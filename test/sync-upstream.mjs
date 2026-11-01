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

try {
  git('init', '-q')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'test')
  const base = commit('base')

  // Identical branches and custom-only fork commits are successful no-ops.
  assert.equal(contains(base, base), true)
  const customFork = commit('fork custom work')
  assert.equal(contains(base, customFork), true)

  // A new upstream commit is the only case that needs a synchronization PR.
  git('checkout', '-q', base)
  const upstreamNew = commit('upstream change')
  assert.equal(contains(upstreamNew, customFork), false)

  // A mirror with an unrelated fork-only commit must be rejected before sync.
  git('checkout', '-q', base)
  const divergedMirror = commit('mirror fork-only change')
  assert.equal(contains(divergedMirror, upstreamNew), false)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('upstream ancestry: no-op, new commits, and divergence scenarios passed')
