'use client'

import { useEffect, useRef } from 'react'
import { BTN_GHOST } from './ui'
import { TokenDisplay } from './token-display'

/**
 * Confirmation for clearing the stored token.
 *
 * This is the most destructive action in the app — the token is the account,
 * with no email, no recovery and no backup — and it used to be one unconfirmed
 * click on the faintest control on screen. Deliberately a real dialog rather
 * than window.confirm, so the token itself can be shown and copied at the
 * moment it still exists.
 */
export function ForgetTokenDialog({
  token,
  onCancel,
  onConfirm,
}: {
  token: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Focus the safe choice, not the destructive one.
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
        aria-labelledby="forget-title"
        aria-describedby="forget-body"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-xl border border-border-strong bg-surface p-5"
      >
        <h2 id="forget-title" className="font-display text-lg font-bold text-fg">
          Save your token first
        </h2>

        <p id="forget-body" className="text-sm leading-relaxed text-fg-muted">
          This token <strong className="text-fg">is</strong> your account. There is no email,
          no password and no recovery — if you clear it without a copy, every spark you have
          captured becomes unreachable.
        </p>

        <TokenDisplay token={token} />

        <p className="text-xs text-fg-subtle">
          Paste it somewhere you will still have in six months, then continue.
        </p>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 rounded-lg border border-danger/50 px-4 text-sm text-danger transition-colors hover:bg-danger/10 cursor-pointer"
          >
            I&rsquo;ve saved it — clear this token
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
