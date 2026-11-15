import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import { analyticsCsp, analyticsTag } from './src/analytics.ts'

/** The commit being built (git short sha; `GG_BUILD_SHA` overrides), so an error report names its bundle. */
function buildSha(): string {
  if (process.env.GG_BUILD_SHA) return process.env.GG_BUILD_SHA
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() || 'dev'
  } catch {
    return 'dev'
  }
}

/**
 * Clerk's Frontend API host, which a publishable key carries base64-encoded
 * (`pk_live_<base64 of "clerk.example.com$">`). clerk-js is served from there
 * and talks to it, so it is the one Clerk host that differs per instance.
 */
function clerkHost(key: string | undefined): string | null {
  const encoded = key?.match(/^pk_(?:test|live)_(.+)$/)?.[1]
  if (!encoded) return null
  const host = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '')
  return /^[a-z0-9.-]+$/i.test(host) ? host : null
}

/**
 * A Content-Security-Policy for the built site, as a <meta> because GitHub
 * Pages cannot send headers. Built rather than written out: the API's origin
 * is a build-time setting, and any inline script is allowed by its hash, taken
 * from the HTML as built so an edit to it cannot silently fall outside the
 * policy. Not in dev, whose HMR client and React preamble are inline and on
 * another socket.
 *
 * - blob: and data: images: generated textures and inline SVG.
 * - Clerk (only when a key is set): its host for clerk-js and its API, img.clerk.com for
 *   avatars, and Cloudflare's challenge (a script and a frame) for bot protection on sign-up.
 *   Clerk injects its own <style>, which style-src already allows.
 * - Cloudflare Web Analytics (only when VITE_CF_BEACON_TOKEN is set): its beacon script, put in
 *   the page here, and the host it reports to (see src/analytics.ts).
 * - frame-ancestors cannot be set from a <meta>; that one needs a header.
 */
function contentSecurityPolicy(): Plugin {
  let env: Record<string, string> = {}
  return {
    name: 'content-security-policy',
    apply: 'build',
    configResolved(config) {
      env = config.env
      // A production bundle that quietly points at 127.0.0.1 would ship a site whose sky and
      // festivals can never load, and a CSP that blocks the real API. Say so at build time.
      // The dev sign-in sheet needs no password: only a build against a local Worker may carry it.
      if (env.VITE_DEV_AUTH === '1' && process.env.GG_ALLOW_LOCAL_API !== '1') {
        throw new Error(
          'VITE_DEV_AUTH=1 would ship a sign-in that needs only a name. It is for e2e and local builds only: ' +
            'unset it, or set GG_ALLOW_LOCAL_API=1 to build against a local Worker on purpose.',
        )
      }
      if (config.mode === 'production' && !env.VITE_API_URL && process.env.GG_ALLOW_LOCAL_API !== '1') {
        throw new Error(
          'VITE_API_URL is not set. A production build needs the API origin (the GitHub secret VITE_API_BASE_URL, ' +
            'e.g. https://api.gulabi-gali.manishbisht.me). To build against a local Worker on purpose ' +
            '(e2e, previews), set GG_ALLOW_LOCAL_API=1.',
        )
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler(page) {
        const beacon = analyticsTag(env.VITE_CF_BEACON_TOKEN)
        const html = beacon ? page.replace('</body>', `  ${beacon}\n  </body>`) : page
        const analytics = analyticsCsp(env.VITE_CF_BEACON_TOKEN)
        const api = new URL(env.VITE_API_URL || 'http://127.0.0.1:8787')
        const socket = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`
        const clerk = clerkHost(env.VITE_CLERK_PUBLISHABLE_KEY)
        const challenge = 'https://challenges.cloudflare.com'
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
          ([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
        )
        const policy = {
          'default-src': ["'self'"],
          'script-src': [
            "'self'",
            ...inline,
            ...(clerk ? [`https://${clerk}`, challenge] : []),
            ...analytics.script,
          ],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:', 'blob:', ...(clerk ? ['https://img.clerk.com'] : [])],
          'connect-src': [
            "'self'",
            api.origin,
            socket,
            ...(clerk ? [`https://${clerk}`] : []),
            ...analytics.connect,
          ],
          'worker-src': ["'self'", 'blob:'],
          'frame-src': clerk ? [challenge] : ["'none'"],
          'manifest-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        }
        const content = Object.entries(policy)
          .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
          .join('; ')
        // Right after the charset (which has to stay in the first 1024 bytes) and
        // ahead of everything else: a meta policy only governs what follows it.
        return html.replace(
          /<meta charset="UTF-8" \/>/,
          (charset) => `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${content}" />`,
        )
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), contentSecurityPolicy()],
  define: {
    // read by src/net/errorBeacon.ts
    __GG_BUILD__: JSON.stringify(buildSha()),
    // read by src/buildFlags.ts: the privacy sheet names Web Analytics only in a build that has it
    __GG_ANALYTICS__: JSON.stringify(!!loadEnv(mode, import.meta.dirname, 'VITE_').VITE_CF_BEACON_TOKEN),
  },
  build: {
    // The `three` chunk is Three.js itself, about 570 kB minified (~145 kB gzipped), and is
    // split out on purpose so it caches across deploys. It is the one chunk allowed past
    // Vite's default 500 kB warning; every other chunk is far smaller.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Three.js is most of the download and changes far less often than the
          // app does. In a chunk of its own its hash survives a deploy, so returning
          // players keep it cached.
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
}))
