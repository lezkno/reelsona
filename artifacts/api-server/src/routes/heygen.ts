import { Router } from "express";
import { db } from "@workspace/db";
import { avatarConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
import { listAvatars, listVoices, listAvatarGroups, listGroupLooks } from "../lib/heygen";

const router = Router();

router.get("/heygen/avatars", async (req, res): Promise<void> => {
  const avatars = await listAvatars();
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
  const voices = await listVoices();
  const mapped = voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    language: v.language ?? "es",
    gender: v.gender ?? null,
    preview_audio_url: (v as any).preview_audio ?? v.preview_audio_url ?? null,
    is_cloned: v.is_clone ?? false,
  }));
  res.json(GetHeyGenVoicesResponse.parse(mapped));
});

router.get("/heygen/avatar-groups", async (req, res): Promise<void> => {
  const groups = await listAvatarGroups();
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
  const groupId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const groups = await listAvatarGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group) {
    res.status(404).json({ error: "Avatar no encontrado" });
    return;
  }
  const looks = await listGroupLooks(groupId);
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

async function fetchAllLooks(): Promise<FlatLook[]> {
  const groups = await listAvatarGroups();
  const all: FlatLook[] = [];
  const results = await Promise.allSettled(
    groups.map(async (g) => ({ group: g, looks: await listGroupLooks(g.id) }))
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
  if (looksCache && Date.now() - looksCache.at < 5 * 60 * 1000) {
    res.json(GetHeyGenAllLooksResponse.parse(looksCache.data));
    return;
  }
  // Single-flight: coalesce concurrent refreshes (each one is ~20 HeyGen calls)
  if (!looksFetch) {
    looksFetch = fetchAllLooks().finally(() => { looksFetch = null; });
  }
  const all = await looksFetch;
  res.json(GetHeyGenAllLooksResponse.parse(all));
});

router.get("/heygen/avatar-config", async (req, res): Promise<void> => {
  let [config] = await db.select().from(avatarConfigTable).limit(1);
  if (!config) {
    [config] = await db.insert(avatarConfigTable).values({}).returning();
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

  const [existing] = await db.select().from(avatarConfigTable).limit(1);
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

export default router;
