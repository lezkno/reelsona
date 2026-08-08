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
 *
 * Looks up the user in the DB and verifies the hashed password.
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
 * Returns { authenticated: true, user } when a valid session exists, 401 otherwise.
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
