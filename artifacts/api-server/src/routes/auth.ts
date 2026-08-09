import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword, hashPassword } from "../lib/password";
import { sendEmail, passwordChangedEmail } from "../lib/email";

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
    req.session.user = { username: user.username, role: user.role, userId: user.id };
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
 * Returns session info enriched with full profile from DB.
 */
router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).json({ authenticated: false });
    return;
  }
  const sessionUser = req.session.user ?? { username: "admin", role: "admin", userId: 1 };
  try {
    const [row] = await db.select().from(users).where(eq(users.id, sessionUser.userId)).limit(1);
    res.json({
      authenticated: true,
      user: {
        ...sessionUser,
        fullName: row?.fullName ?? null,
        email: row?.email ?? null,
        phone: row?.phone ?? null,
        avatarUrl: row?.avatarUrl ?? null,
      },
    });
  } catch {
    res.json({ authenticated: true, user: sessionUser });
  }
});

/**
 * PATCH /api/auth/profile
 * Self-service profile update (name, email, phone).
 */
router.patch("/auth/profile", async (req: Request, res: Response): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const { fullName, email, phone, avatarUrl } = (req.body ?? {}) as {
    fullName?: string; email?: string; phone?: string; avatarUrl?: string;
  };
  const userId = req.session.user?.userId;
  if (!userId) { res.status(400).json({ error: "Sesión inválida" }); return; }

  try {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (fullName !== undefined) patch.fullName = fullName || null;
    if (email !== undefined) patch.email = email || null;
    if (phone !== undefined) patch.phone = phone || null;
    if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl || null;
    await db.update(users).set(patch).where(eq(users.id, userId));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al actualizar perfil" });
  }
});

/**
 * POST /api/auth/change-password
 * Self-service password change.
 */
router.post("/auth/change-password", async (req: Request, res: Response): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const { currentPassword, newPassword } = (req.body ?? {}) as {
    currentPassword?: string; newPassword?: string;
  };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Se requieren ambas contraseñas" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    return;
  }
  const userId = req.session.user?.userId;
  if (!userId) { res.status(400).json({ error: "Sesión inválida" }); return; }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      res.status(401).json({ error: "Contraseña actual incorrecta" });
      return;
    }
    await db.update(users)
      .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, userId));

    // Fire-and-forget: notify by email (don't block the response)
    if (user.email) {
      const tpl = passwordChangedEmail(user.fullName ?? user.username)
      sendEmail({ to: user.email, ...tpl }).catch(() => {})
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al cambiar contraseña" });
  }
});

export default router;
