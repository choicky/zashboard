export type ReleaseVersion = {
  major: number
  minor: number
  patch: number
  prerelease: (string | number)[]
}

export type ForkRelease = { tag_name: string; prerelease: boolean; draft: boolean }

const parseIdentifier = (value: string) => (/^\d+$/.test(value) ? Number(value) : value)

// Semantic version with an optional leading `v` (sing-box tags are `v1.2.3`).
export const parseSemver = (value: string): ReleaseVersion | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) return undefined

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.').map(parseIdentifier) ?? [],
  }
}

export const parseReleaseTag = (tag: string): ReleaseVersion | undefined =>
  tag.startsWith('sb-v') ? parseSemver(tag.slice('sb-'.length)) : undefined

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

export const compareVersions = (left: ReleaseVersion, right: ReleaseVersion) => {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

export const compareReleaseTags = (leftTag: string, rightTag: string) => {
  const left = parseReleaseTag(leftTag)
  const right = parseReleaseTag(rightTag)
  return left && right ? compareVersions(left, right) : undefined
}

export const isReleaseNewer = (candidate: string, installed: string) =>
  compareReleaseTags(candidate, installed) === 1

export const latestStableRelease = (releases: ForkRelease[]) =>
  releases
    .filter(
      (release) =>
        !release.draft && !release.prerelease && /^sb-v\d+\.\d+\.\d+$/.test(release.tag_name),
    )
    .reduce<ForkRelease | undefined>(
      (latest, release) =>
        !latest || compareReleaseTags(release.tag_name, latest.tag_name) === 1 ? release : latest,
      undefined,
    )

export const hasNewerStableRelease = (releases: ForkRelease[], installed: string) => {
  const latest = latestStableRelease(releases)
  return latest ? isReleaseNewer(latest.tag_name, installed) : false
}

// --- sing-box core ---
// Notify-only update check for sing-box. Neither the Clash API nor the native
// API of sing-box can upgrade the core, so the dashboard only reports a newer
// official release and links to it; the user upgrades on the host.
export type SingboxRelease = {
  tag_name: string
  prerelease: boolean
  draft: boolean
  html_url: string
}

export type SingboxUpdate = {
  version: string
  url: string
  prerelease: boolean
}

const RELEASES_API = 'https://api.github.com/repos/SagerNet/sing-box/releases'
// Stable installs follow the latest stable release only.
export const SINGBOX_LATEST_RELEASE_URL = `${RELEASES_API}/latest`
// Testing installs follow the newest release of any kind: a recent page holds
// every current alpha/beta/rc and any stable release newer than them.
export const SINGBOX_RECENT_RELEASES_URL = `${RELEASES_API}?per_page=30`

// The Clash API reports e.g. "sing-box 1.15.0-alpha.13", the native API
// "1.15.0-alpha.13"; both may carry build metadata.
export const parseSingboxVersion = (versionString: string): ReleaseVersion | undefined => {
  const match = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(versionString)
  return match ? parseSemver(match[1]!) : undefined
}

export const isTestingVersion = (installed: ReleaseVersion) => installed.prerelease.length > 0

export const releasesUrlFor = (installed: ReleaseVersion) =>
  isTestingVersion(installed) ? SINGBOX_RECENT_RELEASES_URL : SINGBOX_LATEST_RELEASE_URL

export const findSingboxUpdate = (
  releases: SingboxRelease[],
  installed: ReleaseVersion,
): SingboxUpdate | undefined => {
  const testing = isTestingVersion(installed)
  let newest: { release: SingboxRelease; version: ReleaseVersion } | undefined

  for (const release of releases) {
    if (release.draft || (!testing && release.prerelease)) continue
    const version = parseSemver(release.tag_name)
    // A stable install never compares against a version that is only a
    // prerelease by its tag, even if GitHub's flag says otherwise.
    if (!version || (!testing && version.prerelease.length)) continue
    if (!newest || compareVersions(version, newest.version) === 1) newest = { release, version }
  }

  if (!newest || compareVersions(newest.version, installed) !== 1) return undefined
  return {
    version: newest.release.tag_name.replace(/^v/, ''),
    url: newest.release.html_url,
    prerelease: newest.version.prerelease.length > 0,
  }
}
