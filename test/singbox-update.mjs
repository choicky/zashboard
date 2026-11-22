import assert from 'node:assert/strict'
import {
  findSingboxUpdate,
  parseSingboxVersion,
  pickSingboxReleases,
  releasesUrlFor,
  SINGBOX_LATEST_RELEASE_URL,
  SINGBOX_RECENT_RELEASES_URL,
  singboxUpdateStatus,
} from '../src/assembly/release-version.ts'

const release = (tag, prerelease = /-/.test(tag), draft = false) => ({
  tag_name: tag,
  prerelease,
  draft,
  html_url: `https://github.com/SagerNet/sing-box/releases/tag/${tag}`,
})
const installed = (value) => {
  const parsed = parseSingboxVersion(value)
  assert.ok(parsed, value)
  return parsed
}

// Version strings from the Clash API and the native API.
assert.deepEqual(installed('sing-box 1.15.0-alpha.13'), {
  major: 1,
  minor: 15,
  patch: 0,
  prerelease: ['alpha', 13],
})
assert.deepEqual(installed('1.14.4').prerelease, [])
assert.equal(installed('sing-box version 1.12.4+build.1').patch, 4)
assert.equal(parseSingboxVersion('unknown'), undefined)

// Channel follows the installed version.
assert.equal(releasesUrlFor(installed('1.14.4')), SINGBOX_LATEST_RELEASE_URL)
assert.equal(releasesUrlFor(installed('1.15.0-alpha.13')), SINGBOX_RECENT_RELEASES_URL)

// Testing install: newest release of any kind, including a newer stable.
const recent = [
  release('v1.15.0-alpha.14'),
  release('v1.15.0-alpha.13'),
  release('v1.14.4'),
  release('v1.15.0-alpha.15', true, true), // draft: ignored
]
assert.deepEqual(findSingboxUpdate(recent, installed('1.15.0-alpha.13')), {
  version: '1.15.0-alpha.14',
  url: 'https://github.com/SagerNet/sing-box/releases/tag/v1.15.0-alpha.14',
  prerelease: true,
})
assert.equal(
  findSingboxUpdate([...recent, release('v1.15.0')], installed('1.15.0-alpha.14')).version,
  '1.15.0',
)
assert.equal(
  findSingboxUpdate([...recent, release('v1.15.0-beta.1')], installed('1.15.0-alpha.20')).version,
  '1.15.0-beta.1',
)
assert.equal(findSingboxUpdate(recent, installed('1.15.0-alpha.14')), undefined)
assert.equal(findSingboxUpdate(recent, installed('1.16.0-alpha.1')), undefined)

// Stable install: only stable releases, never a prerelease by flag or by tag.
assert.equal(findSingboxUpdate([release('v1.14.4')], installed('1.14.3')).version, '1.14.4')
assert.equal(findSingboxUpdate([release('v1.14.4')], installed('1.14.4')), undefined)
assert.equal(findSingboxUpdate([release('v1.14.4')], installed('1.14.5')), undefined)
assert.equal(findSingboxUpdate(recent, installed('1.14.4')), undefined)
assert.equal(findSingboxUpdate([release('v1.15.0-rc.1', false)], installed('1.14.4')), undefined)
assert.equal(findSingboxUpdate([], installed('1.14.4')), undefined)
assert.equal(findSingboxUpdate([release('not-a-version', false)], installed('1.14.4')), undefined)

// Check result: an update, or "latest" with the channel the user is on.
assert.deepEqual(singboxUpdateStatus(recent, installed('1.15.0-alpha.14')), {
  state: 'latest',
  channel: 'testing',
})
assert.deepEqual(singboxUpdateStatus([release('v1.14.4')], installed('1.14.4')), {
  state: 'latest',
  channel: 'stable',
})
const updateStatus = singboxUpdateStatus(recent, installed('1.15.0-alpha.13'))
assert.equal(updateStatus.state, 'update')
assert.equal(updateStatus.update.version, '1.15.0-alpha.14')

// Only the fields the check reads are kept (the raw API carries every asset).
const raw = { ...release('v1.14.4'), assets: [{ name: 'x', uploader: {} }], body: 'notes' }
assert.deepEqual(pickSingboxReleases(raw), [release('v1.14.4')])
assert.deepEqual(pickSingboxReleases([raw, raw]).length, 2)
assert.equal('assets' in pickSingboxReleases([raw])[0], false)

console.log('sing-box update notice: version parsing, channel selection and status passed')
