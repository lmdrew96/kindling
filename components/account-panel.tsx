'use client'

import { useState } from 'react'
import { BTN_GHOST, BTN_PRIMARY, INPUT } from './ui'
import { TokenDisplay } from './token-display'

export interface PublicAccount {
  email: string
  token: string
  createdAt: string
}

const api = async <T,>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
  return data as T
}

/**
 * Accounts as an optional bookmark, not a gate.
 *
 * Everything here is skippable: a token with no account keeps working, and the
 * MCP URL never changes. The account exists so the token can be recovered on a
 * second device, which until now was the user's own problem — "save this
 * string or lose everything" is a lot to ask of the working memory this app
 * exists to compensate for.
 */
export function AccountPanel({
  account,
  token,
  onAccount,
  onClose,
}: {
  account: PublicAccount | null
  /** The token this browser is currently using, account or not. */
  token: string | null
  onAccount: (a: PublicAccount | null) => void
  onClose: () => void
}) {
  return (
    <section
      aria-label="Account"
      className="rounded-xl border border-border bg-surface p-4 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-sm font-bold text-fg">
          {account ? 'Your account' : 'Save your sparks to an account'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-fg-subtle hover:text-fg transition-colors cursor-pointer"
        >
          Hide
        </button>
      </div>

      {account ? (
        <SignedIn account={account} onAccount={onAccount} />
      ) : (
        <SignedOut token={token} onAccount={onAccount} />
      )}
    </section>
  )
}

// ─── Signed out ──────────────────────────────────────────────────────────────

function SignedOut({
  token,
  onAccount,
}: {
  token: string | null
  onAccount: (a: PublicAccount) => void
}) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const { account } = await api<{ account: PublicAccount }>('/api/auth', {
        action: mode,
        email,
        password,
      })
      // Signing up mints a fresh empty namespace. If this browser already had
      // a token, link it straight away rather than stranding the user in an
      // empty Kindling wondering where their sparks went.
      if (mode === 'signup' && token && token !== account.token) {
        try {
          const linked = await api<{ account: PublicAccount }>('/api/link', { token })
          onAccount(linked.account)
          return
        } catch {
          /* Account exists; linking can be retried from the signed-in view. */
        }
      }
      onAccount(account)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-fg-muted">
        Optional. Your token keeps working either way, and your MCP URL never changes — an
        account just remembers the token for you, so you can get back in on another device
        without having saved it.
      </p>

      <div className="flex gap-1" role="tablist" aria-label="Account action">
        {(['signup', 'login'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setError('') }}
            className={`text-xs px-3 min-h-11 rounded-lg border transition-colors cursor-pointer ${
              mode === m
                ? 'bg-primary/15 text-primary border-primary/40 font-semibold'
                : 'bg-transparent text-fg-subtle border-transparent hover:text-fg-muted'
            }`}
          >
            {m === 'signup' ? 'Create account' : 'Log in'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError('') }}
          placeholder="you@example.com"
          aria-label="Email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          className={`w-full text-sm px-3 py-2.5 ${INPUT}`}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder={mode === 'signup' ? 'At least 10 characters' : 'Password'}
          aria-label="Password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          className={`w-full text-sm px-3 py-2.5 ${INPUT}`}
        />
      </div>

      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !email || !password}
        className={`w-full py-2.5 px-5 min-h-11 text-sm ${BTN_PRIMARY}`}
      >
        {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Log in'}
      </button>

      <p className="text-xs text-fg-subtle">
        There is no password reset — there is no mail sender. Keep your token backed up as
        well.
      </p>
    </div>
  )
}

// ─── Signed in ───────────────────────────────────────────────────────────────

function SignedIn({
  account,
  onAccount,
}: {
  account: PublicAccount
  onAccount: (a: PublicAccount | null) => void
}) {
  const [linkInput, setLinkInput] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const link = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await api<{ account: PublicAccount; previousSparkCount: number }>(
        '/api/link',
        { token: linkInput }
      )
      setLinkInput('')
      setMessage(
        res.previousSparkCount > 0
          ? `Linked. Your previous namespace still holds ${res.previousSparkCount} spark${
              res.previousSparkCount === 1 ? '' : 's'
            } and is still reachable at its own URL — nothing was deleted.`
          : 'Linked. This account now points at that token.'
      )
      onAccount(res.account)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link that token.')
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    try {
      await api('/api/auth', { action: 'logout' })
    } finally {
      onAccount(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">
        Signed in as <strong className="text-fg">{account.email}</strong>
      </p>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-fg">The token this account points at</p>
        <TokenDisplay token={account.token} />
      </div>

      {/* The retrofit path: someone who used Kindling before accounts existed
          points their new account at the token they already have. */}
      <div className="border-t border-border pt-3 space-y-2">
        <label className="block text-xs font-semibold text-fg" htmlFor="link-token">
          Link a different token
        </label>
        <p className="text-xs text-fg-subtle">
          Paste a token or a whole Kindling URL. The account moves to it; nothing is deleted,
          and any MCP client already pointed at it keeps working.
        </p>
        <div className="flex gap-2">
          <input
            id="link-token"
            value={linkInput}
            onChange={(e) => { setLinkInput(e.target.value); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && void link()}
            placeholder="Token or URL"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={`flex-1 text-xs px-3 py-2 ${INPUT}`}
          />
          <button
            type="button"
            onClick={() => void link()}
            disabled={busy || !linkInput.trim()}
            className={`px-4 min-h-11 text-xs ${BTN_GHOST} disabled:opacity-40`}
          >
            {busy ? 'Linking…' : 'Link'}
          </button>
        </div>
        {message && <p className="text-xs text-primary">{message}</p>}
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => void logout()}
          className={`px-4 min-h-11 text-xs ${BTN_GHOST}`}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
