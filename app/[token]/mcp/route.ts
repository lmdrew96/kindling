import type { NextRequest } from 'next/server'
import { handleMcpGet, handleMcpPost } from '@/lib/mcp-server'

export const runtime = 'nodejs'

/** No identity suffix: captures are recorded as from an unnamed Claude. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return handleMcpPost(req, token, 'claude')
}

export const GET = handleMcpGet
