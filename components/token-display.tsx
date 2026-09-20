'use client'

import { useState } from 'react'
import { BTN_GHOST } from './ui'

/**
 * The token rendered as the credential it actually is — selectable, copyable,
 * and visually distinct from body text. Until accounts exist, this string is
 * the only thing standing between a user and permanent loss of every spark
 * they have captured, so it should never be something the UI hides.
 */
export function TokenDisplay({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked; the token is selectable either way.
      setCopied(false)
    }
  }

  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 select-all break-all rounded-lg border border-border bg-bg px-3 py-2.5 text-xs text-fg">
        {token}
      </code>
      <button
        type="button"
        onClick={copy}
        className={`shrink-0 px-3 min-h-11 text-xs ${BTN_GHOST}`}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  )
}
