import {
  MIN_PASSWORD_LENGTH,
  SESSION_COOKIE,
  claimToken,
  clearRateLimit,
  clearedCookie,
  clientIp,
  createSession,
  destroySession,
  getAccount,
  getTokenOwner,
  hashPassword,
  normalizeEmail,
  isRateLimited,
  ownsToken,
  publicAccount,
  putAccount,
  readCookie,
  requireAccount,
  sessionCookie,
  verifyPassword,
  type Account,
} from '@/lib/auth'
import { parseKindlingToken } from '@/lib/token-input'

/** PBKDF2 at 600k iterations is far too much CPU for the edge runtime. */
export const runtime = 'nodejs'

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init)

const fail = (error: string, status = 400) => Response.json({ error }, { status })

/**
 * Identical for "no such email" and "wrong password" — otherwise this endpoint
 * enumerates which addresses have accounts.
 */
const BAD_CREDENTIALS = 'Email or password is incorrect.'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail('Malformed request.')
  }

  const action = String(body.action ?? '')

  // ── Session reads, no credentials involved ────────────────────────────────

  if (action === 'me') {
    const account = await requireAccount(req)
    return json({ account: account ? publicAccount(account) : null })
  }

  if (action === 'logout') {
    // The browser sends the token it keeps on its own (localStorage). It is
    // only safe to forget if the account owns it — logging back in recovers
    // it. An unowned token exists nowhere else, so it stays. Checked here
    // against the live record rather than the client's copy, which can be
    // stale if a token was unlinked from another device.
    const account = await requireAccount(req)
    const kept = parseKindlingToken(String(body.token ?? ''))
    const forgetToken = Boolean(account && kept && ownsToken(account, kept))
    await destroySession(readCookie(req, SESSION_COOKIE))
    return json(
      { account: null, forgetToken },
      { headers: { 'Set-Cookie': clearedCookie() } }
    )
  }

  // ── Credentialed actions ──────────────────────────────────────────────────

  const email = normalizeEmail(String(body.email ?? ''))
  const password = String(body.password ?? '')
  const ip = clientIp(req)

  if (!EMAIL_RE.test(email)) return fail('Enter a valid email address.')

  if (action === 'signup') {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    }
    if (await isRateLimited('signup', ip, 5, 900)) {
      return fail('Too many sign-ups from here. Try again in a few minutes.', 429)
    }
    // Signup deliberately DOES reveal that an address is taken, unlike login:
    // the alternative is a user who cannot tell why their account won't create.
    if (await getAccount(email)) {
      return fail('An account with that email already exists. Log in instead.', 409)
    }

    const { passwordHash, salt, iterations, hash } = await hashPassword(password)
    // Adopt the token this browser is already using, so signing up never
    // strands someone in an empty namespace beside their real one. Only an
    // unowned token can be adopted; otherwise mint a fresh one.
    const offered = parseKindlingToken(String(body.token ?? ''))
    const adoptable = offered && !(await getTokenOwner(offered))
    const token = adoptable ? offered : crypto.randomUUID()
    const account: Account = {
      email,
      passwordHash,
      salt,
      iterations,
      hash,
      token,
      tokens: [{ token, label: 'Main' }],
      createdAt: new Date().toISOString(),
    }

    await claimToken(token, email)
    await putAccount(account)

    const sid = await createSession(email)
    return json(
      { account: publicAccount(account) },
      { headers: { 'Set-Cookie': sessionCookie(sid) } }
    )
  }

  if (action === 'login') {
    // Two windows: a wide one per IP, a tighter one per address, so one
    // account cannot be ground down from many IPs.
    if (await isRateLimited('login-ip', ip, 20, 900)) {
      return fail('Too many attempts. Try again in a few minutes.', 429)
    }
    if (await isRateLimited('login-email', email, 8, 900)) {
      return fail('Too many attempts for that account. Try again in a few minutes.', 429)
    }

    const account = await getAccount(email)
    if (!account) return fail(BAD_CREDENTIALS, 401)
    if (!(await verifyPassword(account, password))) return fail(BAD_CREDENTIALS, 401)

    await clearRateLimit('login-email', email)

    const sid = await createSession(email)
    return json(
      { account: publicAccount(account) },
      { headers: { 'Set-Cookie': sessionCookie(sid) } }
    )
  }

  return fail('Unknown action.')
}
