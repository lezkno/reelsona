import { Router } from "express";
import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, wavespeedLooksTable, wavespeedPersonasTable, wavespeedVoicesTable } from "@workspace/db";

const router = Router();

export function mergeFinalLookConfig(
  raw: string | null,
  selected: boolean,
  voiceId: number | null,
): string {
  let current: Record<string, unknown> = {};
  try { current = raw ? JSON.parse(raw) : {}; } catch { current = {}; }
  return JSON.stringify({
    ...current,
    selected,
    voiceId: selected ? voiceId : null,
  });
}

/**
 * RC1 atomic finalization for the Avatar AI wizard.
 * Persists the exact selected looks + cloned voice in one DB transaction.
 * The UI must not report the avatar as complete until this endpoint succeeds.
 */
router.post("/wavespeed/personas/:id/finalize", async (req: Request, res: Response): Promise<void> => {
  if (!req.session?.authenticated || !req.session.user?.userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const userId = req.session.user.userId;
  const rawPersonaId = req.params.id;
  const personaIdParam = Array.isArray(rawPersonaId) ? rawPersonaId[0] : rawPersonaId;
  const personaId = Number.parseInt(personaIdParam ?? "", 10);
  const { lookIds, voiceId } = (req.body ?? {}) as { lookIds?: unknown; voiceId?: unknown };

  if (!Number.isInteger(personaId)) {
    res.status(400).json({ error: "Persona inválida" });
    return;
  }
  if (!Array.isArray(lookIds) || lookIds.length === 0 || !lookIds.every(Number.isInteger)) {
    res.status(400).json({ error: "Debes seleccionar al menos un look válido" });
    return;
  }
  if (!Number.isInteger(voiceId)) {
    res.status(400).json({ error: "Debes seleccionar una voz válida" });
    return;
  }

  const selected = new Set<number>((lookIds as number[]).map(Number));

  try {
    const result = await db.transaction(async (tx) => {
      const [persona] = await tx
        .select({ id: wavespeedPersonasTable.id })
        .from(wavespeedPersonasTable)
        .where(and(
          eq(wavespeedPersonasTable.id, personaId),
          eq(wavespeedPersonasTable.userId, userId),
        ))
        .limit(1);
      if (!persona) return { kind: "persona_missing" as const };

      const [voice] = await tx
        .select({ id: wavespeedVoicesTable.id, status: wavespeedVoicesTable.status })
        .from(wavespeedVoicesTable)
        .where(and(
          eq(wavespeedVoicesTable.id, voiceId as number),
          eq(wavespeedVoicesTable.userId, userId),
        ))
        .limit(1);
      if (!voice) return { kind: "voice_missing" as const };
      if (voice.status !== "ready") return { kind: "voice_not_ready" as const };

      const looks = await tx
        .select()
        .from(wavespeedLooksTable)
        .where(and(
          eq(wavespeedLooksTable.personaId, personaId),
          eq(wavespeedLooksTable.userId, userId),
        ));

      const ownedIds = new Set(looks.map((l) => l.id));
      for (const id of selected) {
        if (!ownedIds.has(id)) return { kind: "look_missing" as const };
      }

      const updated = [];
      for (const look of looks) {
        const isSelected = selected.has(look.id);
        const [row] = await tx
          .update(wavespeedLooksTable)
          .set({
            config: mergeFinalLookConfig(look.config, isSelected, voice.id),
            updatedAt: new Date(),
          })
          .where(and(
            eq(wavespeedLooksTable.id, look.id),
            eq(wavespeedLooksTable.userId, userId),
          ))
          .returning();
        updated.push(row);
      }

      return { kind: "ok" as const, looks: updated };
    });

    if (result.kind === "persona_missing") {
      res.status(404).json({ error: "Avatar no encontrado" });
      return;
    }
    if (result.kind === "voice_missing") {
      res.status(404).json({ error: "Voz no encontrada" });
      return;
    }
    if (result.kind === "voice_not_ready") {
      res.status(409).json({ error: "La voz todavía no está lista" });
      return;
    }
    if (result.kind === "look_missing") {
      res.status(400).json({ error: "Uno de los looks no pertenece a este avatar" });
      return;
    }

    res.json({ ok: true, looks: result.looks });
  } catch (err: any) {
    req.log.error({ err, userId, personaId }, "[RC1] Failed to finalize WaveSpeed avatar");
    res.status(500).json({ error: "No se pudo guardar la configuración final del avatar" });
  }
});

export default router;
