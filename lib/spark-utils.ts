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

export const scoreSpark = (
  spark: Spark,
  now: number = Date.now(),
  decayThresholdDays: number = DECAY_THRESHOLD_DAYS
): number => {
  const daysSinceCreated = (now - spark.created_at) / DAY_MS
  const ageScore = Math.min(daysSinceCreated / 365, 1) * 40

  const lastInteraction = spark.last_surfaced_at ?? spark.created_at
  const daysSinceInteraction = (now - lastInteraction) / DAY_MS
  const neglectScore = Math.min(daysSinceInteraction / decayThresholdDays, 1) * 40

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

// ─── Context biasing ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','of','to','in','on','for','with','at','by',
  'from','up','about','into','over','after','is','are','was','were','be','been',
  'it','this','that','these','those','i','im','my','we','you','your','some',
])

/** Distinctive lowercase words from a free-text hint. */
export const contextWords = (context: string): string[] =>
  Array.from(
    new Set(
      context
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    )
  )

const CONTEXT_MAX_BONUS = 25

/**
 * Nudges recall toward what the user is working on right now. Deliberately
 * capped below the weight of age and neglect — it should bias the ranking,
 * not replace it, or `context` would just become a second search.
 */
export const contextBonus = (spark: Spark, words: string[]): number => {
  if (words.length === 0) return 0
  const haystack = `${spark.title ?? ''} ${spark.content} ${(spark.tags ?? []).join(' ')}`.toLowerCase()
  const hits = words.filter((w) => haystack.includes(w)).length
  return (hits / words.length) * CONTEXT_MAX_BONUS
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface SparkStats {
  total: number
  active: number
  cold: number
  archived: number
  promoted: number
  /** Promoted as a share of everything no longer active. */
  promotionRate: number | null
  oldestActive: Spark | null
  mostNeglected: Spark | null
  capturedLast30: number
  capturedLast7: number
  untagged: number
  neverSurfaced: number
}

/** One pass over the array the app already has in memory. */
export const computeStats = (sparks: Spark[], now: number = Date.now()): SparkStats => {
  const active = sparks.filter((s) => s.status === 'active')
  const cold = sparks.filter((s) => s.status === 'cold')
  const archived = sparks.filter((s) => s.status === 'archived')
  const promoted = sparks.filter(isPromoted)

  // Of the sparks that reached an end state, how many became something?
  const concluded = archived.length
  const byOldest = active.slice().sort((a, b) => a.created_at - b.created_at)
  const byNeglect = active
    .slice()
    .sort((a, b) => (a.last_surfaced_at ?? a.created_at) - (b.last_surfaced_at ?? b.created_at))

  const since = (days: number) =>
    sparks.filter((s) => now - s.created_at <= days * DAY_MS).length

  return {
    total: sparks.length,
    active: active.length,
    cold: cold.length,
    archived: archived.length,
    promoted: promoted.length,
    promotionRate: concluded > 0 ? promoted.length / concluded : null,
    oldestActive: byOldest[0] ?? null,
    mostNeglected: byNeglect[0] ?? null,
    capturedLast30: since(30),
    capturedLast7: since(7),
    untagged: sparks.filter((s) => (s.tags ?? []).length === 0).length,
    neverSurfaced: active.filter((s) => s.surface_count === 0).length,
  }
}

/** Tag name -> number of sparks carrying it, most used first. */
export const tagCounts = (sparks: Spark[]): Array<{ tag: string; count: number }> => {
  const counts = new Map<string, number>()
  for (const spark of sparks) {
    for (const tag of spark.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  )
}

// ─── Tag normalization ───────────────────────────────────────────────────────

/**
 * Tags fragment silently: "writing", "Writing" and " writing " become three
 * unrelated tags, and a recall filtered by one misses the others with no
 * error. Everything is folded on write, and comparisons fold too so sparks
 * captured before this still match.
 */
export const normalizeTag = (tag: string): string => tag.trim().toLowerCase()

export const normalizeTags = (tags: readonly string[]): string[] =>
  Array.from(new Set(tags.map(normalizeTag).filter(Boolean)))

/** Case-insensitive membership, for sparks whose tags predate normalization. */
export const hasAnyTag = (spark: Spark, wanted: readonly string[]): boolean => {
  const want = new Set(wanted.map(normalizeTag))
  return (spark.tags ?? []).some((t) => want.has(normalizeTag(t)))
}

export const hasTag = (spark: Spark, wanted: string): boolean =>
  (spark.tags ?? []).some((t) => normalizeTag(t) === normalizeTag(wanted))

/**
 * Rewrites every case-variant of `from` to `to` in one spark's tag list.
 *
 * Normalization stops NEW fragmentation; it does nothing about the variants
 * already sitting in a store, which is what this is for. Only the matched tag
 * is touched — the rest are left exactly as captured — but the result is
 * deduplicated case-insensitively, so renaming into a tag the spark already
 * carries merges the two instead of listing it twice.
 */
export const renameTagIn = (tags: readonly string[], from: string, to: string): string[] => {
  const fromNorm = normalizeTag(from)
  const toNorm = normalizeTag(to)
  const out: string[] = []
  const seen = new Set<string>()

  for (const tag of tags) {
    const next = normalizeTag(tag) === fromNorm ? toNorm : tag
    const key = normalizeTag(next)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(next)
  }

  return out
}

// ─── Fuzzy search ────────────────────────────────────────────────────────────

/** Edit distance, abandoned early once it exceeds `max`. */
const editDistance = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      best = Math.min(best, curr[j])
    }
    if (best > max) return max + 1
    prev = curr
  }
  return prev[b.length]
}

/** Longer words tolerate more typos; short ones must be near-exact. */
const tolerance = (word: string): number => (word.length <= 4 ? 0 : word.length <= 7 ? 1 : 2)

/**
 * Only used when exact substring matching finds nothing. The core use case is
 * "I half-remember writing something about X" — requiring the user to
 * reproduce their own phrasing exactly is the working-memory demand the
 * product exists to remove.
 */
export const fuzzyMatches = (spark: Spark, query: string): boolean => {
  const terms = contextWords(query)
  if (terms.length === 0) return false

  const haystack = `${spark.title ?? ''} ${spark.content} ${(spark.tags ?? []).join(' ')}`
    .toLowerCase()
    // A long spark is capped so a big store stays responsive.
    .slice(0, 4000)
  const words = Array.from(new Set(haystack.split(/[^a-z0-9]+/).filter((w) => w.length > 2)))

  return terms.every((term) => {
    const max = tolerance(term)
    if (max === 0) return words.some((w) => w === term || w.startsWith(term))
    return words.some((w) => w.includes(term) || editDistance(w, term, max) <= max)
  })
}

// ─── Duplicate detection ─────────────────────────────────────────────────────

/** Jaccard overlap of distinctive words. 1 = same wording, 0 = nothing shared. */
export const similarity = (a: string, b: string): number => {
  const A = new Set(contextWords(a))
  const B = new Set(contextWords(b))
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / (A.size + B.size - shared)
}

/** Whitespace- and case-insensitive identity, for the unambiguous case. */
export const isSameContent = (a: string, b: string): boolean =>
  a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Above this, two sparks are probably the same recurring thought. Chosen to
 * sit well clear of "same topic" — two sparks about writing share a couple of
 * words and score far below it.
 */
export const NEAR_DUPLICATE = 0.6

export interface DuplicateHit {
  spark: Spark
  score: number
  exact: boolean
}

/** The closest existing spark to some new content, if anything is close. */
export const findNearest = (
  candidates: Spark[],
  content: string,
  threshold: number = NEAR_DUPLICATE
): DuplicateHit | null => {
  let best: DuplicateHit | null = null
  for (const spark of candidates) {
    if (isSameContent(spark.content, content)) return { spark, score: 1, exact: true }
    const score = similarity(spark.content, content)
    if (score >= threshold && (!best || score > best.score)) {
      best = { spark, score, exact: false }
    }
  }
  return best
}

/** Every near-duplicate pair in the store, closest first. */
export const findDuplicatePairs = (
  sparks: Spark[],
  threshold: number = NEAR_DUPLICATE
): Array<{ a: Spark; b: Spark; score: number }> => {
  const pairs: Array<{ a: Spark; b: Spark; score: number }> = []
  for (let i = 0; i < sparks.length; i++) {
    for (let j = i + 1; j < sparks.length; j++) {
      const score = isSameContent(sparks[i].content, sparks[j].content)
        ? 1
        : similarity(sparks[i].content, sparks[j].content)
      if (score >= threshold) pairs.push({ a: sparks[i], b: sparks[j], score })
    }
  }
  return pairs.sort((x, y) => y.score - x.score)
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/** Held out of recall until the snooze expires. */
export const isSnoozed = (spark: Spark, now: number = Date.now()): boolean =>
  typeof spark.snooze_until === 'number' && spark.snooze_until > now

/** Standing sparks are intentions, not perishable ideas — they never go cold. */
export const isStanding = (spark: Spark): boolean => spark.standing === true

/** Whether decay should be allowed to touch this spark at all. */
export const canGoCold = (spark: Spark, now: number = Date.now()): boolean =>
  spark.status === 'active' && !isStanding(spark) && !isSnoozed(spark, now)

/**
 * How alive a spark currently is, on [0,1]. 1 is touched today; 0 is exactly at
 * the cold threshold.
 *
 * Deliberately NOT scoreSpark. That is recall *priority*, and it runs HIGH for
 * old, neglected, never-surfaced sparks — driving a warm/cold visual from it
 * would set the stalest cards glowing. This is scoreSpark's neglect term alone,
 * inverted, which is also the quantity canGoCold uses: a spark therefore looks
 * cold at exactly the moment it becomes cold, rather than on some second clock
 * that drifts away from the first.
 *
 * Returns null for sparks that are not on the decay clock at all. Standing
 * sparks are intentions rather than perishable ideas, snoozed ones have been
 * deliberately set down, and archived or promoted ones are concluded — a
 * temperature for any of them would be a lie.
 */
export const sparkHeat = (
  spark: Spark,
  now: number = Date.now(),
  decayThresholdDays: number = DECAY_THRESHOLD_DAYS
): number | null => {
  if (isStanding(spark) || isSnoozed(spark, now)) return null
  if (spark.status === 'archived' || isPromoted(spark)) return null
  if (spark.status === 'cold') return 0

  const lastInteraction = spark.last_surfaced_at ?? spark.created_at
  const daysSinceInteraction = (now - lastInteraction) / DAY_MS
  const neglect = Math.min(Math.max(daysSinceInteraction / decayThresholdDays, 0), 1)
  return 1 - neglect
}
