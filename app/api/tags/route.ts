import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { renameTag } from '@/lib/sparks'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const getToken = (req: NextRequest): string | null => {
  const token = req.nextUrl.searchParams.get('token')
  return token && UUID_RE.test(token) ? token : null
}

const Body = z
  .object({
    from: z.string().trim().min(1).max(100),
    to: z.string().trim().min(1).max(100),
    /**
     * Scopes the rewrite to specific sparks. Only used to undo: reversing a
     * merge across the whole store would also rename the sparks that carried
     * the target tag before the merge happened.
     */
    restrict_to: z.array(z.string().uuid()).max(1000).optional(),
  })
  .strict()

/**
 * Rename a tag everywhere it appears — the repair half of tag hygiene.
 * Normalization stops new fragmentation; this is what fixes the variants
 * already sitting in the store.
 */
export async function PATCH(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', detail: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 }
    )
  }

  const { from, to, restrict_to } = parsed.data
  const result = await renameTag(token, from, to, restrict_to)
  return NextResponse.json(result)
}
