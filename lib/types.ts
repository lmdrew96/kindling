export type SparkStatus = 'active' | 'cold' | 'archived'

/**
 * What sort of idea a spark is. A fixed list on purpose — renaming one is a
 * one-line change here, which beats a settings screen nobody asked for.
 */
export const SPARK_KINDS = ['story', 'app-feature', 'research', 'reading', 'essay', 'other'] as const
export type SparkKind = (typeof SPARK_KINDS)[number]

export const KIND_LABELS: Record<SparkKind, string> = {
  story: 'Story',
  'app-feature': 'Development',
  research: 'Research',
  reading: 'Reading',
  essay: 'Essay',
  other: 'Other',
}

/**
 * Who captured it. `claude` is a Claude that didn't say which one — an MCP
 * URL without an identity suffix.
 */
export const SPARK_SOURCES = ['web', 'coru', 'cody', 'claude', 'loose-change'] as const
export type SparkSource = (typeof SPARK_SOURCES)[number]

export interface Spark {
  id: string
  /**
   * Short handle for the spark. Optional: sparks captured before this field
   * existed, and short sparks that are their own title, leave it null and fall
   * back to `deriveTitle`.
   */
  title: string | null
  content: string
  tags: string[]
  created_at: number
  last_surfaced_at: number | null
  surface_count: number
  promoted_to: string | null
  promoted_at: number | null
  promoted_notes: string | null
  status: SparkStatus
  cold_at: number | null
  /**
   * "Not now, ask me later" — epoch ms until which this spark is held out of
   * recall and exempt from decay. Null (or absent, on older sparks) means not
   * snoozed.
   */
  snooze_until: number | null
  /**
   * A standing intention rather than a perishable idea. Standing sparks never
   * decay to cold, however long they sit.
   */
  standing: boolean
  /*
   * Structured fields. All optional in storage: sparks captured before they
   * existed simply lack them, and every reader treats absent as null.
   */
  kind?: SparkKind | null
  /** Where the idea lives once it's acted on — a project, a draft, a notebook. */
  home?: string | null
  /** The one concrete move that would advance it. */
  next_step?: string | null
  source?: SparkSource | null
  /** The originating record when source is loose-change: its entry id. */
  source_ref?: string | null
}

export type SparkExtras = Pick<Spark, 'kind' | 'home' | 'next_step' | 'source' | 'source_ref'>
