import { Router } from "express";
// Use the NEW requireToolAccess (middleware/requireToolAccess.ts) which has
// bypass logic for /billing and /credits.  The old one (middleware/auth.ts)
// had zero bypass logic and was silently 403-ing billing/credits requests that
// reached this router.
import { requireToolAccess } from "../middleware/requireToolAccess";
import { requireCourseAccess } from "../middleware/auth";
import healthRouter from "./health";
import billingRouter from "./billing";
import creditsRouter from "./credits";
import storageRouter from "./storage";
import dashboardRouter from "./dashboard";
import instagramRouter from "./instagram";
import heygenRouter from "./heygen";
import contentRouter from "./content";
import videosRouter from "./videos";
import automationRouter from "./automation";
import settingsRouter from "./settings";
import captionsRouter from "./captions";
import strategyRouter from "./strategy";
import courseRouter from "./course";
import wavespeedRouter from "./wavespeed";
import wavespeedFinalizeRouter from "./wavespeed-finalize";
import wavespeedVoiceDirectorRouter from "./wavespeed-voice-director";


const router = Router();

// ── No-plan-required routes (guaranteed fallback) ─────────────────────────────
// billingRouter and creditsRouter are ALSO mounted directly in app.ts (before
// requireToolAccess), so they are normally handled there.  This second
// registration acts as a belt-and-suspenders fallback: if a request somehow
// falls through the app.ts mount (e.g. due to an async middleware quirk), it
// lands here and is still served correctly before requireToolAccess can block it.
router.use(billingRouter);
router.use(creditsRouter);

// General routes — accessible to any authenticated user
router.use(healthRouter);
router.use(dashboardRouter);
router.use(settingsRouter);

// WaveSpeed internal routes — accessible to any authenticated user (key check is internal)
router.use(wavespeedRouter);
router.use(wavespeedFinalizeRouter);

// WaveSpeed Voice Director — preview/debug route (tool access required)
// Exclusively for WaveSpeed/MiniMax — zero connection to HeyGen pipeline.
router.use(requireToolAccess, wavespeedVoiceDirectorRouter);

// Tool routes — require active tool-access entitlement (admin always passes).
// Note: videosRouter and instagramRouter use GET-only bypasses in the global
// requireToolAccess middleware (app.ts line 117), so no-plan users can list
// videos and check Instagram connection status. The global middleware protects
// all mutating operations; the per-router wrapper is intentionally omitted here.
router.use(requireToolAccess, storageRouter);
router.use(instagramRouter);
router.use(requireToolAccess, heygenRouter);
router.use(requireToolAccess, contentRouter);
router.use(videosRouter);
router.use(requireToolAccess, automationRouter);
router.use(requireToolAccess, captionsRouter);
router.use(requireToolAccess, strategyRouter);

// Course routes — require course-access entitlement (admin always passes)
router.use(requireCourseAccess, courseRouter);

export default router;
