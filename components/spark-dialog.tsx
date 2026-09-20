'use client'

import { useEffect, useRef, useState } from 'react'
import type { Spark } from '@/lib/types'
import { displayTitle } from '@/lib/spark-utils'
import { BTN_GHOST, BTN_PRIMARY, INPUT } from './ui'

/** Shared chrome for the two editing dialogs. */
function Shell({
  title,
  labelledBy,
  onCancel,
  children,
}: {
  title: string
  labelledBy: string
  onCancel: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-5 py-10"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-xl border border-border-strong bg-surface p-5"
      >
        <h2 id={labelledBy} className="font-display text-lg font-bold text-fg">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

/**
 * Editing was MCP-only: you could not fix a typo in something you captured
 * without opening a Claude client.
 */
export function EditSparkDialog({
  spark,
  knownTags,
  onCancel,
  onSave,
}: {
  spark: Spark
  knownTags: string[]
  onCancel: () => void
  onSave: (patch: { title: string | null; content: string; tags: string[] }) => void
}) {
  const [title, setTitle] = useState(spark.title ?? '')
  const [content, setContent] = useState(spark.content)
  const [tagText, setTagText] = useState((spark.tags ?? []).join(', '))
  const contentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { contentRef.current?.focus() }, [])

  const save = () => {
    if (!content.trim()) return
    onSave({
      title: title.trim() || null,
      content: content.trim(),
      tags: tagText.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
    })
  }

  return (
    <Shell title="Edit spark" labelledBy="edit-title" onCancel={onCancel}>
      <label className="block space-y-1">
        <span className="text-xs text-fg-muted">Title (optional)</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={displayTitle(spark)}
          className={`w-full text-sm px-3 py-2.5 ${INPUT}`}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-fg-muted">Content</span>
        <textarea
          ref={contentRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          className={`w-full resize-y text-sm px-3 py-2.5 leading-relaxed ${INPUT}`}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-fg-muted">Tags (comma-separated)</span>
        <input
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          list="known-tags-edit"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`w-full text-sm px-3 py-2.5 ${INPUT}`}
        />
        <datalist id="known-tags-edit">
          {knownTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={`min-h-11 px-4 text-sm ${BTN_GHOST}`}>
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!content.trim()}
          className={`min-h-11 px-4 text-sm ${BTN_PRIMARY}`}
        >
          Save
        </button>
      </div>
    </Shell>
  )
}

/**
 * Promotion is the product's payoff and was Claude-only. Provenance is the
 * part worth writing, so the notes field is given room rather than buried.
 */
export function PromoteDialog({
  spark,
  onCancel,
  onPromote,
}: {
  spark: Spark
  onCancel: () => void
  onPromote: (target: string, notes: string | null) => void
}) {
  const [target, setTarget] = useState('')
  const [notes, setNotes] = useState('')
  const targetRef = useRef<HTMLInputElement>(null)

  useEffect(() => { targetRef.current?.focus() }, [])

  return (
    <Shell title="Promote this spark" labelledBy="promote-title" onCancel={onCancel}>
      <p className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg-muted">
        {displayTitle(spark)}
      </p>

      <label className="block space-y-1">
        <span className="text-xs text-fg-muted">What did it become?</span>
        <input
          ref={targetRef}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="ControlledChaos, a Substack draft, a URL…"
          className={`w-full text-sm px-3 py-2.5 ${INPUT}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && target.trim()) onPromote(target.trim(), notes.trim() || null)
          }}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-fg-muted">How did it get there? (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="became the opening of Vertexism Section V"
          className={`w-full resize-y text-sm px-3 py-2.5 leading-relaxed ${INPUT}`}
        />
      </label>

      <p className="text-xs text-fg-subtle">
        Promoting archives the spark so it stops competing in recall, but keeps this record.
      </p>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={`min-h-11 px-4 text-sm ${BTN_GHOST}`}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onPromote(target.trim(), notes.trim() || null)}
          disabled={!target.trim()}
          className={`min-h-11 px-4 text-sm ${BTN_PRIMARY}`}
        >
          Promote
        </button>
      </div>
    </Shell>
  )
}
