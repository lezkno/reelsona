/**
 * The effect switches stored in Postgres are user input and may include rows
 * written before all switches existed. Keep their interpretation in one place:
 * an effect only runs when it is explicitly `true`.
 */
export interface VideoEffects {
  zoom: boolean;
  ai_broll: boolean;
  text_cards: boolean;
}

export const DEFAULT_VIDEO_EFFECTS: Readonly<VideoEffects> = Object.freeze({
  zoom: false,
  ai_broll: false,
  text_cards: false,
});

export type VideoEffectsOverride = Partial<VideoEffects>;

const EFFECT_KEYS = ["zoom", "ai_broll"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize persisted or request-supplied values. Missing, malformed, and
 * truthy non-boolean values are disabled rather than accidentally starting a
 * costly rendering stage.
 */
export function normalizeVideoEffects(value: unknown): VideoEffects {
  const source = isRecord(value) ? value : {};
  return {
    zoom: source.zoom === true,
    ai_broll: source.ai_broll === true,
    // Text cards are not currently offered, so historical settings cannot
    // activate that rendering stage for a new or reprocessed video.
    text_cards: false,
  };
}

/**
 * Resolve the immutable effect snapshot stored when a video is created.
 * Account defaults are complete first; an item override can then change only
 * the switches it explicitly supplies.
 */
export function resolveVideoEffectsForCreation(
  accountEffects: unknown,
  itemOverride: unknown,
): VideoEffects {
  const resolved = { ...normalizeVideoEffects(accountEffects) };
  if (!isRecord(itemOverride)) return resolved;

  for (const key of EFFECT_KEYS) {
    if (typeof itemOverride[key] === "boolean") {
      resolved[key] = itemOverride[key] === true;
    }
  }
  return resolved;
}

/**
 * Resolve effects immediately before rendering. A present account settings row
 * is authoritative for every switch, including omitted or null values, so an
 * old video snapshot cannot resurrect a stage the user has switched off. A
 * snapshot is only used for legacy videos whose settings row no longer exists.
 */
export function resolveVideoEffectsForProcessing(
  snapshotEffects: unknown,
  currentAccountEffects: unknown,
  hasCurrentSettings: boolean,
): VideoEffects {
  return hasCurrentSettings
    ? normalizeVideoEffects(currentAccountEffects)
    : normalizeVideoEffects(snapshotEffects);
}

/** Captions are enabled only by the explicit global automation switch. */
export function captionsAreEnabled(value: unknown): boolean {
  return value === true;
}