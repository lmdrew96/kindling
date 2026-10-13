'use client'

/**
 * Horizontal drift (px) and start delay (ms) for each rising ember. Fixed
 * rather than random so render stays pure and every promotion looks the same.
 */
const EMBERS: Array<{ dx: number; delay: number; size: number }> = [
  { dx: -64, delay: 40, size: 6 },
  { dx: -38, delay: 160, size: 4 },
  { dx: -14, delay: 0, size: 7 },
  { dx: 10, delay: 220, size: 5 },
  { dx: 32, delay: 80, size: 6 },
  { dx: 58, delay: 180, size: 4 },
  { dx: -50, delay: 300, size: 3 },
  { dx: 44, delay: 340, size: 3 },
]

/**
 * The flare a promotion plays: a bloom where the promote dialog just closed
 * and a handful of embers rising off it. Purely decorative (the toast carries
 * the message), never takes a click, and unmounts itself once the last ember
 * has risen.
 * The caller skips it entirely under prefers-reduced-motion.
 */
export function EmberFlare({ onDone }: { onDone: () => void }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center"
    >
      <div className="relative size-0">
        <span className="ember-bloom" />
        {EMBERS.map((e, i) => (
          <span
            key={i}
            // The last ember has the longest delay, so it finishes last.
            onAnimationEnd={i === EMBERS.length - 1 ? onDone : undefined}
            className="ember-mote"
            style={
              {
                '--dx': `${e.dx}px`,
                animationDelay: `${e.delay}ms`,
                width: e.size,
                height: e.size,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  )
}
