// A production build (no VITE_TEST_HOOKS) must carry no test-hook code. Builds the frontend into a
// scratch directory and fails if `__gg`, or one of the e2e-only address switches (`gg-test`, `gg-full`,
// `gg-festival`, `gg-sw`), appears in any emitted script: each is read only behind the build flag, so a production
// build must fold it away, or a shared link could change what someone's city does.
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
  const scripts = readdirSync(assets).filter((f) => f.endsWith('.js'))
  if (!scripts.length) {
    console.error(`no .js files in ${assets}: the build output moved, so this check would pass for nothing`)
    process.exit(1)
  }
  const TEST_ONLY = ['__gg', 'gg-test', 'gg-full', 'gg-festival', 'gg-sw']
  const leaks = scripts.flatMap((f) => {
    const code = readFileSync(join(assets, f), 'utf8')
    return TEST_ONLY.filter((name) => code.includes(name)).map((name) => `${name} in ${f}`)
  })
  if (leaks.length) {
    console.error(`test hooks leaked into the production build: ${leaks.join(', ')}`)
    process.exit(1)
  }
  console.log(`ok: none of ${TEST_ONLY.join(', ')} in the production build`)
} finally {
  rmSync(out, { recursive: true, force: true })
}
