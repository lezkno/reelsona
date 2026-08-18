import type { Request, RequestHandler } from "express";
import { logger } from "../lib/logger";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastCleanup = 0;

function clientKey(req: Request): string {
  // app.ts sets trust proxy=1, so req.ip reflects the client behind Replit's proxy.
  return req.ip || req.socket.remoteAddress || "unknown";
}

function cleanup(now: number): void {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function limiter(name: string, windowMs: number, max: number): RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    cleanup(now);

    const key = `${name}:${clientKey(req)}`;
    const existing = buckets.get(key);
    const bucket = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existing;

    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      logger.warn(
        { ip: clientKey(req), path: req.path, limiter: name },
        "API rate limit exceeded",
      );
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }

    next();
  };
}

const generalLimiter = limiter("api", 60_000, 600);
const sensitiveLimiter = limiter("sensitive", 15 * 60_000, 40);

/**
 * Lightweight per-instance protection. It is intentionally conservative so
 * normal product traffic is unaffected. Replit Autoscale may run more than one
 * instance, so this is a first line of defense rather than a global quota.
 */
export const apiRateLimit: RequestHandler = (req, res, next) => {
  const path = req.path;

  // Never throttle liveness/readiness or Stripe webhook delivery.
  if (path === "/healthz" || path === "/webhooks/stripe") {
    next();
    return;
  }

  const isSensitive =
    path.startsWith("/auth/") ||
    path.startsWith("/checkout/") ||
    path === "/instagram/callback" ||
    path === "/instagram/auth-url";

  if (isSensitive) {
    sensitiveLimiter(req, res, () => generalLimiter(req, res, next));
    return;
  }

  generalLimiter(req, res, next);
};
