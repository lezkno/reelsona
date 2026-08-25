import type { Request, RequestHandler } from "express";

// Augment express-session to include our authenticated flag and user identity
declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    user?: { username: string; role: string; userId: number; sessionVersion: number };
    /** CSRF token stored server-side during Instagram OAuth initiation */
    igOauthState?: string;
  }
}

// ── Suspension cache ──────────────────────────────────────────────────────────
// Per-user in-memory TTL cache (30 s) so requireAuth avoids a DB hit on every
// request while still kicking out suspended users within half a minute.

const suspensionCache = new Map<number, { suspended: boolean; expires: number }>();

/** Clears the suspension cache for a user — call after toggling suspension. */
export function invalidateSuspensionCache(userId: number): void {
  suspensionCache.delete(userId);
}

export type CurrentSessionUser = {
  id: number;
  username: string;
  role: string;
  isActive: boolean;
  isSuspended: boolean;
  sessionVersion: number;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
};

/** Load the authoritative account state for a session. Never trust session role/status. */
export async function getCurrentSessionUser(req: Request): Promise<CurrentSessionUser | null> {
  const userId = req.session?.user?.userId;
  if (!userId) return null;

  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      isActive: users.isActive,
      isSuspended: users.isSuspended,
      sessionVersion: users.sessionVersion,
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export function destroySession(req: Request): void {
  req.session?.destroy((err) => {
    if (err) console.error("[auth] failed to destroy revoked session:", err);
  });
}

async function isSuspended(userId: number): Promise<boolean> {
  const cached = suspensionCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.suspended;

  const { db }    = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");
  const { eq }    = await import("drizzle-orm");
  const [row] = await db
    .select({ isSuspended: users.isSuspended })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // A session that points at a user row that no longer exists is not valid.
  if (!row) {
    throw new Error(`Authenticated session references missing user ${userId}`);
  }

  const suspended = row.isSuspended ?? false;
  suspensionCache.set(userId, { suspended, expires: Date.now() + 30_000 });
  return suspended;
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Protect all /api routes.
 * Skipped paths (no auth required):
 *   - /healthz
 *   - /auth/*  (login, logout, me)
 */
export const requireAuth: RequestHandler = async (req, res, next): Promise<void> => {
  // /captioned-objects/* must be public: Instagram fetches captioned video
  // files directly when creating media containers and cannot supply a browser
  // session cookie. The videos router mounts this handler under /captioned-objects
  // (no /videos prefix) so the effective path under /api is /captioned-objects/*.
  if (
    req.path === "/healthz" ||
    req.path.startsWith("/auth/") ||
    req.path.startsWith("/captioned-objects/")
  ) {
    next();
    return;
  }

  if (!req.session?.authenticated) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Never map an incomplete legacy session to a real account. Older sessions
  // created before multi-user support must authenticate again so identity is
  // established explicitly instead of defaulting to userId=1.
  const sessionUser = req.session.user;
  if (!sessionUser?.userId) {
    req.session.destroy(() => {});
    res.status(401).json({
      error: "Tu sesión necesita renovarse. Inicia sesión nuevamente.",
      code: "SESSION_REAUTH_REQUIRED",
    });
    return;
  }

  // Authoritative account check. This intentionally reads the account on every
  // protected request so role/status/session revocations take effect immediately.
  try {
    const currentUser = await getCurrentSessionUser(req);
    if (!currentUser) {
      destroySession(req);
      res.status(401).json({ error: "La cuenta ya no existe", code: "ACCOUNT_NOT_FOUND" });
      return;
    }
    if (
      !currentUser.isActive ||
      currentUser.isSuspended ||
      currentUser.sessionVersion !== (sessionUser.sessionVersion ?? 0)
    ) {
      destroySession(req);
      res.status(403).json({
        error: currentUser.isSuspended
          ? "Tu cuenta ha sido suspendida. Contacta al administrador."
          : "Tu sesión ya no es válida. Inicia sesión nuevamente.",
        code: currentUser.isSuspended ? "ACCOUNT_SUSPENDED" : "SESSION_REVOKED",
      });
      return;
    }
    // Keep non-security profile data in sync, while preserving the validated
    // security version used for the revocation check.
    req.session.user = {
      username: currentUser.username,
      role: currentUser.role,
      userId: currentUser.id,
      sessionVersion: currentUser.sessionVersion,
    };
  } catch (err) {
    console.error("[requireAuth] user-state DB error:", err);
    res.setHeader("Retry-After", "5");
    res.status(503).json({
      error: "auth_state_unavailable",
      message: "No se pudo verificar temporalmente el estado de tu cuenta. Intenta de nuevo en unos segundos.",
    });
    return;
  }

  next();
};

/**
 * Require admin role. Must be used after requireAuth.
 * Returns 403 for authenticated non-admin users.
 */
export const requireAdmin: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const user = await getCurrentSessionUser(req);
    if (!user || !user.isActive || user.isSuspended || user.role !== "admin") {
      res.status(403).json({ error: "Se requiere rol de administrador" });
      return;
    }
    if (user.sessionVersion !== (req.session.user?.sessionVersion ?? 0)) {
      destroySession(req);
      res.status(401).json({ error: "La sesión ya no es válida. Inicia sesión nuevamente.", code: "SESSION_REVOKED" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Require active tool-access entitlement. Must be used after requireAuth.
 * Admins always pass through. Non-admin users with expired/disabled entitlements get 403.
 */
export const requireToolAccess: RequestHandler = async (req, res, next): Promise<void> => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (user.role === "admin") { next(); return; }

  try {
    const { getUserAccess } = await import("../lib/access");
    const access = await getUserAccess(user.userId, user.role);
    if (!access.toolAccessActive) {
      res.status(403).json({
        error: "Tu acceso a la herramienta ha vencido o no está activo",
        code: "TOOL_ACCESS_EXPIRED",
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Require course-access entitlement. Must be used after requireAuth.
 * Admins always pass through. Non-admin users without courseAccess get 403.
 */
export const requireCourseAccess: RequestHandler = async (req, res, next): Promise<void> => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (user.role === "admin") { next(); return; }

  try {
    const { getUserAccess } = await import("../lib/access");
    const access = await getUserAccess(user.userId, user.role);
    if (!access.courseAccess) {
      res.status(403).json({
        error: "No tienes acceso al curso",
        code: "COURSE_ACCESS_DENIED",
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};
