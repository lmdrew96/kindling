import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const host = req.headers.get('host') ?? 'kindling.adhdesigns.dev'
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  const token = uuidv4()
  const mcp_url = `${protocol}://${host}/${token}/mcp`

  return NextResponse.json({ token, mcp_url })
}
