type ReleaseVersion = {
  major: number
  minor: number
  patch: number
  prerelease: (string | number)[]
}

export type ForkRelease = { tag_name: string; prerelease: boolean; draft: boolean }

const parseIdentifier = (value: string) => (/^\d+$/.test(value) ? Number(value) : value)

export const parseReleaseTag = (tag: string): ReleaseVersion | undefined => {
  const match = /^sb-v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag)
  if (!match) return undefined

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.').map(parseIdentifier) ?? [],
  }
}

const comparePrerelease = (left: (string | number)[], right: (string | number)[]) => {
  if (!left.length && !right.length) return 0
  if (!left.length) return 1
  if (!right.length) return -1

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1
    if (typeof a === 'number') return -1
    if (typeof b === 'number') return 1
    return a < b ? -1 : 1
  }
  return 0
}

export const compareReleaseTags = (leftTag: string, rightTag: string) => {
  const left = parseReleaseTag(leftTag)
  const right = parseReleaseTag(rightTag)
  if (!left || !right) return undefined

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

export const isReleaseNewer = (candidate: string, installed: string) =>
  compareReleaseTags(candidate, installed) === 1

export const latestStableRelease = (releases: ForkRelease[]) =>
  releases.find(
    (release) =>
      !release.draft && !release.prerelease && /^sb-v\d+\.\d+\.\d+$/.test(release.tag_name),
  )

export const hasNewerStableRelease = (releases: ForkRelease[], installed: string) => {
  const latest = latestStableRelease(releases)
  return latest ? isReleaseNewer(latest.tag_name, installed) : false
}
