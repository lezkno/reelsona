import type { RequestHandler } from "express";

// Augment express-session to include our authenticated flag and user identity
declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    user?: { username: string; role: string; userId: number };
  }
}

/**
 * Protect all /api routes.
 * Skipped paths (no auth required):
 *   - /healthz
 *   - /auth/*  (login, logout, me)
 */
export const requireAuth: RequestHandler = (req, res, next): void => {
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
  if (req.session?.authenticated) {
    // Back-fill userId = 1 for sessions created before multi-user was added.
    // Forces a fresh login on next request after the current session expires.
    if (req.session.user && !req.session.user.userId) {
      req.session.user.userId = 1;
    }
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
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
