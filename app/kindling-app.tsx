'use client'

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import type { Spark, SparkStatus } from '@/lib/types'
import {
  DECAY_THRESHOLD_DAYS,
  absoluteDate,
  contentExtent,
  displayTitle,
  isLongContent,
  fuzzyMatches,
  isPromoted,
  isSnoozed,
  isStanding,
  normalizeTags,
  relativeAge,
  scoreSpark,
  tagCounts,
} from '@/lib/spark-utils'
import { Markdown } from '@/components/markdown'
import { BTN_GHOST, BTN_PRIMARY, INPUT, UUID_RE } from '@/components/ui'
import { TokenDisplay } from '@/components/token-display'
import { ForgetTokenDialog } from '@/components/forget-token-dialog'
import { StatsPanel } from '@/components/stats-panel'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { EditSparkDialog, PromoteDialog } from '@/components/spark-dialog'
import { HelpPanel } from '@/components/help-panel'
import { clearTokenCookie, writeTokenCookie } from '@/lib/token-cookie'
import { AccountPanel, type PublicAccount } from '@/components/account-panel'

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

async function kindleApi(token: string, content: string, tags: string[]): Promise<Spark> {
  const res = await fetch(`/api/sparks?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, tags }),
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
}) {
  const isCold = spark.status === 'cold'
  const promoted = isPromoted(spark)
  const snoozed = isSnoozed(spark)
  const standing = isStanding(spark)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const tags = spark.tags ?? []
  const long = isLongContent(spark.content)
  const [expanded, setExpanded] = useState(false)
  const bodyId = `spark-body-${spark.id}`

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-3 transition-colors ${
        isCold
          ? 'bg-surface border-cold/40'
          : promoted
            ? 'bg-surface border-primary/40'
            : 'bg-surface border-border'
      }`}
    >
      {onToggleSelected && (
        <label className="flex items-center gap-2 text-xs text-fg-subtle cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={onToggleSelected}
            className="size-4 accent-[var(--color-primary)] cursor-pointer"
          />
          <span className="sr-only">Select this spark</span>
        </label>
      )}

      {/* Content. Long sparks collapse behind their title so a list of them
          stays scannable; short ones are their own title and render whole. */}
      {long ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className="group flex items-start gap-2 text-left cursor-pointer"
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 text-xs text-fg-subtle transition-transform ${expanded ? 'rotate-90' : ''}`}
            >
              ▶
            </span>
            <span className="flex-1 font-display text-sm font-semibold leading-snug text-fg group-hover:text-primary transition-colors">
              {displayTitle(spark)}
            </span>
          </button>

          {expanded ? (
            <div id={bodyId} className="pl-5">
              <Markdown>{spark.content}</Markdown>
            </div>
          ) : (
            <p id={bodyId} className="pl-5 text-xs text-fg-subtle">
              {contentExtent(spark.content)} — click to expand
            </p>
          )}
        </div>
      ) : (
        <Markdown>{spark.content}</Markdown>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 rounded-full bg-tag-bg text-tag-fg border border-cold/60"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Promotion record. The whole point of the system, and until now it was
          written to Redis and never read back anywhere. */}
      {promoted && (
        <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
          <p className="text-fg">
            <span aria-hidden="true">✦</span> Became{' '}
            <strong className="font-semibold text-primary">{spark.promoted_to}</strong>
            {spark.promoted_at && (
              <span className="text-fg-muted"> · {relativeAge(spark.promoted_at)}</span>
            )}
          </p>
          {spark.promoted_notes && (
            <p className="mt-1 text-fg-muted italic">{spark.promoted_notes}</p>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-3 text-xs text-fg-subtle">
          <span title={absoluteDate(spark.created_at)}>
            Captured {relativeAge(spark.created_at)}
          </span>
          {spark.surface_count > 0 && (
            <span
              title={
                spark.last_surfaced_at ? absoluteDate(spark.last_surfaced_at) : undefined
              }
            >
              Surfaced {spark.surface_count}×
              {spark.last_surfaced_at && `, last ${relativeAge(spark.last_surfaced_at)}`}
            </span>
          )}
          {isCold && (
            <span className="flex items-center gap-1 text-cold-text">
              <span aria-hidden="true">❄</span> Gone cold
            </span>
          )}
          {standing && (
            <span className="flex items-center gap-1 text-primary">
              <span aria-hidden="true">📌</span> Standing
            </span>
          )}
          {snoozed && spark.snooze_until && (
            <span className="flex items-center gap-1 text-fg-muted">
              <span aria-hidden="true">💤</span> Snoozed until{' '}
              {new Date(spark.snooze_until).toLocaleDateString()}
            </span>
          )}
          {showStatus && !isCold && (
            <span className="rounded-full border border-border px-2 py-0.5 text-fg-muted">
              {promoted ? 'Promoted' : spark.status === 'archived' ? 'Archived' : 'Active'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isCold && onRevive && (
            <button
              type="button"
              onClick={onRevive}
              className="text-xs px-3 min-h-11 rounded-lg bg-cold/15 text-cold-text border border-cold/40 hover:bg-cold/25 transition-colors cursor-pointer"
            >
              Revive
            </button>
          )}
          {onUnarchive && (
            <button
              type="button"
              onClick={onUnarchive}
              className={`text-xs px-3 min-h-11 ${BTN_GHOST}`}
            >
              Unarchive
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className={`text-xs px-3 min-h-11 ${BTN_GHOST}`}
            >
              Edit
            </button>
          )}
          {onPromote && (
            <button
              type="button"
              onClick={onPromote}
              title="Record that this became something real"
              className="text-xs px-3 min-h-11 rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
            >
              Promote
            </button>
          )}
          {onToggleStanding && (
            <button
              type="button"
              onClick={onToggleStanding}
              aria-pressed={standing}
              title={standing ? 'Put back on the decay clock' : 'Never let this go cold'}
              className={`text-xs px-3 min-h-11 rounded-lg border transition-colors cursor-pointer ${
                standing
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-surface text-fg-muted hover:text-fg'
              }`}
            >
              📌
            </button>
          )}
          {snoozed && onUnsnooze && (
            <button
              type="button"
              onClick={onUnsnooze}
              className={`text-xs px-3 min-h-11 ${BTN_GHOST}`}
            >
              Wake
            </button>
          )}
          {!snoozed && onSnooze && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setSnoozeOpen((v) => !v)}
                aria-expanded={snoozeOpen}
                className={`text-xs px-3 min-h-11 ${BTN_GHOST}`}
              >
                Snooze
              </button>
              {snoozeOpen && (
                <div className="absolute right-0 bottom-full z-10 mb-1 flex flex-col rounded-lg border border-border-strong bg-surface-raised p-1">
                  {SNOOZE_CHOICES.map((c) => (
                    <button
                      key={c.days}
                      type="button"
                      onClick={() => { setSnoozeOpen(false); onSnooze(c.days) }}
                      className="whitespace-nowrap rounded px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface hover:text-fg cursor-pointer"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-xs px-3 min-h-11 rounded-lg border border-danger/40 text-danger hover:bg-danger/10 transition-colors cursor-pointer"
            >
              Delete
            </button>
          )}
          {onArchive && (
            <button
              type="button"
              onClick={onArchive}
              className={`text-xs px-3 min-h-11 ${BTN_GHOST}`}
            >
              Archive
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
              is a thought worth keeping but not worth doing yet — an idea, an aside, a
              half-formed connection.
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
              and it can capture a stray idea mid-conversation without being asked. That&rsquo;s
              the part a notes app can&rsquo;t do.
            </dd>
          </div>
        </dl>

        <div className="space-y-3 text-left">
          <button
            type="button"
            onClick={generate}
            className="w-full py-3 px-5 rounded-xl font-semibold text-sm cursor-pointer bg-primary text-on-primary hover:bg-primary-hover hover:text-fg transition-colors"
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
}: {
  token: string
  account: PublicAccount | null
  onAccount: (a: PublicAccount | null) => void
  onSignOut: () => void
}) {
  const [showAccount, setShowAccount] = useState(false)
  const [sparks, setSparks] = useState<Spark[]>([])
  const [tab, setTab] = useState<Tab>('active')
  const [sort, setSort] = useState<SortKey>('recall')
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  const [search, setSearch] = useState('')
  const [kindleText, setKindleText] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [kindling, setKindling] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [mcpCopied, setMcpCopied] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<Spark | null>(null)
  const [decayDays, setDecayDays] = useState<number>(DECAY_THRESHOLD_DAYS)
  const [editing, setEditing] = useState<Spark | null>(null)
  const [promoting, setPromoting] = useState<Spark | null>(null)
  const [recalled, setRecalled] = useState<Spark[] | null>(null)
  const [recalling, setRecalling] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const kindleRef = useRef<HTMLTextAreaElement>(null)
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
        setShowHelp(true)
        localStorage.setItem('kindling:seen-help', '1')
      }
    } catch {
      /* private mode: just don't auto-open */
    }
  }, [])

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

      if (e.key === 'c') {
        e.preventDefault()
        kindleRef.current?.focus()
      } else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Grow the capture box with its content rather than scrolling inside 3 rows.
  useEffect(() => {
    const el = kindleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [kindleText])

  const handleKindle = async () => {
    if (!kindleText.trim()) return
    const tags = normalizeTags(tagInput.split(','))
    setKindling(true)
    try {
      const spark = await kindleApi(token, kindleText.trim(), tags)
      setSparks((prev) => [spark, ...prev])
      setKindleText('')
      setTagInput('')
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
    patch: { title: string | null; content: string; tags: string[] }
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

  const copyMcp = () => {
    navigator.clipboard.writeText(mcpUrl)
    setMcpCopied(true)
    setTimeout(() => setMcpCopied(false), 2000)
  }

  const knownTags = tagCounts(sparks).map((t) => t.tag)

  const query = search.trim().toLowerCase()
  const matchesQuery = (s: Spark) =>
    !query ||
    s.content.toLowerCase().includes(query) ||
    (s.title ?? '').toLowerCase().includes(query) ||
    (s.tags ?? []).some((t) => t.toLowerCase().includes(query))

  // Searching looks everywhere. Scoping search to the open tab meant "I know I
  // wrote this down" -> nothing -> conclude it's lost, when it was one tab over.
  const exactHits = query ? sparks.filter(matchesQuery) : []
  // Same rule as MCP search: fall back to fuzzy only when exact finds nothing.
  const fuzzyFallback = query && exactHits.length === 0
  const filtered = (
    query
      ? fuzzyFallback
        ? sparks.filter((s) => fuzzyMatches(s, query))
        : exactHits
      : sparks.filter((s) => inTab(s, tab))
  )
    // Redis hash order means nothing to a reader. Ranking by recall score is
    // the whole premise of the product, so it is also the default here.
    .sort(COMPARATORS[sort])

  const searching = query.length > 0

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
    return `${labels[t]} ${counts[t] > 0 ? `(${counts[t]})` : ''}`
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      {editing && (
        <EditSparkDialog
          spark={editing}
          knownTags={knownTags}
          onCancel={() => setEditing(null)}
          onSave={(patch) => void handleEdit(editing, patch)}
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
                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary text-on-primary hover:bg-primary-hover hover:text-fg transition-colors cursor-pointer"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-5 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-bold text-primary">Kindling</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRecall()}
              disabled={recalling}
              title="Show the sparks most in need of attention"
              className="text-xs px-3 min-h-11 rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {recalling ? 'Recalling…' : 'Recall'}
            </button>
            <button
              type="button"
              onClick={() => setShowStats((v) => !v)}
              aria-expanded={showStats}
              className="text-xs px-3 min-h-11 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer"
            >
              Stats
            </button>
            <a
              href={`/api/sparks?token=${token}&format=markdown`}
              download
              className="text-xs px-3 min-h-11 inline-flex items-center rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer"
              title="Download every spark as a markdown file"
            >
              Export
            </a>
            <button
              type="button"
              onClick={() => { copyMcp(); setShowHelp(true) }}
              aria-expanded={showHelp}
              title="Copy your MCP URL and show how to connect it"
              className="text-xs px-3 min-h-11 rounded-lg bg-cold/15 border border-cold/40 text-cold-text hover:bg-cold/25 transition-colors cursor-pointer"
            >
              {mcpCopied ? 'Copied ✓' : 'Connect'}
            </button>
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              aria-expanded={showHelp}
              className="text-xs px-3 min-h-11 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer"
            >
              Help
            </button>
            <button
              type="button"
              onClick={() => setShowAccount((v) => !v)}
              aria-expanded={showAccount}
              title={account ? `Signed in as ${account.email}` : 'Save your token to an account'}
              className="text-xs px-3 min-h-11 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer"
            >
              {account ? 'Account' : 'Save token'}
            </button>
            {/* Only meaningful for a browser holding a token on its own — with
                an account there is something to come back to. */}
            {!account && (
              <button
                type="button"
                onClick={() => setConfirmForget(true)}
                className="text-xs px-3 min-h-11 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer"
              >
                Clear token
              </button>
            )}
          </div>
        </div>

        {showHelp && (
          <HelpPanel mcpUrl={mcpUrl} token={token} onClose={() => setShowHelp(false)} />
        )}

        {showAccount && (
          <AccountPanel
            account={account}
            token={token}
            onAccount={onAccount}
            onClose={() => setShowAccount(false)}
          />
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
                  onEdit={() => setEditing(spark)}
                  onPromote={!isPromoted(spark) ? () => setPromoting(spark) : undefined}
                  onArchive={() => handleArchive(spark)}
                  onSnooze={(d) => void handleSnooze(spark, d)}
                />
              ))}
            </div>
          </section>
        )}

        {showStats && sparks.length > 0 && (
          <StatsPanel
            sparks={sparks}
            decayDays={decayDays}
            onDecayChange={(d) => void handleDecayChange(d)}
            onRenameTag={handleRenameTag}
            onClose={() => setShowStats(false)}
          />
        )}

        {/* Kindle input */}
        <div className="rounded-xl p-4 space-y-3 bg-surface border border-border">
          <textarea
            ref={kindleRef}
            value={kindleText}
            onChange={(e) => setKindleText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleKindle()
            }}
            placeholder="What's on your mind? Capture it before it fades…"
            aria-label="Capture a spark"
            rows={3}
            className="w-full text-sm outline-none resize-none overflow-y-auto leading-relaxed bg-transparent text-fg placeholder:text-fg-subtle"
          />
          <div className="flex gap-2 items-center">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Tags (comma-separated)"
              aria-label="Tags, comma separated"
              list="known-tags"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={`flex-1 text-xs px-3 py-2 ${INPUT}`}
            />
            {/* Suggests tags already in use, so the taxonomy stops fragmenting
                into writing / Writing / write across three sessions. */}
            <datalist id="known-tags">
              {knownTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={handleKindle}
              disabled={kindling || !kindleText.trim()}
              className="text-sm font-semibold px-4 min-h-11 rounded-lg cursor-pointer bg-primary text-on-primary hover:bg-primary-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-primary disabled:hover:text-on-primary transition-colors"
            >
              {kindling ? 'Kindling…' : 'Kindle'}
            </button>
          </div>
          <p className="text-xs text-fg-subtle">
            ⌘↵ to submit · <kbd>c</kbd> to capture · <kbd>/</kbd> to search · <kbd>Esc</kbd> to
            leave a field
          </p>
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
          <div role="tablist" aria-label="Spark status" className="flex gap-1">
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
                className={`text-xs px-3 min-h-11 rounded-lg cursor-pointer border transition-colors ${
                  tab === t
                    ? 'bg-primary/15 text-primary border-primary/40 font-semibold underline underline-offset-4'
                    : 'bg-transparent text-fg-subtle border-transparent hover:text-fg-muted'
                }`}
              >
                {tabLabel(t)}
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
        ) : filtered.length === 0 ? (
          <EmptyState tab={tab} hasSearch={searching} />
        ) : (
          <div className="space-y-3">
            {filtered.map((spark) => (
              <SparkCard
                key={spark.id}
                spark={spark}
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
      sub: 'Capture something above — an idea, a link, a half-formed thought.',
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
  const onAccount = (next: PublicAccount | null) => {
    setAccount(next)
    if (next) {
      writeTokenCookie(next.token)
      setToken(next.token)
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
    <Dashboard
      token={token}
      account={account}
      onAccount={onAccount}
      onSignOut={signOut}
    />
  )
}
