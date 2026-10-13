'use client'

import { useEffect, useRef, useState } from 'react'
import type { Spark } from '@/lib/types'
import { displayTitle } from '@/lib/spark-utils'
import { Markdown } from './markdown'
import { BTN_GHOST, BTN_PRIMARY, INPUT } from './ui'

type Turn = { role: 'assistant' | 'user'; content: string }
type Proposal = { writeup: string; next_step: string }

/** Short by design: past this the dialog suggests wrapping up, never forces it. */
const SESSION_MS = 15 * 60_000

async function developApi(
  token: string,
  sparkId: string,
  mode: 'ask' | 'finish',
  history: Turn[]
): Promise<{ question?: string } & Partial<Proposal>> {
  const res = await fetch(`/api/develop?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spark_id: sparkId, mode, history }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Try again.')
  return data
}

const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * "Develop this": Claude asks one question at a time about a spark, then
 * proposes a new write-up and next step. Nothing touches the spark until the
 * user reviews the proposal and presses Save.
 *
 * Deliberately not built on Shell: Escape and a stray backdrop click close
 * Shell, and either would throw away a half-finished session. Leaving here is
 * always an explicit button.
 */
export function DevelopDialog({
  token,
  spark,
  onSave,
  onClose,
}: {
  token: string
  spark: Spark
  onSave: (content: string, nextStep: string | null) => void
  onClose: () => void
}) {
  const [history, setHistory] = useState<Turn[]>([])
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState<'ask' | 'finish' | null>('ask')
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  // Dev mode runs mount effects twice; one session should ask one first question.
  const started = useRef(false)

  const ask = async (turns: Turn[]) => {
    try {
      const { question } = await developApi(token, spark.id, 'ask', turns)
      setHistory([...turns, { role: 'assistant', content: question ?? '' }])
      setBusy(null)
      requestAnimationFrame(() => {
        answerRef.current?.focus()
        endRef.current?.scrollIntoView({ block: 'nearest' })
      })
    } catch (e) {
      setBusy(null)
      setError({ message: (e as Error).message, retry: () => { setError(null); setBusy('ask'); void ask(turns) } })
    }
  }

  const finish = async (turns: Turn[]) => {
    setError(null)
    setBusy('finish')
    try {
      const result = await developApi(token, spark.id, 'finish', turns)
      setProposal({ writeup: result.writeup ?? '', next_step: result.next_step ?? '' })
    } catch (e) {
      setError({ message: (e as Error).message, retry: () => void finish(turns) })
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void ask([])
    // ask is recreated each render; this runs once per session by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const send = () => {
    const text = answer.trim()
    if (!text || busy) return
    const turns: Turn[] = [...history, { role: 'user', content: text }]
    setHistory(turns)
    setAnswer('')
    setBusy('ask')
    void ask(turns)
  }

  // An answer still in the box counts: stopping shouldn't drop the last thing said.
  const wrapUp = () => {
    const text = answer.trim()
    const turns: Turn[] = text ? [...history, { role: 'user', content: text }] : history
    setHistory(turns)
    setAnswer('')
    void finish(turns)
  }

  const elapsed = now - startedAt
  const overTime = elapsed >= SESSION_MS
  const answered = history.some((t) => t.role === 'user') || answer.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-5 py-10">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="develop-title"
        className="flex max-h-full w-full max-w-xl flex-col gap-4 rounded-xl border border-border-strong bg-surface p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="develop-title" className="font-display text-lg font-bold text-fg">
              Develop this
            </h2>
            <p className="truncate text-xs text-fg-muted">{displayTitle(spark)}</p>
          </div>
          {!proposal && (
            <p
              className={`shrink-0 font-mono text-xs ${overTime ? 'text-primary' : 'text-fg-subtle'}`}
              aria-label={`${clock(elapsed)} of 15 minutes`}
            >
              {clock(elapsed)} / 15:00
            </p>
          )}
        </div>

        {proposal ? (
          <ProposalReview
            spark={spark}
            proposal={proposal}
            onChange={setProposal}
            onBack={() => setProposal(null)}
            onSave={() => onSave(proposal.writeup.trim(), proposal.next_step.trim() || null)}
            onDiscard={onClose}
          />
        ) : (
          <>
            {/* The conversation. Polite live region so each new question is read out. */}
            <div className="min-h-24 flex-1 space-y-3 overflow-y-auto" aria-live="polite">
              {history.map((t, i) =>
                t.role === 'assistant' ? (
                  <Markdown key={i} className="text-[0.9375rem] text-fg">
                    {t.content}
                  </Markdown>
                ) : (
                  <div key={i} className="ml-8 rounded-lg bg-surface-raised px-3 py-2">
                    <Markdown className="text-sm text-fg-muted">{t.content}</Markdown>
                  </div>
                )
              )}
              {busy === 'ask' && <p className="text-sm text-fg-subtle">Thinking…</p>}
              {busy === 'finish' && <p className="text-sm text-fg-subtle">Writing it up…</p>}
              {error && (
                <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
                  {error.message}
                  <button
                    type="button"
                    onClick={error.retry}
                    className={`min-h-9 px-3 text-xs ${BTN_GHOST}`}
                  >
                    Retry
                  </button>
                </div>
              )}
              <div ref={endRef} />
            </div>

            {overTime && !busy && (
              <p className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-fg">
                That&rsquo;s fifteen minutes. Wrap up whenever you&rsquo;re ready. You can keep
                going, too.
              </p>
            )}

            <div className="space-y-2">
              <textarea
                ref={answerRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
                }}
                disabled={busy !== null}
                rows={3}
                maxLength={4000}
                placeholder="Your answer"
                aria-label="Your answer"
                className={`block w-full resize-y px-3 py-2 text-sm leading-relaxed disabled:opacity-60 ${INPUT}`}
              />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 px-2 text-left text-xs text-fg-subtle underline underline-offset-4 hover:text-fg cursor-pointer"
                >
                  Leave without saving
                </button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={wrapUp}
                    disabled={busy !== null || !answered}
                    title={answered ? 'End here and see the write-up' : 'Answer at least one question first'}
                    className={`min-h-11 px-4 text-sm disabled:opacity-40 ${BTN_GHOST}`}
                  >
                    Stop &amp; wrap up
                  </button>
                  <button
                    type="button"
                    onClick={send}
                    disabled={busy !== null || !answer.trim()}
                    className={`min-h-11 px-4 text-sm ${BTN_PRIMARY}`}
                  >
                    Answer
                  </button>
                </div>
              </div>
              <p className="font-mono text-[0.6875rem] text-fg-subtle">
                ⌘↵ to answer · nothing changes on the spark until you save the write-up
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** The confirm-before-overwrite step: the proposal, editable, beside what it replaces. */
function ProposalReview({
  spark,
  proposal,
  onChange,
  onBack,
  onSave,
  onDiscard,
}: {
  spark: Spark
  proposal: Proposal
  onChange: (p: Proposal) => void
  onBack: () => void
  onSave: () => void
  onDiscard: () => void
}) {
  const [showOld, setShowOld] = useState(false)

  return (
    <div className="space-y-3 overflow-y-auto">
      <p className="text-sm text-fg-muted">
        Here&rsquo;s the write-up. Edit anything, then save it to replace the spark&rsquo;s body
        and next step.
      </p>

      <label className="block space-y-1">
        <span className="text-xs text-fg-muted">Write-up (markdown)</span>
        <textarea
          value={proposal.writeup}
          onChange={(e) => onChange({ ...proposal, writeup: e.target.value })}
          rows={10}
          className={`block w-full resize-y px-3 py-2 text-sm leading-relaxed ${INPUT}`}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-fg-muted">Next step</span>
        <input
          value={proposal.next_step}
          onChange={(e) => onChange({ ...proposal, next_step: e.target.value })}
          maxLength={300}
          className={`w-full px-3 py-2 text-sm ${INPUT}`}
        />
      </label>

      <div>
        <button
          type="button"
          onClick={() => setShowOld((v) => !v)}
          aria-expanded={showOld}
          className="text-xs text-fg-subtle underline underline-offset-4 hover:text-fg cursor-pointer"
        >
          {showOld ? 'Hide' : 'Show'} what this replaces
        </button>
        {showOld && (
          <div className="mt-2 space-y-1 rounded-lg border border-border bg-bg px-3 py-2">
            <Markdown className="text-sm text-fg-muted">{spark.content}</Markdown>
            {spark.next_step && (
              <p className="text-xs text-fg-muted">
                <span className="font-semibold text-fg">Next:</span> {spark.next_step}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <button type="button" onClick={onDiscard} className={`min-h-11 px-4 text-sm ${BTN_GHOST}`}>
          Discard
        </button>
        <button type="button" onClick={onBack} className={`min-h-11 px-4 text-sm ${BTN_GHOST}`}>
          Keep talking
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!proposal.writeup.trim()}
          className={`min-h-11 px-4 text-sm ${BTN_PRIMARY}`}
        >
          Save to spark
        </button>
      </div>
    </div>
  )
}
