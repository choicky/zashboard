// Deterministic fork release version selection for sb-v* tags.
// Stable fork tags are exactly sb-vMAJOR.MINOR.PATCH so the dashboard's
// release-version parser keeps treating them as stable releases.
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  if (index === -1 || !args[index + 1]) {
    throw new Error(`missing required option ${name}`)
  }
  return args[index + 1]
}

const baseVersion = option('--base-version')
const existingFile = option('--existing-file')
if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
  throw new Error(`base version must be MAJOR.MINOR.PATCH, got ${baseVersion}`)
}

const existing = new Set(
  readFileSync(existingFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
)

const parseStable = (tag) => {
  const match = /^sb-v(\d+)\.(\d+)\.(\d+)$/.exec(tag)
  return match ? match.slice(1).map(Number) : undefined
}

const compare = (left, right) => {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }
  return 0
}

const bumpPatch = ([major, minor, patch]) => [major, minor, patch + 1]

let candidate = baseVersion.split('.').map(Number)
const highest = [...existing]
  .map(parseStable)
  .filter(Boolean)
  .reduce((max, value) => (compare(value, max) > 0 ? value : max), [0, 0, 0])

// Never move backwards: upstream may keep its package version unchanged.
if (compare(candidate, highest) <= 0) {
  candidate = bumpPatch(highest)
}
// Prerelease tags use a different namespace, but a colliding stable tag or
// release must never be overwritten.
while (existing.has(`sb-v${candidate.join('.')}`)) {
  candidate = bumpPatch(candidate)
}

console.log(`version=${candidate.join('.')}`)
console.log(`tag=sb-v${candidate.join('.')}`)
