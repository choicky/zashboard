const CACHE_DURATION = 1000 * 60 * 60

interface CacheEntry<T> {
  timestamp: number
  version: string
  data: T
}

// maxAge 0 always refetches (and refreshes the cache), e.g. for an explicit or
// periodic check that must not reuse an older answer. `select` keeps only what
// the caller needs: GitHub release lists are several MB with every asset's
// metadata, which can exceed the localStorage quota.
export const fetchWithLocalCache = async <T>(
  url: string,
  version: string,
  maxAge = CACHE_DURATION,
  select: (raw: unknown) => T = (raw) => raw as T,
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

  const data = select(await response.json())

  // The cache is an optimisation: a full or unavailable storage must never
  // turn a successful fetch into a failure.
  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({ timestamp: Date.now(), version, data } satisfies CacheEntry<T>),
    )
  } catch (e) {
    console.warn('Failed to cache', url, e)
  }

  return data
}
