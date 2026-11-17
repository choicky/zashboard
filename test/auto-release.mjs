import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const node = (script, args = [], env = {}) =>
  execFileSync('node', [join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
const fails = (script, args = [], env = {}) => {
  try {
    node(script, args, env)
    return false
  } catch {
    return true
  }
}
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')
const parse = (output) =>
  Object.fromEntries(
    output
      .trim()
      .split('\n')
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )
const dir = mkdtempSync(join(tmpdir(), 'zashboard-release-'))
const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

const decide = (state) => {
  const path = join(dir, 'state.json')
  writeFileSync(path, JSON.stringify(state))
  return parse(node('scripts/release-state.mjs', ['--state', path]))
}
const tag = 'sb-v3.30.1'
const state = (over = {}) => ({
  mergeSha: SHA,
  baseVersion: '3.30.0',
  validated: true,
  validationSha: SHA,
  tags: [{ name: 'sb-v3.30.0', sha: OTHER }],
  releases: [],
  ...over,
})
const tagged = (assets = []) => ({
  tags: [
    { name: 'sb-v3.30.0', sha: OTHER },
    { name: tag, sha: SHA },
  ],
  releases: assets.length ? [{ tagName: tag, assets }] : [],
})
const ASSETS = [
  'zashboard-singbox-full.zip',
  'zashboard-singbox-no-fonts.zip',
  'MANIFEST',
  'SHA256SUMS',
]

try {
  // --- one authoritative recovery state model ---
  // No tag yet: allocate exactly one stable tag.
  assert.equal(decide(state()).decision, 'create-tag')
  assert.equal(decide(state()).tag, tag)
  // Tag created but dispatch never started / build failed / Release absent.
  for (const label of ['no dispatch', 'build failed', 'release absent']) {
    const result = decide(state(tagged()))
    assert.equal(result.decision, 'publish', label)
    assert.equal(result.tag, tag, label)
  }
  // Release incomplete: repair with the same tag, never a new version.
  const partial = decide(state(tagged(ASSETS.slice(0, 2))))
  assert.equal(partial.decision, 'publish')
  assert.equal(partial.tag, tag)
  // Release complete: idempotent no-op; repeated recovery converges.
  for (let i = 0; i < 3; i++) {
    const result = decide(state(tagged(ASSETS)))
    assert.equal(result.decision, 'noop')
    assert.equal(result.tag, tag)
  }
  // A tag at another SHA is never reused; the allocator bumps past it.
  const collided = decide(
    state({ tags: [{ name: tag, sha: OTHER }], releases: [{ tagName: tag, assets: [] }] }),
  )
  assert.equal(collided.decision, 'create-tag')
  assert.notEqual(collided.tag, tag)
  // Multiple stable tags for one merge: inconsistent state, refuse.
  assert.equal(
    decide(
      state({
        tags: [
          { name: tag, sha: SHA },
          { name: 'sb-v3.30.2', sha: SHA },
        ],
      }),
    ).decision,
    'fail',
  )
  // Validation gates: failure, cancellation, timeout and wrong SHA all fail.
  assert.equal(decide(state({ validated: false })).decision, 'fail')
  assert.equal(decide(state({ validationSha: OTHER })).decision, 'fail')
  assert.equal(decide(state({ mergeSha: 'short' })).decision, 'fail')

  // --- release eligibility gate (includes validation proof) ---
  const eligible = {
    REPO: 'choicky/zashboard',
    EVENT_NAME: 'pull_request',
    PR_MERGED: 'true',
    PR_BASE: 'custom',
    PR_HEAD: 'main',
    PR_HEAD_REPO: 'choicky/zashboard',
    MERGE_SHA: SHA,
    CUSTOM_SHA: SHA,
    VALIDATED: 'true',
    VALIDATION_SHA: SHA,
  }
  assert.match(node('scripts/release-eligibility.mjs', [], eligible), /eligible=true/)
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, PR_MERGED: 'false' }),
    true,
  )
  assert.equal(fails('scripts/release-eligibility.mjs', [], { ...eligible, PR_BASE: 'main' }), true)
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, PR_HEAD: 'feature' }),
    true,
  )
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, PR_HEAD_REPO: 'other/zashboard' }),
    true,
  )
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, CUSTOM_SHA: OTHER }),
    true,
  )
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, MERGE_SHA: 'abc' }),
    true,
  )
  // Cancellation/timeout/absent validation all present as validated != true.
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, VALIDATED: 'false' }),
    true,
  )
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, VALIDATION_SHA: OTHER }),
    true,
  )
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, EVENT_NAME: 'push' }),
    true,
  )

  // --- complete asset verification ---
  const bundle = join(dir, 'bundle')
  const full = Buffer.concat([
    Buffer.from('PK\x03\x04'),
    Buffer.alloc(2048),
    Buffer.from(' dist/index.html dist/assets/index.js '),
  ])
  const noFonts = Buffer.concat([
    Buffer.from('PK\x03\x04'),
    Buffer.alloc(2048),
    Buffer.from(' dist/index.html dist/assets/no-fonts.js '),
  ])
  mkdirSync(bundle, { recursive: true })
  const args = ['--dir', bundle, '--tag', tag, '--sha', SHA]
  const writeBundle = ({
    manifestTag = tag,
    manifestSha = SHA,
    extraSum = false,
    zipOverride,
  } = {}) => {
    writeFileSync(join(bundle, 'zashboard-singbox-full.zip'), zipOverride?.full ?? full)
    writeFileSync(join(bundle, 'zashboard-singbox-no-fonts.zip'), zipOverride?.noFonts ?? noFonts)
    writeFileSync(
      join(bundle, 'MANIFEST'),
      `release_tag=${manifestTag}\nsource_sha=${manifestSha}\nrelease_identity=${manifestTag}\n` +
        'artifact=zashboard-singbox-full.zip\nartifact=zashboard-singbox-no-fonts.zip\n',
    )
    writeFileSync(
      join(bundle, 'SHA256SUMS'),
      `${sha(full)}  zashboard-singbox-full.zip\n${sha(noFonts)}  zashboard-singbox-no-fonts.zip\n` +
        (extraSum ? `${sha(Buffer.from('extra'))}  extra.txt\n` : ''),
    )
  }
  writeBundle()
  assert.match(node('scripts/verify-release-assets.mjs', args), /verified/)
  writeBundle({ manifestTag: 'sb-v9.9.9' })
  assert.equal(fails('scripts/verify-release-assets.mjs', args), true)
  writeBundle({ manifestSha: OTHER })
  assert.equal(fails('scripts/verify-release-assets.mjs', args), true)
  writeBundle({ extraSum: true })
  assert.equal(fails('scripts/verify-release-assets.mjs', args), true)
  writeBundle()
  rmSync(join(bundle, 'zashboard-singbox-no-fonts.zip'))
  assert.equal(fails('scripts/verify-release-assets.mjs', args), true)
  writeBundle({ zipOverride: { full: Buffer.from('not a zip') } })
  assert.equal(fails('scripts/verify-release-assets.mjs', args), true)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('auto release: recovery states, eligibility and asset checks passed')
