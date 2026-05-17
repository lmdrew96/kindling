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

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3 transition-opacity"
      style={{
        background: isCold ? 'rgba(139,189,185,0.04)' : 'rgba(255,255,255,0.03)',
        borderColor: isCold ? 'rgba(139,189,185,0.18)' : 'rgba(255,255,255,0.07)',
      }}
    >
      {/* Content */}
      <p className="text-sm leading-relaxed" style={{ color: '#F7F5FA' }}>
        {spark.content}
      </p>

      {/* Tags */}
      {spark.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {spark.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(136,115,158,0.18)', color: '#88739E', border: '1px solid rgba(136,115,158,0.25)' }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-3 text-xs" style={{ color: 'rgba(247,245,250,0.3)' }}>
          <span>Captured {daysSince(spark.created_at)}</span>
          {spark.surface_count > 0 && <span>Surfaced {spark.surface_count}×</span>}
          {isCold && (
            <span className="flex items-center gap-1" style={{ color: '#8CBDB9' }}>
              ❄ Gone cold
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isCold && onRevive && (
            <button
              onClick={onRevive}
              className="text-xs px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              style={{ background: 'rgba(139,189,185,0.12)', color: '#8CBDB9', border: '1px solid rgba(139,189,185,0.2)' }}
            >
              Revive
            </button>
          )}
          {onArchive && (
            <button
              onClick={onArchive}
              className="text-xs px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(247,245,250,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}
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
    <main className="flex min-h-screen items-center justify-center px-6" style={{ background: '#1E1830' }}>
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: '#DFA649' }}>Kindling</h1>
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(247,245,250,0.4)' }}>
            Capture sparks before they fade. Surface them before they go cold.
          </p>
        </div>

        <div className="space-y-3 text-left">
          <button
            onClick={generate}
            className="w-full py-3 px-5 rounded-xl font-semibold text-sm cursor-pointer transition-colors"
            style={{ background: '#DFA649', color: '#1E1830' }}
          >
            Get my Kindling URL →
          </button>

          <p className="text-center text-xs" style={{ color: 'rgba(247,245,250,0.2)' }}>or</p>

          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Paste existing token"
              className="flex-1 rounded-lg text-sm px-3 py-2.5 outline-none"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(247,245,250,0.1)',
                color: '#F7F5FA',
              }}
            />
            <button
              onClick={load}
              className="px-4 rounded-lg text-sm cursor-pointer"
              style={{
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(247,245,250,0.1)',
                color: '#F7F5FA',
              }}
            >
              Load →
            </button>
          </div>

          {error && (
            <p className="text-xs" style={{ color: '#ff9090' }}>{error}</p>
          )}
        </div>
      </div>
    </main>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

type Tab = 'active' | 'cold' | 'archived'

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
      s.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
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
    <main className="min-h-screen" style={{ background: '#1E1830', color: '#F7F5FA' }}>
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-lg z-50 pointer-events-none"
          style={{ background: 'rgba(30,24,48,0.95)', border: '1px solid rgba(247,245,250,0.12)', color: '#F7F5FA' }}
        >
          {toast}
        </div>
      )}

      <div className="max-w-2xl mx-auto px-5 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold" style={{ color: '#DFA649' }}>Kindling</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={copyMcp}
              className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
              style={{ background: 'rgba(139,189,185,0.1)', border: '1px solid rgba(139,189,185,0.2)', color: '#8CBDB9' }}
            >
              {mcpCopied ? 'Copied ✓' : 'Copy MCP URL'}
            </button>
            <button
              onClick={onSignOut}
              className="text-xs cursor-pointer"
              style={{ color: 'rgba(247,245,250,0.2)', background: 'none', border: 'none' }}
            >
              Switch token
            </button>
          </div>
        </div>

        {/* Kindle input */}
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <textarea
            ref={kindleRef}
            value={kindleText}
            onChange={(e) => setKindleText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleKindle()
            }}
            placeholder="What's on your mind? Capture it before it fades…"
            rows={3}
            className="w-full text-sm outline-none resize-none leading-relaxed"
            style={{ background: 'transparent', color: '#F7F5FA' }}
          />
          <div className="flex gap-2 items-center">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Tags (comma-separated)"
              className="flex-1 text-xs px-3 py-2 rounded-lg outline-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: 'rgba(247,245,250,0.6)',
              }}
            />
            <button
              onClick={handleKindle}
              disabled={kindling || !kindleText.trim()}
              className="text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer transition-opacity disabled:opacity-40"
              style={{ background: '#DFA649', color: '#1E1830' }}
            >
              {kindling ? 'Kindling…' : 'Kindle'}
            </button>
          </div>
          <p className="text-xs" style={{ color: 'rgba(247,245,250,0.18)' }}>
            ⌘↵ to submit
          </p>
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sparks…"
          className="w-full text-sm px-4 py-2.5 rounded-xl outline-none"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            color: '#F7F5FA',
          }}
        />

        {/* Tabs */}
        <div className="flex gap-1">
          {(['active', 'cold', 'archived'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
              style={{
                background: tab === t ? 'rgba(223,166,73,0.15)' : 'transparent',
                color: tab === t ? '#DFA649' : 'rgba(247,245,250,0.35)',
                border: tab === t ? '1px solid rgba(223,166,73,0.25)' : '1px solid transparent',
              }}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>

        {/* Sparks list */}
        {loading ? (
          <p className="text-sm py-8 text-center" style={{ color: 'rgba(247,245,250,0.3)' }}>
            Loading your sparks…
          </p>
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
      <p className="text-sm py-8 text-center" style={{ color: 'rgba(247,245,250,0.3)' }}>
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
      <p className="text-sm font-medium" style={{ color: 'rgba(247,245,250,0.5)' }}>{heading}</p>
      <p className="text-xs" style={{ color: 'rgba(247,245,250,0.25)' }}>{sub}</p>
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
