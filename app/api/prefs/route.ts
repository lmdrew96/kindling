import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DECAY_BOUNDS, getPrefs, setPrefs } from '@/lib/prefs'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const getToken = (req: NextRequest): string | null => {
  const token = req.nextUrl.searchParams.get('token')
  return token && UUID_RE.test(token) ? token : null
}

const PrefsBody = z
  .object({
    decayThresholdDays: z.number().int().min(DECAY_BOUNDS.min).max(DECAY_BOUNDS.max).optional(),
  })
  .strict()

export async function GET(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  return NextResponse.json(await getPrefs(token))
}

export async function PATCH(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  const parsed = PrefsBody.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid preferences',
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      },
      { status: 400 }
    )
  }

  return NextResponse.json(await setPrefs(token, parsed.data))
}
