import type { Spark } from './types'

/**
 * Pure helpers over a Spark. Deliberately free of any Redis import so both the
 * server (lib/sparks.ts, the MCP route) and the client (app/page.tsx) can use
 * them — the scoring the dashboard sorts by has to be the same scoring recall
 * uses, and the only way to guarantee that is one implementation.
 */

export const DAY_MS = 1000 * 60 * 60 * 24
export const DECAY_THRESHOLD_DAYS = 180

// ─── Recall scoring ──────────────────────────────────────────────────────────

export const scoreSpark = (spark: Spark, now: number = Date.now()): number => {
  const daysSinceCreated = (now - spark.created_at) / DAY_MS
  const ageScore = Math.min(daysSinceCreated / 365, 1) * 40

  const lastInteraction = spark.last_surfaced_at ?? spark.created_at
  const daysSinceInteraction = (now - lastInteraction) / DAY_MS
  const neglectScore = Math.min(daysSinceInteraction / DECAY_THRESHOLD_DAYS, 1) * 40

  // approaches 20 when surface_count=0, halves with each surface
  const unusedScore = (1 / (spark.surface_count + 1)) * 20

  return ageScore + neglectScore + unusedScore
}

// ─── Title derivation ────────────────────────────────────────────────────────

const TITLE_MAX = 80

/**
 * Best-effort handle for a spark that was captured without an explicit title.
 * Sparks predating the title field fall through here too, so this has to cope
 * with a whole structured document arriving as one string.
 */
export const deriveTitle = (content: string): string => {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0)?.trim() ?? ''

  const cleaned = firstLine
    .replace(/^#{1,6}\s+/, '') // markdown heading
    .replace(/^[-*+]\s+/, '') // bullet
    .replace(/^\d+[.)]\s+/, '') // ordered item
    .replace(/^>\s+/, '') // blockquote
    .trim()

  if (cleaned.length <= TITLE_MAX) return cleaned

  // Prefer a sentence boundary if one lands inside the budget.
  const sentenceEnd = cleaned.search(/[.!?](\s|$)/)
  if (sentenceEnd > 0 && sentenceEnd <= TITLE_MAX) {
    return cleaned.slice(0, sentenceEnd + 1).trim()
  }

  const cut = cleaned.slice(0, TITLE_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

/** The title to show for a spark, stored or derived. */
export const displayTitle = (spark: Spark): string =>
  spark.title?.trim() || deriveTitle(spark.content)

// ─── Density ─────────────────────────────────────────────────────────────────

const LONG_CHARS = 280
const LONG_LINES = 4

/**
 * Whether a spark's body is dense enough to be worth collapsing behind its
 * title. Short captures stay fully visible — collapsing a two-line thought
 * adds a click and hides nothing worth hiding.
 */
export const isLongContent = (content: string): boolean =>
  content.length > LONG_CHARS || content.split('\n').filter((l) => l.trim()).length > LONG_LINES

/** "41 lines" / "820 characters" — a hint at what's behind a collapsed card. */
export const contentExtent = (content: string): string => {
  const lines = content.split('\n').filter((l) => l.trim()).length
  if (lines > 1) return `${lines} lines`
  const words = content.trim().split(/\s+/).length
  return `${words} words`
}

// ─── Time ────────────────────────────────────────────────────────────────────

/** Relative-first, because time blindness makes absolute dates hard to read. */
export const relativeAge = (ms: number, now: number = Date.now()): string => {
  const days = Math.floor((now - ms) / DAY_MS)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/** The precise timestamp, for a title attribute alongside the relative one. */
export const absoluteDate = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
  })

/** A spark that was promoted carries provenance; a discarded one doesn't. */
export const isPromoted = (spark: Spark): boolean => Boolean(spark.promoted_to)
