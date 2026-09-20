import { cookies } from 'next/headers'
import { KindlingApp } from './kindling-app'
import { TOKEN_COOKIE } from '@/lib/token-cookie'
import { SESSION_COOKIE, accountFromSessionId, publicAccount } from '@/lib/auth'
import { UUID_RE } from '@/components/ui'

/**
 * A server component whose only job is to decide which screen to send.
 *
 * The dashboard is still a client island — it has to be, since the sparks are
 * fetched with the token from the browser. But the branch is chosen here, so
 * the HTML that goes over the wire is either the real landing page or the real
 * dashboard shell, never an empty body waiting on hydration.
 */
export default async function Page() {
  const jar = await cookies()

  // The account's token wins when signed in; otherwise whatever this browser
  // remembers. Resolving the session here rather than in an effect is what
  // keeps a signed-in user from flashing the landing page on every load.
  const account = await accountFromSessionId(jar.get(SESSION_COOKIE)?.value)

  const stored = jar.get(TOKEN_COOKIE)?.value
  const cookieToken = stored && UUID_RE.test(stored) ? stored : null

  return (
    <KindlingApp
      initialToken={account?.token ?? cookieToken}
      initialAccount={account ? publicAccount(account) : null}
    />
  )
}
