import { displayAllFeatures } from '@/store/settings'
import { activeBackend } from '@/store/setup'
import { computed, ref } from 'vue'
import { daeCapabilities } from './capabilities'

export enum Core {
  Mihomo = 'mihomo',
  SingBox = 'sing-box',
  Honk = 'honk',
  Dae = 'dae',
  Unknown = 'unknown',
}

export const core = ref<Core>(Core.Unknown)

export const resetCore = () => {
  core.value = Core.Unknown
}

const isNonMihomoCore = computed(
  () => core.value === Core.Honk && activeBackend.value?.type !== 'dae',
)

const isForkCoreOverride = computed(() => isNonMihomoCore.value && displayAllFeatures.value)

export const showDisplayAllFeatures = computed(() => !!activeBackend.value && isNonMihomoCore.value)

export type Cap =
  | 'coreUpgrade'
  | 'coreRestart'
  | 'dashboardUpgrade'
  | 'reloadConfigs'
  | 'updateConfigs'
  | 'updateGeoDatabase'
  | 'syncSettings'
  | 'independentLatency'
  | 'coreUpdateCheck'
  | 'configPatch'
  | 'networkConfig'
  | 'traceLogLevel'
  | 'silentLogLevel'
  | 'runtimeStats'
  | 'latencyTest'
  | 'proxyProviderUpdate'
  | 'proxyProviderHealthCheck'
  | 'ruleProviders'
  | 'flushDNSCache'
  | 'flushFakeIP'
  | 'dnsQuery'
  | 'connectionsClose'
  | 'connectionsFilterClose'
  | 'customTestUrl'
  | 'nodeLatencyTest'
  | 'metricsHistory'
  | 'backendEvents'
  | 'flows'
  | 'dnsCache'
  | 'dnsLog'
  | 'dnsRules'
  | 'routingTrace'
  | 'datapath'
  | 'runtimeSettings'
  | 'geodataSettings'
  | 'configSources'
  | 'configCreate'
  | 'configEdit'
  | 'entryManage'
  | 'groupConfigPatch'
  | 'lifecycleControl'

type Caps = Partial<Record<Cap, boolean>>

const clashCaps = computed<Caps>(() => {
  const mihomo = core.value === Core.Mihomo
  const singBox = core.value === Core.SingBox
  const honk = core.value === Core.Honk
  const mihomoOrForkCore = mihomo || isForkCoreOverride.value

  return {
    coreUpgrade: mihomoOrForkCore,
    coreRestart: mihomoOrForkCore,
    dashboardUpgrade: mihomoOrForkCore,
    reloadConfigs: mihomoOrForkCore,
    updateConfigs: mihomoOrForkCore,
    updateGeoDatabase: mihomoOrForkCore,
    syncSettings: mihomoOrForkCore,
    independentLatency: mihomoOrForkCore,
    coreUpdateCheck: mihomo,
    configPatch: mihomo || singBox,
    networkConfig: mihomo,

    traceLogLevel: honk || singBox,
    silentLogLevel: mihomo,

    runtimeStats: honk,

    latencyTest: true,
    proxyProviderUpdate: !singBox,
    proxyProviderHealthCheck: !singBox,
    ruleProviders: !singBox,
    flushDNSCache: !singBox,
    flushFakeIP: !singBox,
    dnsQuery: !singBox,
    connectionsClose: true,
    customTestUrl: true,
    nodeLatencyTest: true,
  }
})

const daeCaps = computed<Caps>(() => {
  const resources = daeCapabilities.value?.resources
  const settingFields = resources?.runtime_settings?.fields ?? []

  return {
    reloadConfigs: resources?.reload?.available === true,
    updateGeoDatabase: resources?.geodata?.can_update === true,

    traceLogLevel: resources?.logs?.levels?.includes('trace') === true,

    runtimeStats: resources?.runtime_outbounds?.available === true,

    latencyTest: resources?.probes?.available === true,
    proxyProviderUpdate: resources?.providers?.can_refresh === true,
    flushDNSCache: resources?.dns_cache?.flush === true,
    dnsQuery: resources?.dns_query?.available === true,
    connectionsClose: resources?.connections?.can_close === true,
    connectionsFilterClose: resources?.connections?.can_close === true,
    metricsHistory:
      resources?.traffic_history?.available === true ||
      resources?.memory_history?.available === true,
    backendEvents: resources?.events?.available === true,
    flows: resources?.flows?.available === true,
    dnsCache: resources?.dns_cache?.read === true,
    dnsLog: resources?.dns_log?.available === true,
    dnsRules: resources?.dns_rules?.available === true,
    routingTrace: resources?.routing_trace?.available === true,
    datapath: resources?.datapath?.available === true,
    runtimeSettings: resources?.runtime_settings?.available === true,
    geodataSettings:
      resources?.geodata?.configurable_sources === true && settingFields.includes('geodata'),
    configSources: resources?.config?.available === true,
    configEdit: resources?.config?.writable === true,
    configCreate: resources?.config?.writable === true && resources?.config?.create === true,
    entryManage: resources?.nodes?.can_manage === true || resources?.providers?.can_manage === true,
    groupConfigPatch: resources?.groups?.config_patch === true,
    lifecycleControl:
      resources?.suspend?.available === true && resources?.resume?.available === true,
  }
})

const soft = computed<Caps>(() =>
  activeBackend.value?.type === 'dae' ? daeCaps.value : clashCaps.value,
)

export const can = (cap: Cap): boolean => {
  if (!activeBackend.value) return false

  return soft.value[cap] === true
}
