// A production build (no VITE_TEST_HOOKS) must carry no test-hook code. Builds the frontend into a
// scratch directory and fails if `__gg` appears in any emitted script.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'gg-prod-'))
try {
  const env = { ...process.env, GG_ALLOW_LOCAL_API: '1' }
  delete env.VITE_TEST_HOOKS
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
    cwd: new URL('../frontend', import.meta.url),
    env,
    stdio: 'inherit',
  })
  const assets = join(out, 'assets')
  const leaks = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => readFileSync(join(assets, f), 'utf8').includes('__gg'))
  if (leaks.length) {
    console.error(`test hooks leaked into the production build: ${leaks.join(', ')}`)
    process.exit(1)
  }
  console.log('ok: no __gg in the production build')
} finally {
  rmSync(out, { recursive: true, force: true })
}
