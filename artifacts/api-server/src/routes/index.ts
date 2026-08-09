import { Router } from "express";
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


const router = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(dashboardRouter);
router.use(instagramRouter);
router.use(heygenRouter);
router.use(contentRouter);
router.use(videosRouter);
router.use(automationRouter);
router.use(settingsRouter);
router.use(captionsRouter);
router.use(strategyRouter);
router.use(courseRouter);

export default router;
