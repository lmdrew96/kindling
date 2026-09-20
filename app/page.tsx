'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Spark, SparkStatus } from '@/lib/types'
import { contentExtent, displayTitle, isLongContent, scoreSpark } from '@/lib/spark-utils'
import { Markdown } from '@/components/markdown'
import { BTN_GHOST, BTN_PRIMARY, INPUT, UUID_RE } from '@/components/ui'
import { TokenDisplay } from '@/components/token-display'
import { ForgetTokenDialog } from '@/components/forget-token-dialog'

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

function daysSince(ms: number): string {
  const days = Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function SparkCard({
  spark,
  onArchive,
  onRevive,
  onUnarchive,
}: {
  spark: Spark
  onArchive?: () => void
  onRevive?: () => void
  onUnarchive?: () => void
}) {
  const isCold = spark.status === 'cold'
  const tags = spark.tags ?? []
  const long = isLongContent(spark.content)
  const [expanded, setExpanded] = useState(false)
  const bodyId = `spark-body-${spark.id}`

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-3 transition-colors ${
        isCold ? 'bg-surface border-cold/40' : 'bg-surface border-border'
      }`}
    >
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

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-3 text-xs text-fg-subtle">
          <span>Captured {daysSince(spark.created_at)}</span>
          {spark.surface_count > 0 && <span>Surfaced {spark.surface_count}×</span>}
          {isCold && (
            <span className="flex items-center gap-1 text-cold-text">
              <span aria-hidden="true">❄</span> Gone cold
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

function TokenGate({ onToken }: { onToken: (t: string) => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  // A freshly minted token is held here until the user confirms they've saved
  // it. Generating used to drop them straight into the dashboard having never
  // shown them the one string they cannot afford to lose.
  const [fresh, setFresh] = useState<string | null>(null)

  const generate = () => setFresh(crypto.randomUUID())

  const keepFresh = () => {
    if (!fresh) return
    localStorage.setItem('kindling:token', fresh)
    onToken(fresh)
  }

  const load = () => {
    const t = input.trim()
    if (!UUID_RE.test(t)) {
      setError('That doesn\'t look like a valid Kindling token.')
      return
    }
    localStorage.setItem('kindling:token', t)
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
              It <strong className="text-fg">is</strong> your account — no email, no password,
              no recovery. Anyone with it can read your sparks; without it, nobody can,
              including you.
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
        </div>
      </div>
    </main>
  )
}

const TABS = ['active', 'cold', 'archived'] as const

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

type Tab = SparkStatus

function Dashboard({ token, onSignOut }: { token: string; onSignOut: () => void }) {
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
  const kindleRef = useRef<HTMLTextAreaElement>(null)

  const mcpUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/${token}/mcp`
    : `https://kindling.adhdesigns.dev/${token}/mcp`

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

  useEffect(() => { load() }, [load])

  const handleKindle = async () => {
    if (!kindleText.trim()) return
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean)
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
      const previous = spark.status
      const apply = (status: SparkStatus) =>
        setSparks((prev) =>
          prev.map((s) =>
            s.id === spark.id
              ? { ...s, status, ...(status === 'active' ? { cold_at: null } : {}) }
              : s
          )
        )

      apply(next)
      try {
        await setStatusApi(token, spark.id, next)
        showToast(
          message,
          undoable
            ? {
                label: 'Undo',
                run: () => {
                  dismissToast()
                  void changeStatus(
                    { ...spark, status: next },
                    previous,
                    'Undone.',
                    false
                  )
                },
              }
            : undefined
        )
      } catch {
        apply(previous)
        showToast(`Couldn't save that change — the spark is still ${previous}.`)
      }
    },
    [token, showToast, dismissToast]
  )

  const handleArchive = (spark: Spark) => changeStatus(spark, 'archived', 'Archived.')

  const handleRevive = (spark: Spark) =>
    changeStatus(spark, 'active', 'Spark revived — back in the fire.')

  const handleUnarchive = (spark: Spark) =>
    changeStatus(spark, 'active', 'Unarchived — back in the fire.')

  const copyMcp = () => {
    navigator.clipboard.writeText(mcpUrl)
    setMcpCopied(true)
    setTimeout(() => setMcpCopied(false), 2000)
  }

  const filtered = sparks
    .filter((s) => s.status === tab)
    .filter((s) =>
      !search || s.content.toLowerCase().includes(search.toLowerCase()) ||
      (s.tags ?? []).some((t) => t.toLowerCase().includes(search.toLowerCase()))
    )
    // Redis hash order means nothing to a reader. Ranking by recall score is
    // the whole premise of the product, so it is also the default here.
    .sort(COMPARATORS[sort])

  const counts: Record<Tab, number> = {
    active: sparks.filter((s) => s.status === 'active').length,
    cold: sparks.filter((s) => s.status === 'cold').length,
    archived: sparks.filter((s) => s.status === 'archived').length,
  }

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
    const labels: Record<Tab, string> = { active: 'Active', cold: 'Cold', archived: 'Archived' }
    return `${labels[t]} ${counts[t] > 0 ? `(${counts[t]})` : ''}`
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
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
              onClick={copyMcp}
              className="text-xs px-3 min-h-11 rounded-lg bg-cold/15 border border-cold/40 text-cold-text hover:bg-cold/25 transition-colors cursor-pointer"
            >
              {mcpCopied ? 'Copied ✓' : 'Copy MCP URL'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmForget(true)}
              className="text-xs px-3 min-h-11 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer"
            >
              Clear token
            </button>
          </div>
        </div>

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
            className="w-full text-sm outline-none resize-none leading-relaxed bg-transparent text-fg placeholder:text-fg-subtle"
          />
          <div className="flex gap-2 items-center">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Tags (comma-separated)"
              aria-label="Tags, comma separated"
              className={`flex-1 text-xs px-3 py-2 ${INPUT}`}
            />
            <button
              type="button"
              onClick={handleKindle}
              disabled={kindling || !kindleText.trim()}
              className="text-sm font-semibold px-4 min-h-11 rounded-lg cursor-pointer bg-primary text-on-primary hover:bg-primary-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-primary disabled:hover:text-on-primary transition-colors"
            >
              {kindling ? 'Kindling…' : 'Kindle'}
            </button>
          </div>
          <p className="text-xs text-fg-subtle">⌘↵ to submit</p>
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sparks…"
          aria-label="Search sparks"
          className={`w-full text-sm px-4 py-2.5 rounded-xl ${INPUT}`}
        />

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
          <EmptyState tab={tab} hasSearch={!!search} />
        ) : (
          <div className="space-y-3">
            {filtered.map((spark) => (
              <SparkCard
                key={spark.id}
                spark={spark}
                onArchive={spark.status !== 'archived' ? () => handleArchive(spark) : undefined}
                onRevive={spark.status === 'cold' ? () => handleRevive(spark) : undefined}
                onUnarchive={spark.status === 'archived' ? () => handleUnarchive(spark) : undefined}
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
      sub: 'Sparks you archive or promote land here.',
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

export default function Home() {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('kindling:token')
    if (saved) setToken(saved)
    setReady(true)
  }, [])

  const signOut = () => {
    localStorage.removeItem('kindling:token')
    setToken(null)
  }

  if (!ready) return null

  if (!token) return <TokenGate onToken={setToken} />

  return <Dashboard token={token} onSignOut={signOut} />
}
