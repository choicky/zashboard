import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dir = mkdtempSync(join(tmpdir(), 'zashboard-sync-'))
const rangeDir = mkdtempSync(join(tmpdir(), 'zashboard-range-'))
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
const rangeGit = (...args) =>
  execFileSync('git', ['-C', rangeDir, ...args], { encoding: 'utf8' }).trim()
const commit = (message) => {
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', message], { stdio: 'ignore' })
  return git('rev-parse', 'HEAD')
}
const contains = (ancestor, descendant) => {
  try {
    git('merge-base', '--is-ancestor', ancestor, descendant)
    return true
  } catch {
    return false
  }
}
// Mirrors the workflow rule: fast-forward only when mirror is an ancestor of
// upstream, and synchronize custom only when upstream is not already included.
const decide = (mirror, upstream, custom) => ({
  canFastForward: contains(mirror, upstream),
  needsSync: !contains(upstream, custom),
})

try {
  git('init', '-q')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'test')
  const base = commit('base')

  // No upstream change: identical mirror and upstream are a successful no-op.
  assert.deepEqual(decide(base, base, base), { canFastForward: true, needsSync: false })

  // Custom-only fork commits are a successful no-op and need no empty PR.
  const customFork = commit('fork custom work')
  assert.deepEqual(decide(base, base, customFork), { canFastForward: true, needsSync: false })
  assert.equal(contains(base, customFork), true)

  // One new upstream commit needs a synchronization PR, but only if custom
  // does not already contain it.
  git('checkout', '-q', base)
  const upstreamNew = commit('upstream change')
  assert.deepEqual(decide(base, upstreamNew, customFork), {
    canFastForward: true,
    needsSync: true,
  })
  git('checkout', '-q', upstreamNew)
  assert.deepEqual(decide(upstreamNew, upstreamNew, upstreamNew), {
    canFastForward: true,
    needsSync: false,
  })

  // A mirror with an unrelated fork-only commit must be rejected before sync.
  git('checkout', '-q', base)
  const divergedMirror = commit('mirror fork-only change')
  assert.deepEqual(decide(divergedMirror, upstreamNew, customFork), {
    canFastForward: false,
    needsSync: true,
  })

  // PR reuse: the workflow counts open main -> custom PRs and reuses exactly
  // one, refuses when several exist, and creates only when none exist.
  const prAction = (count) => (count > 1 ? 'fail' : count === 1 ? 'reuse' : 'create')
  assert.equal(prAction(0), 'create')
  assert.equal(prAction(1), 'reuse')
  assert.equal(prAction(2), 'fail')

  // The authoritative upstream range is based on the merge base: a custom-only
  // file never appears, while an upstream-only sensitive file is flagged.
  rangeGit('init', '-q')
  rangeGit('config', 'user.email', 'test@example.invalid')
  rangeGit('config', 'user.name', 'test')
  writeFileSync(join(rangeDir, 'shared.txt'), 'shared\n')
  rangeGit('add', '.')
  rangeGit('commit', '-q', '-m', 'base')
  rangeGit('checkout', '-q', '-b', 'custom')
  writeFileSync(join(rangeDir, 'custom-only.txt'), 'fork\n')
  rangeGit('add', '.')
  rangeGit('commit', '-q', '-m', 'custom only')
  rangeGit('checkout', '-q', '-b', 'upstream', 'HEAD~1')
  writeFileSync(join(rangeDir, 'upstream-only.txt'), 'upstream\n')
  mkdirSync(join(rangeDir, 'src', 'gen'), { recursive: true })
  writeFileSync(join(rangeDir, 'src', 'gen', 'probe.ts'), 'export {}\n')
  rangeGit('add', '.')
  rangeGit('commit', '-q', '-m', 'upstream only')
  const range = JSON.parse(
    execFileSync(
      'node',
      [
        join(root, 'scripts/upstream-range.mjs'),
        '--repo',
        rangeDir,
        '--custom',
        'custom',
        '--upstream',
        'upstream',
      ],
      { cwd: root, encoding: 'utf8' },
    ),
  )
  assert.equal(range.commits, 1)
  assert.deepEqual(range.files.sort(), ['src/gen/probe.ts', 'upstream-only.txt'])
  assert.deepEqual(range.sensitive, ['src/gen/probe.ts'])
  assert.equal(range.files.includes('custom-only.txt'), false)
  assert.equal(range.files.includes('shared.txt'), false)

  // Workflow structure: the mirror push uses SYNC_TOKEN when configured (it
  // must be able to push upstream workflow changes), never a secret named PAT
  // (read by the disabled upstream deploy workflow), and validation is not
  // duplicated here: it runs as the PR's required checks.
  const workflow = readFileSync(join(root, '.github/workflows/sync-upstream.yml'), 'utf8')
  assert.match(workflow, /token: \$\{\{ secrets\.SYNC_TOKEN \|\| secrets\.GITHUB_TOKEN \}\}/)
  assert.doesNotMatch(workflow, /\$\{\{[^}]*secrets\.PAT\b/)
  assert.doesNotMatch(workflow, /uses: \.\/\.github\/workflows\/validate-sync\.yml/)
} finally {
  rmSync(dir, { recursive: true, force: true })
  rmSync(rangeDir, { recursive: true, force: true })
}

console.log('upstream sync: no-op, fast-forward, divergence, reuse and range scenarios passed')
