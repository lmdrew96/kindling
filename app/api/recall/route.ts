import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recallSparks } from '@/lib/sparks'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Body = z
  .object({
    limit: z.number().int().min(1).max(25).optional().default(5),
    tags: z.array(z.string().min(1)).optional(),
    context: z.string().optional(),
  })
  .strict()

/**
 * POST, not GET, because recall MUTATES — showing a spark bumps surface_count
 * and resets its decay clock. That is what stops the same five surfacing
 * forever, and it would be wrong to let a prefetch or a refresh trigger it.
 */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token || !UUID_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { limit, tags, context } = parsed.data
  const sparks = await recallSparks(token, limit, tags, context)
  return NextResponse.json(sparks)
}
