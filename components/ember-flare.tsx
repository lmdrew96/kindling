'use client'

/**
 * Rising embers: horizontal drift (px), start delay (ms), size (px) and rise
 * height (vh). Derived from the index rather than Math.random so render stays
 * pure and every promotion looks the same.
 */
const EMBERS: Array<{ dx: number; delay: number; size: number; rise: number }> =
  Array.from({ length: 30 }, (_, i) => ({
    dx: ((i * 47) % 220) - 110,
    delay: 250 + ((i * 83) % 1100),
    size: 3 + ((i * 5) % 6),
    rise: 40 + ((i * 13) % 30),
  }))

/** Sparks thrown outward at the moment of ignition: angle (deg) and reach (px). */
const SPARKS: Array<{ angle: number; reach: number }> = Array.from(
  { length: 16 },
  (_, i) => ({ angle: i * 22.5 + ((i * 7) % 10), reach: 120 + ((i * 37) % 90) })
)

/**
 * The flare a promotion plays: the screen warms, a flame roars up where the
 * promote dialog just closed, sparks burst off it and a plume of embers climbs
 * most of the way up the screen. Purely decorative (the toast carries the
 * message), never takes a click, and unmounts itself when the stage animation
 * (which outlasts every piece) ends.
 * The caller skips it entirely under prefers-reduced-motion.
 */
export function EmberFlare({ onDone }: { onDone: () => void }) {
  return (
    <div
      aria-hidden="true"
      className="ember-stage pointer-events-none fixed inset-0 z-40 flex items-center justify-center"
      // animationend bubbles, so ignore the children's and wait for the stage's own.
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onDone()
      }}
    >
      <span className="ember-wash" />
      <div className="relative size-0">
        <span className="ember-bloom" />
        <span className="ember-flame ember-flame-outer" />
        <span className="ember-flame ember-flame-mid" />
        <span className="ember-flame ember-flame-core" />
        {SPARKS.map((s, i) => (
          <span
            key={`s${i}`}
            className="ember-spark"
            style={
              {
                '--angle': `${s.angle}deg`,
                '--reach': `${s.reach}px`,
              } as React.CSSProperties
            }
          />
        ))}
        {EMBERS.map((e, i) => (
          <span
            key={`e${i}`}
            className="ember-mote"
            style={
              {
                '--dx': `${e.dx}px`,
                '--rise': `-${e.rise}vh`,
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
