'use client'

import type { Spark } from '@/lib/types'
import { computeStats, displayTitle, relativeAge } from '@/lib/spark-utils'

/**
 * The view that makes the store feel like a system rather than a dropbox.
 * Everything here comes from the array the dashboard already holds, so it
 * costs no extra request.
 */
export function StatsPanel({ sparks, onClose }: { sparks: Spark[]; onClose: () => void }) {
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
