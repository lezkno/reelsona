import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

/**
 * POST /api/auth/login
 * Body: { password: string }
 *
 * Compares against ADMIN_PASSWORD env var.
 * If ADMIN_PASSWORD is not set, access is granted automatically
 * (first-time / development mode).
 */
router.post("/auth/login", (req: Request, res: Response): void => {
  const { password } = (req.body ?? {}) as { password?: string };
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    if (process.env.NODE_ENV === "production") {
      // Production requires ADMIN_PASSWORD — refuse with an actionable error
      res.status(503).json({
        error: "ADMIN_PASSWORD no está configurada. Añadila como secreto en Replit antes de continuar.",
      });
      return;
    }
    // Development only: allow open access without password for first-time setup
    req.session.authenticated = true;
    req.session.user = { username: "admin", role: "admin" };
    res.json({ ok: true, message: "Acceso concedido (modo desarrollo — configura ADMIN_PASSWORD para producción)" });
    return;
  }

  if (!password || password !== adminPassword) {
    res.status(401).json({ error: "Contraseña incorrecta" });
    return;
  }

  req.session.authenticated = true;
  req.session.user = { username: "admin", role: "admin" };
  res.json({ ok: true });
});

/**
 * POST /api/auth/logout
 */
router.post("/auth/logout", (req: Request, res: Response): void => {
  req.session.destroy(() => {});
  res.clearCookie("contentpilot.sid");
  res.json({ ok: true });
});

/**
 * GET /api/auth/me
 * Returns { authenticated: true } when a valid session exists, 401 otherwise.
 */
router.get("/auth/me", (req: Request, res: Response): void => {
  if (req.session?.authenticated) {
    res.json({
      authenticated: true,
      user: req.session.user ?? { username: "admin", role: "admin" },
    });
    return;
  }
  res.status(401).json({ authenticated: false });
});

export default router;
