/** Shared class strings, so the same control looks the same everywhere. */

export const INPUT =
  'rounded-lg bg-surface border border-border text-fg placeholder:text-fg-subtle outline-none focus:border-border-strong transition-colors'

export const BTN_GHOST =
  'rounded-lg bg-transparent border border-border-strong text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors cursor-pointer'

export const BTN_PRIMARY =
  'rounded-lg font-semibold cursor-pointer bg-flame text-on-flame hover:bg-flame-hover shadow-[0_0_24px_var(--color-flame-glow)] transition-colors disabled:opacity-40 disabled:shadow-none disabled:hover:bg-flame'

/** The token is a v4 UUID; it is also the entire account. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
