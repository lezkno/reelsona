import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword } from "../lib/password";

const router = Router();

/**
 * POST /api/auth/login
 * Body: { username: string; password: string }
 */
router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  const { username, password } = (req.body ?? {}) as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    res.status(400).json({ error: "Se requieren usuario y contraseña" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Usuario o contraseña incorrectos" });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: "Usuario desactivado. Contacta al administrador." });
      return;
    }

    // Update last login timestamp
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    req.session.authenticated = true;
    req.session.user = { username: user.username, role: user.role };
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
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
