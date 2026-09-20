import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

/**
 * Flat config, invoked directly as `eslint .` — Next 16 removed `next lint`,
 * and the old script silently did nothing but fail, so nothing in this repo
 * was linted until now.
 */
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'tsconfig.tsbuildinfo'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
]

export default config
