import { redis } from './redis'
import { DECAY_THRESHOLD_DAYS } from './spark-utils'

/**
 * Per-token preferences.
 *
 * Deliberately keyed off the token exactly like sparks are, so when accounts
 * land these migrate with everything else rather than needing their own
 * story. Small enough to fetch on every load.
 */
export interface Prefs {
  /**
   * Days of no interaction before a spark goes cold. Feeds runDecay's
   * threshold AND scoreSpark's neglect denominator — keeping them coupled is
   * what makes a spark hit full neglect score exactly as it goes cold.
   */
  decayThresholdDays: number
}

export const DEFAULT_PREFS: Prefs = {
  decayThresholdDays: DECAY_THRESHOLD_DAYS,
}

const MIN_DECAY_DAYS = 7
const MAX_DECAY_DAYS = 1095

const prefsKey = (token: string) => `k:${token}:prefs`

/** Clamped on read as well as write, so a bad stored value can't break scoring. */
const clampDecay = (days: unknown): number => {
  const n = typeof days === 'number' && Number.isFinite(days) ? Math.round(days) : NaN
  if (Number.isNaN(n)) return DEFAULT_PREFS.decayThresholdDays
  return Math.min(Math.max(n, MIN_DECAY_DAYS), MAX_DECAY_DAYS)
}

export const getPrefs = async (token: string): Promise<Prefs> => {
  const stored = await redis.get<Partial<Prefs>>(prefsKey(token))
  if (!stored) return DEFAULT_PREFS
  return { decayThresholdDays: clampDecay(stored.decayThresholdDays) }
}

export const setPrefs = async (token: string, patch: Partial<Prefs>): Promise<Prefs> => {
  const current = await getPrefs(token)
  const next: Prefs = {
    decayThresholdDays:
      patch.decayThresholdDays === undefined
        ? current.decayThresholdDays
        : clampDecay(patch.decayThresholdDays),
  }
  await redis.set(prefsKey(token), next)
  return next
}

export const DECAY_BOUNDS = { min: MIN_DECAY_DAYS, max: MAX_DECAY_DAYS }
