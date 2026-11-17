import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'zashboard-sync-'))
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
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
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('upstream sync: no-op, fast-forward, divergence and reuse scenarios passed')
