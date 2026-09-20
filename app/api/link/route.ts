import { claimToken, getTokenOwner, putAccount, releaseToken, requireAccount } from '@/lib/auth'
import { parseKindlingToken } from '@/lib/token-input'
import { listSparks } from '@/lib/sparks'

export const runtime = 'nodejs'

const fail = (error: string, status = 400) => Response.json({ error }, { status })

/**
 * Point an account at an existing token — the path for someone who used
 * Kindling before accounts existed and does not want to lose their corpus.
 *
 * THE LINKED TOKEN WINS. The account is repointed at it rather than the sparks
 * being copied across, because the token is what every already-configured MCP
 * client has in its config. Rotating it would silently break all of them, and
 * the whole reason this is a bookmark rather than an access layer is so that
 * cannot happen.
 *
 * The account's previous token is released, never deleted: its sparks stay
 * exactly where they were and stay readable at their own URL. Linking moves a
 * bookmark; it does not destroy a namespace.
 */
export async function POST(req: Request) {
  const account = await requireAccount(req)
  if (!account) return fail('Not signed in.', 401)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail('Malformed request.')
  }

  const linked = parseKindlingToken(String(body.token ?? ''))
  if (!linked) {
    return fail("That doesn't look like a Kindling token or URL.")
  }
  if (linked === account.token) {
    return fail('That token is already linked to this account.')
  }

  // Someone else's namespace is not claimable. Absence of an owner means
  // "unowned", which is the normal case for a pre-accounts token.
  const owner = await getTokenOwner(linked)
  if (owner && owner !== account.email) {
    return fail('That token belongs to another account.', 403)
  }

  const previous = account.token
  const previousCount = (await listSparks(previous)).length

  await claimToken(linked, account.email)
  account.token = linked
  await putAccount(account)
  if (previous && previous !== linked) await releaseToken(previous)

  return Response.json({
    account: { email: account.email, token: account.token, createdAt: account.createdAt },
    previous,
    /**
     * Surfaced so the UI can warn rather than silently orphan: if the account's
     * old namespace had sparks in it, they are still there, but the account no
     * longer points at them.
     */
    previousSparkCount: previousCount,
  })
}
