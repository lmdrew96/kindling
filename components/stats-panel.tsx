'use client'

import type { Spark } from '@/lib/types'
import { computeStats, displayTitle, relativeAge } from '@/lib/spark-utils'
import { TagManager } from '@/components/tag-manager'

const DECAY_CHOICES = [30, 60, 90, 180, 365, 730]

/**
 * The view that makes the store feel like a system rather than a dropbox.
 * The counts come from the array the dashboard already holds, so they cost no
 * extra request; only the decay setting is fetched separately.
 */
export function StatsPanel({
  sparks,
  decayDays,
  onDecayChange,
  onRenameTag,
  onClose,
}: {
  sparks: Spark[]
  decayDays: number
  onDecayChange: (days: number) => void
  onRenameTag: (from: string, to: string) => Promise<void>
  onClose: () => void
}) {
  const s = computeStats(sparks)

  return (
    <section
      aria-label="Spark statistics"
      className="rounded-xl border border-border bg-surface p-4 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-sm font-bold text-fg">Your sparks</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-fg-subtle hover:text-fg transition-colors cursor-pointer"
        >
          Hide
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active" value={s.active} />
        <Stat label="Cold" value={s.cold} />
        <Stat label="Archived" value={s.archived} />
        <Stat label="Promoted" value={s.promoted} tone="primary" />
      </dl>

      <div className="space-y-1.5 text-xs text-fg-muted">
        <p>
          {s.promotionRate !== null ? (
            <>
              <strong className="text-fg">{Math.round(s.promotionRate * 100)}%</strong> of the
              sparks you&rsquo;ve concluded became something real.
            </>
          ) : (
            <>Nothing concluded yet — promote a spark when it turns into something.</>
          )}
        </p>
        <p>
          <strong className="text-fg">{s.capturedLast7}</strong> captured this week,{' '}
          <strong className="text-fg">{s.capturedLast30}</strong> in the last 30 days.
        </p>
        {s.neverSurfaced > 0 && (
          <p>
            <strong className="text-fg">{s.neverSurfaced}</strong> active spark
            {s.neverSurfaced === 1 ? ' has' : 's have'} never surfaced.
          </p>
        )}
        {s.oldestActive && (
          <p className="truncate">
            Oldest active: <span className="text-fg">{displayTitle(s.oldestActive)}</span> ·{' '}
            {relativeAge(s.oldestActive.created_at)}
          </p>
        )}
      </div>

      {/* The decay clock. 180 days is a reasonable default but a poor thing to
          decide on someone's behalf permanently. */}
      <div className="border-t border-border pt-3">
        <label className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          Sparks go cold after
          <select
            value={decayDays}
            onChange={(e) => onDecayChange(Number(e.target.value))}
            className="min-h-11 cursor-pointer rounded-lg border border-border bg-surface px-2 text-xs text-fg outline-none"
          >
            {DECAY_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
          without interaction.
        </label>
        <p className="mt-1 text-xs text-fg-subtle">
          The same window sets how fast neglect builds in the recall ranking, so a spark hits its
          highest score right as it goes cold.
        </p>
      </div>

      {/* Tags live here rather than behind their own header button: seeing the
          counts next to each other is what makes fragmentation visible, and
          this is already the panel that shows the shape of the store. */}
      <div className="border-t border-border pt-3 space-y-2">
        <h3 className="font-display text-xs font-bold text-fg">Tags</h3>
        <TagManager sparks={sparks} onRename={onRenameTag} />
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'primary'
}) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd
        className={`font-display text-xl font-bold ${
          tone === 'primary' ? 'text-primary' : 'text-fg'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
