'use client'

import { useSyncExternalStore } from 'react'

export type View = 'sparks' | 'stats' | 'connect' | 'help' | 'account'

type NavItem = { view: View; label: string; glyph: string; hint?: string; count?: number }

const NAV: NavItem[] = [
  { view: 'sparks', label: 'Sparks', glyph: '✦' },
  { view: 'stats', label: 'Stats', glyph: '◔' },
  { view: 'connect', label: 'Connect', glyph: '⌁', hint: 'Connect Kindling to Claude' },
  { view: 'help', label: 'Help', glyph: '?' },
]

// Collapse is a per-browser convenience. localStorage is unreadable during SSR
// and set-state-in-effect is linted out here, so it is read through
// useSyncExternalStore with a server snapshot of "expanded".
const COLLAPSE_KEY = 'kindling:sidebar-collapsed'
const COLLAPSE_EVENT = 'kindling:sidebar'

const subscribeCollapsed = (onChange: () => void) => {
  window.addEventListener('storage', onChange)
  window.addEventListener(COLLAPSE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(COLLAPSE_EVENT, onChange)
  }
}

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

const writeCollapsed = (next: boolean) => {
  try {
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
  } catch {
    /* private mode: the toggle just won't persist */
  }
  window.dispatchEvent(new Event(COLLAPSE_EVENT))
}

const itemClass = (active: boolean): string =>
  `flex items-center gap-3 rounded-lg px-3 min-h-11 text-sm transition-colors cursor-pointer ${
    active
      ? 'bg-surface-hover text-fg font-semibold shadow-[inset_3px_0_0_var(--color-primary)]'
      : 'text-fg-muted hover:bg-surface-hover/60 hover:text-fg'
  }`

/**
 * The app shell's navigation. Exactly one item carries the active indicator —
 * the current view — and Connect is styled like everything else, because it is
 * a place you go, not a state you are in.
 */
export function Sidebar({
  view,
  onView,
  exportHref,
  account,
  onClearToken,
  counts,
}: {
  view: View
  onView: (v: View) => void
  exportHref: string
  account: { email: string } | null
  onClearToken: () => void
  counts: { active: number; cold: number; archived: number }
}) {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false)

  const navButton = (item: NavItem, compact: boolean) => (
    <button
      key={item.view}
      type="button"
      onClick={() => onView(item.view)}
      aria-current={view === item.view ? 'page' : undefined}
      title={compact ? item.label : item.hint}
      className={itemClass(view === item.view)}
    >
      <span aria-hidden="true" className="w-4 text-center font-mono text-base leading-none">
        {item.glyph}
      </span>
      <span className={compact ? 'sr-only' : 'flex-1 text-left'}>{item.label}</span>
      {!compact && item.count !== undefined && (
        <span className="font-mono text-[0.6875rem] text-fg-subtle">{item.count}</span>
      )}
    </button>
  )

  const accountItem: NavItem = {
    view: 'account',
    label: account ? 'Account' : 'Save token',
    glyph: '◉',
    hint: account ? `Signed in as ${account.email}` : 'Save your token to an account',
  }

  return (
    <>
      {/* Desktop: a left rail that collapses to icons. */}
      <aside
        aria-label="Kindling"
        className={`hidden md:flex sticky top-0 h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] motion-reduce:transition-none ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className={`flex items-center py-5 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!collapsed && (
            <span className="font-display text-2xl font-bold tracking-tight text-primary">
              Kindling
            </span>
          )}
          <button
            type="button"
            onClick={() => writeCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="flex size-9 items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-hover hover:text-fg transition-colors cursor-pointer"
          >
            <span aria-hidden="true">{collapsed ? '»' : '«'}</span>
          </button>
        </div>

        <nav className="flex flex-col gap-1 px-2">
          {NAV.map((item) =>
            navButton(item.view === 'sparks' ? { ...item, count: counts.active } : item, collapsed)
          )}
          <a
            href={exportHref}
            download
            title={collapsed ? 'Export' : 'Download every spark as a markdown file'}
            className={itemClass(false)}
          >
            <span aria-hidden="true" className="w-4 text-center font-mono text-base leading-none">
              ↓
            </span>
            <span className={collapsed ? 'sr-only' : ''}>Export</span>
          </a>
        </nav>

        <div className="mt-auto flex flex-col gap-3 px-2 pb-4">
          {!collapsed && (
            <div className="mx-3 border-t border-border pt-3">
              <p className="mb-2 text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-fg-subtle">
                Stats
              </p>
              <dl className="space-y-1 text-xs text-fg-subtle">
                {(['active', 'cold', 'archived'] as const).map((k) => (
                  <div key={k} className="flex justify-between capitalize">
                    <dt>{k}</dt>
                    <dd className="font-mono text-fg-muted">{counts[k]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div className="flex flex-col gap-1">
            {navButton(accountItem, collapsed)}
            {/* Only meaningful for a browser holding a token on its own — with
                an account there is something to come back to. */}
            {!account && !collapsed && (
              <button
                type="button"
                onClick={onClearToken}
                className="px-3 py-1 text-left text-xs text-fg-subtle hover:text-fg transition-colors cursor-pointer"
              >
                Clear token
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Small screens: the same destinations as a bottom bar. */}
      <nav
        aria-label="Kindling"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-border bg-surface px-1 pb-[env(safe-area-inset-bottom)]"
      >
        {[...NAV, accountItem].map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => onView(item.view)}
            aria-current={view === item.view ? 'page' : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] transition-colors cursor-pointer ${
              view === item.view ? 'text-primary font-semibold' : 'text-fg-muted hover:text-fg'
            }`}
          >
            <span aria-hidden="true" className="font-mono text-base leading-none">
              {item.glyph}
            </span>
            {item.label}
          </button>
        ))}
        <a
          href={exportHref}
          download
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-fg-muted hover:text-fg transition-colors"
        >
          <span aria-hidden="true" className="font-mono text-base leading-none">
            ↓
          </span>
          Export
        </a>
      </nav>
    </>
  )
}
