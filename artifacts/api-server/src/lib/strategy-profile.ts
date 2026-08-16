/**
 * Helpers for reading and writing the persistent strategic profile.
 * Each user has their own profile row, scoped by userId.
 */
import { db } from "@workspace/db";
import { auditProfilesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import type { AccountData, MarketInsights, ContentStrategy, StrategyContext } from "./ai-strategy";

export type { AccountData, MarketInsights, ContentStrategy, StrategyContext };

export interface StrategyProfileData {
  id: number;
  account_data:     AccountData     | null;
  market_insights:  MarketInsights  | null;
  content_strategy: ContentStrategy | null;
  steps_completed:  string[];
  created_at: string;
  updated_at: string;
}

function mapRow(row: typeof auditProfilesTable.$inferSelect): StrategyProfileData {
  return {
    id:               row.id,
    account_data:     (row.accountData     as AccountData     | null) ?? null,
    market_insights:  (row.marketInsights  as MarketInsights  | null) ?? null,
    content_strategy: (row.contentStrategy as ContentStrategy | null) ?? null,
    steps_completed:  row.stepsCompleted ?? [],
    created_at:       row.createdAt.toISOString(),
    updated_at:       row.updatedAt.toISOString(),
  };
}

export async function getStrategyProfile(userId: number): Promise<StrategyProfileData | null> {
  const [row] = await db
    .select()
    .from(auditProfilesTable)
    .where(eq(auditProfilesTable.userId, userId))
    .orderBy(desc(auditProfilesTable.updatedAt))
    .limit(1);
  return row ? mapRow(row) : null;
}

export async function upsertStrategyProfile(
  userId: number,
  updates: {
    account_data?:     AccountData;
    market_insights?:  MarketInsights;
    content_strategy?: ContentStrategy;
    step?: string;
  }
): Promise<StrategyProfileData> {
  const [existingRow] = await db
    .select()
    .from(auditProfilesTable)
    .where(eq(auditProfilesTable.userId, userId))
    .limit(1);

  const currentSteps: string[] = existingRow?.stepsCompleted ?? [];
  const newSteps = updates.step && !currentSteps.includes(updates.step)
    ? [...currentSteps, updates.step]
    : currentSteps;

  const patch: Partial<typeof auditProfilesTable.$inferInsert> = {
    stepsCompleted: newSteps,
    updatedAt: new Date(),
    ...(updates.account_data     ? { accountData:     updates.account_data     } : {}),
    ...(updates.market_insights  ? { marketInsights:  updates.market_insights  } : {}),
    ...(updates.content_strategy ? { contentStrategy: updates.content_strategy } : {}),
  };

  if (existingRow) {
    const [updated] = await db
      .update(auditProfilesTable)
      .set(patch)
      .where(eq(auditProfilesTable.id, existingRow.id))
      .returning();
    return mapRow(updated);
  } else {
    const [inserted] = await db
      .insert(auditProfilesTable)
      .values({
        userId,
        accountData:     updates.account_data     ?? null,
        marketInsights:  updates.market_insights  ?? null,
        contentStrategy: updates.content_strategy ?? null,
        stepsCompleted:  newSteps,
      })
      .returning();
    return mapRow(inserted);
  }
}

/** Build a StrategyContext for use in AI topic/script generation. */
export function toStrategyContext(profile: StrategyProfileData): StrategyContext | null {
  if (!profile.content_strategy || !profile.market_insights) return null;
  return {
    content_strategy: profile.content_strategy,
    market_insights:  profile.market_insights,
  };
}
