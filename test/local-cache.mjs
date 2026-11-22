import assert from 'node:assert/strict'

// Minimal browser globals for src/helper/cache.ts.
const store = new Map()
let quota = false
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    if (quota) throw new Error('QuotaExceededError')
    store.set(key, String(value))
  },
  removeItem: (key) => store.delete(key),
}
let fetches = 0
let body = {}
globalThis.fetch = async () => {
  fetches++
  return { ok: true, json: async () => body }
}

const { fetchWithLocalCache } = await import('../src/helper/cache.ts')
const { pickSingboxReleases } = await import('../src/assembly/release-version.ts')
const url = 'https://api.github.com/repos/SagerNet/sing-box/releases/latest'
const release = {
  tag_name: 'v1.14.4',
  prerelease: false,
  draft: false,
  html_url: 'https://github.com/SagerNet/sing-box/releases/tag/v1.14.4',
}

// An entry from an older build holds the raw single-object response; a cache
// hit must still be normalised by `select`.
store.set(
  'cache/' + url,
  JSON.stringify({ timestamp: Date.now(), version: '1.14.4', data: { ...release, assets: [{}] } }),
)
assert.deepEqual(await fetchWithLocalCache(url, '1.14.4', undefined, pickSingboxReleases), [
  release,
])
assert.equal(fetches, 0)

// maxAge 0 refetches; only the selected fields are stored.
body = { ...release, assets: [{ name: 'x', uploader: {} }], body: 'notes' }
assert.deepEqual(await fetchWithLocalCache(url, '1.14.4', 0, pickSingboxReleases), [release])
assert.equal(fetches, 1)
assert.deepEqual(JSON.parse(store.get('cache/' + url)).data, [release])

// A failing cache write does not fail the fetch.
quota = true
assert.deepEqual(await fetchWithLocalCache(url, '1.14.4', 0, pickSingboxReleases), [release])
assert.equal(fetches, 2)

console.log('local cache: select on hit and miss, refetch and quota failure passed')
