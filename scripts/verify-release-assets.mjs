// Verify the release bundle before publishing: both ZIPs, MANIFEST and
// SHA256SUMS must exist and agree with the real files on disk.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 || !args[index + 1] ? fallback : args[index + 1]
}

const dir = option('--dir', '.')
const zips = [
  option('--full', 'zashboard-singbox-full.zip'),
  option('--no-fonts', 'zashboard-singbox-no-fonts.zip'),
]
const fail = (reason) => {
  console.error(`release asset verification failed: ${reason}`)
  process.exit(1)
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

const sums = new Map()
for (const line of readFileSync(join(dir, 'SHA256SUMS'), 'utf8').split(/\r?\n/)) {
  const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim())
  if (match) sums.set(match[2], match[1])
}
if (!sums.size) fail('SHA256SUMS has no entries')

const manifest = readFileSync(join(dir, 'MANIFEST'), 'utf8')
for (const field of ['release_tag=', 'source_sha=', 'release_identity=']) {
  if (!manifest.includes(field)) fail(`MANIFEST is missing ${field}`)
}

for (const name of zips) {
  if (!manifest.includes(`artifact=${name}`)) fail(`MANIFEST is missing artifact=${name}`)
  const expected = sums.get(name)
  if (!expected) fail(`SHA256SUMS is missing ${name}`)
  const actual = sha256(join(dir, name))
  if (actual !== expected) fail(`${name} checksum mismatch`)
  const zip = readFileSync(join(dir, name))
  if (zip.length === 0 || zip.subarray(0, 2).toString() !== 'PK')
    fail(`${name} is not a ZIP archive`)
  // The central directory stores entry names uncompressed.
  if (!zip.includes('dist/index.html')) fail(`${name} is missing dist/index.html`)
  if (!zip.includes('dist/assets/')) fail(`${name} is missing dist/assets/`)
}

console.log('release assets verified')
