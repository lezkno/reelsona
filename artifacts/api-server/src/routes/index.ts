import { Router } from "express";
import { requireToolAccess, requireCourseAccess } from "../middleware/auth";
import healthRouter from "./health";
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
import wavespeedVoiceDirectorRouter from "./wavespeed-voice-director";


const router = Router();

// General routes — accessible to any authenticated user
router.use(healthRouter);
router.use(dashboardRouter);
router.use(settingsRouter);

// WaveSpeed internal routes — accessible to any authenticated user (key check is internal)
router.use(wavespeedRouter);

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
