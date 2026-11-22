const CACHE_DURATION = 1000 * 60 * 60

interface CacheEntry<T> {
  timestamp: number
  version: string
  data: T
}

// maxAge 0 always refetches (and refreshes the cache), e.g. for an explicit or
// periodic check that must not reuse an older answer.
export const fetchWithLocalCache = async <T>(
  url: string,
  version: string,
  maxAge = CACHE_DURATION,
): Promise<T> => {
  const cacheKey = 'cache/' + url
  const cacheRaw = localStorage.getItem(cacheKey)

  if (cacheRaw) {
    try {
      const cache: CacheEntry<T> = JSON.parse(cacheRaw)
      const now = Date.now()

      if (now - cache.timestamp < maxAge && cache.version === version) {
        return cache.data
      } else {
        localStorage.removeItem(cacheKey)
      }
    } catch (e) {
      console.warn('Failed to parse cache for', url, e)
    }
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
  }

  const data: T = await response.json()

  localStorage.setItem(
    cacheKey,
    JSON.stringify({ timestamp: Date.now(), version, data } satisfies CacheEntry<T>),
  )

  return data
}
