import { Router } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import instagramRouter from "./instagram";
import heygenRouter from "./heygen";
import contentRouter from "./content";
import videosRouter from "./videos";
import automationRouter from "./automation";
import settingsRouter from "./settings";
import captionsRouter from "./captions";
import captionedRouter from "./captioned";

const router = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(instagramRouter);
router.use(heygenRouter);
router.use(contentRouter);
router.use(videosRouter);
router.use(automationRouter);
router.use(settingsRouter);
router.use(captionsRouter);
router.use(captionedRouter);

export default router;
