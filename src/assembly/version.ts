import DaeLogo from '@/assets/images/dae.jpg'
import HonkLogo from '@/assets/images/honk.svg'
import MetacubexLogo from '@/assets/images/metacubex.jpg'
import SingBoxLogo from '@/assets/images/sing-box.svg'
import { MIHOMO, MIHOMO_CHANNEL } from '@/constant'
import { fetchWithLocalCache } from '@/helper/cache'
import { getRequestErrorMessage } from '@/helper/request-error'
import { autoUpgradeCore, autoUpgradeDashboard, checkUpgradeCore } from '@/store/settings'
import { activeBackend } from '@/store/setup'
import type { Backend } from '@/types'
import { computed, nextTick, ref, watch } from 'vue'
import { can, core, Core, resetCore } from './backend'
import { fetchCapabilities, resetCapabilities } from './capabilities'
import { runOptionalCoreUpdateCheck } from './core-update'
import { driver } from './driver'
import {
  hasNewerStableRelease,
  parseSingboxVersion,
  releasesUrlFor,
  singboxUpdateStatus,
  type CoreUpdateStatus,
  type ForkRelease,
  type SingboxRelease,
} from './release-version'

export const version = ref()
export const isCoreUpdateAvailable = ref(false)
// Last successful core update check for the active backend; undefined while
// unchecked, disabled or after a failed check. For sing-box an available
// update carries the release to link to; the user upgrades on the host.
export const coreUpdateStatus = ref<CoreUpdateStatus | undefined>()
export const isUIUpdateAvailable = ref(false)
// The fork release tag (e.g. sb-v3.30.4) is the dashboard's identity: it is
// shown in settings and compared with newer fork releases. package.json keeps
// the upstream version and is not a fork release number.
export const zashboardReleaseTag = ref(__BUILD_RELEASE_TAG__)
let backendGeneration = 0
let uiUpdateCheckGeneration = -1
let uiUpdateCheckPromise: Promise<void> | undefined

watch(activeBackend, () => {
  backendGeneration++
  void checkUIUpdate()
})

export type BackendProbe = {
  uuid: string
  status: 'probing' | 'connected' | 'failed'
  latency: number
  message: string
}

export const backendProbe = ref<BackendProbe | undefined>()

const detectCore = (versionString: string): Core => {
  if (activeBackend.value?.type === 'singbox') return Core.SingBox
  if (/\bsing-box\b/i.test(versionString)) return Core.SingBox
  if (/\bhonk\b/i.test(versionString)) return Core.Honk
  if (activeBackend.value?.type === 'dae') return Core.Dae
  if (!versionString) return Core.Unknown
  return Core.Mihomo
}

export const coreBrand = computed(() => {
  switch (core.value) {
    case Core.SingBox:
      return { logo: SingBoxLogo, url: 'https://github.com/SagerNet/sing-box' }
    case Core.Honk:
      return { logo: HonkLogo, url: 'https://github.com/Glassyiris/honk' }
    case Core.Dae:
      return { logo: DaeLogo, url: 'https://github.com/daeuniverse/dae' }
    default:
      return {
        logo: MetacubexLogo,
        url: MIHOMO_CHANNEL[mihomo.value?.[0] ?? MIHOMO.Meta].url,
      }
  }
})

export const mihomo = computed<[MIHOMO, string] | undefined>(() => {
  if (core.value !== Core.Mihomo) return undefined

  const match = /(alpha-smart|alpha|beta|meta)-?(\w+)/.exec(version.value)
  switch (match?.[1]) {
    case 'alpha':
      return [MIHOMO.Alpha, match[2] ?? version.value]
    case 'alpha-smart':
      return [MIHOMO.Smart, match[2] ?? version.value]
    case 'meta':
      return [MIHOMO.Meta, match[2] ?? version.value]
    default:
      return [MIHOMO.Meta, version.value]
  }
})

export const restartCore = () => driver().system.restartCore()

export const upgradeCore = (channel: 'release' | 'alpha' | 'auto') =>
  driver().system.upgradeCore(channel)

export const upgradeUI = () => driver().system.upgradeUI()

const probeBackendVersion = async (backend: Backend) => {
  const startAt = Date.now()
  let versionString: string

  try {
    versionString = await driver().system.fetchVersion()
  } catch (e) {
    if (activeBackend.value?.uuid === backend.uuid) {
      backendProbe.value = {
        uuid: backend.uuid,
        status: 'failed',
        latency: 0,
        message: getRequestErrorMessage(e),
      }
    }
    throw e
  }

  if (activeBackend.value?.uuid !== backend.uuid) return

  version.value = versionString
  core.value = detectCore(version.value)

  if (backend.type === 'dae') {
    await fetchCapabilities()
  }

  backendProbe.value = {
    uuid: backend.uuid,
    status: 'connected',
    latency: Date.now() - startAt,
    message: '',
  }

  // HomePage may have checked before /version completed. Re-run after this
  // probe returns so core identity and capabilities are authoritative without
  // recursively awaiting the probe that is still in flight.
  setTimeout(() => void checkUIUpdate(), 0)

  // Page load, backend switch and reconnects may reuse a recent answer.
  void checkCoreUpdate()
}

const CORE_UPDATE_INTERVAL = 30 * 60 * 1000
let coreUpdateCheckSeq = 0

const clearCoreUpdate = () => {
  coreUpdateCheckSeq++
  isCoreUpdateAvailable.value = false
  coreUpdateStatus.value = undefined
}

// One entry for every trigger: probe, enabling the setting, and the periodic
// timer. Only the newest check for the current backend may publish a result.
// `fresh` bypasses the local cache so an explicit or periodic check really
// asks GitHub again, and first re-reads the installed version: the core may
// have been upgraded (on the host, or by an automatic mihomo upgrade) while
// the page stayed open, and comparing a stale version would keep reporting,
// or re-triggering, an update that is already installed.
export const checkCoreUpdate = async ({ fresh = false } = {}) => {
  const backend = activeBackend.value
  let versionString = version.value
  if (
    !backend ||
    !versionString ||
    backendProbe.value?.uuid !== backend.uuid ||
    backendProbe.value.status !== 'connected' ||
    !checkUpgradeCore.value ||
    backend.disableUpgradeCore
  ) {
    return
  }

  const seq = ++coreUpdateCheckSeq
  const generation = backendGeneration
  const isCurrent = () =>
    seq === coreUpdateCheckSeq &&
    backendGeneration === generation &&
    activeBackend.value?.uuid === backend.uuid &&
    checkUpgradeCore.value
  const maxAge = fresh ? 0 : undefined
  const publish = (status: CoreUpdateStatus | undefined) => {
    coreUpdateStatus.value = status
    isCoreUpdateAvailable.value = status?.state === 'update'
  }

  if (fresh) {
    try {
      const installed = await driver().system.fetchVersion()
      if (!isCurrent()) return
      if (installed && installed !== versionString) {
        versionString = installed
        version.value = installed
      }
    } catch {
      // Core unreachable right now: do not compare a possibly stale version.
      if (isCurrent()) publish(undefined)
      return
    }
  }

  if (can('coreUpdateNotice')) {
    let status: CoreUpdateStatus | undefined
    runOptionalCoreUpdateCheck({
      check: async () => {
        status = await fetchSingboxUpdateStatus(versionString, maxAge)
        return status?.state === 'update'
      },
      isCurrent,
      onResult: () => publish(status),
      onFailure: () => publish(undefined),
    })
    return
  }

  if (!can('coreUpdateCheck')) return

  const updateVersion = mihomo.value?.[1] ?? versionString
  const updateChannel = MIHOMO_CHANNEL[mihomo.value?.[0] ?? MIHOMO.Meta]
  runOptionalCoreUpdateCheck({
    check: () => fetchIsCoreUpdateAvailable(updateChannel.check_update_url, updateVersion, maxAge),
    isCurrent,
    onResult: (available) => {
      publish({ state: available ? 'update' : 'latest' })
      if (available && autoUpgradeCore.value) upgradeCore('auto').catch(() => {})
    },
    onFailure: () => publish(undefined),
  })
}

// Enabling the setting checks at once; disabling it clears any result.
watch(checkUpgradeCore, (enabled, wasEnabled) => {
  if (!enabled) clearCoreUpdate()
  else if (!wasEnabled) void checkCoreUpdate({ fresh: true })
})

// While the page stays open, check again every 30 minutes (bypassing the cache).
if (typeof window !== 'undefined') {
  window.setInterval(() => void checkCoreUpdate({ fresh: true }), CORE_UPDATE_INTERVAL)
}

let probe: Promise<void> = Promise.resolve()

export const coreReady = async () => {
  await nextTick()
  await probe
}

export const probeActiveBackend = () => {
  const backend = activeBackend.value

  resetCore()
  resetCapabilities()
  version.value = ''
  clearCoreUpdate()
  backendProbe.value = backend
    ? { uuid: backend.uuid, status: 'probing', latency: 0, message: '' }
    : undefined

  probe = backend ? probeBackendVersion(backend) : Promise.resolve()
  return probe
}

const fetchIsCoreUpdateAvailable = async (url: string, versionNumber: string, maxAge?: number) => {
  const { assets } = await fetchWithLocalCache<{ assets: { name: string }[] }>(
    url,
    versionNumber,
    maxAge,
  )

  return !assets.some(({ name }) => name.includes(versionNumber))
}

// Stable installs compare with the latest stable release, testing installs
// (alpha/beta/rc) with the newest release of any kind.
// An unparseable version yields no status: never claim "up to date" for it.
const fetchSingboxUpdateStatus = async (versionString: string, maxAge?: number) => {
  const installed = parseSingboxVersion(versionString)
  if (!installed) return undefined
  const data = await fetchWithLocalCache<SingboxRelease | SingboxRelease[]>(
    releasesUrlFor(installed),
    versionString,
    maxAge,
  )
  return singboxUpdateStatus(Array.isArray(data) ? data : [data], installed)
}

const checkUIUpdateForGeneration = async (checkGeneration: number) => {
  const backendUuid = activeBackend.value?.uuid
  try {
    await coreReady()
  } catch {
    return
  }

  // A check started for an old backend must never act on the newly selected
  // backend after probing or fetching GitHub releases completes.
  if (
    !backendUuid ||
    backendGeneration !== checkGeneration ||
    activeBackend.value?.uuid !== backendUuid
  ) {
    return
  }

  if (core.value === Core.Unknown) {
    isUIUpdateAvailable.value = false
    return
  }

  if (!can('dashboardUpgrade')) {
    isUIUpdateAvailable.value = false
    return
  }

  let releases: ForkRelease[]

  try {
    releases = await fetchWithLocalCache<ForkRelease[]>(
      'https://api.github.com/repos/choicky/zashboard/releases?per_page=30',
      zashboardReleaseTag.value,
    )
  } catch {
    // A fork with only prereleases has no stable "latest" release yet.
    if (backendGeneration === checkGeneration && activeBackend.value?.uuid === backendUuid) {
      isUIUpdateAvailable.value = false
    }
    return
  }

  // Compare the complete fork tag. In particular, a prerelease must not be
  // compared to v3.30.0 or repeatedly trigger an automatic update.
  if (backendGeneration !== checkGeneration || activeBackend.value?.uuid !== backendUuid) {
    return
  }

  isUIUpdateAvailable.value = hasNewerStableRelease(releases, zashboardReleaseTag.value)

  if (isUIUpdateAvailable.value && autoUpgradeDashboard.value && can('dashboardAutoUpgrade')) {
    upgradeUI().catch(() => {})
  }
}

export const checkUIUpdate = () => {
  const generation = backendGeneration
  if (uiUpdateCheckPromise && uiUpdateCheckGeneration === generation) {
    return uiUpdateCheckPromise
  }

  uiUpdateCheckGeneration = generation
  const promise = checkUIUpdateForGeneration(generation).finally(() => {
    if (uiUpdateCheckPromise === promise) uiUpdateCheckPromise = undefined
  })
  uiUpdateCheckPromise = promise
  return promise
}
