'use client'

import { useState } from 'react'
import type { Spark } from '@/lib/types'
import { normalizeTag, tagCounts } from '@/lib/spark-utils'
import { BTN_GHOST, INPUT } from '@/components/ui'

/**
 * The repair half of tag hygiene.
 *
 * Normalization on write stops new fragmentation, but a store that already
 * contains "writing", "Writing" and "write" has no way to be fixed — and no
 * way to even see the problem, since nothing listed tags with their counts.
 * Listing them side by side is most of the value here; renaming and removing
 * are the rest.
 */
export function TagManager({
  sparks,
  onRename,
  onRemove,
}: {
  sparks: Spark[]
  /** Resolves once the rewrite has landed, so the row can close. */
  onRename: (from: string, to: string) => Promise<void>
  /** Strips the tag from every spark carrying it. Resolves once it has landed. */
  onRemove: (tag: string) => Promise<void>
}) {
  const counts = tagCounts(sparks)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  if (counts.length === 0) {
    return (
      <p className="text-xs text-fg-subtle">
        No tags yet. Tags are how recall gets filtered later, so they are worth adding as you
        capture.
      </p>
    )
  }

  const open = (tag: string) => {
    setConfirming(null)
    setEditing(tag)
    setDraft(tag)
  }

  const remove = async (tag: string) => {
    setBusy(true)
    try {
      await onRemove(tag)
      setConfirming(null)
    } finally {
      setBusy(false)
    }
  }

  const target = normalizeTag(draft)
  const existing = new Set(counts.map((t) => normalizeTag(t.tag)))
  // Renaming into a tag that already exists folds the two together. Saying so
  // before the click is the difference between a merge and a surprise.
  const willMerge = Boolean(editing) && target.length > 0 && target !== normalizeTag(editing ?? '') && existing.has(target)
  const unchanged = target === normalizeTag(editing ?? '')

  const submit = async () => {
    if (!editing || !target || unchanged) return
    setBusy(true)
    try {
      await onRename(editing, target)
      setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ul className="space-y-1.5">
      {counts.map(({ tag, count }) => (
        <li key={tag}>
          {editing === tag ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                  if (e.key === 'Escape') setEditing(null)
                }}
                aria-label={`Rename the tag ${tag}`}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={`flex-1 min-w-32 text-xs px-3 py-2 ${INPUT}`}
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !target || unchanged}
                className="text-xs px-3 min-h-11 rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors cursor-pointer"
              >
                {busy ? 'Saving…' : willMerge ? 'Merge' : 'Rename'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className={`text-xs px-3 min-h-11 ${BTN_GHOST}`}
              >
                Cancel
              </button>
              {willMerge && (
                <p className="w-full text-xs text-cold-text">
                  <span aria-hidden="true">⚠</span> &ldquo;{target}&rdquo; already exists — this
                  merges the two. Merges cannot be undone.
                </p>
              )}
            </div>
          ) : confirming === tag ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 min-w-48 text-xs text-fg-muted">
                Remove &ldquo;{tag}&rdquo; from {count} spark{count === 1 ? '' : 's'}? The sparks
                stay — only the tag goes.
              </p>
              <button
                type="button"
                onClick={() => void remove(tag)}
                disabled={busy}
                className="text-xs px-3 min-h-11 rounded-lg border border-cold/60 bg-cold/10 text-cold-text hover:bg-cold/20 disabled:opacity-40 transition-colors cursor-pointer"
              >
                {busy ? 'Removing…' : 'Remove'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className={`text-xs px-3 min-h-11 ${BTN_GHOST}`}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <span className="truncate rounded-full border border-cold/60 bg-tag-bg px-2 py-0.5 text-xs text-tag-fg">
                  {tag}
                </span>
                <span className="text-xs text-fg-subtle">{count}</span>
              </span>
              <span className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => open(tag)}
                  className="text-xs px-3 min-h-11 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null)
                    setConfirming(tag)
                  }}
                  aria-label={`Remove the tag ${tag} from all ${count} sparks carrying it`}
                  className="text-xs px-3 min-h-11 rounded-lg text-fg-muted hover:text-cold-text transition-colors cursor-pointer"
                >
                  Remove
                </button>
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
