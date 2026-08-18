import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import { logger } from "./lib/logger";
import { requireAuth } from "./middleware/auth";
import { requireToolAccess } from "./middleware/requireToolAccess";
import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";
import captionedRouter from "./routes/captioned";
import usersRouter from "./routes/users";
import checkoutRouter from "./routes/checkout";
import configRouter from "./routes/config";
import webhookRouter from "./routes/webhook";
import creditsRouter from "./routes/credits";
import billingRouter from "./routes/billing";
import router from "./routes";

const PgSession = connectPgSimple(session);

// ── Startup security assertions ─────────────────────────────────────────────
// Fail fast in production rather than silently running with insecure defaults.
const _rawSessionSecret = process.env.SESSION_SECRET;
const _insecureDefault  = "dev-secret-please-set-SESSION_SECRET";
if (!_rawSessionSecret || _rawSessionSecret === _insecureDefault) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL: SESSION_SECRET is not set or uses the insecure dev default. " +
      "Set a strong random secret in your Replit Secrets before deploying."
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "⚠️  SESSION_SECRET is not set — using insecure dev default. " +
    "Never deploy to production without setting SESSION_SECRET."
  );
}
if (!process.env.NODE_ENV) {
  // eslint-disable-next-line no-console
  console.warn(
    "⚠️  NODE_ENV is not set. Session cookies will NOT have the Secure flag. " +
    "Set NODE_ENV=production in your deployment environment."
  );
}
// ────────────────────────────────────────────────────────────────────────────

const app = express();

// Replit (and most cloud providers) terminate TLS at the reverse proxy.
// Without trust proxy, req.secure is always false and express-session will
// refuse to set the Secure cookie flag in production, blocking login.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

// CORS — never fall back to an unrestricted credentialed policy in production.
// Requests without an Origin header (same-origin navigation, server-to-server,
// Stripe webhooks, health checks) are allowed; browser cross-origin requests
// must match the explicit allowlist.
const devDomain = process.env.REPLIT_DEV_DOMAIN;
const appUrl = process.env.APP_URL ?? "https://reelsona.com";
const allowedOrigins = new Set<string>([
  "https://reelsona.com",
  "https://www.reelsona.com",
]);
try {
  allowedOrigins.add(new URL(appUrl).origin);
} catch {
  if (process.env.NODE_ENV === "production") {
    throw new Error("FATAL: APP_URL is not a valid absolute URL");
  }
}
if (devDomain) allowedOrigins.add(`https://${devDomain}`);
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.add("http://localhost:3000");
  allowedOrigins.add("http://localhost:5173");
  allowedOrigins.add("http://127.0.0.1:3000");
  allowedOrigins.add("http://127.0.0.1:5173");
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      logger.warn({ origin }, "[CORS] Rejected origin");
      callback(null, false);
    },
    credentials: true,
  })
);

// Health check — registered BEFORE session middleware so it always returns 200
// even during cold start when the PostgreSQL session store isn't ready yet.
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Stripe webhook — MUST be mounted before express.json() to receive raw body.
// The route applies express.raw() itself; all other routes remain unaffected.
app.use("/api", webhookRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session middleware — persistent PostgreSQL store so sessions survive restarts
app.use(
  session({
    name: "contentpilot.sid",
    store: new PgSession({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
      // Clean up expired sessions every hour
      pruneSessionInterval: 60 * 60,
    }),
    secret: process.env.SESSION_SECRET ?? "dev-secret-please-set-SESSION_SECRET",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Only set secure=true in production (HTTPS); in dev allow HTTP
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

// Auth routes bypass the requireAuth guard (handled inside requireAuth itself,
// but mounting here first makes the intent explicit)
app.use("/api", authRouter);

// Admin routes — mounted before requireAuth so Bearer-token calls work
// (each handler performs its own admin check: session role=admin OR Bearer ADMIN_PASSWORD)
app.use("/api", adminRouter);

// Captioned video streaming — public, no auth required (files are ephemeral /tmp)
app.use("/api", captionedRouter);

// Checkout — public, no auth required (session created by Stripe webhook)
app.use("/api", checkoutRouter);

// Public config (Stripe publishable key, etc.) — no auth required
app.use("/api", configRouter);

// Require a valid session for all other /api routes
app.use("/api", requireAuth);

// Instagram OAuth callback must always have a server-stored state nonce.
// This closes the legacy bypass in routes/instagram.ts where a missing session
// nonce was previously allowed to proceed. The downstream handler still does
// the equality check and clears the nonce after successful validation.
app.post("/api/instagram/callback", (req, res, next) => {
  const expectedState = req.session.igOauthState;
  const returnedState = typeof req.body?.state === "string" ? req.body.state : undefined;
  if (!expectedState || !returnedState || returnedState !== expectedState) {
    logger.warn(
      {
        userId: req.session.user?.userId,
        hasExpectedState: !!expectedState,
        hasReturnedState: !!returnedState,
      },
      "[IG/Callback] Missing or mismatched server-side OAuth state — rejecting"
    );
    res.status(400).json({
      error: "El estado de conexión de Instagram no es válido o expiró. Intenta conectar de nuevo.",
    });
    return;
  }
  next();
});

// Admin user management (requires auth, handled by requireAuth above)
app.use("/api", usersRouter);

// Credit balance and billing info — requires auth but NOT tool access
app.use("/api", creditsRouter);
app.use("/api", billingRouter);

// Tool-access guard — blocks expired/unlicensed users from tool routes.
// Admins always pass. Course, auth, admin, dashboard paths are exempt.
app.use("/api", requireToolAccess);

// Main API router (all other routes)
app.use("/api", router);

export default app;
