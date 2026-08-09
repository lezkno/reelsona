/**
 * Admin user management routes — all require admin session.
 * GET    /api/users         — list all users
 * POST   /api/users         — create a new user
 * PATCH  /api/users/:id     — update user fields
 * DELETE /api/users/:id     — delete a user (cannot delete yourself)
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../lib/password";
import { sendEmail, welcomeEmail, getAppUrl } from "../lib/email";
import { requireAdmin } from "../middleware/auth";

const router = Router();

// All user-management endpoints require admin role
router.use(requireAdmin);

const PUBLIC_FIELDS = {
  id:          users.id,
  username:    users.username,
  fullName:    users.fullName,
  email:       users.email,
  phone:       users.phone,
  role:        users.role,
  isActive:    users.isActive,
  notes:       users.notes,
  lastLoginAt: users.lastLoginAt,
  createdAt:   users.createdAt,
  updatedAt:   users.updatedAt,
} as const;

/** List all admin users (passwords excluded). */
router.get("/users", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select(PUBLIC_FIELDS)
    .from(users)
    .orderBy(users.createdAt);
  res.json(rows);
});

/** Create a new admin user. */
router.post("/users", async (req: Request, res: Response): Promise<void> => {
  const { username, password, fullName, email, phone, role, notes } =
    (req.body ?? {}) as {
      username?: string;
      password?: string;
      fullName?: string;
      email?: string;
      phone?: string;
      role?: string;
      notes?: string;
    };

  if (!username || !password) {
    res.status(400).json({ error: "Se requieren usuario y contraseña" });
    return;
  }
  if (username.length < 3 || username.length > 64) {
    res.status(400).json({ error: "El usuario debe tener entre 3 y 64 caracteres" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    return;
  }

    const allowedRoles = ["admin"];
  const resolvedRole = allowedRoles.includes(role ?? "") ? role! : "admin";

  try {
    const passwordHash = hashPassword(password);
    const [created] = await db
      .insert(users)
      .values({
        username,
        passwordHash,
        fullName: fullName || null,
        email: email || null,
        phone: phone || null,
        role: resolvedRole,
        notes: notes || null,
      })
      .returning(PUBLIC_FIELDS);

    // Fire-and-forget welcome email
    if (email) {
      const tpl = welcomeEmail(fullName ?? username, getAppUrl())
      sendEmail({ to: email, ...tpl }).catch((err) =>
        console.warn("[users/create] Failed to send welcome email to", email, "—", err?.message)
      )
    }

    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Ya existe un usuario con ese nombre" });
      return;
    }
    throw err;
  }
});

/** Update user fields (cannot change your own role or active status). */
router.patch("/users/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  const selfUsername = req.session?.user?.username;
  const isSelf = target.username === selfUsername;

  const {
    fullName, email, phone, role, isActive, notes, password,
  } = (req.body ?? {}) as {
    fullName?: string;
    email?: string;
    phone?: string;
    role?: string;
    isActive?: boolean;
    notes?: string;
    password?: string;
  };

  // Prevent self-demotion
  if (isSelf && (role !== undefined || isActive === false)) {
    res.status(400).json({ error: "No puedes cambiar tu propio rol ni desactivarte" });
    return;
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (fullName !== undefined) updates.fullName = fullName || null;
  if (email !== undefined) updates.email = email || null;
  if (phone !== undefined) updates.phone = phone || null;
  if (notes !== undefined) updates.notes = notes || null;
  if (!isSelf && role !== undefined) {
    const allowedRoles = ["admin"];
    updates.role = allowedRoles.includes(role) ? role : "admin";
  }
  if (!isSelf && isActive !== undefined) updates.isActive = Boolean(isActive);
  if (password) {
    if (password.length < 6) {
      res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      return;
    }
    updates.passwordHash = hashPassword(password);
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning(PUBLIC_FIELDS);

  res.json(updated);
});

/** Delete a user. Cannot delete yourself. */
router.delete("/users/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const selfUsername = req.session?.user?.username;
  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  if (target.username === selfUsername) {
    res.status(400).json({ error: "No puedes eliminar tu propio usuario" });
    return;
  }

  await db.delete(users).where(eq(users.id, id));
  res.json({ ok: true });
});

export default router;
