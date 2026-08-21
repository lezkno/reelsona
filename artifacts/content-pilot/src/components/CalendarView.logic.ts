import { isSameDay } from "date-fns"

export interface CalendarScheduledItem {
  scheduled_at?: string | null
}

/**
 * Calendar placement is always based on the item's current scheduled timestamp.
 * Status deliberately does not participate: a generating item belongs to the
 * day of its actual start once the server updates scheduled_at.
 */
export function getItemsScheduledOnDay<T extends CalendarScheduledItem>(
  items: T[],
  day: Date,
): T[] {
  return items.filter((item) =>
    item.scheduled_at != null && isSameDay(new Date(item.scheduled_at), day),
  )
}