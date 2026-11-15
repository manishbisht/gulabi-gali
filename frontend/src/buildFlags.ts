/** True in a build made with `VITE_CF_BEACON_TOKEN` (Cloudflare Web Analytics on), defined by vite.config.ts. */
declare const __GG_ANALYTICS__: boolean | undefined

/**
 * Whether this build counts visits with Cloudflare Web Analytics. A constant the bundler folds, so a build
 * without the token carries nothing that only matters with it.
 */
export const ANALYTICS_ON: boolean = typeof __GG_ANALYTICS__ === 'boolean' && __GG_ANALYTICS__
