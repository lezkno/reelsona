import { Router } from "express";
import { db } from "@workspace/db";
import { automationConfigTable, videosTable, instagramAccountsTable, settingsTable } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import {
  GetAutomationResponse,
  UpdateAutomationBody,
  UpdateAutomationResponse,
  TriggerAutomationResponse,
} from "@workspace/api-zod";
import { runAutomationCycle } from "../lib/scheduler";

const router = Router();

function mapConfig(c: typeof automationConfigTable.$inferSelect, processingLocked: boolean) {
  return {
    enabled: c.enabled,
    posting_times: c.postingTimes ?? ["09:00", "18:00"],
    days_of_week: c.daysOfWeek ?? [1, 2, 3, 4, 5],
    timezone: c.timezone ?? "America/Buenos_Aires",
    auto_generate_script: c.autoGenerateScript,
    auto_generate_video: c.autoGenerateVideo,
    auto_publish: c.autoPublish,
    captions_enabled: c.captionsEnabled,
    auto_cover_enabled: c.autoCoverEnabled,
    last_run_at: c.lastRunAt?.toISOString() ?? null,
    next_run_at: c.nextRunAt?.toISOString() ?? null,
    last_run_status: c.lastRunStatus ?? null,
    processing_locked: processingLocked,
  };
}

/** Returns true if any of this user's videos is currently being processed (HeyGen rendering or caption render). */
async function isProcessingLocked(userId: number): Promise<boolean> {
  const processing = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(
      and(
        eq(videosTable.userId, userId),
        or(
          eq(videosTable.status, "processing"),
          eq(videosTable.captionStatus as any, "processing")
        )
      )
    )
    .limit(1);
  return processing.length > 0;
}

router.get("/automation", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  let [config] = await db.select().from(automationConfigTable)
    .where(eq(automationConfigTable.userId, userId)).limit(1);
  if (!config) {
    [config] = await db.insert(automationConfigTable).values({ userId }).returning();
  }
  const locked = await isProcessingLocked(userId);
  res.json(GetAutomationResponse.parse(mapConfig(config, locked)));
});

router.put("/automation", async (req, res): Promise<void> => {
  const parsed = UpdateAutomationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.session.user!.userId;

  // Block config changes while a video is being processed
  if (await isProcessingLocked(userId)) {
    res.status(409).json({
      error: "No se pueden cambiar las configuraciones mientras hay un video procesándose.",
      processing_locked: true,
    });
    return;
  }

  const [existing] = await db.select().from(automationConfigTable)
    .where(eq(automationConfigTable.userId, userId)).limit(1);
  const updates: Partial<typeof automationConfigTable.$inferInsert> = { updatedAt: new Date() };
  const d = parsed.data;
  if (d.enabled !== undefined) updates.enabled = d.enabled;
  if (d.posting_times !== undefined) updates.postingTimes = d.posting_times;
  if (d.days_of_week !== undefined) updates.daysOfWeek = d.days_of_week;
  if (d.timezone !== undefined) updates.timezone = d.timezone;
  if (d.auto_generate_script !== undefined) updates.autoGenerateScript = d.auto_generate_script;
  if (d.auto_generate_video !== undefined) updates.autoGenerateVideo = d.auto_generate_video;
  if (d.auto_publish !== undefined) updates.autoPublish = d.auto_publish;
  if (d.captions_enabled !== undefined) updates.captionsEnabled = d.captions_enabled;
  if (d.auto_cover_enabled !== undefined) updates.autoCoverEnabled = d.auto_cover_enabled;

  let config;
  if (existing) {
    [config] = await db.update(automationConfigTable).set(updates).where(eq(automationConfigTable.id, existing.id)).returning();
  } else {
    [config] = await db.insert(automationConfigTable).values({ ...updates, userId }).returning();
  }

  res.json(UpdateAutomationResponse.parse(mapConfig(config, false)));
});

// ── Recommended posting times ────────────────────────────────────────────────

type TimeSlot = { time: string; label: string; reason: string }

const NICHE_SLOTS: Array<{ keywords: string[]; slots: TimeSlot[] }> = [
  {
    keywords: ["fitness", "gym", "entrenamiento", "deporte", "salud", "nutrici", "dieta", "crossfit", "pilates", "yoga", "ejercicio"],
    slots: [
      { time: "06:00", label: "Madrugada", reason: "Antes del entrenamiento mañanero" },
      { time: "12:00", label: "Mediodía", reason: "Pausa entre sesiones" },
      { time: "17:00", label: "Pre-entreno", reason: "Hora pico antes del gym de tarde" },
      { time: "20:00", label: "Post-entreno", reason: "Recuperación y reflexión del día" },
    ],
  },
  {
    keywords: ["negocio", "emprendimiento", "emprendedor", "coaching", "liderazgo", "finanzas", "inversion", "inversión", "marketing", "ventas", "startup", "empresa", "business"],
    slots: [
      { time: "08:00", label: "Inicio del día", reason: "Profesionales antes de empezar a trabajar" },
      { time: "12:00", label: "Almuerzo", reason: "Pausa de negocios — alta interacción" },
      { time: "18:00", label: "Fin del trabajo", reason: "Transición al tiempo personal" },
      { time: "21:00", label: "Noche", reason: "Consumo de contenido reflexivo" },
    ],
  },
  {
    keywords: ["comida", "cocina", "receta", "gastronomía", "restaurant", "chef", "food", "pastelería", "panadería", "café", "bebida"],
    slots: [
      { time: "11:00", label: "Pre-almuerzo", reason: "Buscan inspiración antes de comer" },
      { time: "13:00", label: "Almuerzo", reason: "Hora pico de contenido gastronómico" },
      { time: "17:00", label: "Merienda", reason: "Momento de descanso y snacks" },
      { time: "20:00", label: "Cena", reason: "Planificación de la cena" },
    ],
  },
  {
    keywords: ["moda", "ropa", "estilo", "fashion", "outfit", "tendencia", "marca", "diseño", "accesorio", "calzado"],
    slots: [
      { time: "08:00", label: "Mañana", reason: "Planeando el look del día" },
      { time: "13:00", label: "Mediodía", reason: "Descanso — navegación casual" },
      { time: "19:00", label: "Tarde-noche", reason: "Inspiración para el fin del día" },
      { time: "21:00", label: "Noche", reason: "Hora pico de engagement en moda" },
    ],
  },
  {
    keywords: ["viaje", "travel", "turismo", "destino", "aventura", "mochilero", "hotel", "vacacion"],
    slots: [
      { time: "09:00", label: "Mañana", reason: "Planificación del día con energía" },
      { time: "14:00", label: "Siesta", reason: "Ensoñación de viajes" },
      { time: "19:00", label: "Tarde", reason: "Regreso a casa — contenido escapista" },
      { time: "22:00", label: "Noche", reason: "Planificación de próximos viajes" },
    ],
  },
  {
    keywords: ["educaci", "curso", "aprend", "estudio", "universidad", "capacit", "formaci", "idioma", "tutoría", "clases"],
    slots: [
      { time: "07:00", label: "Antes de clases", reason: "Motivación matutina para estudiar" },
      { time: "13:00", label: "Pausa", reason: "Descanso entre clases" },
      { time: "19:00", label: "Estudio nocturno", reason: "Hora pico de estudiantes" },
      { time: "22:00", label: "Noche", reason: "Preparación del día siguiente" },
    ],
  },
  {
    keywords: ["belleza", "maquillaje", "piel", "skincare", "cabello", "estética", "cosmétic", "peluquería", "nail", "uñas", "spa"],
    slots: [
      { time: "08:00", label: "Rutina matutina", reason: "Rituales de belleza de la mañana" },
      { time: "13:00", label: "Mediodía", reason: "Recarga de inspiración" },
      { time: "19:00", label: "Rutina nocturna", reason: "Preparación para la noche" },
      { time: "21:00", label: "Noche", reason: "Skincare nocturno — comunidad activa" },
    ],
  },
  {
    keywords: ["inmobiliaria", "propiedad", "bienes raíces", "real estate", "alquiler", "compra", "venta", "departamento", "casa"],
    slots: [
      { time: "09:00", label: "Apertura", reason: "Inicio de búsqueda de propiedades" },
      { time: "12:00", label: "Almuerzo", reason: "Revisión de opciones en pausa" },
      { time: "18:00", label: "Post-trabajo", reason: "Búsqueda activa al salir del trabajo" },
      { time: "20:00", label: "Noche", reason: "Decisiones familiares en casa" },
    ],
  },
  {
    keywords: ["entretenimiento", "humor", "comedia", "música", "arte", "baile", "video", "contenido", "influencer", "creator"],
    slots: [
      { time: "12:00", label: "Mediodía", reason: "Pausa con contenido entretenido" },
      { time: "17:00", label: "Tarde", reason: "Descanso de fin de jornada" },
      { time: "20:00", label: "Noche", reason: "Prime time de entretenimiento" },
      { time: "22:00", label: "Noche tardía", reason: "Audiencia nocturna activa" },
    ],
  },
]

const DEFAULT_SLOTS: TimeSlot[] = [
  { time: "09:00", label: "Mañana", reason: "Alta actividad matutina en Instagram" },
  { time: "12:00", label: "Mediodía", reason: "Pico de navegación durante el almuerzo" },
  { time: "18:00", label: "Tarde", reason: "Regreso a casa — mucha actividad" },
  { time: "21:00", label: "Noche", reason: "Hora pico global de engagement en IG" },
]

function detectNicheSlots(niche: string): { slots: TimeSlot[]; matched: string | null } {
  const lower = niche.toLowerCase()
  for (const entry of NICHE_SLOTS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return { slots: entry.slots, matched: entry.keywords[0] }
    }
  }
  return { slots: DEFAULT_SLOTS, matched: null }
}

router.get("/automation/recommended-times", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1)
  const [igAccount] = await db.select().from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, userId)).limit(1)

  const niche = settings?.niche ?? ""
  const { slots, matched } = detectNicheSlots(niche)

  res.json({
    recommended: slots,
    niche: niche || null,
    niche_matched: matched,
    account_username: igAccount?.username ?? null,
    source: matched ? "niche" : "default",
  })
})

router.post("/automation/trigger", async (req, res): Promise<void> => {
  req.log.info("Manual automation trigger requested");
  const userId = req.session.user!.userId;
  const result = await runAutomationCycle(userId);
  res.status(202).json(
    TriggerAutomationResponse.parse({
      triggered: result.success,
      message: result.message,
      content_item_id: result.contentItemId ?? null,
      video_id: result.videoId ?? null,
    })
  );
});

export default router;
