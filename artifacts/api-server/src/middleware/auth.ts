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
