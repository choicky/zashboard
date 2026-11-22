// Single authoritative release-state implementation: enumerate stable tags
// and decide the one action for a merge commit. Both the workflow and the
// regression tests call this file, so git resolution cannot drift.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 || !args[index + 1] ? undefined : args[index + 1]
}

const STABLE_TAG = /^sb-v\d+\.\d+\.\d+$/
const git = (repo, ...command) =>
  execFileSync('git', ['-C', repo, ...command], { encoding: 'utf8' }).trim()

// Observation path: resolve every stable tag exactly like `git rev-parse tag^{}`,
// which works for both lightweight and annotated tags.
const repo = option('--repo')
if (repo) {
  const names = git(repo, 'tag', '--list', 'sb-v*')
    .split('\n')
    .filter((name) => STABLE_TAG.test(name))
  const tags = names.map((name) => ({ name, sha: git(repo, 'rev-parse', `${name}^{}`) }))
  console.log(JSON.stringify(tags))
  process.exit(0)
}

const stateFile = option('--state')
if (!stateFile) throw new Error('expected --state <file> or --repo <dir>')
const state = JSON.parse(readFileSync(stateFile, 'utf8'))

const decide = (s) => {
  if (!/^[0-9a-f]{40}$/.test(s.mergeSha || '')) {
    return { decision: 'fail', reason: 'merge SHA is invalid' }
  }
  if (!/^\d+\.\d+\.\d+$/.test(s.baseVersion || '')) {
    return { decision: 'fail', reason: 'base version is invalid' }
  }

  const tags = (s.tags || []).filter((tag) => tag.name && STABLE_TAG.test(tag.name))
  const matching = tags.filter((tag) => tag.sha === s.mergeSha)
  if (matching.length > 1) {
    return { decision: 'fail', reason: 'multiple stable tags point at the merge SHA' }
  }
  if (matching.length === 1) {
    // Reuse the matching tag. Publication and asset checks run again on the
    // same tag; a rare manual rebuild is simpler than a second verification
    // implementation. Repeated runs converge on this tag.
    return {
      decision: 'publish',
      tag: matching[0].name,
      reason: 'reusing the stable tag for this merge',
    }
  }

  // No stable tag at this merge: allocate exactly one collision-free tag.
  const parse = (name) => name.slice(4).split('.').map(Number)
  const compare = (a, b) => {
    for (let index = 0; index < 3; index++)
      if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
    return 0
  }
  const highest = tags
    .map((tag) => parse(tag.name))
    .reduce((max, value) => (compare(value, max) > 0 ? value : max), [0, 0, 0])
  let candidate = s.baseVersion.split('.').map(Number)
  if (compare(candidate, highest) <= 0) candidate = [highest[0], highest[1], highest[2] + 1]
  const names = new Set(tags.map((tag) => tag.name))
  while (names.has(`sb-v${candidate.join('.')}`))
    candidate = [candidate[0], candidate[1], candidate[2] + 1]
  return {
    decision: 'create-tag',
    tag: `sb-v${candidate.join('.')}`,
    reason: 'no stable tag for this merge yet',
  }
}

const result = decide(state)
console.log(`decision=${result.decision}`)
if (result.tag) console.log(`tag=${result.tag}`)
console.log(`reason=${result.reason}`)
if (result.decision !== 'create-tag' && result.decision !== 'publish') process.exit(1)
