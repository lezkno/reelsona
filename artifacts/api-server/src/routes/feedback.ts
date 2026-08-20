import { Router } from "express";
import { SendFeedbackBody, SendFeedbackResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { escapeHtml, sendEmail } from "../lib/email";

const router = Router();
const FEEDBACK_DESTINATION = "foto.lezkno@gmail.com";
const MIN_SUBMISSION_INTERVAL_MS = 60_000;
const lastSubmissionByUser = new Map<number, number>();

const categoryLabels: Record<string, string> = {
  bug: "Error o bug",
  problem: "Problema o dificultad",
  feature: "Función nueva",
};

function cleanupSubmissionCache(now: number): void {
  for (const [userId, timestamp] of lastSubmissionByUser) {
    if (now - timestamp > MIN_SUBMISSION_INTERVAL_MS * 2) {
      lastSubmissionByUser.delete(userId);
    }
  }
}

router.post("/feedback", async (req, res): Promise<void> => {
  const parsed = SendFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Escribe una opinión de al menos 10 caracteres." });
    return;
  }

  const user = req.session.user!;
  const now = Date.now();
  cleanupSubmissionCache(now);
  const lastSubmission = lastSubmissionByUser.get(user.userId);
  if (lastSubmission && now - lastSubmission < MIN_SUBMISSION_INTERVAL_MS) {
    res.status(429).json({ error: "Espera un momento antes de enviar otra opinión." });
    return;
  }

  const categoryLabel = categoryLabels[parsed.data.category] ?? "Opinión";
  const message = parsed.data.message.trim();
  const page = parsed.data.page?.trim() || "No disponible";
  const username = user.username || `Usuario #${user.userId}`;
  const safeCategory = escapeHtml(categoryLabel);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br />");
  const safePage = escapeHtml(page);
  const safeUsername = escapeHtml(username);

  try {
    await sendEmail({
      to: FEEDBACK_DESTINATION,
      subject: `[Reelsona] ${categoryLabel} — ${username}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#172033">
          <div style="padding:24px;border-radius:16px;background:#111827;color:#fff">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a5b4fc">Opiniones de usuarios</p>
            <h1 style="margin:0;font-size:24px">Nueva opinión de Reelsona</h1>
          </div>
          <div style="padding:24px;border:1px solid #e5e7eb;border-top:0">
            <p style="margin:0 0 8px"><strong>Tipo:</strong> ${safeCategory}</p>
            <p style="margin:0 0 8px"><strong>Usuario:</strong> ${safeUsername} (ID ${user.userId})</p>
            <p style="margin:0 0 20px"><strong>Página:</strong> ${safePage}</p>
            <div style="padding:16px;border-radius:10px;background:#f8fafc;line-height:1.6">${safeMessage}</div>
          </div>
        </div>`,
      text: [
        "Opinión de usuario de Reelsona",
        `Tipo: ${categoryLabel}`,
        `Usuario: ${username} (ID ${user.userId})`,
        `Página: ${page}`,
        "",
        message,
      ].join("\n"),
    });
    lastSubmissionByUser.set(user.userId, now);
    res.json(SendFeedbackResponse.parse({ success: true, message: "Gracias por ayudarnos a mejorar Reelsona." }));
  } catch (error) {
    logger.error({ err: error, userId: user.userId }, "[Feedback] Email delivery failed");
    res.status(502).json({ error: "No pudimos enviar tu opinión. Intenta de nuevo en unos minutos." });
  }
});

export default router;