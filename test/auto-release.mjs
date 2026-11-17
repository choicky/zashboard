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
const dir = mkdtempSync(join(tmpdir(), 'zashboard-release-'))
const tagsFile = join(dir, 'tags.txt')

const resolve = (base, tags) => {
  writeFileSync(tagsFile, `${tags.join('\n')}\n`)
  const output = node('scripts/resolve-release-version.mjs', [
    '--base-version',
    base,
    '--existing-file',
    tagsFile,
  ])
  return Object.fromEntries(
    output
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  )
}

try {
  // Version selection: deterministic, monotonic, collision-safe, stable-tag only.
  assert.deepEqual(resolve('3.30.0', ['sb-v3.30.0']), { version: '3.30.1', tag: 'sb-v3.30.1' })
  assert.deepEqual(resolve('3.31.0', ['sb-v3.30.0']), { version: '3.31.0', tag: 'sb-v3.31.0' })
  assert.deepEqual(resolve('3.30.0', ['sb-v3.30.0', 'sb-v3.30.1']), {
    version: '3.30.2',
    tag: 'sb-v3.30.2',
  })
  assert.deepEqual(resolve('3.30.0', ['sb-v3.30.0', 'sb-v3.30.0-rc9', 'sb-v3.30.0-phase2-rc8']), {
    version: '3.30.1',
    tag: 'sb-v3.30.1',
  })
  assert.deepEqual(resolve('3.29.0', ['sb-v3.31.0']), { version: '3.31.1', tag: 'sb-v3.31.1' })
  assert.deepEqual(resolve('3.30.0', ['sb-v3.30.0']), resolve('3.30.0', ['sb-v3.30.0']))

  // Eligibility: only a reviewed, merged main -> custom PR qualifies.
  const eligible = {
    REPO: 'choicky/zashboard',
    EVENT_NAME: 'pull_request',
    PR_MERGED: 'true',
    PR_BASE: 'custom',
    PR_HEAD: 'main',
    PR_HEAD_REPO: 'choicky/zashboard',
    MERGE_SHA: 'a'.repeat(40),
    CUSTOM_SHA: 'a'.repeat(40),
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
    fails('scripts/release-eligibility.mjs', [], { ...eligible, CUSTOM_SHA: 'b'.repeat(40) }),
    true,
  )
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, MERGE_SHA: 'abc' }),
    true,
  )
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, EVENT_NAME: 'push' }),
    true,
  )

  // Asset verification: both ZIPs, MANIFEST and SHA256SUMS must agree.
  const bundle = join(dir, 'bundle')
  const full = Buffer.from('PK\x03\x04 dist/index.html dist/assets/index.js')
  const noFonts = Buffer.from('PK\x03\x04 dist/index.html dist/assets/index.js')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(bundle, 'zashboard-singbox-full.zip'), full)
  writeFileSync(join(bundle, 'zashboard-singbox-no-fonts.zip'), noFonts)
  writeFileSync(
    join(bundle, 'MANIFEST'),
    'release_tag=sb-v3.30.1\nsource_sha=aaa\nrelease_identity=sb-v3.30.1\n' +
      'artifact=zashboard-singbox-full.zip\nartifact=zashboard-singbox-no-fonts.zip\n',
  )
  writeFileSync(
    join(bundle, 'SHA256SUMS'),
    `${sha(full)}  zashboard-singbox-full.zip\n${sha(noFonts)}  zashboard-singbox-no-fonts.zip\n`,
  )
  assert.match(node('scripts/verify-release-assets.mjs', ['--dir', bundle]), /verified/)
  rmSync(join(bundle, 'zashboard-singbox-no-fonts.zip'))
  assert.equal(fails('scripts/verify-release-assets.mjs', ['--dir', bundle]), true)
  writeFileSync(join(bundle, 'zashboard-singbox-no-fonts.zip'), Buffer.from('not a zip'))
  assert.equal(fails('scripts/verify-release-assets.mjs', ['--dir', bundle]), true)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('auto release: version, eligibility and asset checks passed')
