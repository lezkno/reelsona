import assert from "node:assert/strict"
import test from "node:test"
import { getItemsScheduledOnDay } from "../CalendarView.logic"

test("a generating item is placed on its updated actual-start date", () => {
  const actualStart = new Date("2030-06-01T10:30:00.000Z")
  const originallyPlannedFor = new Date("2030-06-15T15:00:00.000Z")
  const generatingItem = {
    id: 42,
    status: "generating",
    scheduled_at: actualStart.toISOString(),
  }

  assert.deepEqual(getItemsScheduledOnDay([generatingItem], actualStart), [generatingItem])
  assert.deepEqual(getItemsScheduledOnDay([generatingItem], originallyPlannedFor), [])
})