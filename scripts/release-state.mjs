// Single authoritative state model for fork release recovery.
// Given one merge commit and the observed tag/Release state, decide exactly
// one action. Every partial-failure path converges on the same tag.
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const stateIndex = args.indexOf('--state')
if (stateIndex === -1 || !args[stateIndex + 1]) throw new Error('missing --state <file>')
const state = JSON.parse(readFileSync(args[stateIndex + 1], 'utf8'))

const REQUIRED_ASSETS = [
  'zashboard-singbox-full.zip',
  'zashboard-singbox-no-fonts.zip',
  'MANIFEST',
  'SHA256SUMS',
]
const STABLE_TAG = /^sb-v(\d+)\.(\d+)\.(\d+)$/

const decide = (s) => {
  if (!s.validated || s.validationSha !== s.mergeSha) {
    return { decision: 'fail', reason: 'no successful validation for the merge SHA' }
  }
  if (!/^[0-9a-f]{40}$/.test(s.mergeSha || '')) {
    return { decision: 'fail', reason: 'merge SHA is invalid' }
  }
  if (!/^\d+\.\d+\.\d+$/.test(s.baseVersion || '')) {
    return { decision: 'fail', reason: 'base version is invalid' }
  }

  const tags = (s.tags || []).filter((tag) => tag.name && !tag.name.includes('^{}'))
  const stable = tags.filter((tag) => STABLE_TAG.test(tag.name))
  const matching = stable.filter((tag) => tag.sha === s.mergeSha)
  if (matching.length > 1) {
    return { decision: 'fail', reason: 'multiple stable tags point at the merge SHA' }
  }

  if (matching.length === 1) {
    const tag = matching[0].name
    const release = (s.releases || []).find((item) => item.tagName === tag)
    if (release && REQUIRED_ASSETS.every((name) => release.assets.includes(name))) {
      return { decision: 'noop', tag, reason: 'tag and complete release already exist' }
    }
    // Tag exists (dispatch/build/upload failed) or release is incomplete:
    // reuse the same tag, never allocate another version.
    return {
      decision: 'publish',
      tag,
      reason: release
        ? 'release is incomplete; republish using the same tag'
        : 'tag exists; publish using the same tag',
    }
  }

  // No stable tag points at this merge: allocate exactly one collision-free tag.
  const parse = (name) => STABLE_TAG.exec(name)?.slice(1).map(Number)
  const compare = (a, b) => {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
    return 0
  }
  const highest = stable
    .map((tag) => parse(tag.name))
    .filter(Boolean)
    .reduce((max, value) => (compare(value, max) > 0 ? value : max), [0, 0, 0])
  let candidate = s.baseVersion.split('.').map(Number)
  if (compare(candidate, highest) <= 0) {
    candidate = [highest[0], highest[1], highest[2] + 1]
  }
  const names = new Set(tags.map((tag) => tag.name))
  while (names.has(`sb-v${candidate.join('.')}`)) {
    candidate = [candidate[0], candidate[1], candidate[2] + 1]
  }
  const tag = `sb-v${candidate.join('.')}`
  if (tags.some((item) => item.name === tag && item.sha !== s.mergeSha)) {
    return { decision: 'fail', tag, reason: 'chosen tag already points at another SHA' }
  }
  return { decision: 'create-tag', tag, reason: 'no stable tag for this merge yet' }
}

const result = decide(state)
console.log(`decision=${result.decision}`)
if (result.tag) console.log(`tag=${result.tag}`)
console.log(`reason=${result.reason}`)
