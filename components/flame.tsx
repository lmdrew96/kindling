/**
 * Matchbook flame glyphs. Purely decorative (aria-hidden): the words beside
 * them always carry the meaning. Colours come from CSS variables, so a glyph
 * inside a .spark-card picks up that card's heat state.
 */

const OUTER = 'M13 2 C 19 8, 21 12, 18 17 C 16.5 19.5, 9.5 19.5, 8 17 C 5 12, 8 8, 13 2 Z'
const INNER = 'M13 8 C 16 11, 16.5 14, 14.8 16.4 C 14 17.4, 12 17.4, 11.2 16.4 C 9.6 14, 10.5 11, 13 8 Z'

/** A lit match: the logo mark beside the wordmark. */
export const MatchMark = ({ className = 'h-[1.1em] w-auto' }: { className?: string }): React.JSX.Element => (
  <svg viewBox="0 0 26 34" aria-hidden="true" className={className}>
    <rect x="11" y="14" width="4" height="20" rx="1.5" fill="var(--match-stick)" />
    {/* The blazing pair, not --color-gold: gold darkens as text in Ash, but a
        fill stays bright. */}
    <path d={OUTER} fill="var(--heat-blazing-outer)" />
    <path d={INNER} fill="var(--heat-blazing-inner)" />
  </svg>
)

/** A card's heat flame. Reads --heat-outer / --heat-inner / --heat-stroke. */
export const HeatFlame = ({ className = 'h-7 w-auto' }: { className?: string }): React.JSX.Element => (
  <svg viewBox="0 0 26 34" aria-hidden="true" className={className}>
    <path d={OUTER} fill="var(--heat-outer)" stroke="var(--heat-stroke)" strokeWidth="1.6" />
    <path d={INNER} fill="var(--heat-inner)" />
    <rect x="11" y="18" width="4" height="15" rx="1.5" fill="var(--heat-stick)" />
  </svg>
)
