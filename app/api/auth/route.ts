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
  hashPassword,
  normalizeEmail,
  isRateLimited,
  publicAccount,
  putAccount,
  readCookie,
  requireAccount,
  sessionCookie,
  verifyPassword,
  type Account,
} from '@/lib/auth'

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
    await destroySession(readCookie(req, SESSION_COOKIE))
    return json({ account: null }, { headers: { 'Set-Cookie': clearedCookie() } })
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
    // A fresh namespace needs no seeding — one with no sparks already reads as
    // empty. Linking an existing token is the usual next step anyway.
    const token = crypto.randomUUID()
    const account: Account = {
      email,
      passwordHash,
      salt,
      iterations,
      hash,
      token,
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
