import type { RequestHandler } from "express";

// Augment express-session to include our authenticated flag and user identity
declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    user?: { username: string; role: string; userId: number };
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

  // Suspension check — cache-first, 30 s TTL. This check fails closed: if DB
  // state cannot be verified we return 503 rather than accidentally allowing a
  // suspended/deleted account through protected routes.
  try {
    if (await isSuspended(sessionUser.userId)) {
      req.session.destroy(() => {});
      res.status(403).json({
        error: "Tu cuenta ha sido suspendida. Contacta al administrador.",
        code:  "ACCOUNT_SUSPENDED",
      });
      return;
    }
  } catch (err) {
    console.error("[requireAuth] suspension/user-state DB error:", err);
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
export const requireAdmin: RequestHandler = (req, res, next): void => {
  if (req.session?.user?.role !== "admin") {
    res.status(403).json({ error: "Se requiere rol de administrador" });
    return;
  }
  next();
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
