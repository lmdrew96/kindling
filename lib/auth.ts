import { redis } from './redis'

/**
 * Optional accounts, ported from personal-context-mcp and Tangle.
 *
 * The governing idea, and the reason this is smaller than it looks: an account
 * is a convenience wrapper that remembers which token is yours. It is NOT a
 * second access layer over the data. A token still works standalone with no
 * account at all, and the MCP endpoint is untouched by any of this — every
 * `/{token}/mcp` URL already pasted into a client config keeps working exactly
 * as before.
 *
 * So nothing here gates sparks. The only route that checks for a session is
 * /api/link, because linking is the one operation that acts on an account
 * rather than on a token.
 *
 * No third-party auth provider: email plus password, PBKDF2 via Web Crypto,
 * and opaque session ids in Redis behind an httpOnly cookie.
 */

// ─── Key space (alongside k:{token}:*) ───────────────────────────────────────

const accountKey = (email: string) => `kindling:account:${email}`
const sessionKey = (sid: string) => `kindling:session:${sid}`
const ownerKey = (token: string) => `kindling:tokenowner:${token}`
const rateKey = (scope: string, id: string) => `kindling:rl:${scope}:${id}`

export const SESSION_COOKIE = 'kindling_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Account {
  email: string
  passwordHash: string // base64
  salt: string // base64
  iterations: number
  hash: string // e.g. "SHA-256"
  /** The token whose namespace this account owns. */
  token: string
  createdAt: string
}

export type PublicAccount = Pick<Account, 'email' | 'token' | 'createdAt'>

/** The hash and salt must never leave the server, so every response goes through this. */
export const publicAccount = (a: Account): PublicAccount => ({
  email: a.email,
  token: a.token,
  createdAt: a.createdAt,
})

// ─── Password hashing ────────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 600_000
const PBKDF2_HASH = 'SHA-256'
const SALT_BYTES = 16
const KEY_BYTES = 32

export const MIN_PASSWORD_LENGTH = 10

const toB64 = (buf: ArrayBuffer): string =>
  Buffer.from(new Uint8Array(buf)).toString('base64')

const fromB64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'))

const derive = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
  hash: string
): Promise<ArrayBuffer> => {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash },
    keyMaterial,
    KEY_BYTES * 8
  )
}

export const hashPassword = async (
  password: string
): Promise<Pick<Account, 'passwordHash' | 'salt' | 'iterations' | 'hash'>> => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const bits = await derive(password, salt, PBKDF2_ITERATIONS, PBKDF2_HASH)
  return {
    passwordHash: toB64(bits),
    salt: toB64(salt.buffer as ArrayBuffer),
    iterations: PBKDF2_ITERATIONS,
    hash: PBKDF2_HASH,
  }
}

/** Length-independent compare, so a wrong password can't be timed out character by character. */
const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export const verifyPassword = async (account: Account, password: string): Promise<boolean> => {
  const bits = await derive(
    password,
    fromB64(account.salt),
    // Read off the record rather than the constant, so raising the cost later
    // doesn't lock out everyone who signed up before.
    account.iterations ?? PBKDF2_ITERATIONS,
    account.hash ?? PBKDF2_HASH
  )
  return timingSafeEqual(new Uint8Array(bits), fromB64(account.passwordHash))
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

export const getAccount = async (email: string): Promise<Account | null> =>
  (await redis.get<Account>(accountKey(email))) ?? null

export const putAccount = async (account: Account): Promise<void> => {
  await redis.set(accountKey(account.email), account)
}

export const getTokenOwner = async (token: string): Promise<string | null> =>
  (await redis.get<string>(ownerKey(token))) ?? null

export const claimToken = async (token: string, email: string): Promise<void> => {
  await redis.set(ownerKey(token), email)
}

/**
 * Drops the ownership record but never the data. A released namespace stays
 * readable at its own URL, which is what makes linking safe: the sparks under
 * the account's previous token are not destroyed, just no longer bookmarked.
 */
export const releaseToken = async (token: string): Promise<void> => {
  await redis.del(ownerKey(token))
}

// ─── Sessions ────────────────────────────────────────────────────────────────

const randomB64Url = (bytes: number): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url')

export const createSession = async (email: string): Promise<string> => {
  const sid = randomB64Url(32)
  await redis.set(sessionKey(sid), email, { ex: SESSION_TTL_SECONDS })
  return sid
}

export const readSession = async (sid: string | undefined): Promise<string | null> => {
  if (!sid) return null
  return (await redis.get<string>(sessionKey(sid))) ?? null
}

export const destroySession = async (sid: string | undefined): Promise<void> => {
  if (sid) await redis.del(sessionKey(sid))
}

export const sessionCookie = (sid: string): string =>
  `${SESSION_COOKIE}=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`

export const clearedCookie = (): string =>
  `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`

/** Parsed off the raw header rather than next/headers, so this works in any runtime. */
export const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

/** Resolve the signed-in account from a request cookie, or null. */
export const requireAccount = async (req: Request): Promise<Account | null> => {
  const email = await readSession(readCookie(req, SESSION_COOKIE))
  if (!email) return null
  return getAccount(email)
}

/** Same resolution for a server component, which has the jar rather than the Request. */
export const accountFromSessionId = async (sid: string | undefined): Promise<Account | null> => {
  const email = await readSession(sid)
  if (!email) return null
  return getAccount(email)
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

/** Hashed so a raw IP or email never becomes a Redis key name. */
const rateId = async (id: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
  return Buffer.from(new Uint8Array(digest)).toString('hex').slice(0, 32)
}

export const clientIp = (req: Request): string =>
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
  req.headers.get('x-real-ip') ||
  'unknown'

/**
 * Fails OPEN. A Redis blip should not lock everyone out of signing in — the
 * cost of that is worse than the cost of an unthrottled window.
 */
export const isRateLimited = async (
  scope: string,
  id: string,
  max: number,
  windowSeconds: number
): Promise<boolean> => {
  try {
    const k = rateKey(scope, await rateId(id))
    const n = await redis.incr(k)
    if (n === 1) {
      await redis.expire(k, windowSeconds)
    } else if ((await redis.ttl(k)) < 0) {
      // INCR created the key but the EXPIRE never landed. Without this repair
      // the counter never resets and the caller is locked out permanently.
      await redis.expire(k, windowSeconds)
    }
    return n > max
  } catch {
    return false
  }
}

export const clearRateLimit = async (scope: string, id: string): Promise<void> => {
  try {
    await redis.del(rateKey(scope, await rateId(id)))
  } catch {
    /* best effort */
  }
}
