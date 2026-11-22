import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const statePath = join(dir, 'state.json')
const decide = (value) => {
  writeFileSync(statePath, JSON.stringify(value))
  return parse(node('scripts/release-state.mjs', ['--state', statePath]))
}
const decideFails = (value) => {
  writeFileSync(statePath, JSON.stringify(value))
  return fails('scripts/release-state.mjs', ['--state', statePath])
}
const tag = 'sb-v3.30.1'
const state = (over = {}) => ({
  mergeSha: SHA,
  baseVersion: '3.30.0',
  tags: [{ name: 'sb-v3.30.0', sha: OTHER }],
  ...over,
})
const tagged = () => ({
  tags: [
    { name: 'sb-v3.30.0', sha: OTHER },
    { name: tag, sha: SHA },
  ],
})

try {
  // --- three actionable outcomes only: create-tag / publish / fail ---
  assert.equal(decide(state()).decision, 'create-tag')
  assert.equal(decide(state()).tag, tag)
  // A matching stable tag is reused for every partial-failure state.
  for (const label of [
    'no dispatch',
    'build failed',
    'release absent',
    'incomplete release',
    'complete release',
  ]) {
    const result = decide(state(tagged()))
    assert.equal(result.decision, 'publish', label)
    assert.equal(result.tag, tag, label)
  }
  // Repeated recovery keeps the same tag.
  for (let i = 0; i < 3; i++) assert.equal(decide(state(tagged())).tag, tag)
  // A tag at another SHA is never reused; the allocator bumps past it.
  const collided = decide(state({ tags: [{ name: tag, sha: OTHER }] }))
  assert.equal(collided.decision, 'create-tag')
  assert.notEqual(collided.tag, tag)
  // Versions compare numerically after the 4-character `sb-v` prefix: with a
  // gap, the next tag follows the highest one, not the first free patch.
  const gap = decide(
    state({
      tags: [
        { name: 'sb-v3.30.0', sha: OTHER },
        { name: 'sb-v3.30.5', sha: OTHER },
      ],
    }),
  )
  assert.equal(gap.tag, 'sb-v3.30.6')
  assert.equal(decide(state({ baseVersion: '3.31.0' })).tag, 'sb-v3.31.0')

  // Inconsistent or invalid state fails with a non-zero exit.
  assert.equal(
    decideFails(
      state({
        tags: [
          { name: tag, sha: SHA },
          { name: 'sb-v3.30.2', sha: SHA },
        ],
      }),
    ),
    true,
  )
  assert.equal(decideFails(state({ mergeSha: 'short' })), true)
  assert.equal(decideFails(state({ baseVersion: 'bad' })), true)

  // --- eligibility uses real PR metadata (validation is a job dependency) ---
  const eligible = {
    REPO: 'choicky/zashboard',
    EVENT_NAME: 'pull_request',
    PR_MERGED: 'true',
    PR_BASE: 'custom',
    PR_HEAD: 'main',
    PR_HEAD_REPO: 'choicky/zashboard',
    MERGE_SHA: SHA,
    CUSTOM_SHA: SHA,
  }
  assert.match(node('scripts/release-eligibility.mjs', [], eligible), /eligible=true/)
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, PR_MERGED: 'false' }),
    true,
  )
  assert.equal(fails('scripts/release-eligibility.mjs', [], { ...eligible, PR_BASE: 'main' }), true)
  // Policy B: feature PRs into custom publish too, not only the main sync PR.
  assert.match(
    node('scripts/release-eligibility.mjs', [], { ...eligible, PR_HEAD: 'feat/x' }),
    /eligible=true/,
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
  assert.equal(
    fails('scripts/release-eligibility.mjs', [], { ...eligible, EVENT_NAME: 'push' }),
    true,
  )

  // --- real git tag enumeration: lightweight, annotated, different commits ---
  const repoDir = mkdtempSync(join(tmpdir(), 'zashboard-tags-'))
  const git = (...args) =>
    execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).trim()
  const enumerate = () => JSON.parse(node('scripts/release-state.mjs', ['--repo', repoDir]))
  const realState = (mergeSha, tags = enumerate()) => ({ mergeSha, baseVersion: '3.30.0', tags })
  try {
    git('init', '-q')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'test')
    writeFileSync(join(repoDir, 'shared.txt'), 'shared\n')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    const first = git('rev-parse', 'HEAD')
    git('tag', 'sb-v3.30.0') // lightweight
    writeFileSync(join(repoDir, 'next.txt'), 'next\n')
    git('add', '.')
    git('commit', '-q', '-m', 'next')
    const second = git('rev-parse', 'HEAD')
    git('tag', '-a', 'sb-v3.30.1', '-m', 'annotated') // annotated
    git('tag', 'sb-v3.30.9-rc1') // prerelease must be excluded

    const tags = enumerate()
    assert.deepEqual(tags, [
      { name: 'sb-v3.30.0', sha: first },
      { name: 'sb-v3.30.1', sha: second },
    ])
    for (const item of tags) assert.equal(item.sha, git('rev-parse', `${item.name}^{}`))
    assert.equal(decide(realState(first)).tag, 'sb-v3.30.0')
    assert.equal(decide(realState(second)).tag, 'sb-v3.30.1')

    writeFileSync(join(repoDir, 'third.txt'), 'third\n')
    git('add', '.')
    git('commit', '-q', '-m', 'third')
    const third = git('rev-parse', 'HEAD')
    const created = decide(realState(third, tags))
    assert.equal(created.decision, 'create-tag')
    assert.equal(created.tag, 'sb-v3.30.2')

    git('tag', 'sb-v3.30.2')
    git('tag', 'sb-v3.30.3') // two stable tags at one commit
    const ambiguous = enumerate()
    assert.equal(ambiguous.filter((item) => item.sha === third).length, 2)
    assert.equal(decideFails(realState(third, ambiguous)), true)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }

  // --- policy C: skip releases that change nothing the package ships ---
  const relRepo = mkdtempSync(join(tmpdir(), 'zashboard-relevance-'))
  const rgit = (...args) =>
    execFileSync('git', ['-C', relRepo, ...args], { encoding: 'utf8' }).trim()
  const commitFile = (path, text = `${path}\n`) => {
    mkdirSync(join(relRepo, path, '..'), { recursive: true })
    writeFileSync(join(relRepo, path), text)
    rgit('add', '.')
    rgit('commit', '-q', '-m', path)
    return rgit('rev-parse', 'HEAD')
  }
  const relevance = (head, tags) =>
    parse(
      node('scripts/release-relevance.mjs', [
        '--repo',
        relRepo,
        '--sha',
        head,
        '--tags',
        JSON.stringify(tags),
      ]),
    )
  try {
    rgit('init', '-q')
    rgit('config', 'user.email', 'test@example.invalid')
    rgit('config', 'user.name', 'test')
    const released = commitFile('src/main.ts')
    const tags = [{ name: 'sb-v3.30.2', sha: released }]

    // No earlier stable release: always relevant.
    assert.equal(relevance(released, []).relevant, 'true')
    // A tag already at the merge keeps recovery relevant.
    assert.equal(relevance(released, tags).relevant, 'true')

    // Docs, CI, tests, helpers and root metadata only: skip.
    for (const path of [
      'AGENTS.md',
      'docs/DECISIONS.md',
      '.github/workflows/x.yml',
      'test/a.mjs',
      'scripts/release-state.mjs',
      'README.md',
    ])
      commitFile(path)
    const docsOnly = rgit('rev-parse', 'HEAD')
    const skipped = relevance(docsOnly, tags)
    assert.equal(skipped.relevant, 'false')
    assert.match(skipped.reason, /since sb-v3\.30\.2/)

    // Any product path, here nested Markdown inside src, counts.
    const product = commitFile('src/notes.md')
    const kept = relevance(product, tags)
    assert.equal(kept.relevant, 'true')
    assert.equal(kept.files, 'src/notes.md')
    for (const path of ['package.json', 'pnpm-lock.yaml', 'public/icon.png', 'vite.config.ts']) {
      rgit('reset', '-q', '--hard', docsOnly)
      assert.equal(relevance(commitFile(path), tags).relevant, 'true', path)
    }

    // Moving a packaged file into an excluded directory removes it from the
    // package, so the rename's source path must count.
    rgit('reset', '-q', '--hard', docsOnly)
    commitFile('public/ATTRIBUTION.md', 'attribution text that git can track as a rename\n')
    const movedTags = [{ name: 'sb-v3.30.3', sha: rgit('rev-parse', 'HEAD') }]
    mkdirSync(join(relRepo, 'docs'), { recursive: true })
    rgit('mv', 'public/ATTRIBUTION.md', 'docs/ATTRIBUTION.md')
    rgit('commit', '-q', '-m', 'move attribution to docs')
    const moved = relevance(rgit('rev-parse', 'HEAD'), movedTags)
    assert.equal(moved.relevant, 'true', JSON.stringify(moved))
    assert.equal(moved.files, 'public/ATTRIBUTION.md')

    // The newest contained stable tag is the baseline; a tag not contained in
    // the merge is ignored.
    rgit('reset', '-q', '--hard', product)
    const productTagged = [...tags, { name: 'sb-v3.30.3', sha: product }]
    const later = relevance(commitFile('docs/later.md'), productTagged)
    assert.equal(later.relevant, 'false', JSON.stringify(later))
    assert.equal(
      relevance(rgit('rev-parse', 'HEAD'), [...tags, { name: 'sb-v9.9.9', sha: OTHER }]).relevant,
      'true',
    )
    assert.equal(fails('scripts/release-relevance.mjs', ['--repo', relRepo, '--sha', 'abc']), true)
  } finally {
    rmSync(relRepo, { recursive: true, force: true })
  }

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

  // --- structural checks on the workflow sources (no parser needed) ---
  const readWorkflow = (name) => readFileSync(join(root, '.github', 'workflows', name), 'utf8')
  const autoRelease = readWorkflow('auto-release.yml')
  const buildRelease = readWorkflow('build-release.yml')

  // Workflow default stays read-only; only the tag/publish jobs escalate.
  assert.match(autoRelease, /permissions:\n  contents: read\n  pull-requests: read/)
  const tagJob = autoRelease.slice(
    autoRelease.indexOf('  tag:\n'),
    autoRelease.indexOf('  publish:\n'),
  )
  assert.match(tagJob, /permissions:\n      contents: write/)
  const publishJob = autoRelease.slice(autoRelease.indexOf('  publish:\n'))
  assert.match(publishJob, /permissions:\n      contents: write/)

  // Ordinary jobs need a runner; reusable-workflow call jobs must not have one.
  const job = (name) =>
    autoRelease.slice(autoRelease.indexOf(`\n  ${name}:\n`)).split(/\n  \w+:\n/)[1]
  for (const name of ['decide', 'tag', 'summary']) {
    assert.match(job(name), /^    runs-on: ubuntu-latest$/m, name)
  }
  for (const name of ['decide', 'summary']) assert.doesNotMatch(job(name), /permissions:/, name)
  for (const name of ['validate', 'publish']) {
    assert.match(job(name), /^    uses: \.\/\.github\/workflows\//m, name)
    assert.doesNotMatch(job(name), /runs-on:|steps:/, name)
  }

  // gh pr view has no `merged` JSON field; merge status derives from `state`.
  assert.match(autoRelease, /--json number,state,/)
  assert.match(autoRelease, /merged=\$\(jq -r '\.state == "MERGED"'/)

  // The workflow's own checksum command must produce what the verifier accepts.
  const sumsCommand = /^ *(.*[^>]> SHA256SUMS)$/m.exec(buildRelease)[1]
  writeBundle()
  execFileSync('bash', ['-c', sumsCommand], { cwd: bundle })
  assert.match(node('scripts/verify-release-assets.mjs', args), /verified/)

  // Provenance is fail-closed: missing/invalid tags and SHA mismatch abort.
  const provenance = buildRelease.slice(
    buildRelease.indexOf('name: Enforce release provenance'),
    buildRelease.indexOf('uses: actions/download-artifact@v8'),
  )
  assert.match(provenance, /git rev-parse --verify "refs\/tags\/\$RELEASE_TAG\^\{\}"/)
  assert.match(provenance, /test "\$resolved" = "\$RELEASE_SHA"/)
  assert.match(provenance, /exit 1/)

  // Every same-repo PR merged into custom publishes; the trigger filter does
  // not pin the head branch to main.
  assert.doesNotMatch(autoRelease, /head\.ref == 'main'/)
  assert.match(autoRelease, /head\.repo\.full_name == github\.repository/)
  // Rapid successive merges: an older merge already contained in custom is a
  // successful skip; only the newest merge publishes.
  assert.match(autoRelease, /git merge-base --is-ancestor "\$MERGE_SHA" "\$head_sha"/)
  assert.match(autoRelease, /echo 'decision=skip'/)
  // Policy C runs before tag allocation, so a skipped merge never takes a tag.
  assert.ok(
    autoRelease.indexOf('scripts/release-relevance.mjs') <
      autoRelease.indexOf('scripts/release-state.mjs --state'),
  )

  // Publication has no entry that bypasses validation: no tag push, no
  // manual dispatch, only the reusable call from auto-release.
  const buildTriggers = buildRelease.slice(
    buildRelease.indexOf('on:\n'),
    buildRelease.indexOf('permissions:'),
  )
  assert.doesNotMatch(buildTriggers, /^  push:|^  workflow_dispatch:/m)
  assert.match(buildTriggers, /^  workflow_call:/m)
  assert.doesNotMatch(buildRelease, /sb-v0\.0\.0-dev|github\.ref/)

  // Removed logic has not returned.
  assert.doesNotMatch(autoRelease, /releases=\$\(gh api|argjson releases|VALIDATED|VALIDATION_SHA/)
  assert.doesNotMatch(buildRelease, /Manual dev builds have no tag and skip/)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('auto release: outcomes, real tag enumeration, eligibility and asset checks passed')
