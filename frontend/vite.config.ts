import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { createHash } from 'node:crypto'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/**
 * A Content-Security-Policy for the built site, as a <meta> because GitHub
 * Pages cannot send headers. Built rather than written out: the API's origin
 * is a build-time setting, and any inline script is allowed by its hash, taken
 * from the HTML as built so an edit to it cannot silently fall outside the
 * policy. Not in dev, whose HMR client and React preamble are inline and on
 * another socket.
 *
 * - blob: and data: images: generated textures and inline SVG.
 * - frame-ancestors cannot be set from a <meta>; that one needs a header.
 */
function contentSecurityPolicy(): Plugin {
  let env: Record<string, string> = {}
  return {
    name: 'content-security-policy',
    apply: 'build',
    configResolved(config) {
      env = config.env
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const api = new URL(env.VITE_API_URL || 'http://127.0.0.1:8787')
        const socket = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
          ([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
        )
        const policy = {
          'default-src': ["'self'"],
          'script-src': ["'self'", ...inline],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'", api.origin, socket],
          'worker-src': ["'self'", 'blob:'],
          'frame-src': ["'none'"],
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
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), contentSecurityPolicy()],
  build: {
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
})
