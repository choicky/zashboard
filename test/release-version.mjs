import assert from 'node:assert/strict'
import {
  compareReleaseTags,
  hasNewerStableRelease,
  isReleaseNewer,
  latestStableRelease,
} from '../src/assembly/release-version.ts'

assert.equal(compareReleaseTags('sb-v3.30.0', 'sb-v3.30.0'), 0)
assert.equal(compareReleaseTags('sb-v3.31.0', 'sb-v3.30.0'), 1)
assert.equal(compareReleaseTags('sb-v3.29.9', 'sb-v3.30.0'), -1)
assert.equal(compareReleaseTags('sb-v3.30.0', 'sb-v3.30.0-rc3'), 1)
assert.equal(compareReleaseTags('sb-v3.31.0-rc1', 'sb-v3.30.0'), 1)
assert.equal(compareReleaseTags('sb-v3.30.0-rc2', 'sb-v3.30.0-rc3'), -1)
assert.equal(isReleaseNewer('sb-v3.30.0', 'sb-v3.30.0-rc3'), true)
assert.equal(isReleaseNewer('sb-v3.30.0', 'sb-v3.31.0-rc1'), false)
assert.equal(compareReleaseTags('v3.30.0', 'sb-v3.30.0'), undefined)
assert.equal(
  hasNewerStableRelease(
    [{ tag_name: 'sb-v3.30.0-rc3', prerelease: true, draft: false }],
    'sb-v3.30.0-rc3',
  ),
  false,
)
assert.equal(
  latestStableRelease([
    { tag_name: 'sb-v3.30.0-rc3', prerelease: true, draft: false },
    { tag_name: 'sb-v3.30.1', prerelease: false, draft: false },
    { tag_name: 'sb-v3.32.0', prerelease: false, draft: false },
    { tag_name: 'sb-v3.31.0', prerelease: false, draft: false },
  ])?.tag_name,
  'sb-v3.32.0',
)

console.log('release version ordering: scenarios passed')
