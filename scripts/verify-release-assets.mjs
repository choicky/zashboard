// Verify the complete release bundle locally before and after publication:
// exact asset set, MANIFEST values, SHA256SUMS coverage and archive contents.
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 || !args[index + 1] ? fallback : args[index + 1]
}

const dir = option('--dir', '.')
const tag = option('--tag')
const sha = option('--sha')
const zips = [
  option('--full', 'zashboard-singbox-full.zip'),
  option('--no-fonts', 'zashboard-singbox-no-fonts.zip'),
]
const fail = (reason) => {
  console.error(`release asset verification failed: ${reason}`)
  process.exit(1)
}
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

// MANIFEST: repeated keys are allowed (artifact=), every value is checked.
const manifest = new Map()
for (const line of readFileSync(join(dir, 'MANIFEST'), 'utf8').split(/\r?\n/)) {
  const separator = line.indexOf('=')
  if (separator === -1) continue
  const key = line.slice(0, separator)
  manifest.set(key, [...(manifest.get(key) || []), line.slice(separator + 1)])
}
const single = (key, expected) => {
  const values = manifest.get(key) || []
  if (values.length !== 1) fail(`MANIFEST must have exactly one ${key}`)
  if (expected !== undefined && values[0] !== expected) {
    fail(`MANIFEST ${key} is ${values[0]}, expected ${expected}`)
  }
}
single('release_tag', tag)
single('source_sha', sha)
single('release_identity', tag)
const artifacts = manifest.get('artifact') || []
if (artifacts.length !== zips.length || !zips.every((name) => artifacts.includes(name))) {
  fail(`MANIFEST artifacts must be exactly ${zips.join(', ')}`)
}

// SHA256SUMS must cover the two ZIPs and nothing else.
const sums = new Map()
for (const line of readFileSync(join(dir, 'SHA256SUMS'), 'utf8').split(/\r?\n/)) {
  const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim())
  if (match) sums.set(match[2], match[1])
}
if (sums.size !== zips.length || !zips.every((name) => sums.has(name))) {
  fail(`SHA256SUMS must cover exactly ${zips.join(', ')}`)
}

for (const name of zips) {
  if (sha256(join(dir, name)) !== sums.get(name)) fail(`${name} checksum mismatch`)
  const size = statSync(join(dir, name)).size
  if (size <= 1024) fail(`${name} is empty or too small (${size} bytes)`)
  const zip = readFileSync(join(dir, name))
  if (zip.subarray(0, 2).toString() !== 'PK') fail(`${name} is not a ZIP archive`)
  // The central directory stores entry names uncompressed.
  if (!zip.includes('dist/index.html')) fail(`${name} is missing dist/index.html`)
  if (!zip.includes('dist/assets/')) fail(`${name} is missing dist/assets/`)
}

console.log('release assets verified')
