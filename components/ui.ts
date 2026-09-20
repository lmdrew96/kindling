/** Shared class strings, so the same control looks the same everywhere. */

export const INPUT =
  'rounded-lg bg-surface border border-border text-fg placeholder:text-fg-subtle outline-none focus:border-border-strong transition-colors'

export const BTN_GHOST =
  'rounded-lg bg-surface border border-border text-fg-muted hover:bg-surface-raised hover:text-fg transition-colors cursor-pointer'

export const BTN_PRIMARY =
  'rounded-lg font-semibold cursor-pointer bg-primary text-on-primary hover:bg-primary-hover hover:text-fg transition-colors disabled:opacity-40 disabled:hover:bg-primary disabled:hover:text-on-primary'

/** The token is a v4 UUID; it is also the entire account. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
