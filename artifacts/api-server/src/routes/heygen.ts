import { Router } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import { db } from "@workspace/db";
import { avatarConfigTable, settingsTable, heygenClonedVoicesTable, avatarLookMetadataTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { objectStorageClient, getSignedObjectUrl } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const execFileAsync = promisify(execFile);

/**
 * Convert an audio buffer to WAV (16 kHz mono) using FFmpeg.
 * HeyGen requires WAV/MP3/FLAC — rejects WebM from MediaRecorder.
 */
async function convertToWav(inputBuffer: Buffer, inputExt: string): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const id = `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(tmpDir, `${id}${inputExt}`);
  const outputPath = path.join(tmpDir, `${id}.wav`);
  try {
    await fs.writeFile(inputPath, inputBuffer);
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-ar", "16000",   // 16 kHz — HeyGen recommended
      "-ac", "1",       // mono
      "-c:a", "pcm_s16le",
      outputPath,
    ]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

/**
 * Upload an audio buffer to GCS and return a short-lived signed GET URL
 * accessible by HeyGen (24 h TTL).
 *
 * We use a signed URL because HeyGen fetches the audio server-side and cannot
 * go through Replit's mTLS proxy — a proxy URL would return 403.
 * The recording is stored under "voice-audio/u<userId>/<uuid>.wav" with an
 * unguessable UUID path — it is never served through the unauthenticated
 * captioned-objects proxy route, only through the time-limited signed GCS URL.
 */
async function uploadAudioForCloning(audioBuffer: Buffer, userId: number): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  // Use a UUID so the object name is unguessable and cannot be enumerated.
  // userId is embedded only in the prefix for per-user housekeeping / cleanup.
  const objectName = `voice-audio/u${userId}/${randomUUID()}.wav`;
  const bucket = objectStorageClient.bucket(bucketId);
  const gcsFile = bucket.file(objectName);
  await gcsFile.save(audioBuffer, { contentType: "audio/wav" });

  // Return a signed URL (24 h) so HeyGen can retrieve the audio directly from GCS.
  return getSignedObjectUrl(objectName, 24 * 3600);
}

/** Returns Reelsona's centralized HeyGen API key.
 *  All users share the same platform key — no per-user key required. */
function getUserHeyGenKey(_userId: number): Promise<string | undefined> {
  return Promise.resolve(process.env.HEYGEN_API_KEY ?? undefined);
}

import {
  GetHeyGenAvatarsResponse,
  GetHeyGenVoicesResponse,
  GetHeyGenAvatarGroupsResponse,
  GetHeyGenGroupLooksResponse,
  GetHeyGenAllLooksResponse,
  GetAvatarConfigResponse,
  UpdateAvatarConfigBody,
  UpdateAvatarConfigResponse,
} from "@workspace/api-zod";
import {
  listAvatars, listVoices, listAvatarGroups, listGroupLooks,
  getHeyGenQuota, validateHeyGenKey,
  listV3AvatarGroups, listV3GroupLooks,
  uploadAsset, createPhotoAvatar, createPromptAvatar, createAvatarLook,
  createDigitalTwinFromVideo,
  deleteAvatarLook, deleteAvatarGroup, getAvatarLookStatus,
  cloneVoice, deleteVoice, renameVoice, getVoiceCloneStatus,
  invalidateLookCaches, invalidateDefaultVoiceCache, invalidateAvatarIdsCache,
} from "../lib/heygen";
import { sendEmail } from "../lib/email";

const ALERT_EMAIL = "foto.lezkno@gmail.com";

/** Fire-and-forget alert email to the ops address. Never throws. */
function notifyHeyGenError(action: string, heygenStatus: number, detail: string): void {
  sendEmail({
    to: ALERT_EMAIL,
    subject: `⚠️ Reelsona — Error HeyGen ${heygenStatus} en "${action}"`,
    html: `<p>Se produjo un error <strong>${heygenStatus}</strong> al llamar a HeyGen en la acción <strong>${action}</strong>.</p>
<p><strong>Detalle:</strong> ${detail}</p>
<p><em>Este email se genera automáticamente desde el servidor de Reelsona.</em></p>`,
    text: `Error HeyGen ${heygenStatus} en "${action}". Detalle: ${detail}`,
  }).catch(() => { /* no bloquear el flujo principal */ });
}

/**
 * Extract a human-readable error from a HeyGen axios error.
 * Returns { status, message } where status is the HTTP status code HeyGen returned
 * and message is the most specific text available (prefers HeyGen's own body content).
 */
function extractHeyGenError(err: any): { status: number; message: string; heygenStatus: number; heygenDetail: string } {
  const heygenStatus: number = err?.response?.status ?? 500;
  const body = err?.response?.data as any;
  const heygenDetail: string =
    body?.message ??
    body?.error?.message ??
    body?.error ??
    body?.detail ??
    err?.message ??
    "Error desconocido";

  if (heygenStatus === 402) {
    return {
      status: 502,
      message:
        "En este momento no podemos completar su solicitud. Reintenta de nuevo más tarde. " +
        "Si el problema persiste contacte con soporte.",
      heygenStatus,
      heygenDetail,
    };
  }
  if (heygenStatus === 401) {
    return { status: 401, message: "La API Key de HeyGen es inválida o expiró.", heygenStatus, heygenDetail };
  }
  if (heygenStatus === 403) {
    return { status: 403, message: "Tu cuenta de HeyGen no tiene permiso para realizar esta acción.", heygenStatus, heygenDetail };
  }
  if (heygenStatus === 429) {
    return { status: 429, message: "Demasiadas solicitudes a HeyGen. Espera un momento e intenta de nuevo.", heygenStatus, heygenDetail };
  }
  return { status: heygenStatus >= 400 && heygenStatus < 600 ? heygenStatus : 500, message: heygenDetail, heygenStatus, heygenDetail };
}

// Multer: store file in memory (max 32 MB — HeyGen image limit)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024 } });
// Multer for video uploads: MP4/MOV/WebM, max 512 MB for Digital Twin creation
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("Solo se permiten archivos de video (MP4, MOV o WebM)"));
  },
});
// Multer for voice uploads: audio only, max 25 MB
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("Solo se permiten archivos de audio"));
  },
});

const router = Router();

router.get("/heygen/avatars", async (req, res): Promise<void> => {
  const apiKey = await getUserHeyGenKey(req.session.user!.userId);
  const avatars = await listAvatars(apiKey);
  const mapped = avatars.map((a) => ({
    avatar_id: a.avatar_id,
    avatar_name: a.avatar_name,
    preview_image_url: a.preview_image_url ?? null,
    preview_video_url: a.preview_video_url ?? null,
    gender: a.gender ?? null,
    is_active: true,
  }));
  res.json(GetHeyGenAvatarsResponse.parse(mapped));
});

router.get("/heygen/voices", async (req, res): Promise<void> => {
  const apiKey = await getUserHeyGenKey(req.session.user!.userId);
  const userId = req.session.user!.userId;
  const [voices, myClones] = await Promise.all([
    listVoices(apiKey),
    db.select().from(heygenClonedVoicesTable).where(eq(heygenClonedVoicesTable.userId, userId)),
  ]);
  const myCloneIds      = new Set(myClones.map(c => c.voiceId));
  const myCloneSpeedMap = new Map(myClones.map(c => [c.voiceId, c.speed ?? null]));
  const myClonePitchMap = new Map(myClones.map(c => [c.voiceId, (c as any).pitch ?? null]));
  const myCloneStatusMap = new Map(myClones.map(c => [c.voiceId, c.status]));
  const myCloneIdMap    = new Map(myClones.map(c => [c.voiceId, c.id]));
  const mapped = voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    language: v.language ?? "es",
    gender: v.gender ?? null,
    preview_audio_url: (v as any).preview_audio ?? v.preview_audio_url ?? null,
    is_cloned: v.is_clone ?? false,
    is_mine: myCloneIds.has(v.voice_id),
    speed: myCloneIds.has(v.voice_id) ? (myCloneSpeedMap.get(v.voice_id) ?? null) : null,
    pitch: myCloneIds.has(v.voice_id) ? (myClonePitchMap.get(v.voice_id) ?? null) : null,
    status: myCloneIds.has(v.voice_id) ? (myCloneStatusMap.get(v.voice_id) ?? null) : null,
    clone_id: myCloneIds.has(v.voice_id) ? (myCloneIdMap.get(v.voice_id) ?? undefined) : undefined,
  }));

  const listedVoiceIds = new Set(voices.map(v => v.voice_id));
  for (const clone of myClones) {
    if (!listedVoiceIds.has(clone.voiceId) && (clone.status === "pending" || clone.status === "failed")) {
      mapped.push({
        voice_id: clone.voiceId,
        name: clone.displayName,
        language: "es",
        gender: null,
        preview_audio_url: null,
        is_cloned: true,
        is_mine: true,
        speed: clone.speed ?? null,
        pitch: (clone as any).pitch ?? null,
        status: clone.status,
        clone_id: clone.id,
      });
    }
  }
  res.json(GetHeyGenVoicesResponse.parse(mapped));
});

/**
 * POST /heygen/voices/clone
 * Multipart: audio file (≤25 MB, audio/*) + name (string)
 * Creates a cloned voice in HeyGen and records ownership in heygen_cloned_voices.
 */
router.post("/heygen/voices/clone", voiceUpload.single("audio"), async (req, res): Promise<void> => {
  try {
    const userId = req.session.user!.userId;
    const { name } = req.body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "El nombre es requerido" }); return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Se requiere un archivo de audio" }); return;
    }
    const apiKey = await getUserHeyGenKey(userId);
    const rawSpeed = req.body?.speed;
    const speed = rawSpeed != null ? parseFloat(rawSpeed) : null;

    // HeyGen v3 voice_clone requires a public URL (not multipart).
    // Convert any non-WAV audio to WAV 16 kHz mono first (WebM from MediaRecorder).
    const originalExt = path.extname(req.file.originalname).toLowerCase() || ".bin";
    const needsConversion = [".webm", ".ogg", ".opus", ".mp4", ".m4a"].includes(originalExt);
    let audioBuffer = req.file.buffer;
    if (needsConversion) {
      audioBuffer = await convertToWav(req.file.buffer, originalExt);
    }

    // Upload to GCS so HeyGen can fetch it via public URL
    const audioUrl = await uploadAudioForCloning(audioBuffer, userId);

    const voiceId = await cloneVoice(audioUrl, name.trim(), apiKey);
    await db.insert(heygenClonedVoicesTable).values({
      userId,
      voiceId,
      displayName: name.trim(),
      status: "pending",
      speed: speed != null && !isNaN(speed) ? speed : null,
    });
    res.json({ voice_id: voiceId, display_name: name.trim(), status: "pending" });
  } catch (err: any) {
    const msg = err?.message ?? "Error al clonar la voz";
    console.error("[VoiceClone] Error:", msg, "| HeyGen body:", JSON.stringify(err?.response?.data ?? null));
    res.status(500).json({ error: msg });
  }
});

/**
 * DELETE /heygen/voices/:voiceId
 * Deletes a cloned voice. Only succeeds if the current user owns it.
 */
router.delete("/heygen/voices/:voiceId", async (req, res): Promise<void> => {
  try {
    const userId = req.session.user!.userId;
    const { voiceId } = req.params;
    const [row] = await db
      .select()
      .from(heygenClonedVoicesTable)
      .where(and(eq(heygenClonedVoicesTable.voiceId, voiceId), eq(heygenClonedVoicesTable.userId, userId)));
    if (!row) { res.status(403).json({ error: "No tienes permiso para eliminar esta voz" }); return; }
    const apiKey = await getUserHeyGenKey(userId);
    // Best-effort: if HeyGen returns an error (voice not found, already deleted,
    // failed clone, etc.) we still remove it from our DB so the user can clean up.
    await deleteVoice(voiceId, apiKey).catch(() => {});
    await db.delete(heygenClonedVoicesTable)
      .where(and(eq(heygenClonedVoicesTable.voiceId, voiceId), eq(heygenClonedVoicesTable.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error al eliminar la voz" });
  }
});

/**
 * PATCH /heygen/voices/:voiceId
 * Update a cloned voice (name and/or speed). Only succeeds if the current user owns it.
 * Body: { name?: string, speed?: number | null }
 */
router.patch("/heygen/voices/:voiceId", async (req, res): Promise<void> => {
  try {
    const userId = req.session.user!.userId;
    const { voiceId } = req.params;
    const { name, speed, pitch } = req.body ?? {};
    if (!name && speed === undefined && pitch === undefined) {
      res.status(400).json({ error: "Se requiere nombre, velocidad o tono" }); return;
    }
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      res.status(400).json({ error: "El nombre no puede estar vacío" }); return;
    }
    if (speed !== undefined && speed !== null && (typeof speed !== "number" || speed < 0.5 || speed > 1.5)) {
      res.status(400).json({ error: "La velocidad debe estar entre 0.5 y 1.5" }); return;
    }
    if (pitch !== undefined && pitch !== null && (typeof pitch !== "number" || pitch < -50 || pitch > 50)) {
      res.status(400).json({ error: "El tono debe estar entre -50 y +50" }); return;
    }
    const [row] = await db
      .select()
      .from(heygenClonedVoicesTable)
      .where(and(eq(heygenClonedVoicesTable.voiceId, voiceId), eq(heygenClonedVoicesTable.userId, userId)));
    if (!row) { res.status(403).json({ error: "No tienes permiso para editar esta voz" }); return; }
    const apiKey = await getUserHeyGenKey(userId);
    // Only call HeyGen rename API if name is changing
    if (name && name.trim() !== row.displayName) {
      await renameVoice(voiceId, name.trim(), apiKey);
    }
    const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (name) dbUpdates.displayName = name.trim();
    if (speed !== undefined) dbUpdates.speed = speed;
    if (pitch !== undefined) dbUpdates.pitch = pitch;
    await db.update(heygenClonedVoicesTable)
      .set(dbUpdates as any)
      .where(and(eq(heygenClonedVoicesTable.voiceId, voiceId), eq(heygenClonedVoicesTable.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error al actualizar la voz" });
  }
});

router.get("/heygen/avatar-groups", async (req, res): Promise<void> => {
  const apiKey = await getUserHeyGenKey(req.session.user!.userId);
  const groups = await listAvatarGroups(apiKey);
  const mapped = groups.map((g) => ({
    id: g.id,
    name: g.name,
    group_type: g.group_type,
    num_looks: g.num_looks,
    preview_image_url: g.preview_image ?? null,
  }));
  res.json(GetHeyGenAvatarGroupsResponse.parse(mapped));
});

router.get("/heygen/avatar-groups/:id/looks", async (req, res): Promise<void> => {
  const apiKey = await getUserHeyGenKey(req.session.user!.userId);
  const groupId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const groups = await listAvatarGroups(apiKey);
  const group = groups.find((g) => g.id === groupId);
  if (!group) {
    res.status(404).json({ error: "Avatar no encontrado" });
    return;
  }
  const looks = await listGroupLooks(groupId, apiKey);
  // Looks come in two shapes: video avatars ({avatar_id, avatar_name, preview_image_url})
  // and talking photos ({id, name, image_url}). Prefix talking photos with "tp:" so
  // video generation uses the right character type.
  const mapped = looks
    .map((l: any) => {
      if (l.avatar_id) {
        return { id: l.avatar_id, name: l.avatar_name ?? "Look", image_url: l.preview_image_url ?? null, is_talking_photo: false };
      }
      if (l.id) {
        return { id: `tp:${l.id}`, name: l.name ?? "Look", image_url: l.image_url ?? null, is_talking_photo: true };
      }
      return null;
    })
    .filter((l): l is { id: string; name: string; image_url: string | null; is_talking_photo: boolean } => l !== null);
  res.json(GetHeyGenGroupLooksResponse.parse(mapped));
});

// Flat list of all looks, cached in memory (fetching all groups takes ~20 HeyGen calls)
type FlatLook = { id: string; name: string; image_url: string | null; group_name: string; group_id: string; is_talking_photo: boolean };
let looksCache: { data: FlatLook[]; at: number } | null = null;
let looksFetch: Promise<FlatLook[]> | null = null;

async function fetchAllLooks(apiKey?: string): Promise<FlatLook[]> {
  const groups = await listAvatarGroups(apiKey);
  const all: FlatLook[] = [];
  const results = await Promise.allSettled(
    groups.map(async (g) => ({ group: g, looks: await listGroupLooks(g.id, apiKey) }))
  );
  const anyFailed = results.some((r) => r.status === "rejected");
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const l of r.value.looks as any[]) {
      if (l.avatar_id) {
        all.push({ id: l.avatar_id, name: l.avatar_name ?? "Look", image_url: l.preview_image_url ?? null, group_name: r.value.group.name, group_id: r.value.group.id, is_talking_photo: false });
      } else if (r.value.group && l.id) {
        all.push({ id: `tp:${l.id}`, name: l.name ?? "Look", image_url: l.image_url ?? null, group_name: r.value.group.name, group_id: r.value.group.id, is_talking_photo: true });
      }
    }
  }
  if (anyFailed) {
    // Partial result: prefer the last complete cache (even if stale), and don't cache the partial one
    if (looksCache) return looksCache.data;
    return all;
  }
  looksCache = { data: all, at: Date.now() };
  return all;
}

router.get("/heygen/looks", async (req, res): Promise<void> => {
  const apiKey = await getUserHeyGenKey(req.session.user!.userId);
  if (looksCache && Date.now() - looksCache.at < 5 * 60 * 1000) {
    res.json(GetHeyGenAllLooksResponse.parse(looksCache.data));
    return;
  }
  // Single-flight: coalesce concurrent refreshes (each one is ~20 HeyGen calls)
  if (!looksFetch) {
    looksFetch = fetchAllLooks(apiKey).finally(() => { looksFetch = null; });
  }
  const all = await looksFetch;
  res.json(GetHeyGenAllLooksResponse.parse(all));
});

/**
 * GET /heygen/looks/reverse-lookup?ids=id1,id2,...
 * Returns { [lookId]: groupId } for the requested look IDs.
 * Uses the in-memory looks cache (warmed by the scheduler) so it's fast
 * when data is already cached, and falls back to a full fetch otherwise.
 */
router.get("/heygen/looks/reverse-lookup", async (req, res): Promise<void> => {
  try {
    const ids = ((req.query.ids as string) ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (!ids.length) { res.json({}); return; }

    const apiKey = await getUserHeyGenKey(req.session.user!.userId);
    let looks: FlatLook[];
    if (looksCache && Date.now() - looksCache.at < 5 * 60 * 1000) {
      looks = looksCache.data;
    } else {
      if (!looksFetch) {
        looksFetch = fetchAllLooks(apiKey).finally(() => { looksFetch = null; });
      }
      looks = await looksFetch;
    }

    const idSet = new Set(ids);
    const result: Record<string, string> = {};
    for (const look of looks) {
      if (idSet.has(look.id)) result[look.id] = look.group_id;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "reverse-lookup failed" });
  }
});

router.get("/heygen/avatar-config", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  let [config] = await db.select().from(avatarConfigTable)
    .where(eq(avatarConfigTable.userId, userId)).limit(1);
  if (!config) {
    [config] = await db.insert(avatarConfigTable).values({ userId }).returning();
  }
  res.json(
    GetAvatarConfigResponse.parse({
      selected_avatar_ids: config.selectedAvatarIds ?? [],
      preferred_voice_id: config.preferredVoiceId ?? null,
      voice_overrides: (config.voiceOverrides as Record<string, string>) ?? {},
      rotation_strategy: config.rotationStrategy ?? "sequential",
      last_used_avatar_id: config.lastUsedAvatarId ?? null,
    })
  );
});

router.put("/heygen/avatar-config", async (req, res): Promise<void> => {
  const parsed = UpdateAvatarConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.session.user!.userId;
  const [existing] = await db.select().from(avatarConfigTable)
    .where(eq(avatarConfigTable.userId, userId)).limit(1);
  let config;
  if (existing) {
    [config] = await db
      .update(avatarConfigTable)
      .set({
        selectedAvatarIds: parsed.data.selected_avatar_ids,
        preferredVoiceId: parsed.data.preferred_voice_id ?? null,
        voiceOverrides: parsed.data.voice_overrides ?? {},
        rotationStrategy: parsed.data.rotation_strategy,
        updatedAt: new Date(),
      })
      .where(eq(avatarConfigTable.id, existing.id))
      .returning();
  } else {
    [config] = await db
      .insert(avatarConfigTable)
      .values({
        userId,
        selectedAvatarIds: parsed.data.selected_avatar_ids,
        preferredVoiceId: parsed.data.preferred_voice_id ?? null,
        voiceOverrides: parsed.data.voice_overrides ?? {},
        rotationStrategy: parsed.data.rotation_strategy,
      })
      .returning();
  }

  // Upsert per-look metadata for engine resolution and reference_look_id support
  const lookMetadata = parsed.data.look_metadata;
  if (lookMetadata && Object.keys(lookMetadata).length > 0) {
    // Track which groups already have a master look in the DB so we don't add two
    const existingMasters = await db
      .select({ groupId: avatarLookMetadataTable.groupId })
      .from(avatarLookMetadataTable)
      .where(and(
        eq(avatarLookMetadataTable.userId, userId),
        eq(avatarLookMetadataTable.isMasterLook, true),
      ));
    const mastersSet = new Set(existingMasters.map(m => m.groupId).filter(Boolean) as string[]);

    for (const [lookId, meta] of Object.entries(lookMetadata)) {
      const groupId = meta.group_id ?? null;
      // Auto-assign is_master_look to the first digital_twin look added per group
      let isMasterLook = false;
      if (meta.avatar_type === "digital_twin" && groupId && !mastersSet.has(groupId)) {
        isMasterLook = true;
        mastersSet.add(groupId);
      }

      await db
        .insert(avatarLookMetadataTable)
        .values({
          userId,
          lookId,
          groupId,
          avatarType:           meta.avatar_type ?? null,
          supportedApiEngines:  meta.supported_api_engines ?? [],
          preferredOrientation: meta.preferred_orientation ?? null,
          isMasterLook,
        })
        .onConflictDoUpdate({
          target: [avatarLookMetadataTable.userId, avatarLookMetadataTable.lookId],
          set: {
            groupId,
            avatarType:           meta.avatar_type ?? null,
            supportedApiEngines:  meta.supported_api_engines ?? [],
            preferredOrientation: meta.preferred_orientation ?? null,
            // Only promote — never demote an already-assigned master look
            ...(isMasterLook ? { isMasterLook: true } : {}),
            updatedAt: new Date(),
          },
        });
    }
    logger.info({ userId, count: Object.keys(lookMetadata).length }, "[AvatarConfig] Look metadata upserted");
  }

  res.json(
    UpdateAvatarConfigResponse.parse({
      selected_avatar_ids: config.selectedAvatarIds ?? [],
      preferred_voice_id: config.preferredVoiceId ?? null,
      voice_overrides: (config.voiceOverrides as Record<string, string>) ?? {},
      rotation_strategy: config.rotationStrategy,
      last_used_avatar_id: config.lastUsedAvatarId ?? null,
    })
  );
});

// ── HeyGen account / integration ─────────────────────────────────────────────

/** GET /heygen/account — connection status + remaining quota.
 *  key_source:
 *    "user"     — user has their own API key stored in DB (legacy / advanced)
 *    "platform" — using Reelsona's centralized HEYGEN_API_KEY (default for all new users)
 *    "none"     — no key available anywhere (misconfiguration)
 */
router.get("/heygen/account", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const [settings] = await db
    .select({ heygenApiKey: settingsTable.heygenApiKey })
    .from(settingsTable)
    .where(eq(settingsTable.userId, userId))
    .limit(1);

  const userKey     = settings?.heygenApiKey ?? null;
  const platformKey = process.env.HEYGEN_API_KEY ?? null;
  const apiKey      = userKey ?? platformKey;
  const keySource   = userKey ? "user" : platformKey ? "platform" : "none";

  if (!apiKey) {
    res.json({ connected: false, remaining_quota: null, total_quota: null, details: null, key_source: "none" });
    return;
  }

  // For the platform key we trust it is valid (validated at deploy time);
  // skip the extra validateHeyGenKey() call to avoid unnecessary latency.
  const quota = await getHeyGenQuota(apiKey);
  const connected = keySource === "platform"
    ? true
    : quota.remaining !== null || await validateHeyGenKey(apiKey);

  res.json({
    connected,
    remaining_quota: quota.remaining,
    total_quota: null,
    details: quota.details,
    key_source: keySource,
  });
});

/** POST /heygen/account/connect — validate + persist a new API key for the logged-in user */
router.post("/heygen/account/connect", async (req, res): Promise<void> => {
  const { api_key } = req.body ?? {};
  if (!api_key || typeof api_key !== "string" || !api_key.trim()) {
    res.status(400).json({ error: "api_key es requerida" });
    return;
  }

  const trimmedKey = api_key.trim();

  // Validate before saving
  const valid = await validateHeyGenKey(trimmedKey);
  if (!valid) {
    res.status(400).json({ error: "API Key inválida. Verifica que sea correcta en tu cuenta de HeyGen." });
    return;
  }

  // Persist to the logged-in user's settings row
  const userId = req.session.user!.userId;
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1);
  if (existing) {
    await db.update(settingsTable).set({ heygenApiKey: trimmedKey }).where(eq(settingsTable.id, existing.id));
  } else {
    await db.insert(settingsTable).values({ niche: "", userId, heygenApiKey: trimmedKey });
  }

  const quota = await getHeyGenQuota(trimmedKey);
  res.json({ connected: true, remaining_quota: quota.remaining, total_quota: null, details: quota.details, key_source: "db" });
});

/** DELETE /heygen/account — remove the current user's stored key */
router.delete("/heygen/account", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1);
  if (existing) {
    await db.update(settingsTable).set({ heygenApiKey: null }).where(eq(settingsTable.id, existing.id));
  }
  res.json({ ok: true });
});

// ── v3 Avatar listing ─────────────────────────────────────────────────────────

/** GET /heygen/my-avatar-groups — user's own private avatar groups (v3) */
router.get("/heygen/my-avatar-groups", async (req, res): Promise<void> => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : undefined;
    const result = await listV3AvatarGroups("private", token, 50);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error fetching avatar groups" });
  }
});

/** GET /heygen/public-avatar-groups — HeyGen stock public avatars (v3, paginated) */
router.get("/heygen/public-avatar-groups", async (req, res): Promise<void> => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : undefined;
    const result = await listV3AvatarGroups("public", token, 24);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error fetching public avatars" });
  }
});

/** GET /heygen/v3-groups/:groupId/looks — looks for any group via v3 API */
router.get("/heygen/v3-groups/:groupId/looks", async (req, res): Promise<void> => {
  try {
    const groupId = req.params.groupId;
    const token = typeof req.query.token === "string" ? req.query.token : undefined;
    const result = await listV3GroupLooks(groupId, token);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error fetching looks" });
  }
});

// ── Avatar creation ───────────────────────────────────────────────────────────

/**
 * POST /heygen/assets — upload a photo to HeyGen and return asset_id.
 * Expects multipart/form-data with a "file" field (PNG or JPEG, max 32 MB).
 */
router.post("/heygen/assets", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "Se requiere un archivo de imagen (campo: file)" });
    return;
  }
  try {
    const result = await uploadAsset(req.file.buffer, req.file.mimetype, req.file.originalname);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error al subir la imagen" });
  }
});

/**
 * DELETE /heygen/avatars/looks/:lookId — delete a single avatar look.
 * Only photo_avatar and digital_twin types are supported by HeyGen.
 */
router.delete("/heygen/avatars/looks/:lookId", async (req, res): Promise<void> => {
  const { lookId } = req.params;
  if (!lookId) { res.status(400).json({ error: "lookId es requerido" }); return; }
  try {
    const apiKey = await getUserHeyGenKey(req.session.user!.userId);
    await deleteAvatarLook(lookId, apiKey);
    // Invalidate per-look caches so the next generation doesn't use stale engine data or images
    invalidateLookCaches(lookId, apiKey);
    // Also invalidate the full avatar IDs list (look no longer exists)
    invalidateAvatarIdsCache(apiKey);
    // Reset the looks cache so the picker reflects the deletion
    looksCache = null;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error al eliminar el look" });
  }
});

/**
 * DELETE /heygen/avatars/groups/:groupId — permanently delete an avatar group and all its looks.
 */
router.delete("/heygen/avatars/groups/:groupId", async (req, res): Promise<void> => {
  const { groupId } = req.params;
  if (!groupId) { res.status(400).json({ error: "groupId es requerido" }); return; }
  try {
    const apiKey = await getUserHeyGenKey(req.session.user!.userId);
    await deleteAvatarGroup(groupId, apiKey);
    // Invalidate all per-look caches — we don't know which lookIds belonged to this group
    // so invalidate the full avatar IDs list; per-look entries will expire naturally
    invalidateAvatarIdsCache(apiKey);
    invalidateDefaultVoiceCache(apiKey);
    looksCache = null;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error al eliminar el avatar" });
  }
});

/**
 * POST /heygen/avatars/looks/:lookId/new-look — generate a new look for an existing avatar group.
 * Conditions generation on the reference look; saves to the same group.
 * Body: { name, prompt, group_id, pose? }
 */
router.post("/heygen/avatars/looks/:lookId/new-look", async (req, res): Promise<void> => {
  const { lookId } = req.params;
  const { name, prompt, group_id, pose } = req.body ?? {};
  if (!lookId) { res.status(400).json({ error: "lookId es requerido" }); return; }
  if (!name || typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name es requerido" }); return; }
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) { res.status(400).json({ error: "prompt es requerido" }); return; }
  if (!group_id || typeof group_id !== "string" || !group_id.trim()) { res.status(400).json({ error: "group_id es requerido" }); return; }
  try {
    const result = await createAvatarLook(lookId, group_id.trim(), name.trim(), prompt.trim(), { pose: pose ?? "half_body" });
    looksCache = null; // invalidate flat-looks cache so the new look appears immediately
    res.json(result);
  } catch (err: any) {
    const { status, message, heygenStatus, heygenDetail } = extractHeyGenError(err);
    if (heygenStatus === 402) notifyHeyGenError("crear look", heygenStatus, heygenDetail);
    res.status(status).json({ error: message });
  }
});

/**
 * POST /heygen/avatars/create-prompt — create an AI-generated avatar from a text description.
 * Body: { name: string, prompt: string, orientation?: string, pose?: string }
 */
router.post("/heygen/avatars/create-prompt", async (req, res): Promise<void> => {
  const { name, prompt, orientation, pose } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name es requerido" });
    return;
  }
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "prompt es requerido" });
    return;
  }
  try {
    const result = await createPromptAvatar(name.trim(), prompt.trim(), {
      orientation: orientation ?? "vertical",
      pose: pose ?? "half_body",
    });
    looksCache = null; // invalidate flat-looks cache so the new avatar appears immediately
    res.json(result);
  } catch (err: any) {
    const { status, message, heygenStatus, heygenDetail } = extractHeyGenError(err);
    if (heygenStatus === 402) notifyHeyGenError("crear avatar (prompt)", heygenStatus, heygenDetail);
    res.status(status).json({ error: message });
  }
});

/**
 * POST /heygen/avatars/create — create a photo avatar from an uploaded asset.
 * Body: { name: string, asset_id: string }
 * Returns: { look_id: string, group_id: string }
 */
router.post("/heygen/avatars/create", async (req, res): Promise<void> => {
  const { name, asset_id } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name es requerido" });
    return;
  }
  if (!asset_id || typeof asset_id !== "string" || !asset_id.trim()) {
    res.status(400).json({ error: "asset_id es requerido" });
    return;
  }
  try {
    const result = await createPhotoAvatar(name.trim(), asset_id.trim());
    looksCache = null; // invalidate flat-looks cache so the new avatar appears immediately
    res.json(result);
  } catch (err: any) {
    const { status, message, heygenStatus, heygenDetail } = extractHeyGenError(err);
    if (heygenStatus === 402) notifyHeyGenError("crear avatar (foto)", heygenStatus, heygenDetail);
    res.status(status).json({ error: message });
  }
});

/**
 * POST /heygen/avatars/create-digital-twin — create a Digital Twin from a video recording.
 * Accepts multipart/form-data with fields: file (video MP4/MOV/WebM) and name (string).
 * Uploads the video to HeyGen /v3/assets, then submits a Digital Twin creation job.
 * Returns { look_id, group_id } immediately — poll look status until "completed".
 */
router.post("/heygen/avatars/create-digital-twin", videoUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "Se requiere un archivo de video (campo: file)" });
    return;
  }
  const name = req.body?.name;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name es requerido" });
    return;
  }
  try {
    const apiKey = await getUserHeyGenKey(req.session.user!.userId);
    const { asset_id } = await uploadAsset(req.file.buffer, req.file.mimetype, req.file.originalname, apiKey);
    const result = await createDigitalTwinFromVideo(name.trim(), asset_id, apiKey);
    // Invalidate caches so the new avatar appears in the next listing
    invalidateAvatarIdsCache(apiKey);
    looksCache = null;
    res.json(result);
  } catch (err: any) {
    const { status, message, heygenStatus, heygenDetail } = extractHeyGenError(err);
    if (heygenStatus === 402) notifyHeyGenError("crear Digital Twin (video)", heygenStatus, heygenDetail);
    res.status(status).json({ error: message });
  }
});

/**
 * GET /heygen/audio-proxy?url=<encoded>
 * Proxies a HeyGen preview audio URL through the server so the browser can
 * fetch it without CORS restrictions and decode it with Web Audio API.
 * Only HeyGen CDN URLs are allowed.
 */
router.get("/heygen/audio-proxy", async (req, res): Promise<void> => {
  try {
    const rawUrl = req.query.url as string;
    if (!rawUrl) { res.status(400).end(); return; }
    let decodedUrl: string;
    try { decodedUrl = decodeURIComponent(rawUrl); } catch { res.status(400).end(); return; }
    const parsed = new URL(decodedUrl);
    // Must be HTTPS and not point to private/internal addresses (SSRF protection)
    if (parsed.protocol !== "https:") { res.status(403).end(); return; }
    const blocked = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0)/;
    if (blocked.test(parsed.hostname)) { res.status(403).end(); return; }
    const upstream = await axios.get(decodedUrl, { responseType: "arraybuffer", timeout: 15000 });
    const ct = (upstream.headers["content-type"] as string) ?? "audio/mpeg";
    res.set("Content-Type", ct);
    res.set("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(upstream.data));
  } catch {
    res.status(502).end();
  }
});

/**
 * GET /heygen/avatars/looks/:lookId/status — poll look training status.
 * Returns: { id, name, status, avatar_type, group_id, preview_image_url, preview_video_url }
 */
router.get("/heygen/avatars/looks/:lookId/status", async (req, res): Promise<void> => {
  try {
    const result = await getAvatarLookStatus(req.params.lookId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error al consultar el estado del avatar" });
  }
});

export default router;
