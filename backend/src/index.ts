import { allowedOrigin, corsHeaders } from './cors'
import type { Env } from './env'

function json(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, { status, headers: origin ? corsHeaders(origin) : undefined })
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const origin = allowedOrigin(request.headers.get('Origin'))
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : undefined })
    }
    const { pathname } = new URL(request.url)
    if (pathname === '/health') return json({ ok: true }, 200, origin)
    return json({ error: 'not found' }, 404, origin)
  },
} satisfies ExportedHandler<Env>
