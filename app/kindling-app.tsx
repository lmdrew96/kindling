'use client'

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import { KIND_LABELS, SPARK_KINDS, type Spark, type SparkKind, type SparkSource, type SparkStatus } from '@/lib/types'
import {
  DECAY_THRESHOLD_DAYS,
  absoluteDate,
  displayTitle,
  fuzzyMatches,
  isPromoted,
  isSnoozed,
  isStanding,
  normalizeTags,
  previewText,
  relativeAge,
  scoreSpark,
  sparkHeat,
  heatEmphasis,
  tagCounts,
} from '@/lib/spark-utils'
import { Markdown } from '@/components/markdown'
import { BTN_GHOST, BTN_PRIMARY, INPUT, UUID_RE } from '@/components/ui'
import { TokenDisplay } from '@/components/token-display'
import { ForgetTokenDialog } from '@/components/forget-token-dialog'
import { StatsPanel } from '@/components/stats-panel'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { EditSparkDialog, PromoteDialog, type SparkEdit } from '@/components/spark-dialog'
import { HelpPanel } from '@/components/help-panel'
import { SortDialog, type SortPatch } from '@/components/sort-dialog'
import { clearTokenCookie, writeTokenCookie } from '@/lib/token-cookie'
import { AccountPanel, type PublicAccount } from '@/components/account-panel'
import { Sidebar, type View } from '@/components/sidebar'

// The origin never changes within a page's life, so there is nothing to
// subscribe to — this exists only to satisfy useSyncExternalStore's signature.
const subscribeToNothing = () => () => {}
const browserOrigin = () => window.location.origin

// ─── API helpers ─────────────────────────────────────────────────────────────

async function fetchSparks(token: string): Promise<Spark[]> {
  const res = await fetch(`/api/sparks?token=${token}`)
  if (!res.ok) throw new Error('Failed to load sparks')
  return res.json()
}

type NewSpark = {
  title: string
  kind: SparkKind
  content: string
  home?: string
  next_step?: string
  tags: string[]
}

async function kindleApi(token: string, spark: NewSpark): Promise<Spark> {
  const res = await fetch(`/api/sparks?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spark),
  })
  if (!res.ok) throw new Error('Failed to kindle spark')
  return res.json()
}

/**
 * Moves a spark between statuses. Every status change in the app goes through
 * here, so there is one place that checks res.ok — the previous archive/revive
 * helpers ignored the response entirely and reported success unconditionally.
 */
async function batchArchiveApi(token: string, ids: string[]): Promise<string[]> {
  const res = await fetch(`/api/sparks?token=${token}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spark_ids: ids }),
  })
  if (!res.ok) throw new Error('Failed to archive selection')
  return (await res.json()).archived as string[]
}

/** How a card names who captured it. Web is the default and says nothing. */
const SOURCE_LABELS: Record<SparkSource, string> = {
  web: 'from the web',
  coru: 'via Coru',
  cody: 'via Cody',
  claude: 'via Claude',
  'loose-change': 'from Loose Change',
}

/** More than this and the chips start to outweigh the idea. */
const MAX_CARD_TAGS = 4

const SNOOZE_CHOICES: Array<{ label: string; days: number }> = [
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
]

async function patchSparkApi(
  token: string,
  id: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`/api/sparks?token=${token}&id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to update spark')
}

async function surfaceApi(token: string, id: string): Promise<Spark> {
  const res = await fetch(`/api/sparks?token=${token}&id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ surface: true }),
  })
  if (!res.ok) throw new Error('Failed to surface spark')
  return res.json()
}

async function renameTagApi(
  token: string,
  from: string,
  to: string,
  restrictTo?: string[]
): Promise<{ changed: string[]; merged: boolean }> {
  const res = await fetch(`/api/tags?token=${token}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, ...(restrictTo ? { restrict_to: restrictTo } : {}) }),
  })
  if (!res.ok) throw new Error('Failed to rename tag')
  return res.json()
}

async function removeTagApi(token: string, tag: string): Promise<{ changed: string[] }> {
  const res = await fetch(`/api/tags?token=${token}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag }),
  })
  if (!res.ok) throw new Error('Failed to remove tag')
  return res.json()
}

async function restoreTagApi(token: string, tag: string, ids: string[]): Promise<void> {
  const res = await fetch(`/api/tags?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag, ids }),
  })
  if (!res.ok) throw new Error('Failed to restore tag')
}

async function fetchPrefs(token: string): Promise<{ decayThresholdDays: number }> {
  const res = await fetch(`/api/prefs?token=${token}`)
  if (!res.ok) throw new Error('Failed to load settings')
  return res.json()
}

async function savePrefs(token: string, decayThresholdDays: number): Promise<void> {
  const res = await fetch(`/api/prefs?token=${token}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decayThresholdDays }),
  })
  if (!res.ok) throw new Error('Failed to save settings')
}

async function promoteApi(
  token: string,
  id: string,
  target: string,
  notes: string | null
): Promise<Spark> {
  const res = await fetch(`/api/promote?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spark_id: id, target, notes }),
  })
  if (!res.ok) throw new Error('Failed to promote spark')
  return res.json()
}

async function recallApi(token: string, limit = 5): Promise<Spark[]> {
  const res = await fetch(`/api/recall?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  })
  if (!res.ok) throw new Error('Failed to recall sparks')
  return res.json()
}

async function deleteApi(token: string, id: string): Promise<void> {
  const res = await fetch(`/api/sparks?token=${token}&id=${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete spark')
}

async function setStatusApi(token: string, id: string, status: SparkStatus): Promise<void> {
  const res = await fetch(`/api/sparks?token=${token}&id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    // Returning to active clears the cold clock; nothing else should.
    body: JSON.stringify(status === 'active' ? { status, cold_at: null } : { status }),
  })
  if (!res.ok) throw new Error(`Failed to set status to ${status}`)
}

// ─── Spark card ───────────────────────────────────────────────────────────────

function SparkCard({
  spark,
  onEdit,
  onPromote,
  onSnooze,
  onUnsnooze,
  onToggleStanding,
  onArchive,
  onRevive,
  onUnarchive,
  showStatus,
  selected,
  onToggleSelected,
  onDelete,
  decayDays,
}: {
  spark: Spark
  onEdit?: () => void
  onPromote?: () => void
  onSnooze?: (days: number) => void
  onUnsnooze?: () => void
  onToggleStanding?: () => void
  onArchive?: () => void
  onRevive?: () => void
  onUnarchive?: () => void
  /** Search spans every status, so a hit has to say where it lives. */
  showStatus?: boolean
  selected?: boolean
  onToggleSelected?: () => void
  onDelete?: () => void
  /** The user's cold threshold, so heat reaches zero where decay actually bites. */
  decayDays?: number
}) {
  const isCold = spark.status === 'cold'
  const promoted = isPromoted(spark)
  const snoozed = isSnoozed(spark)
  const standing = isStanding(spark)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const tags = spark.tags ?? []
  const shownTags = tags.slice(0, MAX_CARD_TAGS)
  const hiddenTags = tags.length - shownTags.length
  const preview = previewText(spark)
  const bodyId = `spark-body-${spark.id}`

  // The left rail is the spark's temperature: hot when it was touched
  // recently, slate as it drifts toward cold. sparkHeat is the neglect term
  // inverted — NOT scoreSpark, which runs high for the stalest sparks. Null
  // means the spark is off the decay clock and the rail stays neutral.
  // `now` defaults inside the helper; sparks only render after a client fetch,
  // so there is no server render to disagree with.
  const trueHeat = sparkHeat(spark, undefined, decayDays)
  // Paint along the emphasis curve, not the raw value — see heatEmphasis.
  const heat = trueHeat === null ? null : heatEmphasis(trueHeat)
  const railColor =
    heat === null
      ? promoted
        ? 'color-mix(in srgb, var(--color-primary) 50%, transparent)'
        : 'var(--color-border-strong)'
      : `color-mix(in oklch, var(--color-hot) ${Math.round(heat * 100)}%, var(--color-cold))`

  // Same cuts the prefers-contrast override in globals.css expects.
  const heatBucket =
    heat === null ? undefined : heat >= 0.66 ? 'warm' : heat < 0.33 ? 'cold' : 'cooling'

  const action = `text-xs px-2.5 min-h-8 pointer-coarse:min-h-11 rounded-md transition-colors cursor-pointer`
  const ghost = `${action} text-fg-muted hover:bg-surface-hover hover:text-fg`

  return (
    <div
      data-heat={heatBucket}
      style={{ borderLeftColor: railColor }}
      className="group/card relative flex flex-col gap-1.5 rounded-xl border border-l-[3px] border-border bg-surface-raised px-4 py-3"
    >
      {/* Selection is a mode you enter, not a permanent fixture on every card.
          It stays reachable by keyboard and always visible once checked or on
          touch, where there is no hover to reveal it. */}
      {onToggleSelected && (
        <label
          className={`absolute -left-2.5 -top-2.5 z-10 flex items-center rounded-lg border border-border-strong bg-surface-hover p-1.5 shadow-md text-xs text-fg-subtle cursor-pointer transition-opacity motion-reduce:transition-none pointer-coarse:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 ${
            selected ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={onToggleSelected}
            className="size-4 accent-[var(--color-primary)] cursor-pointer"
          />
          <span className="sr-only">Select this spark</span>
        </label>
      )}

      {/* Kind and home as an eyebrow: what sort of idea, and where it lives. */}
      {(spark.kind || spark.home) && (
        <p className="pl-[1.125rem] text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-fg-subtle">
          {spark.kind && KIND_LABELS[spark.kind]}
          {spark.kind && spark.home && ' · '}
          {spark.home && <span className="normal-case tracking-normal">{spark.home}</span>}
        </p>
      )}

      {/* Title is the expand control. Collapsed, the card shows a plain-text
          glimpse; expanded, the full body renders as markdown inline. */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="group flex items-start gap-2 text-left cursor-pointer"
      >
        <span
          aria-hidden="true"
          className={`mt-1 text-[0.625rem] text-fg-subtle transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
        >
          ▶
        </span>
        <span className="flex-1 text-[0.9375rem] font-semibold leading-snug text-fg transition-colors group-hover:text-primary">
          {displayTitle(spark)}
        </span>
      </button>

      <div id={bodyId} className="pl-[1.125rem]">
        {expanded ? (
          <Markdown className="text-[0.9375rem] text-fg">{spark.content}</Markdown>
        ) : (
          preview && <p className="line-clamp-2 text-sm leading-relaxed text-fg-muted">{preview}</p>
        )}
      </div>

      {spark.next_step && (
        <p className="pl-[1.125rem] text-xs text-fg-muted">
          <span className="font-semibold text-fg">Next:</span> {spark.next_step}
        </p>
      )}

      {/* Promotion record. The whole point of the system. */}
      {promoted && (
        <p className="pl-[1.125rem] text-xs text-fg-muted">
          <span aria-hidden="true" className="text-primary">✦</span> Became{' '}
          <strong className="font-semibold text-primary">{spark.promoted_to}</strong>
          {spark.promoted_at && <> · {relativeAge(spark.promoted_at)}</>}
          {spark.promoted_notes && <span className="italic"> — {spark.promoted_notes}</span>}
        </p>
      )}

      {/* Footer: quiet chips and machine-voice metadata on the left, actions
          on the right — all in flow, so the actions can never cover the
          metadata. It wraps rather than overlapping when the row runs out. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pl-[1.125rem]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Tags">
            {shownTags.map((tag) => (
              <li
                key={tag}
                className="rounded-md bg-tag-bg px-1.5 py-0.5 text-[0.6875rem] leading-none text-tag-fg"
              >
                {tag}
              </li>
            ))}
            {hiddenTags > 0 && (
              <li
                title={tags.slice(MAX_CARD_TAGS).join(', ')}
                className="px-1 py-0.5 font-mono text-[0.6875rem] leading-none text-fg-subtle"
              >
                +{hiddenTags}
              </li>
            )}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.6875rem] text-fg-subtle">
          <span title={absoluteDate(spark.created_at)}>
            captured {relativeAge(spark.created_at)}
          </span>
          {spark.surface_count > 0 && (
            <span
              title={spark.last_surfaced_at ? absoluteDate(spark.last_surfaced_at) : undefined}
            >
              · surfaced {spark.surface_count}×
              {spark.last_surfaced_at && `, last ${relativeAge(spark.last_surfaced_at)}`}
            </span>
          )}
          {spark.source && spark.source !== 'web' && (
            <span>· {SOURCE_LABELS[spark.source]}</span>
          )}
          {isCold && (
            <span className="text-cold-text">
              · <span aria-hidden="true">❄</span> cold
            </span>
          )}
          {standing && (
            <span className="text-primary">
              · <span aria-hidden="true">📌</span> standing
            </span>
          )}
          {snoozed && spark.snooze_until && (
            <span className="text-fg-muted">
              · <span aria-hidden="true">💤</span> until{' '}
              {new Date(spark.snooze_until).toLocaleDateString()}
            </span>
          )}
          {showStatus && !isCold && (
            <span className="rounded border border-border-strong px-1.5 text-fg-muted">
              {promoted ? 'promoted' : spark.status === 'archived' ? 'archived' : 'active'}
            </span>
          )}
        </div>
      </div>


      {/* Quick actions fade in on hover or keyboard focus; their space is
          always reserved, so revealing them never shifts or covers anything.
          Touch keeps them visible, since there is no hover to reveal them. */}
      <div className="flex flex-wrap items-center justify-end gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover/card:opacity-100 sm:group-focus-within/card:opacity-100 sm:pointer-coarse:opacity-100 sm:motion-reduce:transition-none">
        {isCold && onRevive && (
          <button type="button" onClick={onRevive} className={`${action} text-cold-text hover:bg-cold/20`}>
            Revive
          </button>
        )}
        {onUnarchive && (
          <button type="button" onClick={onUnarchive} className={ghost}>
            Unarchive
          </button>
        )}
        {onPromote && (
          <button
            type="button"
            onClick={onPromote}
            title="Record that this became something real"
            className={`${action} text-primary hover:bg-primary/10`}
          >
            Promote
          </button>
        )}
        {snoozed && onUnsnooze && (
          <button type="button" onClick={onUnsnooze} className={ghost}>
            Wake
          </button>
        )}
        {!snoozed && onSnooze && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setSnoozeOpen((v) => !v)}
              aria-expanded={snoozeOpen}
              className={ghost}
            >
              Snooze
            </button>
            {snoozeOpen && (
              <div className="absolute right-0 bottom-full z-20 mb-1 flex flex-col rounded-lg border border-border-strong bg-surface-hover p-1 shadow-lg">
                {SNOOZE_CHOICES.map((c) => (
                  <button
                    key={c.days}
                    type="button"
                    onClick={() => { setSnoozeOpen(false); onSnooze(c.days) }}
                    className="whitespace-nowrap rounded px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface-raised hover:text-fg cursor-pointer"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {onArchive && (
          <button type="button" onClick={onArchive} className={ghost}>
            Archive
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={onEdit} className={ghost}>
            Edit
          </button>
        )}
        {onToggleStanding && (
          <button
            type="button"
            onClick={onToggleStanding}
            aria-pressed={standing}
            aria-label={standing ? 'Put back on the decay clock' : 'Never let this go cold'}
            title={standing ? 'Put back on the decay clock' : 'Never let this go cold'}
            className={`${action} ${standing ? 'bg-primary/15 text-primary' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}`}
          >
            📌
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={onDelete} className={`${action} text-danger hover:bg-danger/10`}>
            Delete
          </button>
        )}
      </div>
      </div>
    </div>
  )
}

// ─── Token gate ───────────────────────────────────────────────────────────────

function TokenGate({
  onToken,
  account,
  onAccount,
}: {
  onToken: (t: string) => void
  account: PublicAccount | null
  onAccount: (a: PublicAccount | null) => void
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [showAccount, setShowAccount] = useState(false)
  // A freshly minted token is held here until the user confirms they've saved
  // it. Generating used to drop them straight into the dashboard having never
  // shown them the one string they cannot afford to lose.
  const [fresh, setFresh] = useState<string | null>(null)

  const generate = () => setFresh(crypto.randomUUID())

  const keepFresh = () => {
    if (!fresh) return
    localStorage.setItem('kindling:token', fresh)
    writeTokenCookie(fresh)
    onToken(fresh)
  }

  const load = () => {
    const t = input.trim()
    if (!UUID_RE.test(t)) {
      setError('That doesn\'t look like a valid Kindling token.')
      return
    }
    localStorage.setItem('kindling:token', t)
    writeTokenCookie(t)
    onToken(t)
  }

  if (fresh) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 bg-bg">
        <div className="w-full max-w-md space-y-5">
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold mb-2 text-primary">
              Save this token
            </h1>
            <p className="text-sm leading-relaxed text-fg-muted">
              It is the credential. Anyone with it can read your sparks; without it, nobody
              can, including you. You can attach an email and password later so Kindling
              remembers it for you — the token itself never changes.
            </p>
          </div>

          <TokenDisplay token={fresh} />

          <p className="text-xs text-fg-subtle text-center">
            Put it in a password manager or a note you&rsquo;ll still have in six months.
          </p>

          <button
            type="button"
            onClick={keepFresh}
            className={`w-full py-3 px-5 min-h-11 text-sm ${BTN_PRIMARY}`}
          >
            I&rsquo;ve saved it — open Kindling →
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 bg-bg">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="font-display text-3xl font-bold mb-2 text-primary">Kindling</h1>
          <p className="text-sm leading-relaxed text-fg-muted">
            Capture sparks before they fade. Surface them before they go cold.
          </p>
        </div>

        {/* The landing page previously explained nothing, so someone arriving
            cold had no idea what they were being given a URL for. */}
        <dl className="space-y-2 text-left text-xs text-fg-muted">
          <div>
            <dt className="inline font-semibold text-fg">A spark </dt>
            <dd className="inline">
              is an idea you&rsquo;ve decided is worth keeping — titled, sorted, and waiting
              for its turn. Not a passing thought (that&rsquo;s what Loose Change is for), and
              not a task.
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold text-fg">Kindling decides </dt>
            <dd className="inline">
              what to show you, ranking by age and neglect, so old ideas resurface instead of
              sinking.
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold text-fg">Connect it to Claude </dt>
            <dd className="inline">
              and you can kindle an idea mid-conversation, or ask what&rsquo;s worth another
              look. The ideas you meant to come back to actually come back.
            </dd>
          </div>
        </dl>

        <div className="space-y-3 text-left">
          <button
            type="button"
            onClick={generate}
            className="w-full py-3 px-5 rounded-xl font-semibold text-sm cursor-pointer bg-primary text-on-primary hover:bg-primary-hover transition-colors"
          >
            Get my Kindling URL →
          </button>

          <p className="text-center text-xs text-fg-subtle">or</p>

          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Paste existing token"
              aria-label="Existing Kindling token"
              className={`flex-1 text-sm px-3 py-2.5 ${INPUT}`}
            />
            <button
              type="button"
              onClick={load}
              className={`px-4 min-h-11 text-sm ${BTN_GHOST}`}
            >
              Load →
            </button>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          {/* Third route in, and deliberately last: an account is optional and
              the two options above still work without one. */}
          <div className="pt-1 text-center">
            <button
              type="button"
              onClick={() => setShowAccount((v) => !v)}
              aria-expanded={showAccount}
              className="text-xs text-fg-subtle underline underline-offset-4 hover:text-fg transition-colors cursor-pointer"
            >
              {showAccount ? 'Hide account options' : 'Or use an email and password'}
            </button>
          </div>

          {showAccount && (
            <AccountPanel
              account={account}
              token={null}
              onAccount={onAccount}
              onClose={() => setShowAccount(false)}
            />
          )}
        </div>
      </div>
    </main>
  )
}

/**
 * 'promoted' is a view, not a status — promoted sparks are archived too. It
 * gets its own tab because "I shipped this" and "I gave up on this" were
 * otherwise indistinguishable in Archived.
 */
const TABS = ['active', 'cold', 'archived', 'promoted'] as const

// ─── Toast ────────────────────────────────────────────────────────────────────

type ToastAction = { label: string; run: () => void }
type ToastState = { message: string; action?: ToastAction }

// ─── Sorting ──────────────────────────────────────────────────────────────────

type SortKey = 'recall' | 'newest' | 'oldest' | 'neglected'

const SORT_LABELS: Record<SortKey, string> = {
  recall: 'Recall score',
  newest: 'Newest',
  oldest: 'Oldest',
  neglected: 'Most neglected',
}

/** Last time a spark was touched at all — surfaced if ever, else created. */
const lastTouched = (s: Spark): number => s.last_surfaced_at ?? s.created_at

const COMPARATORS: Record<SortKey, (a: Spark, b: Spark) => number> = {
  recall: (a, b) => scoreSpark(b) - scoreSpark(a),
  newest: (a, b) => b.created_at - a.created_at,
  oldest: (a, b) => a.created_at - b.created_at,
  neglected: (a, b) => lastTouched(a) - lastTouched(b),
}

// ─── Kind filter ─────────────────────────────────────────────────────────────

/** 'unsorted' finds the sparks captured before kinds existed. */
type KindFilter = SparkKind | 'all' | 'unsorted'

const matchesKind = (s: Spark, k: KindFilter): boolean =>
  k === 'all' ? true : k === 'unsorted' ? !s.kind : s.kind === k

// ─── Dashboard ────────────────────────────────────────────────────────────────

type Tab = (typeof TABS)[number]

/** Which sparks belong in a given tab. */
const inTab = (spark: Spark, tab: Tab): boolean =>
  tab === 'promoted'
    ? isPromoted(spark)
    : spark.status === tab && !(tab === 'archived' && isPromoted(spark))

function Dashboard({
  token,
  account,
  onAccount,
  onSignOut,
  onSwitchToken,
}: {
  token: string
  account: PublicAccount | null
  onAccount: (a: PublicAccount | null) => void
  onSignOut: () => void
  onSwitchToken: (t: string) => void
}) {
  const [view, setView] = useState<View>('sparks')
  const [sparks, setSparks] = useState<Spark[]>([])
  const [tab, setTab] = useState<Tab>('active')
  const [sort, setSort] = useState<SortKey>('recall')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  const [search, setSearch] = useState('')
  const [kindleTitle, setKindleTitle] = useState('')
  const [kindleKind, setKindleKind] = useState<SparkKind | null>(null)
  const [kindleText, setKindleText] = useState('')
  const [kindleHome, setKindleHome] = useState('')
  const [kindleNext, setKindleNext] = useState('')
  const [tagChips, setTagChips] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [composerFocused, setComposerFocused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [kindling, setKindling] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [confirmForget, setConfirmForget] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<Spark | null>(null)
  const [decayDays, setDecayDays] = useState<number>(DECAY_THRESHOLD_DAYS)
  const [editing, setEditing] = useState<Spark | null>(null)
  const [promoting, setPromoting] = useState<Spark | null>(null)
  const [recalled, setRecalled] = useState<Spark[] | null>(null)
  const [recalling, setRecalling] = useState(false)
  // Dismissed spotlight, by spark id — a different spark rising to the top
  // still gets its moment. Lives for this page session only.
  const [spotlightDismissed, setSpotlightDismissed] = useState<string | null>(null)
  // The sort review works over a snapshot, so saving one doesn't reshuffle
  // the queue under the user's hands.
  const [sortQueue, setSortQueue] = useState<Spark[] | null>(null)
  const [sortPromptDismissed, setSortPromptDismissed] = useState(false)
  // The title is the composer's always-mounted field, so it's what `c` focuses.
  const kindleRef = useRef<HTMLInputElement>(null)
  const ideaRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // The origin is only knowable in the browser. Reading window.location straight
  // out of render would have the server and the client disagree about this
  // string the moment the help panel is open — and a hardcoded production
  // fallback would hand a localhost user the wrong URL to copy. The server
  // snapshot is empty and the real origin arrives right after hydration.
  const origin = useSyncExternalStore(subscribeToNothing, browserOrigin, () => '')

  const mcpUrl = `${origin}/${token}/mcp`

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string, action?: ToastAction) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, action })
    // An undoable toast sticks around long enough to actually be clicked.
    toastTimer.current = setTimeout(() => setToast(null), action ? 7000 : 2500)
  }, [])

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const data = await fetchSparks(token)
      setSparks(data)
    } catch {
      // Never fall through to the empty state here. Telling someone their idea
      // store is empty when the fetch simply failed is the worst possible lie
      // for this particular app.
      setLoadError("Couldn't load your sparks. This is a connection problem, not an empty store.")
    } finally {
      setLoading(false)
    }
  }, [token])

  // load() clears the error state synchronously before fetching, and a
  // client-side store read on mount has nowhere else to live.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  // Opens itself once, for someone who has just been handed an MCP URL and no
  // idea what to do with it. Never again after that — see ND anti-pattern #8.
  useEffect(() => {
    try {
      if (!localStorage.getItem('kindling:seen-help')) {
        // localStorage is unreadable during SSR, so this cannot move into a
        // state initializer.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setView('connect')
        localStorage.setItem('kindling:seen-help', '1')
      }
    } catch {
      /* private mode: just don't auto-open */
    }
  }, [])

  // The tab title follows the view, so a row of browser tabs says where each
  // one is. Restored on unmount, which is the token gate.
  useEffect(() => {
    const labels: Record<View, string> = {
      sparks: 'Sparks',
      stats: 'Stats',
      connect: 'Connect',
      help: 'Help',
      account: 'Account',
    }
    document.title = `${labels[view]} · Kindling`
    return () => {
      document.title = 'Kindling'
    }
  }, [view])

  useEffect(() => {
    fetchPrefs(token)
      .then((p) => setDecayDays(p.decayThresholdDays))
      .catch(() => { /* defaults are fine; the dashboard still works */ })
  }, [token])

  /**
   * "Capture it before it fades" was the product promise and it cost a mouse
   * trip. Kept to three keys — a full palette is its own thing.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement

      if (e.key === 'Escape' && typing) {
        ;(el as HTMLElement).blur()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      // Both fields live in the Sparks view, so the shortcut takes you there
      // first and focuses once it has rendered.
      if (e.key === 'c') {
        e.preventDefault()
        setView('sparks')
        requestAnimationFrame(() => kindleRef.current?.focus())
      } else if (e.key === '/') {
        e.preventDefault()
        setView('sparks')
        requestAnimationFrame(() => searchRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Grow the idea box with its content rather than scrolling inside 3 rows.
  useEffect(() => {
    const el = ideaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [kindleText, composerFocused])

  // At rest the composer is one line; it opens on focus (click, tab or `c`)
  // and folds back only once it is both empty and blurred, so a half-written
  // thought never disappears behind a collapse.
  const composerOpen =
    composerFocused ||
    [kindleTitle, kindleText, kindleHome, kindleNext, tagDraft].some((v) => v.length > 0) ||
    kindleKind !== null ||
    tagChips.length > 0

  const canKindle = Boolean(kindleTitle.trim() && kindleKind && kindleText.trim())

  const commitTagDraft = (raw: string) => {
    const next = normalizeTags([...tagChips, ...raw.split(',')])
    setTagChips(next)
    setTagDraft('')
  }

  const handleKindle = async () => {
    if (!canKindle || !kindleKind || kindling) return
    const tags = normalizeTags([...tagChips, ...tagDraft.split(',')])
    setKindling(true)
    try {
      const spark = await kindleApi(token, {
        title: kindleTitle.trim(),
        kind: kindleKind,
        content: kindleText.trim(),
        ...(kindleHome.trim() ? { home: kindleHome.trim() } : {}),
        ...(kindleNext.trim() ? { next_step: kindleNext.trim() } : {}),
        tags,
      })
      setSparks((prev) => [spark, ...prev])
      setKindleTitle('')
      setKindleKind(null)
      setKindleText('')
      setKindleHome('')
      setKindleNext('')
      setTagChips([])
      setTagDraft('')
      showToast('Spark kindled.')
      kindleRef.current?.focus()
    } catch {
      showToast('Failed to kindle — try again.')
    } finally {
      setKindling(false)
    }
  }

  /**
   * Optimistic status change with rollback. The previous version updated local
   * state and toasted success whether or not the write landed, so a failed
   * PATCH left the user looking at a change that had not happened.
   */
  const changeStatus = useCallback(
    async (spark: Spark, next: SparkStatus, message: string, undoable = true) => {
      const apply = (status: SparkStatus) =>
        setSparks((prev) =>
          prev.map((s) =>
            s.id === spark.id
              ? { ...s, status, ...(status === 'active' ? { cold_at: null } : {}) }
              : s
          )
        )

      /**
       * One optimistic hop with rollback. Undo is the same hop in reverse, so
       * it goes through here too rather than recursing back into changeStatus
       * — which referenced itself before its own declaration.
       */
      const transition = async (to: SparkStatus, from: SparkStatus): Promise<boolean> => {
        apply(to)
        try {
          await setStatusApi(token, spark.id, to)
          return true
        } catch {
          apply(from)
          showToast(`Couldn't save that change — the spark is still ${from}.`)
          return false
        }
      }

      const previous = spark.status
      if (!(await transition(next, previous))) return

      showToast(
        message,
        undoable
          ? {
              label: 'Undo',
              run: () => {
                dismissToast()
                void transition(previous, next).then((done) => {
                  if (done) showToast('Undone.')
                })
              },
            }
          : undefined
      )
    },
    [token, showToast, dismissToast]
  )

  const handleArchive = (spark: Spark) => changeStatus(spark, 'archived', 'Archived.')

  const handleRevive = (spark: Spark) =>
    changeStatus(spark, 'active', 'Spark revived — back in the fire.')

  const handleUnarchive = (spark: Spark) =>
    changeStatus(spark, 'active', 'Unarchived — back in the fire.')

  const handleDelete = async (spark: Spark) => {
    setConfirmDelete(null)
    const previous = sparks
    setSparks((prev) => prev.filter((s) => s.id !== spark.id))
    try {
      await deleteApi(token, spark.id)
      // Deliberately no Undo: the record is gone, so offering one would lie.
      showToast('Deleted permanently.')
    } catch {
      setSparks(previous)
      showToast("Couldn't delete that — the spark is still here.")
    }
  }

  const handleSnooze = async (spark: Spark, days: number) => {
    // Only ever called from a click handler; the rule cannot tell that apart
    // from the component body.
    // eslint-disable-next-line react-hooks/purity
    const until = Date.now() + days * 86_400_000
    const previous = sparks
    setSparks((prev) =>
      prev.map((s) => (s.id === spark.id ? { ...s, snooze_until: until } : s))
    )
    try {
      await patchSparkApi(token, spark.id, { snooze_until: until })
      showToast(`Snoozed for ${days} day${days === 1 ? '' : 's'}.`, {
        label: 'Undo',
        run: () => { dismissToast(); void handleUnsnooze(spark) },
      })
    } catch {
      setSparks(previous)
      showToast("Couldn't snooze that.")
    }
  }

  const handleUnsnooze = async (spark: Spark) => {
    const previous = sparks
    setSparks((prev) => prev.map((s) => (s.id === spark.id ? { ...s, snooze_until: null } : s)))
    try {
      await patchSparkApi(token, spark.id, { snooze_until: null })
    } catch {
      setSparks(previous)
      showToast("Couldn't wake that spark.")
    }
  }

  /** "I looked at this" — the clock reset recall applies, for one spark. */
  const handleSurface = async (spark: Spark) => {
    const previous = sparks
    setSparks((prev) =>
      prev.map((s) =>
        s.id === spark.id
          ? { ...s, last_surfaced_at: Date.now(), surface_count: s.surface_count + 1 }
          : s
      )
    )
    try {
      const saved = await surfaceApi(token, spark.id)
      setSparks((prev) => prev.map((s) => (s.id === saved.id ? saved : s)))
      showToast('Back in the fire — its clock is reset.')
    } catch {
      setSparks(previous)
      showToast("Couldn't revive that.")
    }
  }

  const handleToggleStanding = async (spark: Spark) => {
    const next = !isStanding(spark)
    const previous = sparks
    setSparks((prev) => prev.map((s) => (s.id === spark.id ? { ...s, standing: next } : s)))
    try {
      await patchSparkApi(token, spark.id, { standing: next })
      showToast(next ? 'Standing — this one will never go cold.' : 'Back on the decay clock.')
    } catch {
      setSparks(previous)
      showToast("Couldn't change that.")
    }
  }

  /**
   * A store-wide rewrite, so it re-reads rather than patching local state by
   * hand. A plain rename is reversible; a merge is not, because afterwards
   * nothing records which spark carried which tag — so Undo is offered only
   * for the reversible case, scoped to exactly the sparks that changed.
   */
  const handleRenameTag = async (from: string, to: string) => {
    try {
      const { changed, merged } = await renameTagApi(token, from, to)
      if (changed.length === 0) {
        showToast('Nothing to rename.')
        return
      }
      await load()
      const what = `${changed.length} spark${changed.length === 1 ? '' : 's'}`
      if (merged) {
        showToast(`Merged into "${to}" across ${what}.`)
        return
      }
      showToast(`Renamed to "${to}" across ${what}.`, {
        label: 'Undo',
        run: () => {
          dismissToast()
          void renameTagApi(token, to, from, changed)
            .then(load)
            .catch(() => showToast("Couldn't undo that rename."))
        },
      })
    } catch {
      showToast("Couldn't rename that tag.")
    }
  }

  /**
   * Also a store-wide rewrite, so it re-reads too. Unlike a merge this is
   * always undoable: nothing is conflated, so putting the tag back on exactly
   * the sparks that lost it restores the previous state precisely.
   */
  const handleRemoveTag = async (tag: string) => {
    try {
      const { changed } = await removeTagApi(token, tag)
      if (changed.length === 0) {
        showToast('Nothing to remove.')
        return
      }
      await load()
      const what = `${changed.length} spark${changed.length === 1 ? '' : 's'}`
      showToast(`Removed "${tag}" from ${what}.`, {
        label: 'Undo',
        run: () => {
          dismissToast()
          void restoreTagApi(token, tag, changed)
            .then(load)
            .catch(() => showToast("Couldn't undo that removal."))
        },
      })
    } catch {
      showToast("Couldn't remove that tag.")
    }
  }

  const handleDecayChange = async (days: number) => {
    const previous = decayDays
    setDecayDays(days)
    try {
      await savePrefs(token, days)
      showToast(`Sparks now go cold after ${days} days.`)
    } catch {
      setDecayDays(previous)
      showToast("Couldn't save that setting.")
    }
  }

  const handleEdit = async (
    spark: Spark,
    patch: SparkEdit
  ) => {
    setEditing(null)
    const previous = sparks
    setSparks((prev) => prev.map((s) => (s.id === spark.id ? { ...s, ...patch } : s)))
    try {
      await patchSparkApi(token, spark.id, patch)
      showToast('Spark updated.')
    } catch {
      setSparks(previous)
      showToast("Couldn't save that edit.")
    }
  }

  /** One step of the sort review. Quiet on success — the dialog moving on is the feedback. */
  const handleSort = async (spark: Spark, patch: SortPatch) => {
    const previous = sparks
    setSparks((prev) => prev.map((s) => (s.id === spark.id ? { ...s, ...patch } : s)))
    try {
      await patchSparkApi(token, spark.id, patch)
    } catch {
      setSparks(previous)
      showToast(`Couldn't save "${displayTitle(spark)}" — it's still unsorted.`)
    }
  }

  const handlePromote = async (spark: Spark, target: string, notes: string | null) => {
    setPromoting(null)
    const previous = sparks
    setSparks((prev) =>
      prev.map((s) =>
        s.id === spark.id
          ? {
              ...s,
              promoted_to: target,
              promoted_at: Date.now(),
              promoted_notes: notes,
              status: 'archived' as SparkStatus,
            }
          : s
      )
    )
    try {
      const saved = await promoteApi(token, spark.id, target, notes)
      // Take the server's record, so promoted_at is its clock rather than ours.
      setSparks((prev) => prev.map((s) => (s.id === saved.id ? saved : s)))
      showToast(`Promoted → ${target}`)
    } catch {
      setSparks(previous)
      showToast("Couldn't promote that.")
    }
  }

  /** Recall mutates, so this is an explicit action rather than a passive view. */
  const handleRecall = async () => {
    setRecalling(true)
    try {
      const picked = await recallApi(token, 5)
      setRecalled(picked)
      if (picked.length === 0) showToast('Nothing active to recall right now.')
      // Surfacing changed counts and clocks server-side; re-read so the
      // dashboard's ranking reflects it.
      await load()
    } catch {
      showToast("Couldn't recall right now.")
    } finally {
      setRecalling(false)
    }
  }

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Archiving thirty sparks was thirty clicks and thirty toasts. */
  const archiveSelected = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    const previous = sparks
    setSparks((prev) =>
      prev.map((s) => (selected.has(s.id) ? { ...s, status: 'archived' as SparkStatus } : s))
    )
    setSelected(new Set())
    try {
      const archived = await batchArchiveApi(token, ids)
      showToast(`Archived ${archived.length} spark${archived.length === 1 ? '' : 's'}.`, {
        label: 'Undo',
        run: async () => {
          dismissToast()
          setSparks(previous)
          await Promise.all(archived.map((id) => setStatusApi(token, id, 'active')))
        },
      })
    } catch {
      setSparks(previous)
      showToast("Couldn't archive those — nothing was changed.")
    }
  }

  const knownTags = tagCounts(sparks).map((t) => t.tag)
  const knownHomes = Array.from(
    new Set(sparks.map((s) => s.home?.trim()).filter((h): h is string => Boolean(h)))
  ).sort((a, b) => a.localeCompare(b))

  const query = search.trim().toLowerCase()
  const matchesQuery = (s: Spark) =>
    !query ||
    s.content.toLowerCase().includes(query) ||
    (s.title ?? '').toLowerCase().includes(query) ||
    (s.home ?? '').toLowerCase().includes(query) ||
    (s.next_step ?? '').toLowerCase().includes(query) ||
    (s.tags ?? []).some((t) => t.toLowerCase().includes(query))

  // Searching looks everywhere. Scoping search to the open tab meant "I know I
  // wrote this down" -> nothing -> conclude it's lost, when it was one tab over.
  const exactHits = query ? sparks.filter(matchesQuery) : []
  // Same rule as MCP search: fall back to fuzzy only when exact finds nothing.
  const fuzzyFallback = query && exactHits.length === 0
  const unfiltered = query
    ? fuzzyFallback
      ? sparks.filter((s) => fuzzyMatches(s, query))
      : exactHits
    : sparks.filter((s) => inTab(s, tab))

  // Kind narrows whatever the tab or search produced, and counts against it.
  const kindCounts = (k: KindFilter): number => unfiltered.filter((s) => matchesKind(s, k)).length

  const filtered = unfiltered
    .filter((s) => matchesKind(s, kindFilter))
    // Redis hash order means nothing to a reader. Ranking by recall score is
    // the whole premise of the product, so it is also the default here.
    .sort(COMPARATORS[sort])

  const searching = query.length > 0

  // Raw statuses for the sidebar — promoted sparks count as archived there,
  // since that is what they are; the tab view splits them out.
  const statusCounts = {
    active: sparks.filter((s) => s.status === 'active').length,
    cold: sparks.filter((s) => s.status === 'cold').length,
    archived: sparks.filter((s) => s.status === 'archived').length,
  }

  // Orientation for the top of the list. All derived from the array already
  // in hand — no extra request.
  // eslint-disable-next-line react-hooks/purity -- sparks only render after a client fetch
  const weekAgo = Date.now() - 7 * 86_400_000
  const surfacedThisWeek = sparks.filter((s) => (s.last_surfaced_at ?? 0) >= weekAgo).length

  // The spark recall would pick first. Shown passively — looking at the
  // dashboard doesn't count as surfacing it; Revive does.
  const spotlight =
    sparks
      .filter((s) => s.status === 'active' && !isSnoozed(s))
      .sort((a, b) => scoreSpark(b, undefined, decayDays) - scoreSpark(a, undefined, decayDays))[0] ??
    null
  const showSpotlight = spotlight !== null && spotlight.id !== spotlightDismissed

  // Concluded sparks (archived, promoted) aren't worth a sorting pass.
  const unsorted = sparks.filter((s) => !s.kind && s.status !== 'archived')

  const counts = Object.fromEntries(
    TABS.map((t) => [t, sparks.filter((s) => inTab(s, t)).length])
  ) as Record<Tab, number>

  /** Arrow/Home/End move between tabs, per the WAI-ARIA tabs pattern. */
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    }
    const next = moves[e.key]
    if (next === undefined) return
    e.preventDefault()
    const target = TABS[next]
    setTab(target)
    tabRefs.current[target]?.focus()
  }

  const tabLabel = (t: Tab): string => {
    const labels: Record<Tab, string> = {
      active: 'Active',
      cold: 'Cold',
      archived: 'Archived',
      promoted: 'Promoted',
    }
    return labels[t]
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      {editing && (
        <EditSparkDialog
          spark={editing}
          knownTags={knownTags}
          knownHomes={knownHomes}
          onCancel={() => setEditing(null)}
          onSave={(patch) => void handleEdit(editing, patch)}
        />
      )}

      {sortQueue && (
        <SortDialog
          queue={sortQueue}
          onSave={(spark, patch) => void handleSort(spark, patch)}
          onClose={() => setSortQueue(null)}
        />
      )}

      {promoting && (
        <PromoteDialog
          spark={promoting}
          onCancel={() => setPromoting(null)}
          onPromote={(target, notes) => void handlePromote(promoting, target, notes)}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteDialog
          spark={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleDelete(confirmDelete)}
        />
      )}

      {confirmForget && (
        <ForgetTokenDialog
          token={token}
          onCancel={() => setConfirmForget(false)}
          onConfirm={() => { setConfirmForget(false); onSignOut() }}
        />
      )}

      {/* Toast. role=status so changes are announced; only pointer-events-none
          when there is nothing to click, or the Undo button would be dead. */}
      <div
        role="status"
        aria-live="polite"
        className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex justify-center px-4"
      >
        {toast && (
          <div
            className={`flex items-center gap-3 text-sm px-4 py-2 rounded-lg bg-surface-raised border border-border-strong text-fg ${
              toast.action ? '' : 'pointer-events-none'
            }`}
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={toast.action.run}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary text-on-primary hover:bg-primary-hover transition-colors cursor-pointer"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex min-h-screen">
      <Sidebar
        view={view}
        onView={setView}
        exportHref={`/api/sparks?token=${token}&format=markdown`}
        account={account}
        onClearToken={() => setConfirmForget(true)}
        counts={statusCounts}
        token={token}
        onSwitchToken={onSwitchToken}
      />

      <div className="flex-1 min-w-0 pb-20 md:pb-0">
      <div className="max-w-5xl mx-auto px-5 md:px-8 py-6 md:py-8 space-y-6">

        {/* The wordmark lives in the sidebar on desktop; small screens get it here. */}
        <p className="md:hidden font-display text-2xl font-bold tracking-tight text-primary">
          Kindling
        </p>

        {view === 'stats' &&
          (sparks.length > 0 ? (
            <StatsPanel
              sparks={sparks}
              decayDays={decayDays}
              onDecayChange={(d) => void handleDecayChange(d)}
              onRenameTag={handleRenameTag}
              onRemoveTag={handleRemoveTag}
              onClose={() => setView('sparks')}
            />
          ) : (
            <p className="py-12 text-center text-sm text-fg-subtle">
              {loading ? 'Loading your sparks…' : 'No sparks yet — stats appear once you capture one.'}
            </p>
          ))}

        {(view === 'connect' || view === 'help') && (
          <HelpPanel
            section={view === 'connect' ? 'connect' : 'how'}
            mcpUrl={mcpUrl}
            token={token}
            onClose={() => setView('sparks')}
          />
        )}

        {view === 'account' && (
          <>
            <AccountPanel
              account={account}
              token={token}
              onAccount={onAccount}
              onClose={() => setView('sparks')}
              onSwitchToken={onSwitchToken}
            />
            {/* The sidebar carries this on desktop; the bottom bar has no room. */}
            {!account && (
              <button
                type="button"
                onClick={() => setConfirmForget(true)}
                className="md:hidden text-xs text-fg-subtle underline underline-offset-4 hover:text-fg transition-colors cursor-pointer"
              >
                Clear token from this browser
              </button>
            )}
          </>
        )}

        {view === 'sparks' && (
        <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.2em] text-fg-subtle">
              Overview
            </p>
            <h1 className="font-display text-2xl font-bold text-fg">Sparks</h1>
          </div>
          <button
            type="button"
            onClick={() => void handleRecall()}
            disabled={recalling}
            title="Show the sparks most in need of attention"
            className={`text-xs px-3 min-h-11 disabled:opacity-50 ${BTN_GHOST}`}
          >
            {recalling ? 'Recalling…' : 'Recall 5'}
          </button>
        </div>

        {/* The one-time sort for sparks from before kinds existed. Goes away
            on its own once nothing live is unsorted. */}
        {!loading && unsorted.length > 0 && !sortPromptDismissed && !searching && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-2.5">
            <p className="text-sm text-fg-muted">
              <span className="font-mono text-fg">{unsorted.length}</span> spark
              {unsorted.length === 1 ? ' has' : 's have'} no kind yet — from before kinds existed.
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setSortPromptDismissed(true)}
                className={`text-xs px-3 min-h-9 pointer-coarse:min-h-11 ${BTN_GHOST}`}
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => setSortQueue(unsorted.slice().sort(COMPARATORS.newest))}
                className={`text-xs px-3 min-h-9 pointer-coarse:min-h-11 ${BTN_GHOST}`}
              >
                Sort them →
              </button>
            </div>
          </div>
        )}

        {/* At a glance: the counts, then the one spark recall would pick. */}
        {!loading && !loadError && sparks.length > 0 && !searching && (
          <div className={`grid gap-3 ${showSpotlight ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : ''}`}>
            <dl className="grid grid-cols-4 divide-x divide-border rounded-xl border border-border bg-surface">
              {[
                { label: 'Active', value: statusCounts.active },
                { label: 'Cold', value: statusCounts.cold },
                { label: 'Surfaced 7d', value: surfacedThisWeek },
                { label: 'Promoted', value: counts.promoted },
              ].map((stat) => (
                <div key={stat.label} className="flex flex-col justify-center gap-0.5 px-3 py-3">
                  <dd className="font-mono text-xl leading-none text-fg">{stat.value}</dd>
                  <dt className="text-[0.6875rem] text-fg-subtle">{stat.label}</dt>
                </div>
              ))}
            </dl>

            {showSpotlight && spotlight && (
              <section
                aria-label="Worth another look"
                className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-surface px-4 py-3 shadow-[inset_3px_0_0_var(--color-cold)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-fg-subtle">
                    Worth another look
                  </p>
                  <button
                    type="button"
                    onClick={() => setSpotlightDismissed(spotlight.id)}
                    aria-label="Dismiss for now"
                    className="rounded px-1.5 text-sm leading-none text-fg-subtle hover:text-fg cursor-pointer"
                  >
                    ×
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">{displayTitle(spotlight)}</p>
                    <p className="font-mono text-[0.6875rem] text-fg-subtle">
                      captured {relativeAge(spotlight.created_at)} ·{' '}
                      {spotlight.surface_count === 0
                        ? 'never surfaced'
                        : `last seen ${relativeAge(spotlight.last_surfaced_at ?? spotlight.created_at)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleSurface(spotlight)}
                      title="Mark it seen — resets its decay clock"
                      className={`text-xs px-2.5 min-h-8 pointer-coarse:min-h-11 ${BTN_GHOST}`}
                    >
                      Revive
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSnooze(spotlight, 7)}
                      title="Snooze for a week"
                      className={`text-xs px-2.5 min-h-8 pointer-coarse:min-h-11 ${BTN_GHOST}`}
                    >
                      Snooze
                    </button>
                    <button
                      type="button"
                      onClick={() => handleArchive(spotlight)}
                      className={`text-xs px-2.5 min-h-8 pointer-coarse:min-h-11 ${BTN_GHOST}`}
                    >
                      Archive
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* Recall results. Kept as a distinct panel rather than reordering the
            list, so it's clear these are the ones the algorithm picked — and
            that showing them reset their clocks. */}
        {recalled && recalled.length > 0 && (
          <section
            aria-label="Recalled sparks"
            className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold text-fg">
                  Most in need of attention
                </h2>
                <p className="text-xs text-fg-subtle">
                  Ranked by age, neglect and how rarely they&rsquo;ve surfaced. Showing them
                  resets their decay clocks.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRecalled(null)}
                className="text-xs text-fg-subtle hover:text-fg transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
            <div className="space-y-3">
              {recalled.map((spark) => (
                <SparkCard
                  key={`recalled-${spark.id}`}
                  spark={spark}
                  decayDays={decayDays}
                  onEdit={() => setEditing(spark)}
                  onPromote={!isPromoted(spark) ? () => setPromoting(spark) : undefined}
                  onArchive={() => handleArchive(spark)}
                  onSnooze={(d) => void handleSnooze(spark, d)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Kindle input */}
        <div
          onFocus={() => setComposerFocused(true)}
          onBlur={(e) => {
            // Moving focus between the composer's own fields is not leaving it.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setComposerFocused(false)
          }}
          className={`rounded-2xl border bg-surface transition-colors motion-reduce:transition-none ${
            composerOpen ? 'border-border-strong p-4 space-y-3 shadow-lg' : 'border-border px-4 py-2.5'
          }`}
        >
          <input
            ref={kindleRef}
            value={kindleTitle}
            onChange={(e) => setKindleTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleKindle()
            }}
            placeholder={composerOpen ? 'Title' : "What's the idea? Capture it before it fades…"}
            aria-label="Spark title"
            maxLength={200}
            className={`block w-full bg-transparent text-fg outline-none placeholder:text-fg-subtle ${
              composerOpen ? 'text-lg font-semibold' : 'text-base'
            }`}
          />
          {composerOpen && (
            <>
              {/* One tap, not a dropdown. Required, like the title and idea. */}
              <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1.5">
                {SPARK_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kindleKind === k}
                    onClick={() => setKindleKind((cur) => (cur === k ? null : k))}
                    className={`rounded-md border px-2.5 min-h-8 pointer-coarse:min-h-11 text-xs transition-colors cursor-pointer ${
                      kindleKind === k
                        ? 'border-primary/60 bg-primary/15 text-primary font-semibold'
                        : 'border-border-strong text-fg-muted hover:bg-surface-hover hover:text-fg'
                    }`}
                  >
                    {KIND_LABELS[k]}
                  </button>
                ))}
              </div>

              <textarea
                ref={ideaRef}
                value={kindleText}
                onChange={(e) => setKindleText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleKindle()
                }}
                placeholder="The idea — markdown welcome"
                aria-label="The idea"
                rows={3}
                className={`block w-full resize-none overflow-y-auto px-3 py-2 text-[0.9375rem] leading-relaxed ${INPUT}`}
              />

              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={kindleHome}
                  onChange={(e) => setKindleHome(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleKindle()
                  }}
                  placeholder="Home (optional) — where it lives"
                  aria-label="Home (optional)"
                  list="known-homes"
                  maxLength={120}
                  className={`text-xs px-3 py-2 ${INPUT}`}
                />
                <datalist id="known-homes">
                  {knownHomes.map((h) => (
                    <option key={h} value={h} />
                  ))}
                </datalist>
                <input
                  value={kindleNext}
                  onChange={(e) => setKindleNext(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleKindle()
                  }}
                  placeholder="Next step (optional) — one line"
                  aria-label="Next step (optional)"
                  maxLength={300}
                  className={`text-xs px-3 py-2 ${INPUT}`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Chip input: Enter or comma commits, Backspace on an empty
                    draft takes the last chip back. */}
                <div className={`flex flex-1 min-w-48 flex-wrap items-center gap-1 px-2 py-1.5 ${INPUT}`}>
                  {tagChips.map((t) => (
                    <span
                      key={t}
                      className="flex items-center gap-1 rounded-md bg-tag-bg pl-1.5 pr-0.5 py-0.5 text-[0.6875rem] leading-none text-tag-fg"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => setTagChips((prev) => prev.filter((x) => x !== t))}
                        aria-label={`Remove tag ${t}`}
                        className="rounded px-1 text-fg-subtle hover:text-fg cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v.includes(',')) commitTagDraft(v)
                      else setTagDraft(v)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        void handleKindle()
                      } else if (e.key === 'Enter') {
                        e.preventDefault()
                        if (tagDraft.trim()) commitTagDraft(tagDraft)
                      } else if (e.key === 'Backspace' && tagDraft === '' && tagChips.length > 0) {
                        e.preventDefault()
                        setTagChips((prev) => prev.slice(0, -1))
                      }
                    }}
                    placeholder={tagChips.length ? 'Add tag' : 'Tags'}
                    aria-label="Add a tag (Enter or comma to add)"
                    list="known-tags"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="flex-1 min-w-20 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
                  />
                </div>
                {/* Suggests tags already in use, so the taxonomy stops fragmenting
                    into writing / Writing / write across three sessions. */}
                <datalist id="known-tags">
                  {knownTags
                    .filter((t) => !tagChips.includes(t))
                    .map((t) => (
                      <option key={t} value={t} />
                    ))}
                </datalist>
                <button
                  type="button"
                  onClick={() => void handleKindle()}
                  disabled={!canKindle}
                  aria-busy={kindling}
                  title={canKindle ? undefined : 'Needs a title, a kind and the idea'}
                  className={`text-sm px-5 min-h-11 ${BTN_PRIMARY}`}
                >
                  {kindling ? 'Kindling…' : 'Kindle'}
                </button>
              </div>
              <p className="font-mono text-[0.6875rem] text-fg-subtle">
                ⌘↵ to submit · <kbd>c</kbd> to capture · <kbd>/</kbd> to search · <kbd>Esc</kbd> to
                leave a field
              </p>
            </>
          )}
        </div>

        {/* Search */}
        <div className="space-y-1.5">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sparks…"
            aria-label="Search sparks (searches every status)"
            className={`w-full text-sm px-4 py-2.5 rounded-xl ${INPUT}`}
          />
          {searching && (
            <p className="text-xs text-fg-subtle" role="status">
              {filtered.length} result{filtered.length === 1 ? '' : 's'} across all statuses
              {fuzzyFallback && filtered.length > 0 && ' (no exact match — showing close ones)'}
            </p>
          )}
        </div>

        {/* Bulk selection bar */}
        {selected.size > 0 && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2"
          >
            <span className="text-xs text-fg">
              {selected.size} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs px-3 min-h-11 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={archiveSelected}
                className={`text-xs px-4 min-h-11 ${BTN_GHOST}`}
              >
                Archive selected
              </button>
            </div>
          </div>
        )}

        {/* Tabs + sort */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Spark status"
            className="flex flex-1 sm:flex-none rounded-lg border border-border bg-surface p-1"
          >
            {TABS.map((t, i) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`tab-${t}`}
                aria-selected={tab === t}
                aria-controls="spark-panel"
                // Roving tabindex: one stop for the whole group, arrows move within.
                tabIndex={tab === t ? 0 : -1}
                ref={(el) => { tabRefs.current[t] = el }}
                onClick={() => setTab(t)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={`flex flex-1 sm:flex-none items-center justify-center gap-1.5 text-xs px-3 min-h-9 pointer-coarse:min-h-11 rounded-md cursor-pointer transition-colors ${
                  tab === t
                    ? 'bg-surface-hover text-fg font-semibold shadow-sm'
                    : 'text-fg-muted hover:text-fg'
                }`}
              >
                {tabLabel(t)}
                <span className="font-mono text-[0.6875rem] text-fg-subtle">{counts[t]}</span>
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs text-fg-subtle">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className={`text-xs px-2 min-h-11 cursor-pointer ${INPUT}`}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Kind filter. A filter, not navigation, so no ember: the active chip
            just steps up a surface. Kinds with nothing in view are hidden. */}
        {unfiltered.length > 0 && (
          <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
            {(['all', ...SPARK_KINDS, 'unsorted'] as KindFilter[])
              .filter((k) => k === 'all' || k === kindFilter || kindCounts(k) > 0)
              .map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  aria-pressed={kindFilter === k}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 min-h-8 pointer-coarse:min-h-11 text-xs transition-colors cursor-pointer ${
                    kindFilter === k
                      ? 'border-border-strong bg-surface-hover text-fg font-semibold'
                      : 'border-border text-fg-muted hover:text-fg'
                  }`}
                >
                  {k === 'all' ? 'All kinds' : k === 'unsorted' ? 'Unsorted' : KIND_LABELS[k]}
                  <span className="font-mono text-[0.6875rem] text-fg-subtle">{kindCounts(k)}</span>
                </button>
              ))}
          </div>
        )}

        {/* Sparks list */}
        <div id="spark-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {loading ? (
          <p className="text-sm py-8 text-center text-fg-subtle">Loading your sparks…</p>
        ) : loadError ? (
          <div className="py-12 text-center space-y-3" role="alert">
            <p className="text-sm font-medium text-danger">{loadError}</p>
            <button
              type="button"
              onClick={() => { setLoading(true); void load() }}
              className={`text-sm px-4 py-2.5 min-h-11 ${BTN_GHOST}`}
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 && unfiltered.length > 0 ? (
          <p className="text-sm py-8 text-center text-fg-subtle">Nothing of that kind here.</p>
        ) : filtered.length === 0 ? (
          <EmptyState tab={tab} hasSearch={searching} />
        ) : (
          <div className="space-y-2">
            {filtered.map((spark) => (
              <SparkCard
                key={spark.id}
                spark={spark}
                decayDays={decayDays}
                onArchive={spark.status !== 'archived' ? () => handleArchive(spark) : undefined}
                onRevive={spark.status === 'cold' ? () => handleRevive(spark) : undefined}
                onUnarchive={spark.status === 'archived' ? () => handleUnarchive(spark) : undefined}
                showStatus={searching}
                selected={selected.has(spark.id)}
                onToggleSelected={() => toggleSelected(spark.id)}
                onDelete={() => setConfirmDelete(spark)}
                onEdit={() => setEditing(spark)}
                onPromote={!isPromoted(spark) ? () => setPromoting(spark) : undefined}
                onToggleStanding={() => void handleToggleStanding(spark)}
                onSnooze={
                  spark.status === 'active' ? (d) => void handleSnooze(spark, d) : undefined
                }
                onUnsnooze={() => void handleUnsnooze(spark)}
              />
            ))}
          </div>
        )}
        </div>
        </>
        )}
      </div>
      </div>
      </div>
    </main>
  )
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function EmptyState({ tab, hasSearch }: { tab: Tab; hasSearch: boolean }) {
  if (hasSearch) {
    return (
      <p className="text-sm py-8 text-center text-fg-subtle">
        No sparks match that search.
      </p>
    )
  }

  const messages: Record<Tab, { heading: string; sub: string }> = {
    active: {
      heading: 'No active sparks yet.',
      sub: 'Capture one above — give it a title, pick a kind, and say what the idea is.',
    },
    cold: {
      heading: 'Nothing has gone cold.',
      sub: 'Sparks with no interaction for 180 days move here automatically.',
    },
    archived: {
      heading: 'Nothing archived.',
      sub: 'Sparks you let go of land here. Promoted ones get their own tab.',
    },
    promoted: {
      heading: 'Nothing promoted yet.',
      sub: 'When a spark becomes a project, a draft, or a decision, promote it — this is where you see that it happened.',
    },
  }

  const { heading, sub } = messages[tab]

  return (
    <div className="py-12 text-center space-y-2">
      <p className="text-sm font-medium text-fg-muted">{heading}</p>
      <p className="text-xs text-fg-subtle">{sub}</p>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

/**
 * `initialToken` and `initialAccount` are resolved by the server component in
 * page.tsx, so the first paint is already the correct screen. This used to
 * hold a `ready` flag and return null until a localStorage effect had run,
 * which meant the server sent an empty body and every load flashed blank.
 *
 * An account, when there is one, only decides WHICH token is in play. It is
 * never a gate: a token with no account behind it works exactly as before.
 */
export function KindlingApp({
  initialToken,
  initialAccount,
}: {
  initialToken: string | null
  initialAccount: PublicAccount | null
}) {
  const [token, setToken] = useState<string | null>(initialToken)
  const [account, setAccount] = useState<PublicAccount | null>(initialAccount)

  /**
   * Adopts a token saved before the cookie existed. Only runs when the server
   * found neither a session nor a cookie, so for everyone else this is a
   * no-op and there is no flash. Users migrating this way see the gate for
   * one paint, once.
   */
  useEffect(() => {
    if (initialToken) return
    const saved = localStorage.getItem('kindling:token')
    if (!saved || !UUID_RE.test(saved)) return
    writeTokenCookie(saved)
    // localStorage is unreadable during SSR, so this cannot be an initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(saved)
  }, [initialToken])

  const adopt = (t: string) => setToken(t)

  /**
   * Signing in or out repoints this browser at the account's token. The
   * localStorage copy is deliberately never rewritten, so a token that lives
   * only in this browser cannot be lost by using an account.
   */
  /** Moves this browser into one of the account's namespaces. */
  const switchToken = (t: string) => {
    writeTokenCookie(t)
    setToken(t)
  }

  const onAccount = (next: PublicAccount | null) => {
    setAccount(next)
    if (next) {
      // Account edits (rename, add, make default) leave this browser where it
      // is; only signing in from elsewhere, or unlinking the namespace it's
      // in, moves it — to the account's default.
      if (!token || !next.tokens.some((t) => t.token === token)) switchToken(next.token)
      return
    }
    // Signed out. Fall back to whatever this browser remembers on its own.
    let saved: string | null = null
    try {
      saved = localStorage.getItem('kindling:token')
    } catch {
      /* private mode */
    }
    if (saved && UUID_RE.test(saved)) {
      writeTokenCookie(saved)
      setToken(saved)
    } else {
      clearTokenCookie()
      setToken(null)
    }
  }

  const signOut = () => {
    localStorage.removeItem('kindling:token')
    clearTokenCookie()
    setToken(null)
  }

  if (!token) return <TokenGate onToken={adopt} account={account} onAccount={onAccount} />

  return (
    // Keyed by token: switching namespaces is a fresh dashboard, not a
    // half-updated one still holding the other namespace's selection.
    <Dashboard
      key={token}
      token={token}
      onSwitchToken={switchToken}
      account={account}
      onAccount={onAccount}
      onSignOut={signOut}
    />
  )
}
