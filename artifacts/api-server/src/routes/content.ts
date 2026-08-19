import { Router } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import multer from "multer";
import { toFile } from "openai";
import { CAPTION_DIR } from "../lib/caption-engine";
import { db } from "@workspace/db";
import { contentPlanItemsTable, settingsTable, automationConfigTable, videosTable } from "@workspace/db";
import { eq, and, sql, isNotNull, gte, lte, inArray, lt } from "drizzle-orm";
import { computeUpcomingSlots } from "../lib/schedule";
import {
  GetContentPlanQueryParams,
  GetContentPlanResponse,
  GenerateContentPlanBody,
  CreateContentItemBody,
  CreateContentItemResponse,
  ProcessContentItemNowParams,
  ProcessContentItemNowResponse,
  GenerateContentPlanResponse,
  GenerateScriptBody,
  GenerateScriptResponse,
  GetContentItemParams,
  GetContentItemResponse,
  UpdateContentItemParams,
  UpdateContentItemBody,
  UpdateContentItemResponse,
  DeleteContentItemParams,
  DeleteContentItemResponse,
} from "@workspace/api-zod";
import { generateScript, generateContentTopics, regenerateCaption, regenerateScriptWithCriterion, reanalyzeTopicsWithStrategy, interpretExpressOrder, type RegenerateCriterion } from "../lib/ai-scripts";
import { makeOpenAIClient } from "../lib/openai-client";
import { hasEnoughCredits, computeReelCreditCost, estimateDurationFromScript } from "../lib/credits";
import { runAutomationCycle, triggerFillEmptySlots } from "../lib/scheduler";
import { getLatestAuditCache } from "../lib/audit-cache";
import { getStrategyProfile, toStrategyContext } from "../lib/strategy-profile";
import { logger } from "../lib/logger";

/** Normalise a title for duplicate detection: lowercase, strip accents + punctuation */
function normTopic(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip accents
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove duplicates within `topics`, also excluding any already in `existing` */
function deduplicateTopics<T extends { topic: string }>(topics: T[], existing: string[]): T[] {
  const seen = new Set(existing.map(normTopic));
  return topics.filter(t => {
    const n = normTopic(t.topic);
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

const router = Router();

interface VideoInfo {
  captionStatus: string | null;
  videoStatus: string | null;
  videoUrl: string | null;
  captionedVideoUrl: string | null;
  thumbnailUrl: string | null;
  videoEffects: Record<string, boolean> | null;
}

function mapItem(
  item: typeof contentPlanItemsTable.$inferSelect,
  captionStatus?: string | null,
  videoInfo?: VideoInfo | null
) {
  return {
    id: item.id,
    topic: item.topic,
    hook: item.hook ?? null,
    script: item.script ?? null,
    cta: item.cta ?? null,
    avatar_id: item.avatarId ?? null,
    wavespeed_look_id: item.wavespeedLookId ?? null,
    voice_id: item.voiceId ?? null,
    caption: item.caption ?? null,
    hashtags: item.hashtags ?? null,
    scheduled_at: item.scheduledAt?.toISOString() ?? null,
    status: item.status,
    video_id: item.videoId ?? null,
    caption_status: captionStatus ?? null,
    copy_status: item.copyStatus ?? null,
    video_url: videoInfo?.videoUrl ?? null,
    captioned_video_url: videoInfo?.captionedVideoUrl ?? null,
    thumbnail_url: videoInfo?.thumbnailUrl ?? null,
    video_status: videoInfo?.videoStatus ?? null,
    // Effects actually applied when the video was processed (from the video record).
    // Distinct from video_effects_override which is the per-item config setting.
    video_effects: videoInfo?.videoEffects ?? null,
    // ── Viral Editorial Engine fields ────────────────────────────────────────
    viral_score: item.viralScore ?? null,
    editorial_angle: item.editorialAngle ?? null,
    hook_candidates: item.hookCandidates ?? null,
    hook_selection_reason: item.hookSelectionReason ?? null,
    share_reason: item.shareReason ?? null,
    audience_pain: item.audiencePain ?? null,
    novelty_level: item.noveltyLevel ?? null,
    // ────────────────────────────────────────────────────────────────────────
    video_effects_override: item.videoEffectsOverride ?? null,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  };
}

/** Same stale-URL filter used in videos.ts mapVideo */
function resolveCaptionedUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.includes("/api/captioned/")) return raw;
  const filename = raw.split("/api/captioned/").pop() ?? "";
  const filePath = path.join(CAPTION_DIR, filename);
  return fs.existsSync(filePath) ? raw : null;
}

/** Fetch video info for a list of video IDs — caption status, URLs, thumbnail. */
async function fetchVideoInfos(videoIds: number[]): Promise<Map<number, VideoInfo>> {
  if (videoIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: videosTable.id,
      captionStatus: videosTable.captionStatus,
      videoStatus: videosTable.status,
      videoUrl: videosTable.videoUrl,
      captionedVideoUrl: videosTable.captionedVideoUrl,
      thumbnailUrl: videosTable.thumbnailUrl,
      videoEffects: videosTable.videoEffects,
    })
    .from(videosTable)
    .where(inArray(videosTable.id, videoIds));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        captionStatus: r.captionStatus,
        videoStatus: r.videoStatus,
        videoUrl: r.videoUrl,
        captionedVideoUrl: resolveCaptionedUrl(r.captionedVideoUrl),
        thumbnailUrl: r.thumbnailUrl,
        videoEffects: (r.videoEffects as Record<string, boolean> | null) ?? null,
      },
    ])
  );
}

router.get("/content/plan", async (req, res): Promise<void> => {
  const queryParsed = GetContentPlanQueryParams.safeParse(req.query);
  const status = queryParsed.success ? queryParsed.data.status ?? "all" : "all";
  const limit = queryParsed.success ? queryParsed.data.limit ?? 30 : 30;

  const conditions =
    status !== "all" ? [eq(contentPlanItemsTable.status, status)] : [];

  const userId = req.session.user!.userId;
  // Fetch items + automation config in parallel
  const [items, [automation]] = await Promise.all([
    db
      .select()
      .from(contentPlanItemsTable)
      .where(conditions.length > 0 ? and(eq(contentPlanItemsTable.userId, userId), ...conditions) : eq(contentPlanItemsTable.userId, userId))
      .orderBy(
        sql`${contentPlanItemsTable.scheduledAt} ASC NULLS LAST`,
        contentPlanItemsTable.createdAt
      )
      .limit(limit),
    db.select().from(automationConfigTable).where(eq(automationConfigTable.userId, userId)).limit(1),
  ]);

  const captionsGloballyEnabled = automation?.captionsEnabled ?? false;

  // Fetch video info (caption status + URLs) for items that have an associated video
  const videoIds = items.map((i) => i.videoId).filter((v): v is number => v != null);
  const videoInfoMap = await fetchVideoInfos(videoIds);

  res.json(
    GetContentPlanResponse.parse(
      items.map((i) => {
        if (i.videoId == null) return mapItem(i, null, null);

        const info = videoInfoMap.get(i.videoId) ?? null;
        let cs = info?.captionStatus ?? null;

        // Backfill: videos created before the captionStatus-aware fix have
        // captionStatus = "disabled" by default. If captions are globally
        // enabled and the item is still in-flight (generating/ready), treat
        // it as null (pending) so the Caption Studio step appears in the UI.
        const inFlight = i.status === "generating" || i.status === "ready";
        if (captionsGloballyEnabled && cs === "disabled" && inFlight) {
          cs = null;
        }

        return mapItem(i, cs, info);
      })
    )
  );
});

router.post("/content/plan/generate", async (req, res): Promise<void> => {
  const parsed = GenerateContentPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.session.user!.userId;
  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1);
  const niche = settings?.niche ?? "marketing digital";
  const keywords = settings?.topicKeywords ?? [];
  const tone = settings?.tone ?? "casual";
  const language = settings?.language ?? "es";

  const existingItems = await db.select({ topic: contentPlanItemsTable.topic }).from(contentPlanItemsTable)
    .where(eq(contentPlanItemsTable.userId, userId)).limit(20);
  const existingTopics = existingItems.map((i) => i.topic);

  // Compute publishing slots from the automation schedule (days of week + times)
  const [automation] = await db.select().from(automationConfigTable).where(eq(automationConfigTable.userId, userId)).limit(1);
  const now = new Date();
  const futureScheduled = await db
    .select({ scheduledAt: contentPlanItemsTable.scheduledAt })
    .from(contentPlanItemsTable)
    .where(and(eq(contentPlanItemsTable.userId, userId), isNotNull(contentPlanItemsTable.scheduledAt), gte(contentPlanItemsTable.scheduledAt, now)));

  // Start scheduling from the day AFTER the last already-planned item so new
  // content never lands in the same week as existing content.
  const occupiedDates = futureScheduled.map((r) => r.scheduledAt!).filter(Boolean);
  const lastScheduled = occupiedDates.length > 0
    ? new Date(Math.max(...occupiedDates.map((d) => d.getTime())))
    : null;

  // Move cursor to start-of-day (midnight UTC) the day after the last item.
  // If nothing is scheduled yet, start from now as before.
  const fromDate = lastScheduled
    ? new Date(Date.UTC(
        lastScheduled.getUTCFullYear(),
        lastScheduled.getUTCMonth(),
        lastScheduled.getUTCDate() + 1,  // next calendar day
        0, 0, 0, 0
      ))
    : now;

  const postsPerDay = parsed.data.posts_per_day ?? 1;
  const slots = computeUpcomingSlots({
    daysOfWeek: automation?.daysOfWeek ?? [1, 2, 3, 4, 5],
    postingTimes: automation?.postingTimes ?? ["09:00"],
    timezone: automation?.timezone ?? "America/Buenos_Aires",
    scheduledDays: parsed.data.days,
    postsPerDay,
    occupied: occupiedDates,
    from: fromDate,
  });

  if (slots.length === 0) {
    res.status(400).json({ error: "No hay horarios disponibles: revisa los días y horas en Automatización" });
    return;
  }

  // Load strategy profile (primary context) + audit cache (fallback)
  const [auditInsights, strategyProfile] = await Promise.all([
    getLatestAuditCache().catch(() => null),
    getStrategyProfile(userId).catch(() => null),
  ]);
  const strategyContext = strategyProfile ? toStrategyContext(strategyProfile) : undefined;

  const rawTopics = await generateContentTopics(
    niche,
    keywords,
    tone,
    language,
    parsed.data.days,
    postsPerDay,
    existingTopics,
    auditInsights ?? undefined,
    strategyContext ?? undefined,
  );

  // Server-side safety net: remove any topics the AI returned more than once
  // or that are too similar to topics already in the plan.
  const topics = deduplicateTopics(rawTopics, existingTopics);

  const inserted = await db
    .insert(contentPlanItemsTable)
    .values(
      topics.slice(0, slots.length).map((t, i) => ({
        userId,
        topic: t.topic,
        scheduledAt: slots[i],
        status: "draft",
        viralScore: t.viral_score ?? null,
        editorialAngle: t.editorial_angle ?? null,
        shareReason: t.share_reason ?? null,
        audiencePain: t.audience_pain ?? null,
        noveltyLevel: t.novelty_level ?? null,
        visualDependency: t.visual_dependency ?? null,
        formatFitScore: t.format_fit_score ?? null,
        suggestedVisualSupport: t.suggested_visual_support?.length ? JSON.stringify(t.suggested_visual_support) : null,
        avatarFitReason: t.avatar_talking_head_fit_reason ?? null,
      }))
    )
    .returning();

  res.status(201).json(GenerateContentPlanResponse.parse(inserted.map((i) => mapItem(i))));
});

router.post("/content", async (req, res): Promise<void> => {
  const parsed = CreateContentItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.session.user!.userId;
  let topic = parsed.data.topic?.trim() ?? "";

  // If no topic given, ask the AI for one
  if (!topic) {
    const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1);
    const niche = settings?.niche ?? "marketing digital";
    const keywords = settings?.topicKeywords ?? [];
    const tone = settings?.tone ?? "casual";
    const language = settings?.language ?? "es";
    const existingItems = await db.select({ topic: contentPlanItemsTable.topic }).from(contentPlanItemsTable)
      .where(eq(contentPlanItemsTable.userId, userId)).limit(20);
    const [auditInsights, strategyProfile] = await Promise.all([
      getLatestAuditCache().catch(() => null),
      getStrategyProfile(userId).catch(() => null),
    ]);
    const strategyCtx = strategyProfile ? toStrategyContext(strategyProfile) : undefined;
    const generated = await generateContentTopics(niche, keywords, tone, language, 1, 1, existingItems.map((i) => i.topic), auditInsights ?? undefined, strategyCtx ?? undefined);
    if (!generated[0]?.topic) {
      res.status(500).json({ error: "No se pudo generar el tema" });
      return;
    }
    topic = generated[0].topic;
  }

  const [inserted] = await db
    .insert(contentPlanItemsTable)
    .values({
      userId,
      topic,
      scheduledAt: parsed.data.scheduled_at ? new Date(parsed.data.scheduled_at) : null,
      status: "draft",
    })
    .returning();

  res.status(201).json(CreateContentItemResponse.parse(mapItem(inserted)));
});

// ── Video Express ─────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);
const expressUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

/** Per-user in-flight lock: one Video Express order processing at a time. */
const expressInFlight = new Set<number>();
/**
 * Users whose express-launched generation cycle hasn't claimed a video row
 * yet. Closes the race between firing runAutomationCycle (fire-and-forget)
 * and the videos.status='generating' row appearing: a second order arriving
 * in that window is queued instead of double-generating.
 */
const expressLaunching = new Set<number>();

const EXPRESS_MIN_SECONDS = 2;
const EXPRESS_MAX_SECONDS = 120;

/** Probe audio duration (seconds) with ffprobe; returns null when unreadable. */
async function probeAudioDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { timeout: 15_000 });
    const dur = parseFloat(stdout.trim());
    return Number.isFinite(dur) ? dur : null;
  } catch {
    return null;
  }
}

/** Convert an uploaded audio buffer to 16 kHz mono WAV for transcription. */
async function convertExpressAudioToWav(inputBuffer: Buffer, ext: string): Promise<{ wav: Buffer; durationSec: number | null }> {
  const tmpDir = os.tmpdir();
  const id = `express_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(tmpDir, `${id}_in${ext}`);
  const outputPath = path.join(tmpDir, `${id}_out.wav`);
  try {
    await fs.promises.writeFile(inputPath, inputBuffer);
    const durationSec = await probeAudioDuration(inputPath);
    // -t caps decoded output so a malformed/compressed bomb can't fill disk;
    // the process timeout caps CPU. Duration validity is enforced by caller.
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-t", String(EXPRESS_MAX_SECONDS + 5),
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
      outputPath,
    ], { timeout: 60_000 });
    return { wav: await fs.promises.readFile(outputPath), durationSec };
  } finally {
    // The command audio is transient by design: nothing is persisted anywhere.
    await fs.promises.unlink(inputPath).catch(() => {});
    await fs.promises.unlink(outputPath).catch(() => {});
  }
}

/**
 * POST /content/express
 *
 * Video Express: receive a spoken order (multipart "audio"), transcribe it,
 * interpret the editorial instructions, create a scripted content-plan item
 * and kick off the normal generation pipeline. Available to all plans; the
 * video bills through the normal credit lifecycle (no extra cost here).
 */
router.post("/content/express", (req, res, next) => {
  expressUpload.single("audio")(req, res, (err: unknown) => {
    if (err) {
      const isSize = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
      res.status(isSize ? 413 : 400).json({
        error: isSize ? "El audio supera el máximo de 16 MB." : "No se pudo recibir el audio. Inténtalo de nuevo.",
      });
      return;
    }
    next();
  });
}, async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;

  if (!req.file || !req.file.buffer?.length) {
    res.status(400).json({ error: "No se recibió ningún audio. Graba tu orden e inténtalo de nuevo." });
    return;
  }
  const mime = req.file.mimetype ?? "";
  if (!mime.startsWith("audio/") && !mime.startsWith("video/webm")) {
    res.status(400).json({ error: "Formato no válido: solo se aceptan archivos de audio." });
    return;
  }

  if (expressInFlight.has(userId)) {
    res.status(429).json({ error: "Ya estamos procesando una orden tuya. Espera a que termine antes de enviar otra." });
    return;
  }
  expressInFlight.add(userId);

  try {
    // 1 ── Normalize + validate the recording
    const ext = path.extname(req.file.originalname || "").toLowerCase() || ".webm";
    let wav: Buffer; let durationSec: number | null;
    try {
      ({ wav, durationSec } = await convertExpressAudioToWav(req.file.buffer, ext));
    } catch (err) {
      logger.error({ err, userId }, "[VideoExpress] Audio conversion failed");
      res.status(400).json({ error: "No se pudo leer el audio. Graba de nuevo o sube otro archivo." });
      return;
    }
    if (durationSec === null) {
      // Unprobeable media: reject instead of trusting it (resource-abuse guard).
      res.status(400).json({ error: "No se pudo leer el audio. Graba de nuevo o sube otro archivo." });
      return;
    }
    if (durationSec < EXPRESS_MIN_SECONDS) {
      res.status(400).json({ error: "El audio es demasiado corto. Describe qué video quieres en unos segundos." });
      return;
    }
    if (durationSec > EXPRESS_MAX_SECONDS) {
      res.status(400).json({ error: `El audio supera el máximo de ${EXPRESS_MAX_SECONDS} segundos para una orden. Grábala más breve.` });
      return;
    }

    // 2 ── Transcribe (the WAV lives only in memory; nothing is persisted)
    const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1);
    const language = settings?.language ?? "es";
    let transcript = "";
    try {
      const openai = makeOpenAIClient({ timeout: 120_000 });
      const tr = await openai.audio.transcriptions.create({
        model: "gpt-4o-mini-transcribe",
        file: await toFile(wav, "orden.wav"),
        ...(language === "es" || language === "en" ? { language } : {}),
      });
      transcript = (tr.text ?? "").trim();
    } catch (err) {
      logger.error({ err, userId }, "[VideoExpress] Transcription failed");
      res.status(502).json({ error: "No se pudo transcribir el audio. Inténtalo de nuevo en unos minutos." });
      return;
    }
    if (transcript.replace(/\s+/g, " ").length < 10) {
      res.status(422).json({ error: "No se detectó una instrucción en el audio. Cuéntanos qué video quieres crear." });
      return;
    }

    // 3 ── Interpret the order (topic + explicit editorial constraints)
    let order;
    try {
      order = await interpretExpressOrder(transcript, language);
    } catch (err) {
      logger.error({ err, userId }, "[VideoExpress] Order interpretation failed");
      res.status(502).json({ error: "No se pudo interpretar la orden. Inténtalo de nuevo." });
      return;
    }
    if (!order.comprehensible || !order.topic) {
      res.status(422).json({
        error: order.rejection_reason ?? "No entendimos qué video quieres. Intenta describirlo con una frase como: «créame un video sobre…».",
      });
      return;
    }

    // 4 ── Generate the full script honoring the dictated constraints
    const durationTarget = order.duration_seconds ?? settings?.videoDurationSeconds ?? 60;
    const extraDirectives = [
      ...(order.audience ? [`Dirigido a esta audiencia: ${order.audience}`] : []),
      ...order.extra_instructions,
    ];
    let script;
    try {
      script = await generateScript(
        order.topic,
        settings?.niche ?? "marketing digital",
        order.tone ?? settings?.tone ?? "casual",
        language,
        durationTarget,
        {
          customCta: order.explicit_cta ?? settings?.customCta,
          extraDirectives,
          nicheDescription: settings?.nicheDescription,
          topicKeywords: (settings?.topicKeywords as string[] | null) ?? undefined,
          offer: settings?.offer,
          idealAudience: settings?.idealAudience,
          uniqueValueProp: settings?.uniqueValueProp,
          voiceStyle: settings?.voiceStyle,
          commonObjections: settings?.commonObjections,
        },
      );
    } catch (err) {
      logger.error({ err, userId }, "[VideoExpress] Script generation failed");
      res.status(502).json({ error: "No se pudo crear el guion. Inténtalo de nuevo en unos minutos." });
      return;
    }
    // A literally dictated CTA always wins over the generated one.
    if (order.explicit_cta) script.cta = order.explicit_cta;

    // 5 ── Create the plan item, already scripted and due now
    const [inserted] = await db
      .insert(contentPlanItemsTable)
      .values({
        userId,
        topic: order.topic,
        hook: script.hook,
        script: script.script,
        cta: script.cta,
        caption: script.caption,
        hashtags: script.hashtags,
        hookCandidates: script.hook_candidates?.length ? JSON.stringify(script.hook_candidates) : null,
        hookSelectionReason: script.hook_selection_reason || null,
        status: "scripted",
        scheduledAt: new Date(),
      })
      .returning();

    // 6 ── Launch generation through the normal pipeline (credits included),
    //      or leave the item queued if another video is already generating.
    const [alreadyGenerating] = await db
      .select({ id: videosTable.id })
      .from(videosTable)
      .where(and(eq(videosTable.status, "generating"), eq(videosTable.userId, userId)))
      .limit(1);

    let launch: "generating" | "queued" = "queued";
    let warning: string | null = null;

    const estimatedCost = computeReelCreditCost(estimateDurationFromScript(script.script));
    const isAdminUser = req.session.user!.role === "admin";
    // Fail closed: if the credit store can't be read, queue instead of launching.
    const enoughCredits = isAdminUser || await hasEnoughCredits(userId, estimatedCost).catch(() => false);

    if (alreadyGenerating || expressLaunching.has(userId)) {
      warning = "Ya hay un video generándose. Este quedó listo en tu plan y podrás generarlo en cuanto termine.";
    } else if (!enoughCredits) {
      warning = "El guion quedó guardado en tu plan, pero no tienes créditos suficientes para generar el video ahora. Recarga tu saldo y genéralo desde el plan.";
    } else {
      // Await the cycle (same contract as /content/:id/process): only report
      // "generating" when a video was actually claimed and launched.
      expressLaunching.add(userId);
      try {
        const result = await runAutomationCycle(userId, inserted.id);
        if (result.success) {
          launch = "generating";
        } else {
          warning = `No se pudo iniciar la generación automáticamente: ${result.message}. El guion quedó en tu plan — revisa tu configuración y genéralo desde ahí.`;
        }
      } catch (err) {
        logger.error({ err, itemId: inserted.id, userId }, "[VideoExpress] runAutomationCycle failed");
        warning = "No se pudo iniciar la generación automáticamente. El guion quedó en tu plan, listo para generar desde ahí.";
      } finally {
        expressLaunching.delete(userId);
      }
    }

    res.status(201).json({
      item: mapItem(inserted),
      transcript,
      status: launch,
      warning,
      detected: {
        topic: order.topic,
        explicit_cta: order.explicit_cta,
        duration_seconds: durationTarget,
        tone: order.tone,
        audience: order.audience,
      },
    });
  } finally {
    expressInFlight.delete(userId);
  }
});

router.post("/content/:id/process", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = ProcessContentItemNowParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [item] = await db
    .select()
    .from(contentPlanItemsTable)
    .where(and(eq(contentPlanItemsTable.id, paramsParsed.data.id), eq(contentPlanItemsTable.userId, userId)))
    .limit(1);

  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (item.status !== "draft" && item.status !== "scripted") {
    res.status(400).json({ error: `El video ya está en proceso (estado: ${item.status})` });
    return;
  }

  // Bring the item forward to now, then kick off the full pipeline
  await db
    .update(contentPlanItemsTable)
    .set({ scheduledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(contentPlanItemsTable.id, item.id), eq(contentPlanItemsTable.userId, userId)));

  const result = await runAutomationCycle(userId, item.id);
  res.json(ProcessContentItemNowResponse.parse({ success: result.success, message: result.message }));
});

// Suggest a fresh AI topic for an existing content item (without generating the script).
// Returns a single {topic} string so the user can accept/retry/cancel inline.
router.post("/content/:id/suggest-topic", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number(raw);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1);
  const niche    = settings?.niche ?? "marketing digital";
  const keywords = settings?.topicKeywords ?? [];
  const tone     = settings?.tone ?? "casual";
  const language = settings?.language ?? "es";

  // Avoid repeating any existing topic
  const existing = await db.select({ topic: contentPlanItemsTable.topic }).from(contentPlanItemsTable)
    .where(eq(contentPlanItemsTable.userId, userId));
  const existingTopics = existing.map((i) => i.topic);

  const [auditInsights, strategyProfile] = await Promise.all([
    getLatestAuditCache().catch(() => null),
    getStrategyProfile(userId).catch(() => null),
  ]);
  const strategyCtxSuggest = strategyProfile ? toStrategyContext(strategyProfile) : undefined;
  const [generated] = await generateContentTopics(niche, keywords, tone, language, 1, 1, existingTopics, auditInsights ?? undefined, strategyCtxSuggest ?? undefined);
  if (!generated?.topic) { res.status(500).json({ error: "No se pudo generar el tema" }); return; }

  res.json({ topic: generated.topic });
});

router.post("/content/script", async (req, res): Promise<void> => {
  const parsed = GenerateScriptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.userId, req.session.user!.userId)).limit(1);
  const niche = settings?.niche ?? "marketing digital";
  const tone = settings?.tone ?? "casual";
  const language = settings?.language ?? "es";
  const duration = parsed.data.duration_seconds ?? 60;

  const result = await generateScript(parsed.data.topic, niche, tone, language, duration, {
    nicheDescription: settings?.nicheDescription,
    topicKeywords: (settings?.topicKeywords as string[] | null) ?? undefined,
    offer: settings?.offer,
    idealAudience: settings?.idealAudience,
    uniqueValueProp: settings?.uniqueValueProp,
    voiceStyle: settings?.voiceStyle,
    commonObjections: settings?.commonObjections,
    customCta: settings?.customCta,
  });

  res.json(
    GenerateScriptResponse.parse({
      topic: result.topic,
      hook: result.hook,
      script: result.script,
      cta: result.cta,
      caption: result.caption,
      hashtags: result.hashtags,
      estimated_duration_seconds: result.estimated_duration_seconds,
    })
  );
});

router.get("/content/:id", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const idParsed = GetContentItemParams.safeParse({ id: Number(raw) });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [item] = await db
    .select()
    .from(contentPlanItemsTable)
    .where(and(eq(contentPlanItemsTable.id, idParsed.data.id), eq(contentPlanItemsTable.userId, userId)))
    .limit(1);

  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(GetContentItemResponse.parse(mapItem(item)));
});

router.patch("/content/:id", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = UpdateContentItemParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const bodyParsed = UpdateContentItemBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const updates: Partial<typeof contentPlanItemsTable.$inferInsert> = { updatedAt: new Date() };
  const b = bodyParsed.data;
  if (b.topic !== undefined) updates.topic = b.topic;
  if (b.hook !== undefined) updates.hook = b.hook ?? null;
  if (b.script !== undefined) updates.script = b.script ?? null;
  if (b.cta !== undefined) updates.cta = b.cta ?? null;
  if (b.avatar_id !== undefined) updates.avatarId = b.avatar_id ?? null;
  if (b.wavespeed_look_id !== undefined) updates.wavespeedLookId = b.wavespeed_look_id ?? null;
  if (b.voice_id !== undefined) updates.voiceId = b.voice_id ?? null;
  if (b.caption !== undefined) updates.caption = b.caption ?? null;
  if (b.hashtags !== undefined) updates.hashtags = b.hashtags ?? null;
  if (b.scheduled_at !== undefined) updates.scheduledAt = b.scheduled_at ? new Date(b.scheduled_at) : null;
  if (b.video_effects_override !== undefined) updates.videoEffectsOverride = b.video_effects_override ?? null;

  // If script was added, move to scripted status
  if (b.script && b.script.length > 10) {
    const [existing] = await db.select().from(contentPlanItemsTable)
      .where(and(eq(contentPlanItemsTable.id, paramsParsed.data.id), eq(contentPlanItemsTable.userId, userId))).limit(1);
    if (existing?.status === "draft") updates.status = "scripted";
  }

  const [updated] = await db
    .update(contentPlanItemsTable)
    .set(updates)
    .where(and(eq(contentPlanItemsTable.id, paramsParsed.data.id), eq(contentPlanItemsTable.userId, userId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(UpdateContentItemResponse.parse(mapItem(updated)));

  // If the user moved this item to a different date, immediately fill the
  // slot it left behind instead of waiting for the next cron cycle (up to 5 min).
  if (b.scheduled_at !== undefined) {
    triggerFillEmptySlots(userId).catch(() => {/* non-fatal */});
  }
});

router.post("/content/:id/regenerate-caption", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const userId = req.session.user!.userId;
  const [[item], [settings], auditInsights] = await Promise.all([
    db.select().from(contentPlanItemsTable).where(and(eq(contentPlanItemsTable.id, id), eq(contentPlanItemsTable.userId, userId))).limit(1),
    db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1),
    getLatestAuditCache().catch(() => null),
  ]);
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  const niche    = settings?.niche    ?? "marketing digital";
  const tone     = settings?.tone     ?? "casual";
  const language = settings?.language ?? "es";

  const result = await regenerateCaption(
    item.topic,
    item.script ?? item.hook ?? item.topic,
    niche, tone, language,
    auditInsights?.topCaptions?.slice(0, 3),
  );
  res.json(result);
});

/**
 * Regenerate the script for a content item with a different editorial criterion.
 * POST /content/:id/regenerate
 * Body: { criterion: "educational" | "controversial" | "storytelling" | "sales" | "emotional" }
 */
router.post("/content/:id/regenerate", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const VALID_CRITERIA = ["educational", "controversial", "storytelling", "sales", "emotional"] as const;
  const criterion = req.body?.criterion as RegenerateCriterion;
  if (!VALID_CRITERIA.includes(criterion)) {
    res.status(400).json({ error: `criterion must be one of: ${VALID_CRITERIA.join(", ")}` });
    return;
  }

  const userId = req.session.user!.userId;
  const [[item], [settings], auditInsights] = await Promise.all([
    db.select().from(contentPlanItemsTable).where(and(eq(contentPlanItemsTable.id, id), eq(contentPlanItemsTable.userId, userId))).limit(1),
    db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1),
    getLatestAuditCache().catch(() => null),
  ]);
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  if (item.status !== "draft" && item.status !== "scripted") {
    res.status(400).json({ error: `Cannot regenerate script for item in status "${item.status}"` });
    return;
  }

  const niche    = settings?.niche    ?? "marketing digital";
  const tone     = settings?.tone     ?? "casual";
  const language = settings?.language ?? "es";
  const duration = settings?.videoDurationSeconds ?? 60;

  const scriptResult = await regenerateScriptWithCriterion(
    item.topic, niche, tone, language, duration, criterion,
    auditInsights ?? undefined,
  );

  const [updated] = await db
    .update(contentPlanItemsTable)
    .set({
      hook: scriptResult.hook,
      script: scriptResult.script,
      cta: scriptResult.cta,
      caption: scriptResult.caption,
      hashtags: scriptResult.hashtags,
      hookCandidates: scriptResult.hook_candidates.length > 0 ? JSON.stringify(scriptResult.hook_candidates) : null,
      hookSelectionReason: scriptResult.hook_selection_reason || null,
      status: "scripted",
      updatedAt: new Date(),
    })
    .where(and(eq(contentPlanItemsTable.id, id), eq(contentPlanItemsTable.userId, userId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  res.json({ success: true, item: mapItem(updated), criterion });
});

// ── POST /content/plan/reschedule-overdue — move past-dated drafts to future slots ──

router.post("/content/plan/reschedule-overdue", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  try {
    const now = new Date();

    // Find all unprocessed items whose scheduled date is in the past
    const overdueItems = await db
      .select()
      .from(contentPlanItemsTable)
      .where(
        and(
          eq(contentPlanItemsTable.userId, userId),
          inArray(contentPlanItemsTable.status, ["draft", "scripted"]),
          isNotNull(contentPlanItemsTable.scheduledAt),
          lt(contentPlanItemsTable.scheduledAt, now),
        )
      )
      .orderBy(contentPlanItemsTable.scheduledAt);

    if (overdueItems.length === 0) {
      res.json({ rescheduled: 0 });
      return;
    }

    // Load automation config to know posting days/times/timezone
    const [automation] = await db.select().from(automationConfigTable)
      .where(eq(automationConfigTable.userId, userId)).limit(1);

    // Find the last FUTURE scheduled item to anchor new slots after it
    const futureScheduled = await db
      .select({ scheduledAt: contentPlanItemsTable.scheduledAt })
      .from(contentPlanItemsTable)
      .where(and(eq(contentPlanItemsTable.userId, userId), isNotNull(contentPlanItemsTable.scheduledAt), gte(contentPlanItemsTable.scheduledAt, now)));

    const occupiedDates = futureScheduled.map((r) => r.scheduledAt!).filter(Boolean);
    const lastScheduled = occupiedDates.length > 0
      ? new Date(Math.max(...occupiedDates.map((d) => d.getTime())))
      : null;

    // Start assigning slots from the day AFTER the last scheduled item (or from today)
    const fromDate = lastScheduled
      ? new Date(Date.UTC(
          lastScheduled.getUTCFullYear(),
          lastScheduled.getUTCMonth(),
          lastScheduled.getUTCDate() + 1,
          0, 0, 0, 0,
        ))
      : now;

    const newSlots = computeUpcomingSlots({
      daysOfWeek: automation?.daysOfWeek ?? [1, 2, 3, 4, 5],
      postingTimes: automation?.postingTimes ?? ["09:00"],
      timezone: automation?.timezone ?? "America/Buenos_Aires",
      scheduledDays: overdueItems.length * 7, // generous upper bound
      postsPerDay: 1,
      occupied: occupiedDates,
      from: fromDate,
    });

    if (newSlots.length < overdueItems.length) {
      res.status(500).json({ error: "No hay suficientes slots disponibles en el calendario. Revisa los días y horarios en Automatización." });
      return;
    }

    // Reassign each overdue item to the next available future slot
    for (let i = 0; i < overdueItems.length; i++) {
      await db
        .update(contentPlanItemsTable)
        .set({ scheduledAt: newSlots[i], updatedAt: now })
        .where(and(eq(contentPlanItemsTable.id, overdueItems[i].id), eq(contentPlanItemsTable.userId, userId)));
    }

    res.json({ rescheduled: overdueItems.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Reschedule failed" });
  }
});

// ── POST /content/plan/reanalyze — re-score all draft items against strategy ──

router.post("/content/plan/reanalyze", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  try {
    const strategyProfile = await getStrategyProfile(userId);
    if (!strategyProfile?.content_strategy) {
      res.status(400).json({ error: "No hay estrategia generada. Completa el paso de Estrategia en la auditoría primero." });
      return;
    }
    const strategyContext = toStrategyContext(strategyProfile);

    const drafts = await db
      .select({ id: contentPlanItemsTable.id, topic: contentPlanItemsTable.topic })
      .from(contentPlanItemsTable)
      .where(and(eq(contentPlanItemsTable.status, "draft"), eq(contentPlanItemsTable.userId, userId)));

    if (drafts.length === 0) {
      res.json({ updated: 0 });
      return;
    }

    const scores = await reanalyzeTopicsWithStrategy(
      drafts.map((d) => ({ id: d.id, topic: d.topic ?? "" })),
      strategyContext!,
    );

    for (const score of scores) {
      await db
        .update(contentPlanItemsTable)
        .set({
          viralScore:             score.viral_score,
          editorialAngle:         score.editorial_angle,
          visualDependency:       score.visual_dependency,
          formatFitScore:         score.format_fit_score,
          avatarFitReason:        score.avatar_fit_reason,
          suggestedVisualSupport: score.suggested_visual_support.length > 0
            ? JSON.stringify(score.suggested_visual_support)
            : null,
          audiencePain:           score.audience_pain,
          shareReason:            score.share_reason,
        })
        .where(and(eq(contentPlanItemsTable.id, score.id), eq(contentPlanItemsTable.userId, userId)));
    }

    res.json({ updated: scores.length });
  } catch (err: any) {
    logger.error({ err }, "Failed to reanalyze content plan");
    res.status(500).json({ error: err?.message ?? "Reanalysis failed" });
  }
});

router.delete("/content/:id", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = DeleteContentItemParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  // If the item has an associated video, delete it too
  const [item] = await db
    .select({ videoId: contentPlanItemsTable.videoId })
    .from(contentPlanItemsTable)
    .where(and(eq(contentPlanItemsTable.id, paramsParsed.data.id), eq(contentPlanItemsTable.userId, userId)))
    .limit(1);

  await db.delete(contentPlanItemsTable)
    .where(and(eq(contentPlanItemsTable.id, paramsParsed.data.id), eq(contentPlanItemsTable.userId, userId)));

  if (item?.videoId) {
    await db.delete(videosTable).where(and(eq(videosTable.id, item.videoId), eq(videosTable.userId, userId)));
  }

  res.json(DeleteContentItemResponse.parse({ success: true, message: "Deleted" }));
});

export default router;
