'use client'

import { useState } from 'react'

export default function Home() {
  const [mcpUrl, setMcpUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  const generate = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/register', { method: 'POST' })
      const data = await res.json() as { mcp_url: string }
      setMcpUrl(data.mcp_url)
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    if (!mcpUrl) return
    await navigator.clipboard.writeText(mcpUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#1E1830] text-[#F7F5FA] px-6">
      <div className="w-full max-w-lg text-center space-y-6">
        <div>
          <h1 className="text-4xl font-bold text-[#DFA649] mb-2">Kindling</h1>
          <p className="text-[#8CBDB9] text-sm">
            Capture sparks before they fade. Surface them before they go cold.
          </p>
        </div>

        {!mcpUrl ? (
          <button
            onClick={generate}
            disabled={loading}
            className="px-6 py-3 rounded-lg bg-[#DFA649] text-[#1E1830] font-semibold hover:bg-[#c8933e] transition-colors disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Get your Kindling URL'}
          </button>
        ) : (
          <div className="space-y-4">
            <p className="text-[#8CBDB9] text-sm">
              Add this to your Claude MCP config. Keep it private — it&apos;s your key.
            </p>
            <div className="flex items-center gap-2 bg-[#2a2040] rounded-lg px-4 py-3 text-left">
              <code className="flex-1 text-[#97D181] text-sm break-all">{mcpUrl}</code>
              <button
                onClick={copy}
                className="shrink-0 text-xs text-[#8CBDB9] hover:text-[#F7F5FA] transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-[#88739E] text-xs">
              Each click generates a new unique URL. Save this one — it won&apos;t be shown again.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
