'use client'

import { useState } from 'react'
import { BTN_GHOST, BTN_PRIMARY, INPUT } from './ui'
import { TokenDisplay } from './token-display'

export interface AccountToken {
  token: string
  label: string
}

export interface PublicAccount {
  email: string
  /** The default token — where a fresh device lands after signing in. */
  token: string
  tokens: AccountToken[]
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
  onSwitchToken,
}: {
  account: PublicAccount | null
  /** The token this browser is currently using, account or not. */
  token: string | null
  onAccount: (a: PublicAccount | null) => void
  onClose: () => void
  /** Moves this browser into another of the account's namespaces. */
  onSwitchToken?: (t: string) => void
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
        <SignedIn
          account={account}
          token={token}
          onAccount={onAccount}
          onSwitchToken={onSwitchToken}
        />
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
      // Signing up adopts the token this browser already has, so nobody is
      // stranded in an empty namespace wondering where their sparks went.
      const { account } = await api<{ account: PublicAccount }>('/api/auth', {
        action: mode,
        email,
        password,
        ...(mode === 'signup' && token ? { token } : {}),
      })
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

const send = async <T,>(method: 'PATCH' | 'DELETE', body: unknown): Promise<T> => {
  const res = await fetch('/api/link', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
  return data as T
}

function SignedIn({
  account,
  token,
  onAccount,
  onSwitchToken,
}: {
  account: PublicAccount
  token: string | null
  onAccount: (a: PublicAccount | null) => void
  onSwitchToken?: (t: string) => void
}) {
  const [linkInput, setLinkInput] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  /** One wrapper so every token action reports errors the same way. */
  const run = async (action: () => Promise<{ account: PublicAccount }>) => {
    setBusy(true)
    setError('')
    try {
      const res = await action()
      onAccount(res.account)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const link = async () => {
    const ok = await run(() =>
      api('/api/link', { token: linkInput, label: newLabel.trim() || 'Linked' })
    )
    if (ok) {
      setLinkInput('')
      setNewLabel('')
    }
  }

  const create = async () => {
    const ok = await run(() =>
      api('/api/link', { create: true, label: newLabel.trim() || 'New' })
    )
    if (ok) setNewLabel('')
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

      {/* Each namespace keeps its own sparks and its own MCP URL — the token
          is the path — so a work client and a personal client never mix. */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-fg">Your tokens</p>
        <ul className="space-y-2">
          {account.tokens.map((t) => (
            <TokenRow
              key={t.token}
              entry={t}
              isCurrent={t.token === token}
              isDefault={t.token === account.token}
              canRemove={account.tokens.length > 1}
              busy={busy}
              onUse={onSwitchToken ? () => onSwitchToken(t.token) : undefined}
              onRename={(label) => run(() => send('PATCH', { token: t.token, label }))}
              onMakeDefault={() => void run(() => send('PATCH', { token: t.token, default: true }))}
              onRemove={() => void run(() => send('DELETE', { token: t.token }))}
            />
          ))}
        </ul>
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs font-semibold text-fg">Add a token</p>
        <p className="text-xs text-fg-subtle">
          Start a fresh namespace (say, work beside personal), or link one you already have —
          paste a token or a whole Kindling URL. Nothing is moved or deleted, and any MCP client
          already pointed at a linked token keeps working.
        </p>
        <input
          value={newLabel}
          onChange={(e) => { setNewLabel(e.target.value); setError('') }}
          placeholder="Name it — e.g. Work"
          aria-label="Name for the new token"
          maxLength={40}
          className={`w-full text-xs px-3 py-2 ${INPUT}`}
        />
        <div className="flex flex-wrap gap-2">
          <input
            value={linkInput}
            onChange={(e) => { setLinkInput(e.target.value); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && linkInput.trim() && void link()}
            placeholder="Existing token or URL (optional)"
            aria-label="Existing token or URL to link"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={`flex-1 min-w-48 text-xs px-3 py-2 ${INPUT}`}
          />
          {linkInput.trim() ? (
            <button
              type="button"
              onClick={() => void link()}
              disabled={busy}
              className={`px-4 min-h-11 text-xs ${BTN_GHOST} disabled:opacity-40`}
            >
              {busy ? 'Linking…' : 'Link it'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy}
              className={`px-4 min-h-11 text-xs ${BTN_GHOST} disabled:opacity-40`}
            >
              {busy ? 'Creating…' : 'Create new'}
            </button>
          )}
        </div>
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

function TokenRow({
  entry,
  isCurrent,
  isDefault,
  canRemove,
  busy,
  onUse,
  onRename,
  onMakeDefault,
  onRemove,
}: {
  entry: AccountToken
  isCurrent: boolean
  isDefault: boolean
  canRemove: boolean
  busy: boolean
  onUse?: () => void
  onRename: (label: string) => Promise<boolean>
  onMakeDefault: () => void
  onRemove: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(entry.label)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [open, setOpen] = useState(false)

  const saveLabel = async () => {
    const next = label.trim()
    if (!next || next === entry.label) {
      setRenaming(false)
      setLabel(entry.label)
      return
    }
    if (await onRename(next)) setRenaming(false)
  }

  const small = `px-2.5 min-h-8 pointer-coarse:min-h-11 text-xs ${BTN_GHOST} disabled:opacity-40`

  return (
    <li
      className={`rounded-lg border bg-surface-raised p-3 space-y-2 ${
        isCurrent ? 'border-border-strong shadow-[inset_3px_0_0_var(--color-primary)]' : 'border-border'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {renaming ? (
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveLabel()
              if (e.key === 'Escape') { setRenaming(false); setLabel(entry.label) }
            }}
            onBlur={() => void saveLabel()}
            maxLength={40}
            autoFocus
            aria-label={`Rename ${entry.label}`}
            className={`text-sm px-2 py-1 ${INPUT}`}
          />
        ) : (
          <span className="text-sm font-semibold text-fg">{entry.label}</span>
        )}
        <span className="font-mono text-[0.6875rem] text-fg-subtle">{entry.token.slice(0, 8)}…</span>
        {isCurrent && (
          <span className="rounded border border-border-strong px-1.5 font-mono text-[0.625rem] uppercase tracking-wide text-fg-muted">
            this browser
          </span>
        )}
        {isDefault && (
          <span className="rounded border border-border-strong px-1.5 font-mono text-[0.625rem] uppercase tracking-wide text-fg-muted">
            default
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {!isCurrent && onUse && (
          <button type="button" onClick={onUse} disabled={busy} className={small}>
            Use here
          </button>
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={small}>
          {open ? 'Hide token' : 'Show token'}
        </button>
        <button type="button" onClick={() => setRenaming(true)} disabled={busy} className={small}>
          Rename
        </button>
        {!isDefault && (
          <button
            type="button"
            onClick={onMakeDefault}
            disabled={busy}
            title="The one a new device opens after you sign in"
            className={small}
          >
            Make default
          </button>
        )}
        {canRemove &&
          (confirmRemove ? (
            <>
              <button
                type="button"
                onClick={() => { setConfirmRemove(false); onRemove() }}
                disabled={busy}
                className="px-2.5 min-h-8 pointer-coarse:min-h-11 rounded-lg border border-danger/50 text-xs text-danger hover:bg-danger/10 transition-colors cursor-pointer disabled:opacity-40"
              >
                Confirm unlink
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)} className={small}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmRemove(true)} disabled={busy} className={small}>
              Unlink
            </button>
          ))}
      </div>

      {confirmRemove && (
        <p className="text-xs text-fg-muted">
          Unlinking doesn&rsquo;t delete these sparks — they stay at their own URL — but the
          account will stop remembering this token. Copy it first if you might want it back.
        </p>
      )}
      {(open || confirmRemove) && <TokenDisplay token={entry.token} />}
    </li>
  )
}
