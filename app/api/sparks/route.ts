import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSpark, listSparks, updateSpark } from '@/lib/sparks'
import { exportFilename, toJson, toMarkdown } from '@/lib/export'
import type { SparkStatus } from '@/lib/types'

export const runtime = 'nodejs'

/** The only fields the dashboard is allowed to change. */
const PatchBody = z
  .object({
    status: z.enum(['active', 'cold', 'archived']).optional(),
    cold_at: z.number().int().nullable().optional(),
    title: z.string().min(1).max(200).nullable().optional(),
    content: z.string().min(1).max(100_000).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict()

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

  // ?format=json|markdown returns a downloadable file rather than the array
  // the dashboard consumes.
  const format = req.nextUrl.searchParams.get('format')
  if (format === 'json' || format === 'markdown') {
    const body = format === 'json' ? toJson(sparks) : toMarkdown(sparks)
    return new NextResponse(body, {
      headers: {
        'Content-Type':
          format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFilename(format)}"`,
      },
    })
  }

  return NextResponse.json(sparks)
}

export async function POST(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  const { content, tags, title } = await req.json() as {
    content: string
    tags?: string[]
    title?: string
  }
  if (!content?.trim()) return NextResponse.json({ error: 'content is required' }, { status: 400 })

  const spark = await createSpark(token, content.trim(), tags ?? [], title ?? null)
  return NextResponse.json(spark, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Whitelisted, for the same reason the MCP boundary is: Upstash stores
  // whatever it is handed, so an unguarded PATCH lets a caller write any field
  // on the record — including the promotion provenance and the decay clock.
  const parsed = PatchBody.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid update', detail: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 }
    )
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const spark = await updateSpark(token, id, parsed.data)
  if (!spark) return NextResponse.json({ error: 'Spark not found' }, { status: 404 })

  return NextResponse.json(spark)
}
