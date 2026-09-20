'use client'

import { useEffect, useRef } from 'react'
import type { Spark } from '@/lib/types'
import { displayTitle } from '@/lib/spark-utils'
import { BTN_GHOST } from './ui'

/**
 * Everything else in Kindling is soft — archive sets a status and can always
 * be undone. This is the one operation with no way back, so it is also the
 * only one that stops and asks.
 */
export function ConfirmDeleteDialog({
  spark,
  onCancel,
  onConfirm,
}: {
  spark: Spark
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-5"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-xl border border-border-strong bg-surface p-5"
      >
        <h2 id="delete-title" className="font-display text-lg font-bold text-fg">
          Delete this spark?
        </h2>

        <p className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg-muted">
          {displayTitle(spark)}
        </p>

        <p className="text-sm leading-relaxed text-fg-muted">
          This is permanent — there&rsquo;s no undo and no trash.{' '}
          <strong className="text-fg">Archiving</strong> keeps it out of recall just as
          effectively and can always be reversed.
        </p>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 rounded-lg border border-danger/50 px-4 text-sm text-danger transition-colors hover:bg-danger/10 cursor-pointer"
          >
            Delete permanently
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={`min-h-11 px-4 text-sm ${BTN_GHOST}`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
