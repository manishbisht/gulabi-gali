const ALLOWED_ORIGINS = new Set([
  'https://gulabi-gali.manishbisht.me',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
])

export function allowedOrigin(origin: string | null): string | null {
  return origin !== null && ALLOWED_ORIGINS.has(origin) ? origin : null
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}
