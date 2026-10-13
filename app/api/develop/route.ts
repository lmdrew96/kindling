import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import * as z4 from 'zod/v4'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { getSpark } from '@/lib/sparks'
import { KIND_LABELS, type Spark } from '@/lib/types'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MODEL = 'claude-sonnet-5-5'

/** Generous for a 15-minute session; a cap so one request can't grow without bound. */
const MAX_TURNS = 40

const Body = z
  .object({
    spark_id: z.string().uuid(),
    /** 'ask' gets the next question; 'finish' ends the session with a proposal. */
    mode: z.enum(['ask', 'finish']),
    /** The session so far, starting with Claude's first question. Text only. */
    history: z
      .array(
        z.object({
          role: z.enum(['assistant', 'user']),
          content: z.string().trim().min(1).max(4000),
        })
      )
      .max(MAX_TURNS),
  })
  .strict()

const SYSTEM = `You are helping someone develop an idea they saved in Kindling, an app for ideas worth coming back to. This is a short session, about fifteen minutes. Your job is to ask questions that sharpen the idea, not to develop it for them.

Cover three things, roughly in this order:
1. What the idea is for: who or what it serves, and why it matters to them.
2. What is still unclear or undecided about it.
3. What the smallest real version of it would be.

Ask exactly one question per message. Keep each message short: at most one sentence acknowledging their last answer, then the question. Build on what they've said rather than repeating ground. Offer options only if they say they're stuck.

Once all three are covered (usually after three to five questions), tell them they have enough to wrap up, and ask whether there's anything they want to add first.`

const WRAP_UP = `Wrap up the session now, even if not everything was covered.

Return:
- writeup: an updated body for the spark, in markdown and in their voice. Keep everything from the original that still holds, and fold in what this session clarified: what it's for, what's still open, and the smallest version. Don't invent anything they didn't say.
- next_step: one concrete action they could take next, under 200 characters.`

const Proposal = z4.object({
  writeup: z4.string(),
  next_step: z4.string(),
})

/** The spark as Claude sees it: the fields that describe the idea, nothing about decay. */
const describeSpark = (s: Spark): string =>
  [
    `Title: ${s.title ?? '(untitled)'}`,
    s.kind ? `Kind: ${KIND_LABELS[s.kind]}` : null,
    s.home ? `Home: ${s.home}` : null,
    s.next_step ? `Current next step: ${s.next_step}` : null,
    '',
    s.content,
  ]
    .filter((line) => line !== null)
    .join('\n')

const textOf = (message: Anthropic.Beta.BetaMessage): string =>
  message.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
    .trim()

/**
 * The "Develop this" session. Stateless: the client holds the conversation
 * and sends it back each turn, so nothing about a session is stored until
 * the user accepts the proposal and it is saved through the normal PATCH.
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Develop isn't set up on this server yet (no Anthropic API key)." },
      { status: 503 }
    )
  }

  const { spark_id, mode, history } = parsed.data
  const spark = await getSpark(token, spark_id)
  if (!spark) return NextResponse.json({ error: 'Spark not found' }, { status: 404 })

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: `Here's the spark I want to develop.\n\n${describeSpark(spark)}\n\nAsk your first question.`,
    },
    ...history,
  ]
  if (mode === 'finish') messages.push({ role: 'user', content: WRAP_UP })

  const client = new Anthropic()

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: mode === 'finish' ? 16000 : 4000,
      system: SYSTEM,
      messages,
      // Questions are chat; the write-up is the part worth thinking about.
      output_config:
        mode === 'finish'
          ? { effort: 'medium', format: zodOutputFormat(Proposal) }
          : { effort: 'low' },
      // On a policy decline, the API retries on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })

    if (response.stop_reason === 'refusal') {
      return NextResponse.json(
        { error: "Claude declined to continue this session. Try rephrasing your last answer." },
        { status: 502 }
      )
    }
    if (response.stop_reason === 'max_tokens') {
      return NextResponse.json(
        { error: 'The reply ran too long and was cut off. Try again.' },
        { status: 502 }
      )
    }

    const text = textOf(response)

    if (mode === 'ask') {
      if (!text) return NextResponse.json({ error: 'Claude sent an empty reply.' }, { status: 502 })
      return NextResponse.json({ question: text })
    }

    const proposal = Proposal.safeParse(JSON.parse(text))
    if (!proposal.success) {
      return NextResponse.json({ error: "Couldn't read the write-up. Try again." }, { status: 502 })
    }
    return NextResponse.json({
      writeup: proposal.data.writeup.trim(),
      // The spark field caps at 300; the prompt asks for 200 to leave room.
      next_step: proposal.data.next_step.trim().slice(0, 300),
    })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error('develop: Anthropic rejected the API key', error.message)
      return NextResponse.json(
        { error: "Develop isn't set up correctly on this server (the API key was rejected)." },
        { status: 503 }
      )
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Claude is busy right now. Try again in a minute.' }, { status: 429 })
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`develop: Anthropic API error ${error.status}`, error.message)
      return NextResponse.json({ error: "Couldn't reach Claude. Try again." }, { status: 502 })
    }
    if (error instanceof SyntaxError) {
      console.error('develop: write-up was not valid JSON', error.message)
      return NextResponse.json({ error: "Couldn't read the write-up. Try again." }, { status: 502 })
    }
    throw error
  }
}
