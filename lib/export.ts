import type { Spark, SparkStatus } from './types'
import { displayTitle } from './spark-utils'

/**
 * Serializers for getting a corpus back out.
 *
 * Until accounts exist, one token in one browser's localStorage is the only
 * handle on everything a user has captured. Export is the difference between
 * losing that token being an inconvenience and it being total loss.
 */

const iso = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString()

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

const STATUS_ORDER: SparkStatus[] = ['active', 'cold', 'archived']

const HEADINGS: Record<SparkStatus, string> = {
  active: 'Active',
  cold: 'Cold',
  archived: 'Archived',
}

/** Newest first within each group, which is how people read their own archive. */
const byNewest = (a: Spark, b: Spark) => b.created_at - a.created_at

export const toMarkdown = (sparks: Spark[], now: number = Date.now()): string => {
  const out: string[] = [
    '# Kindling export',
    '',
    `Exported ${day(now)} · ${sparks.length} spark${sparks.length === 1 ? '' : 's'}`,
    '',
  ]

  for (const status of STATUS_ORDER) {
    // Promoted sparks are archived; they earn their own section because the
    // provenance is the interesting part.
    const group = sparks
      .filter((s) => s.status === status && !(status === 'archived' && s.promoted_to))
      .sort(byNewest)
    if (group.length === 0) continue

    out.push(`## ${HEADINGS[status]} (${group.length})`, '')
    for (const spark of group) out.push(...sparkBlock(spark))
  }

  const promoted = sparks.filter((s) => s.promoted_to).sort(byNewest)
  if (promoted.length > 0) {
    out.push(`## Promoted (${promoted.length})`, '')
    for (const spark of promoted) out.push(...sparkBlock(spark))
  }

  return out.join('\n')
}

const sparkBlock = (spark: Spark): string[] => {
  const tags = spark.tags ?? []
  const meta = [`Captured ${day(spark.created_at)}`]
  if (spark.surface_count > 0) {
    meta.push(
      `surfaced ${spark.surface_count}×${
        spark.last_surfaced_at ? ` (last ${day(spark.last_surfaced_at)})` : ''
      }`
    )
  }
  if (tags.length) meta.push(`tags: ${tags.join(', ')}`)

  const block = [`### ${displayTitle(spark)}`, '', `*${meta.join(' · ')}*`, '', spark.content, '']

  if (spark.promoted_to) {
    block.push(
      `> **Became ${spark.promoted_to}**${
        spark.promoted_at ? ` on ${day(spark.promoted_at)}` : ''
      }${spark.promoted_notes ? ` — ${spark.promoted_notes}` : ''}`,
      ''
    )
  }

  block.push('---', '')
  return block
}

/** Round-trips exactly; this is the one to keep if you keep only one. */
export const toJson = (sparks: Spark[], now: number = Date.now()): string =>
  JSON.stringify(
    {
      exported_at: iso(now),
      format: 'kindling-export-v1',
      count: sparks.length,
      sparks: sparks.slice().sort(byNewest),
    },
    null,
    2
  )

export const exportFilename = (format: 'json' | 'markdown', now: number = Date.now()): string =>
  `kindling-${day(now)}.${format === 'json' ? 'json' : 'md'}`
