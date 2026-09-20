/**
 * A non-httpOnly mirror of the token in localStorage.
 *
 * localStorage is unreadable during SSR, which is why the dashboard used to
 * render nothing at all on the server — it could not know whether to show the
 * gate or the dashboard until hydration. A cookie is visible to the server on
 * the very first request, so the right branch can be chosen before any HTML is
 * sent and there is no blank first paint.
 *
 * It cannot be httpOnly, because the client is what mints the token. That is
 * no weaker than the localStorage copy it mirrors: the token is already a
 * bearer credential sitting in the browser and embedded in the MCP URL.
 */

export const TOKEN_COOKIE = 'kindling_token'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export const writeTokenCookie = (token: string): void => {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${TOKEN_COOKIE}=${token}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`
}

export const clearTokenCookie = (): void => {
  document.cookie = `${TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}
