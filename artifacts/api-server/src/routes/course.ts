/**
 * Course / onboarding progress routes
 * GET    /api/course/progress           — list completed lesson IDs for current user
 * POST   /api/course/progress           — mark a lesson complete  { lessonId: string }
 * DELETE /api/course/progress/:lessonId — unmark a lesson
 */
import { Router } from "express"
import type { Request, Response } from "express"
import { db } from "@workspace/db"
import { courseProgress } from "@workspace/db/schema"
import { eq, and, sql } from "drizzle-orm"

const router = Router()

function requireAuth(req: Request, res: Response): number | null {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "No autenticado" })
    return null
  }
  const userId = req.session.user?.userId
  if (!userId) {
    res.status(400).json({ error: "Sesión inválida" })
    return null
  }
  return userId
}

/** GET /api/course/progress */
router.get("/course/progress", async (req: Request, res: Response): Promise<void> => {
  const userId = requireAuth(req, res)
  if (!userId) return

  const rows = await db
    .select({ lessonId: courseProgress.lessonId, completedAt: courseProgress.completedAt })
    .from(courseProgress)
    .where(eq(courseProgress.userId, userId))

  res.json({ completedLessons: rows.map((r) => r.lessonId) })
})

/** POST /api/course/progress — { lessonId } */
router.post("/course/progress", async (req: Request, res: Response): Promise<void> => {
  const userId = requireAuth(req, res)
  if (!userId) return

  const { lessonId } = (req.body ?? {}) as { lessonId?: string }
  if (!lessonId) {
    res.status(400).json({ error: "Se requiere lessonId" })
    return
  }

  await db
    .insert(courseProgress)
    .values({ userId, lessonId })
    .onConflictDoNothing()

  res.json({ ok: true })
})

/** DELETE /api/course/progress/:lessonId */
router.delete("/course/progress/:lessonId", async (req: Request, res: Response): Promise<void> => {
  const userId = requireAuth(req, res)
  if (!userId) return

  const { lessonId } = req.params
  await db
    .delete(courseProgress)
    .where(sql`${courseProgress.userId} = ${userId} AND ${courseProgress.lessonId} = ${lessonId}`)

  res.json({ ok: true })
})

export default router
