'use client'

import { useState } from 'react'
import { KIND_LABELS, SPARK_KINDS, type Spark, type SparkKind } from '@/lib/types'
import { firstLineAsTitle, previewText, suggestKind } from '@/lib/spark-utils'
import { Shell } from './spark-dialog'
import { BTN_GHOST, BTN_PRIMARY, INPUT } from './ui'

export type SortPatch = { kind: SparkKind; home?: string; title?: string; content?: string }

/** Which gap the review is filling: kinds (the one-time pass) or homes (from the board). */
export type SortPurpose = 'kinds' | 'homes'

/**
 * A one-spark-at-a-time review: the one-time pass over sparks captured before
 * kinds existed, or (from the by-home board) a pass over sparks with no home.
 * Every step offers both kind and home. A suggestion from its tags is marked
 * but never applied on its own — nothing is written until Save, and Skip
 * writes nothing. Closing keeps whatever was already saved, so the review can
 * be picked up again later.
 */
export function SortDialog({
  queue,
  knownHomes,
  purpose = 'kinds',
  onSave,
  onClose,
}: {
  /** The sparks to review, snapshotted when the review opened. */
  queue: Spark[]
  knownHomes: string[]
  purpose?: SortPurpose
  onSave: (spark: Spark, patch: SortPatch) => void
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const spark = queue[index]

  if (!spark) {
    return (
      <Shell title="All sorted" labelledBy="sort-title" onCancel={onClose}>
        <p className="text-sm text-fg-muted">
          {purpose === 'homes'
            ? 'Every spark in this pass has a home now — or was skipped, and still shows under Unsorted on the board.'
            : 'Every spark in this pass has a kind now — or was skipped, and still shows under Unsorted.'}
        </p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={`min-h-11 px-4 text-sm ${BTN_PRIMARY}`}>
            Done
          </button>
        </div>
      </Shell>
    )
  }

  // Keyed by id so each spark starts from its own suggestion, not the last one's picks.
  return (
    <SortStep
      key={spark.id}
      spark={spark}
      knownHomes={knownHomes}
      purpose={purpose}
      position={`${index + 1} of ${queue.length}`}
      onSave={(patch) => {
        onSave(spark, patch)
        setIndex((i) => i + 1)
      }}
      onSkip={() => setIndex((i) => i + 1)}
      onClose={onClose}
    />
  )
}

function SortStep({
  spark,
  knownHomes,
  purpose,
  position,
  onSave,
  onSkip,
  onClose,
}: {
  spark: Spark
  knownHomes: string[]
  purpose: SortPurpose
  position: string
  onSave: (patch: SortPatch) => void
  onSkip: () => void
  onClose: () => void
}) {
  // A spark that already has a kind keeps it; otherwise its tags may suggest one.
  const suggested = spark.kind ? null : suggestKind(spark.tags ?? [])
  const [kind, setKind] = useState<SparkKind | null>(spark.kind ?? suggested)
  const [home, setHome] = useState(spark.home ?? '')

  // Only sparks without a stored title get the title offer.
  const derived = spark.title?.trim() ? null : firstLineAsTitle(spark)
  const [title, setTitle] = useState(derived?.title ?? '')
  const [strip, setStrip] = useState(Boolean(derived?.strippedContent))

  const save = () => {
    if (!kind) return
    const nextHome = home.trim()
    onSave({
      kind,
      ...(nextHome && nextHome !== spark.home ? { home: nextHome } : {}),
      ...(derived && title.trim() ? { title: title.trim() } : {}),
      ...(derived && strip && derived.strippedContent ? { content: derived.strippedContent } : {}),
    })
  }

  const preview = previewText(spark)

  return (
    <Shell
      title={purpose === 'homes' ? 'Give them homes' : 'Sort your sparks'}
      labelledBy="sort-title"
      onCancel={onClose}
    >
      <p className="font-mono text-[0.6875rem] text-fg-subtle">{position}</p>

      <div className="space-y-1.5 rounded-lg border border-border bg-surface-raised p-3">
        {derived ? (
          <label className="block space-y-1">
            <span className="text-xs text-fg-muted">
              Title — taken from the first line; edit it or keep it
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className={`w-full text-sm font-semibold px-3 py-2 ${INPUT}`}
            />
          </label>
        ) : (
          <p className="text-sm font-semibold text-fg">{spark.title}</p>
        )}
        {preview && <p className="line-clamp-3 text-sm text-fg-muted">{preview}</p>}
        {(spark.tags ?? []).length > 0 && (
          <p className="font-mono text-[0.6875rem] text-fg-subtle">{spark.tags.join(' · ')}</p>
        )}
        {derived?.strippedContent && (
          <label className="flex items-start gap-2 pt-1 text-xs text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={strip}
              onChange={(e) => setStrip(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--color-primary)] cursor-pointer"
            />
            Remove that first line from the body, so the title isn&rsquo;t repeated
          </label>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-fg-muted">
          Kind{suggested && <> — suggested from its tags: <strong className="text-fg">{KIND_LABELS[suggested]}</strong></>}
        </p>
        <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1.5">
          {SPARK_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-md border px-2.5 min-h-9 pointer-coarse:min-h-11 text-xs transition-colors cursor-pointer ${
                kind === k
                  ? 'border-primary/60 bg-primary/15 text-primary font-semibold'
                  : 'border-border-strong text-fg-muted hover:bg-surface-hover hover:text-fg'
              }`}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs text-fg-muted">
          Home (optional) — the project or place it belongs to
        </span>
        <input
          value={home}
          onChange={(e) => setHome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
          list="known-homes-sort"
          maxLength={120}
          autoFocus={purpose === 'homes'}
          placeholder="Leave empty to keep it unsorted"
          className={`w-full text-sm px-3 py-2.5 ${INPUT}`}
        />
        <datalist id="known-homes-sort">
          {knownHomes.map((h) => (
            <option key={h} value={h} />
          ))}
        </datalist>
      </label>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
        <button type="button" onClick={onClose} className={`min-h-11 px-4 text-sm ${BTN_GHOST}`}>
          Stop for now
        </button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" onClick={onSkip} className={`min-h-11 px-4 text-sm ${BTN_GHOST}`}>
            Skip
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!kind}
            className={`min-h-11 px-4 text-sm ${BTN_PRIMARY}`}
          >
            Save &amp; next
          </button>
        </div>
      </div>
    </Shell>
  )
}
