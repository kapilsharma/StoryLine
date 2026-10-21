import { mergeConfig } from 'vitest/config'
import base from './vitest.config'

/**
 * Benchmarks (#185): same aliases and setup as the test suite, but only the
 * `tests/bench` files, one at a time, with output shown. Not part of `npm test`.
 *
 *   npm run bench:index
 */
const config = mergeConfig(base, { test: { fileParallelism: false, silent: false } })
// Replaced, not merged: `mergeConfig` concatenates arrays, which would pull the
// whole test suite in alongside the benchmarks.
config.test!.include = ['tests/bench/**/*.bench.ts']

export default config
