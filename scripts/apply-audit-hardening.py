from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count} for:\n{old[:180]}")
    p.write_text(text.replace(old, new))


instagram = "artifacts/api-server/src/routes/instagram.ts"
scheduler = "artifacts/api-server/src/lib/scheduler.ts"

replace_exact(instagram, "  saveAuditCache({\n", "  saveAuditCache(req.session.user!.userId, {\n")
replace_exact(
    scheduler,
    "getLatestAuditCache().catch(() => null)",
    "getLatestAuditCache(userId).catch(() => null)",
    expected=2,
)
replace_exact(
    scheduler,
    "  const [automation] = await db.select().from(automationConfigTable).limit(1);\n",
    "",
)
replace_exact(
    scheduler,
    "  for (const v of stuckVideos) {\n    if (!v.videoUrl) continue;\n    if (automation?.captionsEnabled) {\n",
    "  for (const v of stuckVideos) {\n    if (!v.videoUrl) continue;\n    const [videoAutomation] = await db\n      .select({ captionsEnabled: automationConfigTable.captionsEnabled })\n      .from(automationConfigTable)\n      .where(eq(automationConfigTable.userId, v.userId))\n      .limit(1);\n    if (videoAutomation?.captionsEnabled) {\n",
)
replace_exact(
    scheduler,
    "  // ── Auto-publish all ready videos when automation + auto_publish are on ──\n  // Only publish when both caption AND copy are in a terminal state so the\n  // Instagram description is ready before the post goes live.\n  if (automation?.enabled && automation?.autoPublish) {\n",
    "  // ── Auto-publish ready videos using each owner's automation config ─────\n  // Only publish when both caption AND copy are terminal.\n  {\n",
)
replace_exact(
    scheduler,
    "    for (const video of readyVideos) {\n      if (video.scheduledPublishAt) continue; // handled in the scheduled sweep above\n\n",
    "    for (const video of readyVideos) {\n      if (video.scheduledPublishAt) continue; // handled in the scheduled sweep above\n\n      const [videoAutomation] = await db\n        .select({ enabled: automationConfigTable.enabled, autoPublish: automationConfigTable.autoPublish })\n        .from(automationConfigTable)\n        .where(eq(automationConfigTable.userId, video.userId))\n        .limit(1);\n      if (!videoAutomation?.enabled || !videoAutomation.autoPublish) continue;\n\n",
)

marker = "      continue;\n    }\n\n    // ── WaveSpeed polling: sentinel \"wavespeed-{stage}:{requestId}\" ───────\n"
insertion = """      continue;
    }

    // ── Shared polling accounting / timeout for every provider ─────────────
    const pollNow = new Date();
    const startedAt = video.generatingStartedAt ?? pollNow;
    const newAttempts = (video.pollAttempts ?? 0) + 1;
    const isWaveSpeedVideo = video.heygenVideoId.startsWith("wavespeed-");

    await db
      .update(videosTable)
      .set({
        pollAttempts: newAttempts,
        generatingStartedAt: video.generatingStartedAt ?? pollNow,
        updatedAt: pollNow,
      })
      .where(eq(videosTable.id, video.id));

    const ageMs = pollNow.getTime() - startedAt.getTime();
    if (ageMs > pollTimeoutMs) {
      const timeoutMinutes = Math.round(pollTimeoutMs / 60000);
      const providerName = isWaveSpeedVideo ? "WaveSpeed" : "HeyGen";
      const timeoutMsg = `Video atascado: ${providerName} no respondió en ${timeoutMinutes} minutos (${newAttempts} intentos)`;
      await db
        .update(videosTable)
        .set({ status: "failed", errorMessage: timeoutMsg, updatedAt: pollNow })
        .where(eq(videosTable.id, video.id));
      if (video.contentPlanId) {
        await db
          .update(contentPlanItemsTable)
          .set({ status: isWaveSpeedVideo ? "scripted" : "failed", updatedAt: pollNow })
          .where(eq(contentPlanItemsTable.id, video.contentPlanId));
      }
      sendVideoFailedAlert(video.userId, video.contentPlanId ?? null).catch(() => {});
      logger.warn({ videoId: video.id, providerName, ageMs, attempts: newAttempts }, timeoutMsg);
      await releaseVideoCredits(video.id, `Video timeout: ${timeoutMsg}`).catch((err) =>
        logger.error({ videoId: video.id, err }, "[Credits] Release falló en timeout")
      );
      continue;
    }

    const [videoAutomation] = await db
      .select({
        enabled: automationConfigTable.enabled,
        autoPublish: automationConfigTable.autoPublish,
        captionsEnabled: automationConfigTable.captionsEnabled,
      })
      .from(automationConfigTable)
      .where(eq(automationConfigTable.userId, video.userId))
      .limit(1);

    // ── WaveSpeed polling: sentinel "wavespeed-{stage}:{requestId}" ───────
"""
replace_exact(scheduler, marker, insertion)

for old, new in [
    (
        "throw new Error(`TTS completado pero sin audio_url en outputs: ${JSON.stringify(rawOutputs)}`);",
        "throw new Error(`WS_TERMINAL: TTS completado pero sin audio_url en outputs: ${JSON.stringify(rawOutputs)}`);",
    ),
    (
        'throw new Error("No se encontró imageUrl para el paso de talking-head");',
        'throw new Error("WS_TERMINAL: No se encontró imageUrl para el paso de talking-head");',
    ),
    (
        'throw new Error(`TTS fallido: ${jobResult.error ?? "error desconocido"}`);',
        'throw new Error(`WS_TERMINAL: TTS fallido: ${jobResult.error ?? "error desconocido"}`);',
    ),
    (
        "throw new Error(`Talking-head completado pero sin video_url en outputs: ${JSON.stringify(rawOutputs)}`);",
        "throw new Error(`WS_TERMINAL: Talking-head completado pero sin video_url en outputs: ${JSON.stringify(rawOutputs)}`);",
    ),
    (
        'throw new Error(`Talking-head fallido: ${jobResult.error ?? "error desconocido"}`);',
        'throw new Error(`WS_TERMINAL: Talking-head fallido: ${jobResult.error ?? "error desconocido"}`);',
    ),
]:
    replace_exact(scheduler, old, new)

replace_exact(
    scheduler,
    "              const [autoCfg] = await db.select({ captionsEnabled: automationConfigTable.captionsEnabled })\n                .from(automationConfigTable)\n                .where(eq(automationConfigTable.userId, video.userId))\n                .limit(1);\n              if (autoCfg?.captionsEnabled) {\n",
    "              if (videoAutomation?.captionsEnabled) {\n",
)

old_catch = """      } catch (wsErr: any) {
        const wsError = wsErr instanceof Error ? wsErr.message : String(wsErr);
        logger.error({ videoId: video.id, stage, requestId, wsError }, "[WaveSpeed] Error en polling");
        await db
          .update(videosTable)
          .set({
            status: "failed",
            errorMessage: "No se pudo completar la generación del video. Intenta de nuevo.",
            updatedAt: new Date(),
          })
          .where(eq(videosTable.id, video.id));
        if (video.contentPlanId) {
          await db
            .update(contentPlanItemsTable)
            .set({ status: "scripted", updatedAt: new Date() }) // retryable
            .where(eq(contentPlanItemsTable.id, video.contentPlanId));
        }
        await releaseVideoCredits(video.id, "Generación de video fallida").catch((err) =>
          logger.error({ videoId: video.id, err }, "[Credits][WaveSpeed] Release falló en error de polling")
        );
      }
"""
new_catch = """      } catch (wsErr: any) {
        const wsError = wsErr instanceof Error ? wsErr.message : String(wsErr);
        const terminal = wsError.startsWith("WS_TERMINAL:");
        if (!terminal) {
          logger.warn(
            { videoId: video.id, stage, requestId, wsError },
            "[WaveSpeed] Polling temporalmente no disponible — se reintentará sin liberar créditos",
          );
          continue;
        }

        const terminalMessage = wsError.replace(/^WS_TERMINAL:\\s*/, "");
        logger.error({ videoId: video.id, stage, requestId, terminalMessage }, "[WaveSpeed] Fallo terminal confirmado");
        await db
          .update(videosTable)
          .set({
            status: "failed",
            errorMessage: "No se pudo completar la generación del video. Intenta de nuevo.",
            updatedAt: new Date(),
          })
          .where(eq(videosTable.id, video.id));
        if (video.contentPlanId) {
          await db
            .update(contentPlanItemsTable)
            .set({ status: "scripted", updatedAt: new Date() })
            .where(eq(contentPlanItemsTable.id, video.contentPlanId));
        }
        await releaseVideoCredits(video.id, `Generación WaveSpeed fallida: ${terminalMessage}`).catch((err) =>
          logger.error({ videoId: video.id, err }, "[Credits][WaveSpeed] Release falló en error terminal")
        );
      }
"""
replace_exact(scheduler, old_catch, new_catch)

old_timeout = """    // ── Track polling attempts and generation start time ──────────────────
    const now = new Date();
    const startedAt = video.generatingStartedAt ?? now;
    const newAttempts = (video.pollAttempts ?? 0) + 1;

    await db
      .update(videosTable)
      .set({
        pollAttempts: newAttempts,
        generatingStartedAt: video.generatingStartedAt ?? now,
        updatedAt: now,
      })
      .where(eq(videosTable.id, video.id));

    // ── Timeout check ─────────────────────────────────────────────────────
    const ageMs = now.getTime() - startedAt.getTime();
    if (ageMs > pollTimeoutMs) {
      const timeoutMinutes = Math.round(pollTimeoutMs / 60000);
      const timeoutMsg = `Video atascado: HeyGen no respondió en ${timeoutMinutes} minutos (${newAttempts} intentos)`;
      await db
        .update(videosTable)
        .set({ status: "failed", errorMessage: timeoutMsg, updatedAt: now })
        .where(eq(videosTable.id, video.id));
      if (video.contentPlanId) {
        await db.update(contentPlanItemsTable).set({ status: "failed", updatedAt: now }).where(eq(contentPlanItemsTable.id, video.contentPlanId));
      }
      sendVideoFailedAlert(video.userId, video.contentPlanId ?? null).catch(() => {});
      logger.warn({ videoId: video.id, ageMs, attempts: newAttempts }, timeoutMsg);
      await releaseVideoCredits(video.id, `Video timeout: ${timeoutMsg}`).catch((err) =>
        logger.error({ videoId: video.id, err }, "[Credits] Release falló en timeout")
      );
      continue;
    }

"""
replace_exact(scheduler, old_timeout, "")

replace_exact(
    scheduler,
    "        if (video.captionStatus === null) {\n          if (automation?.captionsEnabled) {\n",
    "        if (video.captionStatus === null) {\n          if (videoAutomation?.captionsEnabled) {\n",
)
replace_exact(
    scheduler,
    "        if (automation?.enabled && automation?.autoPublish && status.video_url && captionTerminal && noCopyPending) {\n",
    "        if (videoAutomation?.enabled && videoAutomation?.autoPublish && status.video_url && captionTerminal && noCopyPending) {\n",
)

print("Deterministic scheduler/Instagram hardening patch applied successfully")
