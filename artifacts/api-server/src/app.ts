import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import { logger } from "./lib/logger";
import { requireAuth } from "./middleware/auth";
import authRouter from "./routes/auth";
import router from "./routes";

const PgSession = connectPgSimple(session);

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

// CORS — restrict to the Replit dev domain when available; open in local dev
const devDomain = process.env.REPLIT_DEV_DOMAIN;
app.use(
  cors({
    origin: devDomain ? [`https://${devDomain}`] : true,
    credentials: true,
  })
);

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

// Require a valid session for all other /api routes
app.use("/api", requireAuth);

// Main API router (all other routes)
app.use("/api", router);

export default app;
