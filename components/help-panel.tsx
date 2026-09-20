'use client'

import { useState } from 'react'
import { BTN_GHOST } from './ui'
import { TokenDisplay } from './token-display'

/**
 * Deliberately a dismissible panel rather than a multi-step tour — a forced
 * walkthrough is an ND anti-pattern, and the thing people actually need
 * (where do I paste this URL?) should be reachable at any time, not once.
 */
export function HelpPanel({
  mcpUrl,
  token,
  onClose,
}: {
  mcpUrl: string
  token: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<'connect' | 'how'>('connect')

  return (
    <section
      aria-label="Help"
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-1">
          {(['connect', 'how'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`min-h-11 rounded-lg px-3 text-xs transition-colors cursor-pointer ${
                tab === t
                  ? 'bg-primary/15 font-semibold text-primary underline underline-offset-4'
                  : 'text-fg-subtle hover:text-fg-muted'
              }`}
            >
              {t === 'connect' ? 'Connect to Claude' : 'How Kindling works'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-fg-subtle hover:text-fg transition-colors cursor-pointer"
        >
          Hide
        </button>
      </div>

      {tab === 'connect' ? (
        <div className="space-y-4 text-sm text-fg-muted">
          <p>
            Connecting Kindling to Claude is the whole point — it&rsquo;s what lets Claude notice
            a stray idea mid-conversation and capture it without being asked. Point a client at
            this URL:
          </p>

          <CopyRow label="Your MCP endpoint" value={mcpUrl} />

          <div className="space-y-1">
            <p className="text-xs font-semibold text-fg">Claude Code</p>
            <CopyRow
              label="Terminal command"
              value={`claude mcp add --transport http kindling ${mcpUrl}`}
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold text-fg">Claude web or desktop</p>
            <p className="text-xs">
              Settings → Connectors → Add custom connector, then paste the endpoint URL above.
            </p>
          </div>

          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-xs font-semibold text-fg">Your token</p>
            <p className="text-xs">
              This token is the credential. Anyone with it can read your sparks; without it,
              nobody can. Attach an account under <strong className="text-fg">Save token</strong>{' '}
              and Kindling will remember it for you, so a lost copy stops meaning a lost corpus.
              The token itself never changes, so your MCP URL keeps working either way.
            </p>
            <TokenDisplay token={token} />
          </div>
        </div>
      ) : (
        <dl className="space-y-3 text-sm text-fg-muted">
          <Entry term="Spark">
            A thought worth keeping but not worth doing yet — an idea, an aside, a half-formed
            connection. Not a task: concrete work belongs in a task tracker.
          </Entry>
          <Entry term="Recall">
            Kindling ranks sparks by how old they are, how long they&rsquo;ve been neglected, and
            how rarely they&rsquo;ve surfaced, then shows you the ones most in need of attention.
            Showing a spark resets its clock, which is what stops the same few surfacing forever.
          </Entry>
          <Entry term="Cold">
            A spark nobody has touched for a long time (180 days by default — change it under
            Stats) drops out of active rotation. It isn&rsquo;t deleted; the Cold tab is where you
            go to decide whether to revive it or let it go.
          </Entry>
          <Entry term="Promote">
            When a spark becomes something real — a project, a draft, a decision — promote it and
            say what it became. That record is the only evidence the system is working, and it
            shows up in the Promoted tab.
          </Entry>
          <Entry term="Snooze and standing">
            Snooze holds a spark out of recall for a while without rejecting it. Marking one
            standing means it never goes cold, for ongoing commitments rather than perishable
            ideas.
          </Entry>
        </dl>
      )}
    </section>
  )
}

function Entry({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-fg">{term}</dt>
      <dd className="text-xs leading-relaxed">{children}</dd>
    </div>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex items-stretch gap-2">
      <code
        aria-label={label}
        className="flex-1 select-all overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-bg px-3 py-2.5 text-xs text-fg"
      >
        {value}
      </code>
      <button type="button" onClick={copy} className={`shrink-0 px-3 min-h-11 text-xs ${BTN_GHOST}`}>
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  )
}
