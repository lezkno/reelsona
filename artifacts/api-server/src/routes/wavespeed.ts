/**
 * WaveSpeed routes — persona creation wizard + voice cloning
 *
 * GET  /wavespeed/status                        — health check (no API call)
 * POST /wavespeed/personas                      — create persona + submit 5 look-gen jobs
 * GET  /wavespeed/personas                      — list personas with their looks
 * GET  /wavespeed/personas/:id/looks/status     — poll look generation, update imageUrls in DB
 * DELETE /wavespeed/personas/:id                — delete persona (cascade looks)
 * POST /wavespeed/voices/clone                  — upload audio + submit WaveSpeed clone job
 * GET  /wavespeed/voices                        — list user's WaveSpeed voices
 * GET  /wavespeed/voices/:id/status             — poll voice clone status, update DB when ready
 * PATCH /wavespeed/looks/:id                    — update look name/config (voiceId, selected flag)
 * DELETE /wavespeed/looks/:id                   — delete a look
 */

import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  wavespeedPersonasTable,
  wavespeedLooksTable,
  wavespeedVoicesTable,
  wavespeedJobsTable,
} from "@workspace/db";
import {
  isWavespeedConfigured,
  WAVESPEED_MODELS,
  submitImageEdit,
  submitVoiceClone,
  getJobStatus,
} from "../lib/wavespeed";
import {
  getSignedObjectUrl,
  objectStorageClient,
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import {
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "../lib/objectAcl";

const storageService = new ObjectStorageService();

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Auth helper ───────────────────────────────────────────────────────────────
// Mirrors the pattern in routes/course.ts — session identity lives at
// req.session.user.userId (NOT req.session.userId).

function requireAuth(req: Request, res: Response): number | null {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "No autenticado" });
    return null;
  }
  const userId = req.session.user?.userId;
  if (!userId) {
    res.status(400).json({ error: "Sesión inválida" });
    return null;
  }
  return userId;
}

// ── GCS helpers ───────────────────────────────────────────────────────────────

/**
 * Convert a /objects/... path to GCS objectName.
 * PRIVATE_OBJECT_DIR = /bucket-name/some/prefix → objectName = some/prefix/uploads/uuid
 */
function gcsObjectNameFromPath(objectPath: string): string {
  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  const dirParts = privateDir.split("/").filter(Boolean);
  const dirPrefix = dirParts.slice(1).join("/"); // everything after the bucket name
  const entityId = objectPath.replace(/^\/objects\//, "");
  return [dirPrefix, entityId].filter(Boolean).join("/");
}

/** Upload a Buffer directly to GCS and return a 24-hour signed URL. */
async function uploadBufferAndSign(
  buffer: Buffer,
  contentType: string,
  subDir: string,
): Promise<string> {
  const bucketName = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketName) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  const dirParts = privateDir.split("/").filter(Boolean);
  const dirPrefix = dirParts.slice(1).join("/");
  const objectId = randomUUID();
  const objectName = [dirPrefix, subDir, objectId].filter(Boolean).join("/");
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, { contentType, resumable: false });
  return getSignedObjectUrl(objectName, 24 * 3600);
}

// ── 5 look variation prompts ──────────────────────────────────────────────────
// Portrait / vertical 9:16 framing, different outfit for each scene.
// Face identity must be preserved exactly; only outfit, setting, and lighting change.

const LOOK_PROMPTS = [
  {
    name: "Estudio de podcast",
    prompt:
      "Vertical portrait photo, 9:16 aspect ratio. Same person, same face and hair. Outfit: smart-casual shirt or blazer. Setting: professional podcast studio — acoustic foam panels on the walls, a large professional condenser microphone on a boom arm directly in front of the person, moody dim background lighting with a subtle LED ring glow. The person is looking straight at the camera, confident and relaxed. Photorealistic, sharp detail.",
  },
  {
    name: "Look profesional",
    prompt:
      "Vertical portrait photo, 9:16 aspect ratio. Same person, same face and hair. Outfit: tailored business suit or blazer with a collared shirt, polished and authoritative. Setting: modern glass-walled office, soft natural window light, clean minimalist background. Photorealistic, sharp detail.",
  },
  {
    name: "Look casual exterior",
    prompt:
      "Vertical portrait photo, 9:16 aspect ratio. Same person, same face and hair. Outfit: relaxed casual — well-fitted jeans, a plain t-shirt or open shirt, comfortable and approachable. Setting: sunny urban street or park, golden-hour light, blurred green bokeh background. Photorealistic, sharp detail.",
  },
  {
    name: "Look deportivo",
    prompt:
      "Vertical portrait photo, 9:16 aspect ratio. Same person, same face and hair. Outfit: modern athletic wear — fitted performance top, jogger pants or shorts, clean sports shoes. Setting: bright outdoor gym area or rooftop with city skyline, energetic natural light. Photorealistic, sharp detail.",
  },
  {
    name: "Look creativo",
    prompt:
      "Vertical portrait photo, 9:16 aspect ratio. Same person, same face and hair. Outfit: stylish smart-casual creative look — layered textures, interesting accessories, expressive but not formal. Setting: artistic loft studio or urban concrete wall with subtle graffiti art, warm ambient lighting. Photorealistic, sharp detail.",
  },
];

// ── GET /wavespeed/status ─────────────────────────────────────────────────────

router.get("/wavespeed/status", (req, res) => {
  const configured = isWavespeedConfigured();
  res.json({
    configured,
    models: Object.values(WAVESPEED_MODELS),
    note: configured
      ? "WAVESPEED_API_KEY is set — pipeline ready"
      : "WAVESPEED_API_KEY is not configured — add it to Replit Secrets to enable the WaveSpeed pipeline",
  });
});

// ── POST /wavespeed/personas ──────────────────────────────────────────────────

router.post("/wavespeed/personas", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  if (!isWavespeedConfigured()) {
    res.status(503).json({ error: "WaveSpeed not configured" });
    return;
  }

  const { name, referenceObjectPath } = (req.body ?? {}) as {
    name?: string;
    referenceObjectPath?: string;
  };

  if (!name?.trim() || !referenceObjectPath) {
    res.status(400).json({ error: "name and referenceObjectPath are required" });
    return;
  }

  try {
    // ── Object ownership enforcement ──────────────────────────────────────────
    // 1. Validate the path is canonical (within PRIVATE_OBJECT_DIR) and exists.
    // 2. Claim-on-first-use: if no ACL policy yet, bind the object to this user.
    //    UUID paths are unguessable (122-bit entropy), so the first requester who
    //    knows the path is the uploader — setting them as owner is safe.
    // 3. If an ACL policy already exists with a different owner, return 403.
    const objectFile = await storageService.getObjectEntityFile(referenceObjectPath);
    const existingPolicy = await getObjectAclPolicy(objectFile);
    if (!existingPolicy) {
      await setObjectAclPolicy(objectFile, {
        owner: String(userId),
        visibility: "private",
      });
    } else if (existingPolicy.owner !== String(userId)) {
      res.status(403).json({ error: "No tienes permiso para usar este archivo" });
      return;
    }

    // Convert /objects/... path to a signed public URL WaveSpeed can fetch.
    const gcsName = gcsObjectNameFromPath(referenceObjectPath);
    const referenceImageUrl = await getSignedObjectUrl(gcsName, 4 * 3600);

    // Create persona row
    const [persona] = await db
      .insert(wavespeedPersonasTable)
      .values({ userId, name: name.trim() })
      .returning();

    // Submit 5 image-edit jobs in parallel
    const lookJobs = await Promise.allSettled(
      LOOK_PROMPTS.map((lp) => submitImageEdit(referenceImageUrl, lp.prompt)),
    );

    // Log any submission failures so they appear in server logs
    lookJobs.forEach((job, i) => {
      if (job.status === "rejected") {
        req.log.error(
          { err: job.reason, lookName: LOOK_PROMPTS[i].name },
          "[WaveSpeed] Image-edit job submission failed",
        );
      }
    });

    // Create look + job rows for each (even if submission failed)
    const lookRows = [];
    for (let i = 0; i < LOOK_PROMPTS.length; i++) {
      const lp = LOOK_PROMPTS[i];
      const job = lookJobs[i];
      const requestId = job.status === "fulfilled" ? job.value.requestId : null;
      const genStatus = requestId ? "pending" : "failed";
      const config = JSON.stringify({ requestId, generationStatus: genStatus });

      const [look] = await db
        .insert(wavespeedLooksTable)
        .values({
          userId,
          personaId: persona.id,
          name: lp.name,
          config,
        })
        .returning();

      if (requestId) {
        await db.insert(wavespeedJobsTable).values({
          userId,
          model: WAVESPEED_MODELS.IMAGE_EDIT,
          status: "processing",
          wavespeedRequestId: requestId,
          inputPayload: JSON.stringify({ prompt: lp.prompt, personaId: persona.id, lookId: look.id }),
        });
      }

      lookRows.push({ id: look.id, name: look.name, config: look.config });
    }

    res.json({ persona: { id: persona.id, name: persona.name }, looks: lookRows });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to create persona");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── GET /wavespeed/personas ───────────────────────────────────────────────────

router.get("/wavespeed/personas", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const personas = await db
      .select()
      .from(wavespeedPersonasTable)
      .where(eq(wavespeedPersonasTable.userId, userId));

    const result = await Promise.all(
      personas.map(async (p) => {
        const looks = await db
          .select()
          .from(wavespeedLooksTable)
          .where(
            and(
              eq(wavespeedLooksTable.personaId, p.id),
              eq(wavespeedLooksTable.userId, userId),
            ),
          );
        return { ...p, looks };
      }),
    );

    res.json({ personas: result });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to list personas");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── GET /wavespeed/personas/:id/looks/status ──────────────────────────────────

router.get("/wavespeed/personas/:id/looks/status", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const personaId = parseInt(req.params.id, 10);
  if (isNaN(personaId)) {
    res.status(400).json({ error: "Invalid persona ID" });
    return;
  }

  try {
    const looks = await db
      .select()
      .from(wavespeedLooksTable)
      .where(
        and(
          eq(wavespeedLooksTable.personaId, personaId),
          eq(wavespeedLooksTable.userId, userId),
        ),
      );

    const updated = await Promise.all(
      looks.map(async (look) => {
        let cfg: Record<string, unknown> = {};
        try {
          cfg = look.config ? JSON.parse(look.config) : {};
        } catch {
          cfg = {};
        }

        // Poll if pending, OR if marked ready but imageUrl is still null
        // (can happen when previous polling runs extracted the URL incorrectly).
        const needsPoll =
          (cfg.generationStatus === "pending" && !!cfg.requestId) ||
          (cfg.generationStatus === "ready" && !look.imageUrl && !!cfg.requestId);
        if (!needsPoll) {
          return look;
        }

        try {
          const result = await getJobStatus(String(cfg.requestId));
          req.log.info(
            { lookId: look.id, requestId: cfg.requestId, status: result.status, outputs: result.outputs, error: result.error },
            "[WaveSpeed] Poll look job response",
          );
          if (result.status === "completed") {
            const outputs = result.outputs;
            // WaveSpeed returns outputs as a plain string[] (e.g. [cloudfront_url]).
            // Fall back to object shapes for future-proofing.
            let rawUrl: string | undefined;
            if (Array.isArray(outputs)) {
              rawUrl = typeof outputs[0] === "string" ? outputs[0] : (outputs[0] as any)?.url;
            } else if (outputs && typeof outputs === "object") {
              const obj = outputs as Record<string, unknown>;
              const imagesArr = obj["images"];
              rawUrl =
                (Array.isArray(imagesArr)
                  ? typeof imagesArr[0] === "string" ? imagesArr[0] : (imagesArr[0] as any)?.url
                  : undefined) ??
                (obj["image"] as string | undefined) ??
                (obj["url"] as string | undefined);
            }
            const imageUrl = rawUrl ?? null;
            req.log.info({ lookId: look.id, imageUrl }, "[WaveSpeed] Look completed, imageUrl resolved");
            cfg.generationStatus = "ready";
            cfg.outputUrl = imageUrl;
            const newConfig = JSON.stringify(cfg);
            await db
              .update(wavespeedLooksTable)
              .set({ imageUrl, config: newConfig, updatedAt: new Date() })
              .where(eq(wavespeedLooksTable.id, look.id));
            return { ...look, imageUrl, config: newConfig };
          } else if (result.status === "failed") {
            req.log.error({ lookId: look.id, error: result.error }, "[WaveSpeed] Look job failed");
            cfg.generationStatus = "failed";
            cfg.errorMessage = result.error ?? "Generation failed";
            const newConfig = JSON.stringify(cfg);
            await db
              .update(wavespeedLooksTable)
              .set({ config: newConfig, updatedAt: new Date() })
              .where(eq(wavespeedLooksTable.id, look.id));
            return { ...look, config: newConfig };
          }
        } catch (pollErr: any) {
          req.log.warn({ lookId: look.id, err: pollErr }, "[WaveSpeed] Poll look job error");
        }
        return look;
      }),
    );

    const allDone = updated.every((l) => {
      let cfg: Record<string, unknown> = {};
      try { cfg = l.config ? JSON.parse(l.config) : {}; } catch { cfg = {}; }
      return cfg.generationStatus === "ready" || cfg.generationStatus === "failed";
    });

    res.json({ looks: updated, allDone });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to poll look status");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── DELETE /wavespeed/personas/:id ───────────────────────────────────────────

router.delete("/wavespeed/personas/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const personaId = parseInt(req.params.id, 10);
  if (isNaN(personaId)) {
    res.status(400).json({ error: "Invalid persona ID" });
    return;
  }

  try {
    // Delete looks first (FK set null → need explicit delete)
    await db
      .delete(wavespeedLooksTable)
      .where(
        and(
          eq(wavespeedLooksTable.personaId, personaId),
          eq(wavespeedLooksTable.userId, userId),
        ),
      );
    await db
      .delete(wavespeedPersonasTable)
      .where(and(eq(wavespeedPersonasTable.id, personaId), eq(wavespeedPersonasTable.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to delete persona");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── POST /wavespeed/voices/clone ─────────────────────────────────────────────

router.post("/wavespeed/voices/clone", upload.single("audio"), async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  if (!isWavespeedConfigured()) {
    res.status(503).json({ error: "WaveSpeed not configured" });
    return;
  }

  const file = req.file;
  const name = (req.body?.name ?? "").trim();

  if (!file || !name) {
    res.status(400).json({ error: "audio file and name are required" });
    return;
  }

  try {
    // Upload audio to object storage and get a signed URL
    const contentType = file.mimetype || "audio/webm";
    const audioUrl = await uploadBufferAndSign(file.buffer, contentType, "wavespeed-voices");

    // Submit clone job
    const { requestId } = await submitVoiceClone(name, audioUrl);

    // Create voice row
    const [voiceRow] = await db
      .insert(wavespeedVoicesTable)
      .values({ userId, displayName: name, wavespeedRequestId: requestId, status: "pending" })
      .returning();

    res.json({ voiceId: voiceRow.id, displayName: voiceRow.displayName, status: voiceRow.status });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to clone voice");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── GET /wavespeed/voices ─────────────────────────────────────────────────────

router.get("/wavespeed/voices", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const voices = await db
      .select()
      .from(wavespeedVoicesTable)
      .where(eq(wavespeedVoicesTable.userId, userId));
    res.json({ voices });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to list voices");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── GET /wavespeed/voices/:id/status ─────────────────────────────────────────

router.get("/wavespeed/voices/:id/status", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const voiceId = parseInt(req.params.id, 10);
  if (isNaN(voiceId)) {
    res.status(400).json({ error: "Invalid voice ID" });
    return;
  }

  try {
    const [voice] = await db
      .select()
      .from(wavespeedVoicesTable)
      .where(and(eq(wavespeedVoicesTable.id, voiceId), eq(wavespeedVoicesTable.userId, userId)))
      .limit(1);

    if (!voice) {
      res.status(404).json({ error: "Voice not found" });
      return;
    }

    // If already terminal, return current state
    if (voice.status === "ready" || voice.status === "failed" || !voice.wavespeedRequestId) {
      res.json(voice);
      return;
    }

    // Poll WaveSpeed
    const result = await getJobStatus(voice.wavespeedRequestId);
    let updated = voice;

    if (result.status === "completed") {
      const outputs = result.outputs ?? {};
      // minimax/voice-clone returns outputs.voice_id or outputs.id
      const wavespeedVoiceId: string | undefined =
        (outputs["voice_id"] as string | undefined) ??
        (outputs["id"] as string | undefined) ??
        (outputs["voiceId"] as string | undefined);

      if (wavespeedVoiceId) {
        const [u] = await db
          .update(wavespeedVoicesTable)
          .set({ status: "ready", wavespeedVoiceId, updatedAt: new Date() })
          .where(eq(wavespeedVoicesTable.id, voiceId))
          .returning();
        updated = u;
      } else {
        // Completed but no voice ID — treat as failed
        const errMsg = `Clone completed but no voice_id in outputs: ${JSON.stringify(outputs)}`;
        const [u] = await db
          .update(wavespeedVoicesTable)
          .set({ status: "failed", errorMessage: errMsg, updatedAt: new Date() })
          .where(eq(wavespeedVoicesTable.id, voiceId))
          .returning();
        updated = u;
      }
    } else if (result.status === "failed") {
      const [u] = await db
        .update(wavespeedVoicesTable)
        .set({ status: "failed", errorMessage: result.error ?? "Unknown error", updatedAt: new Date() })
        .where(eq(wavespeedVoicesTable.id, voiceId))
        .returning();
      updated = u;
    }

    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to poll voice status");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── PATCH /wavespeed/looks/:id ────────────────────────────────────────────────

router.patch("/wavespeed/looks/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const lookId = parseInt(req.params.id, 10);
  if (isNaN(lookId)) {
    res.status(400).json({ error: "Invalid look ID" });
    return;
  }

  const { name, config } = (req.body ?? {}) as { name?: string; config?: Record<string, unknown> };

  try {
    const [existing] = await db
      .select()
      .from(wavespeedLooksTable)
      .where(and(eq(wavespeedLooksTable.id, lookId), eq(wavespeedLooksTable.userId, userId)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Look not found" });
      return;
    }

    const updates: Partial<typeof existing> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (config !== undefined) {
      // Merge with existing config
      let existingCfg: Record<string, unknown> = {};
      try { existingCfg = existing.config ? JSON.parse(existing.config) : {}; } catch { existingCfg = {}; }
      updates.config = JSON.stringify({ ...existingCfg, ...config });
    }

    const [updated] = await db
      .update(wavespeedLooksTable)
      .set(updates)
      .where(eq(wavespeedLooksTable.id, lookId))
      .returning();

    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to update look");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── DELETE /wavespeed/looks/:id ───────────────────────────────────────────────

router.delete("/wavespeed/looks/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const lookId = parseInt(req.params.id, 10);
  if (isNaN(lookId)) {
    res.status(400).json({ error: "Invalid look ID" });
    return;
  }

  try {
    await db
      .delete(wavespeedLooksTable)
      .where(and(eq(wavespeedLooksTable.id, lookId), eq(wavespeedLooksTable.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to delete look");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

export default router;
