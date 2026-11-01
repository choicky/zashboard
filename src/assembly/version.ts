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
import { computed, nextTick, ref } from 'vue'
import { can, core, Core, resetCore } from './backend'
import { fetchCapabilities, resetCapabilities } from './capabilities'
import { driver } from './driver'

export const version = ref()
export const isCoreUpdateAvailable = ref(false)
export const isUIUpdateAvailable = ref(false)
export const zashboardVersion = ref(__APP_VERSION__)
export const zashboardReleaseTag = ref(__BUILD_RELEASE_TAG__)

export type BackendProbe = {
  uuid: string
  status: 'probing' | 'connected' | 'failed'
  latency: number
  message: string
}

export const backendProbe = ref<BackendProbe | undefined>()

const detectCore = (versionString: string): Core => {
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

  if (!can('coreUpdateCheck') || !checkUpgradeCore.value || backend.disableUpgradeCore) return

  isCoreUpdateAvailable.value = await fetchIsCoreUpdateAvailable()

  if (isCoreUpdateAvailable.value && autoUpgradeCore.value) {
    upgradeCore('auto').catch(() => {})
  }
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

  probe = backend ? probeBackendVersion(backend).catch(() => {}) : Promise.resolve()
  return probe
}

const fetchIsCoreUpdateAvailable = async () => {
  const versionNumber = mihomo.value?.[1] ?? version.value
  const { assets } = await fetchWithLocalCache<{ assets: { name: string }[] }>(
    MIHOMO_CHANNEL[mihomo.value?.[0] ?? MIHOMO.Meta].check_update_url,
    versionNumber,
  )

  return !assets.some(({ name }) => name.includes(versionNumber))
}

export const checkUIUpdate = async () => {
  if (!can('dashboardUpgrade')) {
    isUIUpdateAvailable.value = false
    return
  }

  type Release = { tag_name: string; prerelease: boolean; draft: boolean }
  let releases: Release[]

  try {
    releases = await fetchWithLocalCache<Release[]>(
      'https://api.github.com/repos/choicky/zashboard/releases?per_page=30',
      zashboardReleaseTag.value,
    )
  } catch {
    // A fork with only prereleases has no stable "latest" release yet.
    isUIUpdateAvailable.value = false
    return
  }

  const latestStable = releases.find(
    (release) =>
      !release.draft && !release.prerelease && /^sb-v\d+\.\d+\.\d+$/.test(release.tag_name),
  )

  // Compare the complete fork tag. In particular, sb-v3.30.0-rc1 must not be
  // compared to v3.30.0 or repeatedly trigger an automatic update.
  isUIUpdateAvailable.value = Boolean(
    latestStable && latestStable.tag_name !== zashboardReleaseTag.value,
  )

  if (isUIUpdateAvailable.value && autoUpgradeDashboard.value) {
    upgradeUI().catch(() => {})
  }
}
