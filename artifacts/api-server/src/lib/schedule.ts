/**
 * Helpers to compute publishing slots from the automation config
 * (days of week + posting times, in the configured timezone).
 */

/** Convert a wall-clock time in a timezone to a UTC Date. */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  let ts = utcGuess;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(ts)).map((p) => [p.type, p.value])
    ) as Record<string, string>;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      parts.hour === "24" ? 0 : Number(parts.hour),
      Number(parts.minute)
    );
    ts += utcGuess - asUtc;
  }
  return new Date(ts);
}

/** Get { year, month, day, dayOfWeek } for "now" in a timezone. */
export function getZonedDateParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number; // 0 = Sunday
} {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dayOfWeek: weekdayMap[parts.weekday] ?? 0,
  };
}

/** Build the list of times (HH:mm) to use per day given the desired count. */
export function timesForDay(postingTimes: string[], postsPerDay: number): string[] {
  const sorted = [...postingTimes].filter((t) => /^\d{2}:\d{2}$/.test(t)).sort();
  if (sorted.length === 0) sorted.push("09:00");
  if (postsPerDay <= sorted.length) return sorted.slice(0, postsPerDay);
  // Need more times than configured: pad after the last one, +2h each, capped at 23:00
  const result = [...sorted];
  let [h] = result[result.length - 1].split(":").map(Number);
  while (result.length < postsPerDay) {
    h = Math.min(h + 2, 23);
    const candidate = `${String(h).padStart(2, "0")}:00`;
    if (result.includes(candidate)) {
      if (h >= 23) break;
      continue;
    }
    result.push(candidate);
  }
  return result.sort();
}

/**
 * Compute the next publishing slots (UTC Dates).
 * Walks forward day by day (in the configured timezone), keeping only
 * enabled days of week, and fills `postsPerDay` times per scheduled day.
 * Skips slots in the past and slots already occupied.
 */
export function computeUpcomingSlots(opts: {
  daysOfWeek: number[];
  postingTimes: string[];
  timezone: string;
  scheduledDays: number; // how many publishing days to fill
  postsPerDay: number;
  occupied: Date[];
  from?: Date;
}): Date[] {
  const from = opts.from ?? new Date();
  const daysOfWeek = opts.daysOfWeek.length > 0 ? opts.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const times = timesForDay(opts.postingTimes, Math.max(1, opts.postsPerDay));
  const occupiedKeys = new Set(opts.occupied.map((d) => Math.floor(d.getTime() / 60000)));

  const slots: Date[] = [];
  let cursor = new Date(from);
  let daysFilled = 0;
  let safety = 0;

  while (daysFilled < opts.scheduledDays && safety < 90) {
    safety++;
    const parts = getZonedDateParts(cursor, opts.timezone);
    if (daysOfWeek.includes(parts.dayOfWeek)) {
      let addedAny = false;
      for (const t of times) {
        const [hh, mm] = t.split(":").map(Number);
        const slot = zonedTimeToUtc(parts.year, parts.month, parts.day, hh, mm, opts.timezone);
        if (slot.getTime() <= from.getTime()) continue; // past
        if (occupiedKeys.has(Math.floor(slot.getTime() / 60000))) continue; // taken
        slots.push(slot);
        occupiedKeys.add(Math.floor(slot.getTime() / 60000));
        addedAny = true;
      }
      if (addedAny) daysFilled++;
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return slots;
}
