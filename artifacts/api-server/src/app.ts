import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import { logger } from "./lib/logger";
import { getSchedulerLeadershipState } from "./lib/scheduler-leader";
import { requireAuth } from "./middleware/auth";
import { requireToolAccess } from "./middleware/requireToolAccess";
import { apiRateLimit } from "./middleware/rateLimit";
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

const _rawSessionSecret = process.env.SESSION_SECRET;
const _insecureDefault  = "dev-secret-please-set-SESSION_SECRET";
if (!_rawSessionSecret || _rawSessionSecret === _insecureDefault) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL: SESSION_SECRET is not set or uses the insecure dev default. " +
      "Set a strong random secret in your Replit Secrets before deploying."
    );
  }
  console.warn(
    "⚠️  SESSION_SECRET is not set — using insecure dev default. " +
    "Never deploy to production without setting SESSION_SECRET."
  );
}
if (!process.env.NODE_ENV) {
  console.warn(
    "⚠️  NODE_ENV is not set. Session cookies will NOT have the Secure flag. " +
    "Set NODE_ENV=production in your deployment environment."
  );
}

const app = express();
let applicationReady = false;

export function markApplicationReady(): void {
  applicationReady = true;
}

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

app.get("/api/healthz", (_req, res) => {
  const scheduler = getSchedulerLeadershipState();
  const buildSha =
    process.env.REPLIT_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    process.env.COMMIT_SHA ??
    null;

  res.json({
    status: applicationReady ? "ok" : "starting",
    scheduler: scheduler.status,
    schedulerStarted: scheduler.started,
    build: buildSha ? buildSha.slice(0, 12) : null,
  });
});

app.use("/api", (_req, res, next) => {
  if (applicationReady) {
    next();
    return;
  }
  res.setHeader("Retry-After", "5");
  res.status(503).json({ error: "Reelsona is starting. Please retry shortly." });
});

// First-line abuse protection. Health and Stripe webhooks are explicitly exempt
// inside the middleware so external delivery and liveness cannot be throttled.
app.use("/api", apiRateLimit);

// Stripe webhook — MUST be mounted before express.json() to receive raw body.
app.use("/api", webhookRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  session({
    name: "contentpilot.sid",
    store: new PgSession({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 60,
    }),
    secret: process.env.SESSION_SECRET ?? "dev-secret-please-set-SESSION_SECRET",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use("/api", authRouter);
app.use("/api", adminRouter);
app.use("/api", captionedRouter);
app.use("/api", checkoutRouter);
app.use("/api", configRouter);

app.use("/api", requireAuth);

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

app.use("/api", usersRouter);
app.use("/api", creditsRouter);
app.use("/api", billingRouter);

app.use("/api", requireToolAccess);
app.use("/api", router);

export default app;
