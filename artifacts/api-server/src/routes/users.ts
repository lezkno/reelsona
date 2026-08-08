/**
 * Admin user management routes — all require admin session.
 * GET    /api/users         — list all users
 * POST   /api/users         — create a new user
 * DELETE /api/users/:id     — delete a user (cannot delete yourself)
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/password";

const router = Router();

/** List all admin users (passwords excluded). */
router.get("/users", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt);
  res.json(rows);
});

/** Create a new admin user. */
router.post("/users", async (req: Request, res: Response): Promise<void> => {
  const { username, password, role } = (req.body ?? {}) as {
    username?: string;
    password?: string;
    role?: string;
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
      .values({ username, passwordHash, role: resolvedRole })
      .returning({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Ya existe un usuario con ese nombre" });
      return;
    }
    throw err;
  }
});

/** Delete a user. Cannot delete yourself. */
router.delete("/users/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  // Prevent self-deletion
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
