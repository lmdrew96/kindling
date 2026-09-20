import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { addTagToMany, removeTag, renameTag } from '@/lib/sparks'

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

const RemoveBody = z.object({ tag: z.string().trim().min(1).max(100) }).strict()

/**
 * Strip a tag from every spark carrying it.
 *
 * Separate from PATCH rather than folded in as a rename-to-nothing, because
 * the two have different reversibility stories and the caller should not be
 * able to confuse them: a rename may silently be a merge, this never is.
 */
export async function DELETE(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  const parsed = RemoveBody.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', detail: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 }
    )
  }

  const changed = await removeTag(token, parsed.data.tag)
  return NextResponse.json({ changed })
}

const RestoreBody = z
  .object({
    tag: z.string().trim().min(1).max(100),
    /** Exactly the sparks a DELETE stripped — this is the undo half. */
    ids: z.array(z.string().uuid()).min(1).max(1000),
  })
  .strict()

/** Put a tag back on specific sparks. Exists to undo DELETE, nothing else. */
export async function POST(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  const parsed = RestoreBody.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', detail: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 }
    )
  }

  const { tag, ids } = parsed.data
  const changed = await addTagToMany(token, tag, ids)
  return NextResponse.json({ changed })
}
