import { NextResponse, type NextRequest } from 'next/server'
import { handleMcpGet, handleMcpPost } from '@/lib/mcp-server'
import type { SparkSource } from '@/lib/types'

export const runtime = 'nodejs'

/**
 * Which Claude is calling, taken from the URL — the same pattern Tangle uses.
 * Unknown names 404 rather than falling back, so a typo in a connector URL is
 * loud instead of quietly mislabelling every capture.
 */
const IDENTITIES: Record<string, SparkSource> = { coru: 'coru', cody: 'cody' }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; identity: string }> }
) {
  const { token, identity } = await params
  const source = IDENTITIES[identity.toLowerCase()]
  if (!source) {
    return NextResponse.json(
      { error: `Unknown identity "${identity}". Use one of: ${Object.keys(IDENTITIES).join(', ')}.` },
      { status: 404 }
    )
  }
  return handleMcpPost(req, token, source)
}

export const GET = handleMcpGet
