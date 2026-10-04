import {
  MAX_LABEL_LENGTH,
  MAX_TOKENS_PER_ACCOUNT,
  accountTokens,
  claimToken,
  getTokenOwner,
  ownsToken,
  publicAccount,
  putAccount,
  releaseToken,
  requireAccount,
  type Account,
} from '@/lib/auth'
import { parseKindlingToken } from '@/lib/token-input'

export const runtime = 'nodejs'

const fail = (error: string, status = 400) => Response.json({ error }, { status })

const readBody = async (req: Request): Promise<Record<string, unknown> | null> => {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

const cleanLabel = (raw: unknown): string | null => {
  const label = String(raw ?? '').trim()
  return label.length > 0 && label.length <= MAX_LABEL_LENGTH ? label : null
}

/** Every write goes through here, so `tokens` is always materialised afterwards. */
const save = async (account: Account, tokens: Account['tokens']): Promise<Response> => {
  account.tokens = tokens
  await putAccount(account)
  return Response.json({ account: publicAccount(account) })
}

/**
 * Add a namespace to the account: either link one that already exists (the
 * pre-accounts token, a work token from another device) or mint a fresh one.
 *
 * Linking APPENDS. It used to repoint the account and release the old token;
 * now an account holds several, so nothing is released and every
 * already-configured MCP client keeps working — each namespace keeps its own
 * `/{token}/mcp` URL, because the token is the path.
 */
export async function POST(req: Request) {
  const account = await requireAccount(req)
  if (!account) return fail('Not signed in.', 401)

  const body = await readBody(req)
  if (!body) return fail('Malformed request.')

  const tokens = accountTokens(account)
  if (tokens.length >= MAX_TOKENS_PER_ACCOUNT) {
    return fail(`An account can hold up to ${MAX_TOKENS_PER_ACCOUNT} tokens.`)
  }

  const label = cleanLabel(body.label ?? (body.create ? 'New' : 'Linked'))
  if (!label) return fail(`Give it a name of 1–${MAX_LABEL_LENGTH} characters.`)

  if (body.create === true) {
    const token = crypto.randomUUID()
    await claimToken(token, account.email)
    return save(account, [...tokens, { token, label }])
  }

  const linked = parseKindlingToken(String(body.token ?? ''))
  if (!linked) return fail("That doesn't look like a Kindling token or URL.")
  if (ownsToken(account, linked)) return fail('That token is already on this account.')

  // Someone else's namespace is not claimable. Absence of an owner means
  // "unowned", which is the normal case for a pre-accounts token.
  const owner = await getTokenOwner(linked)
  if (owner && owner !== account.email) {
    return fail('That token belongs to another account.', 403)
  }

  await claimToken(linked, account.email)
  return save(account, [...tokens, { token: linked, label }])
}

/** Rename a namespace, or make it the default a new device lands on. */
export async function PATCH(req: Request) {
  const account = await requireAccount(req)
  if (!account) return fail('Not signed in.', 401)

  const body = await readBody(req)
  if (!body) return fail('Malformed request.')

  const target = String(body.token ?? '')
  if (!ownsToken(account, target)) return fail('That token is not on this account.', 404)

  let tokens = accountTokens(account)
  if (body.label !== undefined) {
    const label = cleanLabel(body.label)
    if (!label) return fail(`Give it a name of 1–${MAX_LABEL_LENGTH} characters.`)
    tokens = tokens.map((t) => (t.token === target ? { ...t, label } : t))
  }
  if (body.default === true) account.token = target

  return save(account, tokens)
}

/**
 * Take a namespace off the account. Ownership is released; the sparks are
 * NOT deleted and stay readable at their own URL. The last token cannot be
 * removed — an account with no namespace has nothing to remember.
 */
export async function DELETE(req: Request) {
  const account = await requireAccount(req)
  if (!account) return fail('Not signed in.', 401)

  const body = await readBody(req)
  if (!body) return fail('Malformed request.')

  const target = String(body.token ?? '')
  if (!ownsToken(account, target)) return fail('That token is not on this account.', 404)

  const remaining = accountTokens(account).filter((t) => t.token !== target)
  if (remaining.length === 0) return fail("That's the account's only token — it can't be removed.")

  if (account.token === target) account.token = remaining[0].token
  await releaseToken(target)
  return save(account, remaining)
}
