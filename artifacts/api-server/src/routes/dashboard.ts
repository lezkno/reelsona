import { Router } from "express";
import { db } from "@workspace/db";
import {
  instagramAccountsTable,
  automationConfigTable,
  videosTable,
  contentPlanItemsTable,
  avatarConfigTable,
} from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";
import { GetDashboardResponse } from "@workspace/api-zod";

const router = Router();

router.get("/dashboard", async (req, res): Promise<void> => {
  const [igAccount] = await db.select().from(instagramAccountsTable).limit(1);
  const [automation] = await db.select().from(automationConfigTable).limit(1);
  const [avatarCfg] = await db.select().from(avatarConfigTable).limit(1);

  const [videosTotal] = await db
    .select({ count: count() })
    .from(videosTable)
    .where(eq(videosTable.status, "published"));

  const [videosGenerated] = await db
    .select({ count: count() })
    .from(videosTable)
    .where(sql`${videosTable.status} != 'pending'`);

  const [generatingNow] = await db
    .select({ count: count() })
    .from(videosTable)
    .where(eq(videosTable.status, "generating"));

  const [readyItems] = await db
    .select({ count: count() })
    .from(contentPlanItemsTable)
    .where(eq(contentPlanItemsTable.status, "ready"));

  const lastPublished = await db
    .select({ publishedAt: videosTable.publishedAt })
    .from(videosTable)
    .where(eq(videosTable.status, "published"))
    .orderBy(sql`${videosTable.publishedAt} DESC`)
    .limit(1);

  const summary = {
    account_connected: !!igAccount,
    instagram_username: igAccount?.username ?? null,
    instagram_followers: igAccount?.followersCount ?? null,
    automation_enabled: automation?.enabled ?? false,
    next_scheduled_at: automation?.nextRunAt?.toISOString() ?? null,
    videos_generated_total: videosGenerated?.count ?? 0,
    videos_published_total: videosTotal?.count ?? 0,
    videos_generating_now: generatingNow?.count ?? 0,
    content_items_ready: readyItems?.count ?? 0,
    avatar_count: avatarCfg?.selectedAvatarIds?.length ?? 0,
    last_published_at: lastPublished[0]?.publishedAt?.toISOString() ?? null,
  };

  res.json(GetDashboardResponse.parse(summary));
});

export default router;
