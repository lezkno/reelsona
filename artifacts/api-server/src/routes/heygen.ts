import { Router } from "express";
import { db } from "@workspace/db";
import { avatarConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetHeyGenAvatarsResponse,
  GetHeyGenVoicesResponse,
  GetHeyGenAvatarGroupsResponse,
  GetHeyGenGroupLooksResponse,
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
    preview_audio_url: v.preview_audio_url ?? null,
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
        return { id: l.avatar_id, name: l.avatar_name ?? "Look", image_url: l.preview_image_url ?? null };
      }
      if (l.id) {
        return { id: `tp:${l.id}`, name: l.name ?? "Look", image_url: l.image_url ?? null };
      }
      return null;
    })
    .filter((l): l is { id: string; name: string; image_url: string | null } => l !== null);
  res.json(GetHeyGenGroupLooksResponse.parse(mapped));
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
        rotationStrategy: parsed.data.rotation_strategy,
      })
      .returning();
  }

  res.json(
    UpdateAvatarConfigResponse.parse({
      selected_avatar_ids: config.selectedAvatarIds ?? [],
      preferred_voice_id: config.preferredVoiceId ?? null,
      rotation_strategy: config.rotationStrategy,
      last_used_avatar_id: config.lastUsedAvatarId ?? null,
    })
  );
});

export default router;
