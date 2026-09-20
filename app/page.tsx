'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Spark, SparkStatus } from '@/lib/types'

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

async function archiveApi(token: string, id: string): Promise<void> {
  await fetch(`/api/sparks?token=${token}&id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'archived' }),
  })
}

async function reviveApi(token: string, id: string): Promise<void> {
  await fetch(`/api/sparks?token=${token}&id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active', cold_at: null }),
  })
}

// ─── Shared class strings ────────────────────────────────────────────────────

const INPUT =
  'rounded-lg bg-surface border border-border text-fg placeholder:text-fg-subtle outline-none focus:border-border-strong transition-colors'

const BTN_GHOST =
  'rounded-lg bg-surface border border-border text-fg-muted hover:bg-surface-raised hover:text-fg transition-colors cursor-pointer'

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
}: {
  spark: Spark
  onArchive?: () => void
  onRevive?: () => void
}) {
  const isCold = spark.status === 'cold'
  const tags = spark.tags ?? []

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-3 transition-colors ${
        isCold ? 'bg-surface border-cold/40' : 'bg-surface border-border'
      }`}
    >
      {/* Content */}
      <p className="text-sm leading-relaxed text-fg">{spark.content}</p>

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
              className="text-xs px-2.5 py-1 rounded-lg bg-cold/15 text-cold-text border border-cold/40 hover:bg-cold/25 transition-colors cursor-pointer"
            >
              Revive
            </button>
          )}
          {onArchive && (
            <button
              type="button"
              onClick={onArchive}
              className={`text-xs px-2.5 py-1 ${BTN_GHOST}`}
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
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  const generate = () => {
    const t = crypto.randomUUID()
    localStorage.setItem('kindling:token', t)
    onToken(t)
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
              className={`px-4 text-sm ${BTN_GHOST}`}
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

type Tab = SparkStatus

function Dashboard({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [sparks, setSparks] = useState<Spark[]>([])
  const [tab, setTab] = useState<Tab>('active')
  const [search, setSearch] = useState('')
  const [kindleText, setKindleText] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [kindling, setKindling] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [mcpCopied, setMcpCopied] = useState(false)
  const kindleRef = useRef<HTMLTextAreaElement>(null)

  const mcpUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/${token}/mcp`
    : `https://kindling.adhdesigns.dev/${token}/mcp`

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const load = useCallback(async () => {
    try {
      const data = await fetchSparks(token)
      setSparks(data)
    } catch {
      showToast('Failed to load sparks — check your connection.')
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

  const handleArchive = async (spark: Spark) => {
    await archiveApi(token, spark.id)
    setSparks((prev) => prev.map((s) => s.id === spark.id ? { ...s, status: 'archived' } : s))
    showToast('Archived.')
  }

  const handleRevive = async (spark: Spark) => {
    await reviveApi(token, spark.id)
    setSparks((prev) => prev.map((s) => s.id === spark.id ? { ...s, status: 'active', cold_at: null } : s))
    showToast('Spark revived — back in the fire.')
  }

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

  const counts: Record<Tab, number> = {
    active: sparks.filter((s) => s.status === 'active').length,
    cold: sparks.filter((s) => s.status === 'cold').length,
    archived: sparks.filter((s) => s.status === 'archived').length,
  }

  const tabLabel = (t: Tab): string => {
    const labels: Record<Tab, string> = { active: 'Active', cold: 'Cold', archived: 'Archived' }
    return `${labels[t]} ${counts[t] > 0 ? `(${counts[t]})` : ''}`
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-lg z-50 pointer-events-none bg-surface-raised border border-border-strong text-fg">
          {toast}
        </div>
      )}

      <div className="max-w-2xl mx-auto px-5 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-bold text-primary">Kindling</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyMcp}
              className="text-xs px-3 py-1.5 rounded-lg bg-cold/15 border border-cold/40 text-cold-text hover:bg-cold/25 transition-colors cursor-pointer"
            >
              {mcpCopied ? 'Copied ✓' : 'Copy MCP URL'}
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="text-xs px-3 py-1.5 rounded-lg text-fg-subtle hover:text-fg transition-colors cursor-pointer"
            >
              Switch token
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
              className="text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer bg-primary text-on-primary hover:bg-primary-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-primary disabled:hover:text-on-primary transition-colors"
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

        {/* Tabs */}
        <div className="flex gap-1">
          {(['active', 'cold', 'archived'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`text-xs px-3 py-1.5 rounded-lg cursor-pointer border transition-colors ${
                tab === t
                  ? 'bg-primary/15 text-primary border-primary/40 font-semibold'
                  : 'bg-transparent text-fg-subtle border-transparent hover:text-fg-muted'
              }`}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>

        {/* Sparks list */}
        {loading ? (
          <p className="text-sm py-8 text-center text-fg-subtle">Loading your sparks…</p>
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
              />
            ))}
          </div>
        )}
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
