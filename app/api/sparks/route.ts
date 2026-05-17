import { NextRequest, NextResponse } from 'next/server'
import { createSpark, listSparks, updateSpark } from '@/lib/sparks'
import type { SparkStatus } from '@/lib/types'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getToken(req: NextRequest): string | null {
  const token = req.nextUrl.searchParams.get('token')
  return token && UUID_RE.test(token) ? token : null
}

export async function GET(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  const status = req.nextUrl.searchParams.get('status') as SparkStatus | null
  const sparks = await listSparks(token, status ?? undefined)
  return NextResponse.json(sparks)
}

export async function POST(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  const { content, tags } = await req.json() as { content: string; tags?: string[] }
  if (!content?.trim()) return NextResponse.json({ error: 'content is required' }, { status: 400 })

  const spark = await createSpark(token, content.trim(), tags ?? [])
  return NextResponse.json(spark, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const updates = await req.json() as Record<string, unknown>
  const spark = await updateSpark(token, id, updates)
  if (!spark) return NextResponse.json({ error: 'Spark not found' }, { status: 404 })

  return NextResponse.json(spark)
}
