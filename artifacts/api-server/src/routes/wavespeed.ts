/**
 * WaveSpeed routes — persona creation wizard + voice cloning
 *
 * GET  /wavespeed/status                        — health check (no API call)
 * POST /wavespeed/personas                      — create persona + submit 3 look-gen jobs (plan-limited)
 * GET  /wavespeed/personas                      — list personas with their looks + planEnabled flag
 * GET  /wavespeed/personas/:id/looks/status     — poll look generation, update imageUrls in DB
 * DELETE /wavespeed/personas/:id                — delete persona (cascade looks)
 * POST /wavespeed/voices/clone                  — upload audio + submit WaveSpeed clone job (first free)
 * GET  /wavespeed/voices                        — list user's WaveSpeed voices
 * GET  /wavespeed/voices/:id/status             — poll voice clone status, update DB when ready
 * PATCH /wavespeed/looks/:id                    — update look name/config (voiceId, selected flag)
 * DELETE /wavespeed/looks/:id                   — delete a look
 */

import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join as pathJoin } from "path";
const execFileAsync = promisify(execFile);
import { eq, and, isNotNull, count as drizzleCount, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  wavespeedPersonasTable,
  wavespeedLooksTable,
  wavespeedVoicesTable,
  wavespeedJobsTable,
} from "@workspace/db";
import {
  getUserPlanSlug,
  getAvatarLimit,
  countUserPersonas,
  countNonFailedVoiceClones,
  computePersonaPlanEnabled,
  FREE_LOOKS_PER_PERSONA,
  FREE_VOICE_CLONES,
} from "../lib/planLimits";
import {
  hasEnoughCredits,
  getUserCredits,
  LOOK_CREDIT_COST,
  EXTRA_VOICE_CREDIT_COST,
  reserveLookCredits,
  consumeLookCredits,
  releaseLookCredits,
  reserveVoiceCredits,
  consumeVoiceCredits,
  releaseVoiceCredits,
} from "../lib/credits";
import {
  isWavespeedConfigured,
  WAVESPEED_MODELS,
  submitImageEdit,
  submitVoiceClone,
  submitSpeech,
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

/** Upload a Buffer directly to GCS and return a 24-hour signed URL + the object name. */
async function uploadBufferAndSign(
  buffer: Buffer,
  contentType: string,
  subDir: string,
  ext?: string,   // optional file extension e.g. ".wav" — included in the object name
                  // so WaveSpeed can identify the format from the URL
): Promise<{ url: string; objectName: string }> {
  const bucketName = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketName) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  const dirParts = privateDir.split("/").filter(Boolean);
  const dirPrefix = dirParts.slice(1).join("/");
  const objectId = randomUUID();
  const filename = ext ? `${objectId}${ext}` : objectId;
  const objectName = [dirPrefix, subDir, filename].filter(Boolean).join("/");
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, { contentType, resumable: false });
  const url = await getSignedObjectUrl(objectName, 24 * 3600);
  return { url, objectName };
}

/**
 * Convert any browser-recorded audio (webm, ogg, etc.) to 16-kHz mono WAV
 * using ffmpeg.  WaveSpeed's minimax voice-clone API rejects webm/ogg by
 * extension (error 2013) but accepts WAV, MP3, and M4A.
 */
async function convertToWav(inputBuffer: Buffer): Promise<Buffer> {
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new Error("Audio buffer is empty — nothing was recorded");
  }
  const id = randomUUID();
  const inputPath  = pathJoin(tmpdir(), `ws-audio-in-${id}.webm`);
  const outputPath = pathJoin(tmpdir(), `ws-audio-out-${id}.wav`);
  try {
    await writeFile(inputPath, inputBuffer);
    await execFileAsync("ffmpeg", [
      "-y",             // overwrite output without asking
      "-i", inputPath,
      "-ar", "16000",   // 16 kHz — minimax requirement
      "-ac", "1",       // mono
      "-f", "wav",
      outputPath,
    ], { timeout: 60_000 }); // 60 s max — hangs indefinitely without this
    const out = await readFile(outputPath);
    if (out.length === 0) throw new Error("ffmpeg produced an empty WAV file");
    return out;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

// ── 3 look variation prompts ──────────────────────────────────────────────────
// One look per archetype: authority (Profesional), closeness (Cercano), energy (Dinámico).
// Face identity must be preserved exactly; only outfit, setting, and lighting change.
// "Profesional" is the default/primary look.

// NOTE ON FRAMING — "both hands visible" is intentional and critical:
// The talking-head model (infinitetalk-fast) can only animate what exists in the
// source image. If the portrait crops at the shoulders the avatar will be nearly
// static. Half-body framing with hands in frame gives the model natural hand and
// arm movement to work with, producing a much more engaging talking-head video.
const LOOK_PROMPTS = [
  {
    name: "Profesional",
    prompt:
      "same person, RAW DSLR photograph, shot on 85mm f/1.4 prime lens, professional studio portrait, half-body shot from waist up with both hands naturally visible, modern clean office background, business casual outfit, confident and trustworthy, vertical 9:16, natural soft lighting, natural skin texture with visible pores, no plastic smoothing, no AI artifacts, no digital retouching, authentic candid expression, photojournalistic quality, film grain",
  },
  {
    name: "Cercano",
    prompt:
      "same person, RAW DSLR photograph, shot on 85mm f/1.4 prime lens, warm lifestyle portrait, half-body shot from waist up with both hands naturally visible, cozy home office or cafe background, casual polished outfit, approachable and friendly, vertical 9:16, warm natural window light, natural skin texture with visible pores, no plastic smoothing, no AI artifacts, no digital retouching, authentic candid expression, photojournalistic quality, film grain",
  },
  {
    name: "Dinámico",
    prompt:
      "same person, RAW DSLR photograph, shot on 85mm f/1.4 prime lens, creator studio portrait, half-body shot from waist up with both hands naturally visible, modern content creator set, subtle colorful background lights, stylish casual outfit, energetic and charismatic, vertical 9:16, mixed practical lighting, natural skin texture with visible pores, no plastic smoothing, no AI artifacts, no digital retouching, authentic candid expression, photojournalistic quality, film grain",
  },
];

// ── GET /wavespeed/status ─────────────────────────────────────────────────────

router.get("/wavespeed/status", (req, res) => {
  res.json({ configured: isWavespeedConfigured() });
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
    // ── Plan limit enforcement ─────────────────────────────────────────────────
    // Admins bypass all plan limits. Non-admins are checked TWICE:
    //   1) Here (fast path, no lock) — rejects the vast majority of over-limit attempts.
    //   2) Inside the atomic insert transaction (below) — guards against two simultaneous
    //      requests that both pass this check before either inserts a row.
    const isAdmin = req.session.user?.role === "admin";
    // Lifted to outer scope so the atomic-insert block can reference them.
    let planSlug: string | null = null;
    let planLimit               = 0; // safe sentinel; only used when !isAdmin

    if (!isAdmin) {
      planSlug  = await getUserPlanSlug(userId);
      planLimit = getAvatarLimit(planSlug);
      const current = await countUserPersonas(userId);
      if (current >= planLimit) {
        const message = !planSlug
          ? "Necesitas un plan activo para crear Avatares AI."
          : `Has alcanzado el límite de Avatares AI de tu plan (${planLimit}). Actualiza tu plan para crear más.`;
        res.status(403).json({ error: "avatar_limit_reached", message, planSlug, limit: planLimit, current });
        return;
      }
    }
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

    // ── Atomic persona creation with concurrency guard ─────────────────────────
    // Two simultaneous requests from the same user could both pass the initial count
    // check above and then both insert a row, exceeding the plan limit.
    // pg_advisory_xact_lock serialises per-user creation at the DB level so only
    // one transaction at a time can hold the lock for this userId.
    type PersonaRow = { id: number; name: string; referenceObjectPath: string | null };
    let persona: PersonaRow | undefined;
    try {
      await db.transaction(async (tx) => {
        if (!isAdmin) {
          // Lock key: userId-scoped (multiplied to avoid key collisions with other locks)
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${userId}::bigint * 31 + 7)`);
          const [lockRow] = await tx
            .select({ cnt: drizzleCount() })
            .from(wavespeedPersonasTable)
            .where(eq(wavespeedPersonasTable.userId, userId));
          const lockedCount = Number(lockRow?.cnt ?? 0);
          if (lockedCount >= planLimit) {
            const err: any = new Error(
              `Has alcanzado el límite de Avatares AI de tu plan (${planLimit}). Actualiza tu plan para crear más.`,
            );
            err.code = "AVATAR_LIMIT_CONCURRENT";
            throw err;
          }
        }
        [persona] = await tx
          .insert(wavespeedPersonasTable)
          .values({ userId, name: name.trim(), referenceObjectPath })
          .returning();
      });
    } catch (txErr: any) {
      if (txErr.code === "AVATAR_LIMIT_CONCURRENT") {
        res.status(403).json({ error: "avatar_limit_reached", message: txErr.message, planSlug, limit: planLimit });
        return;
      }
      throw txErr;
    }
    if (!persona) throw new Error("Persona creation failed unexpectedly");

    // Submit 3 look-gen jobs in parallel — first 3 looks are always free
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
    // Fetch personas sorted by creation date (oldest first) — order is used to decide
    // which personas are "enabled" when the user's plan limit is lower than their total count.
    const personas = await db
      .select()
      .from(wavespeedPersonasTable)
      .where(eq(wavespeedPersonasTable.userId, userId))
      .orderBy(wavespeedPersonasTable.createdAt);

    // Determine plan limits
    const isAdmin   = req.session.user?.role === "admin";
    const planSlug  = isAdmin ? "admin" : await getUserPlanSlug(userId);
    const planLimit = isAdmin ? 999 : getAvatarLimit(planSlug);

    // The first N personas (by createdAt ASC) are considered "enabled" by the plan.
    // If plan = basic (limit 1) and the user has 3 personas from a downgrade, only
    // persona #1 is enabled; personas #2 and #3 are blocked until they upgrade.
    const planEnabledMap = computePersonaPlanEnabled(personas, planLimit);

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
        return { ...p, looks, planEnabled: planEnabledMap.get(p.id) ?? true };
      }),
    );

    res.json({ personas: result, planSlug, planLimit });
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
            // Settle paid-look credit reservation — no-op if the look was free
            consumeLookCredits(look.id).catch((err) =>
              req.log.warn({ err, lookId: look.id }, "[WaveSpeed] consumeLookCredits failed"),
            );
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
            // Release paid-look credit reservation so the user can retry — no-op if free
            releaseLookCredits(look.id, "Look fallido").catch((err) =>
              req.log.warn({ err, lookId: look.id }, "[WaveSpeed] releaseLookCredits failed"),
            );
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
  const name = (req.body?.name ?? "Mi voz").trim() || "Mi voz";

  if (!file) {
    res.status(400).json({ error: "audio file is required" });
    return;
  }

  // ── Credit gate for paid voice clones (2nd+ clone per user) ──────────────
  // The first WaveSpeed voice clone per user is always free.
  // Admins bypass all credit requirements.
  const isAdminVoice = req.session.user?.role === "admin";
  // Count ALL non-failed voice clones across both WaveSpeed and HeyGen — the "first
  // voice free" rule is GLOBAL per user, not per provider.
  const nonFailedVoiceCount = isAdminVoice ? 0 : await countNonFailedVoiceClones(userId);
  const needsVoiceCredits = !isAdminVoice && nonFailedVoiceCount >= FREE_VOICE_CLONES;

  if (needsVoiceCredits) {
    const enough = await hasEnoughCredits(userId, EXTRA_VOICE_CREDIT_COST);
    if (!enough) {
      const wallet = await getUserCredits(userId);
      res.status(402).json({
        error:     "insufficient_credits",
        message:   `Necesitas ${EXTRA_VOICE_CREDIT_COST} créditos para clonar una voz adicional. Tienes ${wallet.availableCredits} disponibles.`,
        required:  EXTRA_VOICE_CREDIT_COST,
        available: wallet.availableCredits,
      });
      return;
    }
  }

  try {
    // Convert whatever the browser recorded (webm, ogg…) to 16-kHz mono WAV.
    // WaveSpeed's minimax voice-clone API rejects webm/ogg by extension (code 2013)
    // but accepts WAV.  Converting server-side avoids any browser compatibility issues.
    const wavBuffer = await convertToWav(file.buffer);
    const { url: audioUrl, objectName: sourceAudioObjectName } =
      await uploadBufferAndSign(wavBuffer, "audio/wav", "wavespeed-voices", ".wav");

    // Generate a unique custom_voice_id that satisfies WaveSpeed format rules:
    //   ≥ 8 chars, starts with a letter, contains both letters and numbers.
    // We keep it and save it immediately — no need to parse it from outputs later.
    const ts = Date.now();
    const hex = randomUUID().replace(/-/g, "").slice(0, 6);
    const customVoiceId = `WsV${ts}${hex}`; // e.g. WsV1723657890123abc123

    // Submit clone job to WaveSpeed
    const { requestId } = await submitVoiceClone(customVoiceId, audioUrl);

    // Create voice row — wavespeedVoiceId is already known upfront
    const [voiceRow] = await db
      .insert(wavespeedVoicesTable)
      .values({
        userId,
        displayName: name,
        wavespeedRequestId: requestId,
        wavespeedVoiceId: customVoiceId, // stored immediately; ready to use once status = "ready"
        status: "pending",
        sourceAudioObjectName,           // for regenerating play URLs later
      })
      .returning();

    // Reserve credits for paid voice clones — fire-and-forget after row creation so the
    // response is not blocked.  Reservation failure is logged; on the rare race where
    // it fails the user gets a free extra clone (acceptable edge case).
    if (needsVoiceCredits) {
      reserveVoiceCredits(
        userId, EXTRA_VOICE_CREDIT_COST, voiceRow.id, "wavespeed", "Voz clonada adicional",
      ).catch((err) =>
        req.log.warn({ err, voiceId: voiceRow.id }, "[WaveSpeed] Voice credit reservation failed"),
      );
    }

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

// ── GET /wavespeed/voices/:id/play-url ───────────────────────────────────────
// Generates a fresh 1-hour signed URL for the original WAV recorded by the user.

router.get("/wavespeed/voices/:id/play-url", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const voiceId = parseInt(req.params.id, 10);
  if (isNaN(voiceId)) { res.status(400).json({ error: "Invalid voice ID" }); return; }

  const [voice] = await db
    .select()
    .from(wavespeedVoicesTable)
    .where(and(eq(wavespeedVoicesTable.id, voiceId), eq(wavespeedVoicesTable.userId, userId)))
    .limit(1);

  if (!voice) { res.status(404).json({ error: "Voice not found" }); return; }
  if (!voice.sourceAudioObjectName) { res.status(404).json({ error: "No source audio stored for this voice" }); return; }

  try {
    const url = await getSignedObjectUrl(voice.sourceAudioObjectName, 3600);
    res.json({ url });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to generate play URL");
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
      // wavespeedVoiceId (= custom_voice_id) was stored at submission time —
      // no need to parse it from outputs. Just flip status to "ready".
      const [u] = await db
        .update(wavespeedVoicesTable)
        .set({ status: "ready", updatedAt: new Date() })
        .where(and(eq(wavespeedVoicesTable.id, voiceId), eq(wavespeedVoicesTable.userId, userId)))
        .returning();
      updated = u;
      // Settle paid-voice credit reservation — no-op for the first (free) clone
      consumeVoiceCredits(voiceId, "wavespeed").catch((err) =>
        req.log.warn({ err, voiceId }, "[WaveSpeed] consumeVoiceCredits failed"),
      );
    } else if (result.status === "failed") {
      const [u] = await db
        .update(wavespeedVoicesTable)
        .set({ status: "failed", errorMessage: result.error ?? "Unknown error", updatedAt: new Date() })
        .where(and(eq(wavespeedVoicesTable.id, voiceId), eq(wavespeedVoicesTable.userId, userId)))
        .returning();
      updated = u;
      // Release paid-voice credit reservation so the user can retry — no-op for free clones
      releaseVoiceCredits(voiceId, "wavespeed", "Voz fallida").catch((err) =>
        req.log.warn({ err, voiceId }, "[WaveSpeed] releaseVoiceCredits failed"),
      );
    }

    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to poll voice status");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── PATCH /wavespeed/personas/:id ────────────────────────────────────────────

router.patch("/wavespeed/personas/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const personaId = parseInt(req.params.id, 10);
  if (isNaN(personaId)) { res.status(400).json({ error: "Invalid persona ID" }); return; }

  const { name } = (req.body ?? {}) as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  try {
    const [updated] = await db
      .update(wavespeedPersonasTable)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(and(eq(wavespeedPersonasTable.id, personaId), eq(wavespeedPersonasTable.userId, userId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Persona not found" }); return; }
    res.json({ persona: { id: updated.id, name: updated.name } });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to update persona name");
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
      .where(and(eq(wavespeedLooksTable.id, lookId), eq(wavespeedLooksTable.userId, userId)))
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

// ── DELETE /wavespeed/voices/:id ─────────────────────────────────────────────

router.delete("/wavespeed/voices/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const voiceId = parseInt(req.params.id, 10);
  if (isNaN(voiceId)) { res.status(400).json({ error: "Invalid voice ID" }); return; }

  try {
    await db
      .delete(wavespeedVoicesTable)
      .where(and(eq(wavespeedVoicesTable.id, voiceId), eq(wavespeedVoicesTable.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to delete voice");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── POST /wavespeed/personas/:id/looks/generate ───────────────────────────────

router.post("/wavespeed/personas/:id/looks/generate", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const personaId = parseInt(req.params.id, 10);
  if (isNaN(personaId)) { res.status(400).json({ error: "Invalid persona ID" }); return; }

  const {
    name: customName,
    prompt: customPrompt,
    baseLookId,
    pose,
  } = (req.body ?? {}) as {
    name?: string;
    prompt?: string;
    baseLookId?: number;
    pose?: "half_body" | "close_up" | "full_body";
  };

  // Pose framing prefix injected into every prompt.
  // "both hands naturally visible" is intentional — infinitetalk-fast can only
  // animate what exists in the source image, so hands must be in frame for the
  // talking-head video to show natural arm/hand movement.
  const POSE_PREFIX: Record<string, string> = {
    half_body: "Half-body framing (from the waist up), both hands and arms naturally visible in frame.",
    close_up:  "Close-up framing (from the chest up, face prominent). Upper arms visible if possible.",
    full_body:  "Full-body framing (entire body visible, hands and arms clearly in frame).",
  };
  const posePrefix = POSE_PREFIX[pose ?? "half_body"] ?? POSE_PREFIX.half_body;

  try {
    const [persona] = await db
      .select()
      .from(wavespeedPersonasTable)
      .where(and(eq(wavespeedPersonasTable.id, personaId), eq(wavespeedPersonasTable.userId, userId)))
      .limit(1);

    if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

    // ── Credit gate for paid looks (4th+ look per persona) ────────────────────
    // The first FREE_LOOKS_PER_PERSONA (3) looks generated on persona creation are always free.
    // Admins bypass all credit requirements.
    const isAdmin = req.session.user?.role === "admin";
    const [lookCountRow] = await db
      .select({ cnt: drizzleCount() })
      .from(wavespeedLooksTable)
      .where(and(eq(wavespeedLooksTable.personaId, personaId), eq(wavespeedLooksTable.userId, userId)));
    const lookCount = Number(lookCountRow?.cnt ?? 0);
    const needsLookCredits = !isAdmin && lookCount >= FREE_LOOKS_PER_PERSONA;

    if (needsLookCredits) {
      const enough = await hasEnoughCredits(userId, LOOK_CREDIT_COST);
      if (!enough) {
        const wallet = await getUserCredits(userId);
        res.status(402).json({
          error:     "insufficient_credits",
          message:   `Necesitas ${LOOK_CREDIT_COST} créditos para generar un look adicional. Tienes ${wallet.availableCredits} disponibles.`,
          required:  LOOK_CREDIT_COST,
          available: wallet.availableCredits,
        });
        return;
      }
    }

    // Determine reference image:
    // 1. Use baseLookId's imageUrl if provided (user picked an existing look as reference)
    // 2. Fall back to the persona's original reference photo
    let referenceImageUrl: string;

    if (baseLookId) {
      const [baseLook] = await db
        .select()
        .from(wavespeedLooksTable)
        .where(
          and(
            eq(wavespeedLooksTable.id, baseLookId),
            eq(wavespeedLooksTable.userId, userId),
          ),
        )
        .limit(1);

      if (!baseLook?.imageUrl) {
        res.status(400).json({ error: "El look de referencia no tiene imagen. Elige otro look." });
        return;
      }
      referenceImageUrl = baseLook.imageUrl;
    } else {
      if (!persona.referenceObjectPath) {
        res.status(400).json({ error: "Esta persona no tiene una foto de referencia guardada. Crea un nuevo avatar AI para generar más looks." });
        return;
      }
      const gcsName = gcsObjectNameFromPath(persona.referenceObjectPath);
      referenceImageUrl = await getSignedObjectUrl(gcsName, 4 * 3600);
    }

    // Build prompt
    const existingLooks = await db
      .select({ name: wavespeedLooksTable.name })
      .from(wavespeedLooksTable)
      .where(and(eq(wavespeedLooksTable.personaId, personaId), eq(wavespeedLooksTable.userId, userId)));

    const existingNames = new Set(existingLooks.map((l) => l.name));
    const unusedPreset = LOOK_PROMPTS.find((lp) => !existingNames.has(lp.name));

    const lookPrompt = customPrompt?.trim()
      ? `RAW DSLR photograph, shot on 85mm f/1.4 prime lens, vertical portrait, 9:16 aspect ratio. ${posePrefix} Same person, same face and hair. ${customPrompt.trim()}. Natural skin texture with visible pores, no plastic smoothing, no AI artifacts, no digital retouching, authentic candid expression, photojournalistic quality, film grain.`
      : (unusedPreset?.prompt ?? LOOK_PROMPTS[Math.floor(Math.random() * LOOK_PROMPTS.length)].prompt);

    const lookName = customName?.trim()
      || (customPrompt?.trim() ? "Look personalizado" : (unusedPreset?.name ?? "Look extra"));

    const { requestId } = await submitImageEdit(referenceImageUrl, lookPrompt);
    const config = JSON.stringify({ requestId, generationStatus: "pending" });

    const [look] = await db
      .insert(wavespeedLooksTable)
      .values({ userId, personaId, name: lookName, config })
      .returning();

    // Reserve credits for paid looks (4th+ look per persona).
    // Done after DB row creation so we have the look ID for the ledger entry.
    // If reservation fails (concurrent race depletes balance), clean up the look row.
    if (needsLookCredits) {
      try {
        await reserveLookCredits(userId, LOOK_CREDIT_COST, look.id, "Look adicional");
      } catch (creditErr: any) {
        await db.delete(wavespeedLooksTable).where(eq(wavespeedLooksTable.id, look.id)).catch(() => {});
        res.status(402).json({ error: "insufficient_credits", message: creditErr.message ?? "Créditos insuficientes" });
        return;
      }
    }

    await db.insert(wavespeedJobsTable).values({
      userId,
      model: WAVESPEED_MODELS.IMAGE_EDIT,
      status: "processing",
      wavespeedRequestId: requestId,
      inputPayload: JSON.stringify({ prompt: lookPrompt, personaId, lookId: look.id }),
    });

    res.json({ look: { id: look.id, name: look.name, config: look.config } });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to generate new look");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── PATCH /wavespeed/voices/:id ───────────────────────────────────────────────
// Save voice tuning settings (speed and/or pitch) for a WaveSpeed cloned voice.
// Clears the cached previewAudioUrl so the next play regenerates with new settings.

router.patch("/wavespeed/voices/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const voiceId = parseInt(req.params.id, 10);
  if (isNaN(voiceId)) { res.status(400).json({ error: "Invalid voice ID" }); return; }

  const { speed, pitch } = (req.body ?? {}) as { speed?: number | null; pitch?: number | null };

  try {
    const updateFields: Record<string, unknown> = { previewAudioUrl: null, updatedAt: new Date() };
    if (speed !== undefined) updateFields.speed  = speed;
    if (pitch !== undefined) updateFields.pitch  = pitch;

    const [updated] = await db
      .update(wavespeedVoicesTable)
      .set(updateFields)
      .where(and(eq(wavespeedVoicesTable.id, voiceId), eq(wavespeedVoicesTable.userId, userId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Voice not found" }); return; }

    res.json({ voice: updated });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to update voice settings");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── GET /wavespeed/voices/:id/preview ─────────────────────────────────────────
// Returns a playable audio URL for any ready WaveSpeed cloned voice.
//
//  • Fast path:  cached previewAudioUrl (busted by PATCH when speed/pitch change)
//  • Slow path:  generate a short TTS clip using the cloned voice + saved tuning,
//                poll until ready, cache the URL in DB, return it (~5-15 s first call)
//
// NOTE: The original source audio fast-path was intentionally removed.
// Returning the raw recording is misleading — it sounds like the user's human voice,
// not the AI clone, so they cannot hear if the clone sounds right or how tuning applies.

const VOICE_PREVIEW_TEXT =
  "Hola, esta es mi voz clonada con inteligencia artificial. ¿Cómo suena?";

router.get("/wavespeed/voices/:id/preview", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const voiceId = parseInt(req.params.id, 10);
  if (isNaN(voiceId)) { res.status(400).json({ error: "Invalid voice ID" }); return; }

  // Optional override params — used by the tuning UI to preview before saving.
  // When present the cache is bypassed and the result is NOT saved to DB.
  const overrideSpeed = req.query.speed !== undefined ? parseFloat(req.query.speed as string) : undefined;
  const overridePitch = req.query.pitch !== undefined ? parseFloat(req.query.pitch as string) : undefined;
  const hasOverride   = overrideSpeed !== undefined || overridePitch !== undefined;

  try {
    const [voice] = await db
      .select()
      .from(wavespeedVoicesTable)
      .where(and(eq(wavespeedVoicesTable.id, voiceId), eq(wavespeedVoicesTable.userId, userId)))
      .limit(1);

    if (!voice) { res.status(404).json({ error: "Voice not found" }); return; }
    if (voice.status !== "ready" || !voice.wavespeedVoiceId) {
      res.status(400).json({ error: "Voice is not ready yet" }); return;
    }

    // Fast path — already cached AND no override requested
    if (voice.previewAudioUrl && !hasOverride) {
      res.json({ url: voice.previewAudioUrl }); return;
    }

    const effectiveSpeed = overrideSpeed ?? voice.speed ?? undefined;
    const effectivePitch = overridePitch ?? voice.pitch ?? undefined;

    req.log.info({ voiceId, speed: effectiveSpeed, pitch: effectivePitch, hasOverride }, "[WaveSpeed] Generating TTS preview for voice");
    const { requestId } = await submitSpeech(
      VOICE_PREVIEW_TEXT,
      voice.wavespeedVoiceId,
      undefined,
      { speed: effectiveSpeed, pitch: effectivePitch },
    );

    // Poll up to 45 s (15 × 3 s)
    let audioUrl: string | null = null;
    for (let i = 0; i < 15; i++) {
      await new Promise<void>((r) => setTimeout(r, 3000));
      const result = await getJobStatus(requestId);
      if (result.status === "completed") {
        const out = result.outputs as string[] | undefined;
        audioUrl = out?.[0] ?? null;
        break;
      }
      if (result.status === "failed") break;
    }

    if (!audioUrl) {
      res.status(504).json({ error: "Preview generation timed out — try again" }); return;
    }

    // Only cache when NOT using override values (override = still exploring)
    if (!hasOverride) {
      await db
        .update(wavespeedVoicesTable)
        .set({ previewAudioUrl: audioUrl, updatedAt: new Date() })
        .where(and(eq(wavespeedVoicesTable.id, voiceId), eq(wavespeedVoicesTable.userId, userId)));
    }

    res.json({ url: audioUrl });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed] Failed to generate voice preview");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

export default router;
