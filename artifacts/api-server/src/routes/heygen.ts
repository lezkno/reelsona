import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { avatarConfigTable, settingsTable, heygenClonedVoicesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

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
  deleteAvatarLook, deleteAvatarGroup, getAvatarLookStatus,
  cloneVoice, deleteVoice, renameVoice,
} from "../lib/heygen";

// Multer: store file in memory (max 32 MB — HeyGen limit)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024 } });
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
  const myCloneIds = new Set(myClones.map(c => c.voiceId));
  const myCloneSpeedMap = new Map(myClones.map(c => [c.voiceId, c.speed ?? null]));
  const mapped = voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    language: v.language ?? "es",
    gender: v.gender ?? null,
    preview_audio_url: (v as any).preview_audio ?? v.preview_audio_url ?? null,
    is_cloned: v.is_clone ?? false,
    is_mine: myCloneIds.has(v.voice_id),
    speed: myCloneIds.has(v.voice_id) ? (myCloneSpeedMap.get(v.voice_id) ?? null) : null,
  }));
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
    const voiceId = await cloneVoice(req.file.buffer, req.file.originalname, name.trim(), apiKey);
    await db.insert(heygenClonedVoicesTable).values({
      userId,
      voiceId,
      displayName: name.trim(),
      status: "pending",
      speed: speed != null && !isNaN(speed) ? speed : null,
    });
    res.json({ voice_id: voiceId, display_name: name.trim(), status: "pending" });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error al clonar la voz" });
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
    await deleteVoice(voiceId, apiKey);
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
    const { name, speed } = req.body ?? {};
    if (!name && speed === undefined) {
      res.status(400).json({ error: "Se requiere nombre o velocidad" }); return;
    }
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      res.status(400).json({ error: "El nombre no puede estar vacío" }); return;
    }
    if (speed !== undefined && speed !== null && (typeof speed !== "number" || speed < 0.5 || speed > 1.5)) {
      res.status(400).json({ error: "La velocidad debe estar entre 0.5 y 1.5" }); return;
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
    await deleteAvatarLook(lookId);
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
    await deleteAvatarGroup(groupId);
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
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error al crear el nuevo look" });
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
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error al crear el avatar" });
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
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error al crear el avatar" });
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
