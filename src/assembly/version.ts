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
import { hasNewerStableRelease, type ForkRelease } from './release-version'

export const version = ref()
export const isCoreUpdateAvailable = ref(false)
export const isUIUpdateAvailable = ref(false)
export const zashboardVersion = ref(__APP_VERSION__)
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

  if (!can('coreUpdateCheck') || !checkUpgradeCore.value || backend.disableUpgradeCore) return

  const updateGeneration = backendGeneration
  const backendUuid = backend.uuid
  const updateVersion = mihomo.value?.[1] ?? versionString
  const updateChannel = MIHOMO_CHANNEL[mihomo.value?.[0] ?? MIHOMO.Meta]
  runOptionalCoreUpdateCheck({
    check: () => fetchIsCoreUpdateAvailable(updateChannel.check_update_url, updateVersion),
    isCurrent: () =>
      backendGeneration === updateGeneration && activeBackend.value?.uuid === backendUuid,
    onResult: (available) => {
      isCoreUpdateAvailable.value = available
      if (available && autoUpgradeCore.value) upgradeCore('auto').catch(() => {})
    },
    onFailure: () => {
      isCoreUpdateAvailable.value = false
    },
  })
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
  isCoreUpdateAvailable.value = false
  backendProbe.value = backend
    ? { uuid: backend.uuid, status: 'probing', latency: 0, message: '' }
    : undefined

  probe = backend ? probeBackendVersion(backend) : Promise.resolve()
  return probe
}

const fetchIsCoreUpdateAvailable = async (url: string, versionNumber: string) => {
  const { assets } = await fetchWithLocalCache<{ assets: { name: string }[] }>(url, versionNumber)

  return !assets.some(({ name }) => name.includes(versionNumber))
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

  if (isUIUpdateAvailable.value && autoUpgradeDashboard.value) {
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
