import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateSpark } from '@/lib/sparks'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Body = z
  .object({
    spark_id: z.string().uuid(),
    target: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()

/**
 * Promotion has its own endpoint rather than widening the PATCH whitelist,
 * which deliberately refuses promoted_* writes. Keeping it here means the
 * server owns promoted_at, so provenance dates can't be fabricated by a
 * client, and the archive side-effect stays in one place.
 */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token || !UUID_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', detail: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 }
    )
  }

  const { spark_id, target, notes } = parsed.data
  const updated = await updateSpark(token, spark_id, {
    promoted_to: target,
    promoted_at: Date.now(),
    promoted_notes: notes ?? null,
    status: 'archived',
  })
  if (!updated) return NextResponse.json({ error: 'Spark not found' }, { status: 404 })

  return NextResponse.json(updated)
}
