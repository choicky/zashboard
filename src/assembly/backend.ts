// 组装层 · 后端判别与能力表。
//
// 只有一条判别轴,且**仅限 assembly 层内部使用**
//(components / views / composables 由 eslint no-restricted-imports 禁止导入):
//
//   core —— 运行时内核品牌。靠 /version 字符串嗅探得来,是启发式猜测,
//           可能误判(分支核 / 兼容核),且拉取完成前为 'unknown'。
//
// 支持 Clash REST/WS 与 sing-box 原生 gRPC 两条连接通道:
//   A. core=mihomo  mihomo 的 Clash API
//   B. core=honk    honk 的 Clash 兼容 API(端点子集)
//
// 能力表只剩由 core 决定的这一张,一律通过 can() 读取。因探测是启发式,允许用户用
// displayAllFeatures 强制掰开(提示文案承诺:fork 版内核可能支持官方版没有的功能)。
//
// 两种形态都提供的端点不进表:can() 会恒真,徒增一层查表。直接调即可。
//
// 注意:能凭响应数据自证的差异(如 rules 开关端点由 rule.uuid 决定、smart 由
// proxy.type 决定)不进此表,就近放在对应的 assembly 子模块里 —— 数据比版本
// 字符串可靠,不该被降级成全局猜测。

import { probeClashChannel } from '@/api/clash'
import type { ProbeResult } from '@/helper/connectivity'
import { displayAllFeatures } from '@/store/settings'
import { activeBackend } from '@/store/setup'
import type { Backend } from '@/types'
import { computed, ref } from 'vue'

const USBIP_MIN_API_VERSION = 2
const OPENVPN_MIN_API_VERSION = 3
const TAILDROP_MIN_API_VERSION = 4

export enum Channel {
  Clash = 'clash',
  Singbox = 'singbox',
}

export enum Core {
  Mihomo = 'mihomo',
  Singbox = 'singbox',
  Honk = 'honk',
  Unknown = 'unknown',
}

export const channel = computed<Channel>(() =>
  activeBackend.value?.type === 'singbox' ? Channel.Singbox : Channel.Clash,
)

// core 由 assembly/version.ts 在探测 /version 后写入,
// 后端切换时先重置为未知,避免沿用上一个后端的结论。
export const core = ref<Core>(Core.Unknown)
export const apiVersion = ref(0)

export const resetCore = () => {
  core.value = Core.Unknown
  apiVersion.value = 0
}

// displayAllFeatures 的适用范围:跑着非 mihomo 内核(honk)时。
// 该开关的语义是「我用的 fork 版内核也支持这些 mihomo 扩展端点,先显示出来」。
// core 未探测出结论(Unknown)时不掰,免得凭空点亮一堆按钮。
const isNonMihomoCore = computed(
  () =>
    channel.value === Channel.Clash && (core.value === Core.Singbox || core.value === Core.Honk),
)

const isForkCoreOverride = computed(() => isNonMihomoCore.value && displayAllFeatures.value)

// 开关自身的可见性与其生效范围保持一致。
export const showDisplayAllFeatures = computed(() => !!activeBackend.value && isNonMihomoCore.value)

const soft = computed(() => {
  const singbox = core.value === Core.Singbox
  const mihomo = core.value === Core.Mihomo
  const honk = core.value === Core.Honk
  const mihomoOrForkCore = mihomo || isForkCoreOverride.value

  return {
    // ---------- mihomo 内核侧 ----------
    coreUpgrade: mihomoOrForkCore,
    coreRestart: mihomoOrForkCore,
    reloadConfigs: mihomoOrForkCore,
    updateConfigs: mihomoOrForkCore,
    updateGeoDatabase: mihomoOrForkCore,
    // /storage/zashboard 设置同步,mihomo 扩展
    syncSettings: mihomoOrForkCore,
    independentLatency: mihomoOrForkCore,
    coreUpdateCheck: mihomo,
    // ports / tun / allow-lan 等 PATCH /configs 配置块。
    configPatch: mihomo,

    customGlobalNode: singbox,
    logTypeFilter: singbox,
    logConnectionDetail: singbox,
    disconnectOnModeChange: singbox,

    // ---------- 日志级别集合 ----------
    // /logs?level= 传了内核不认的级别会被 400 掉,WS 随后陷入无限重连,
    // 所以按内核各自支持的取值逐档点亮,拼装见 assembly/logs。
    // trace:honk 有,mihomo 没有
    traceLogLevel: singbox || honk,
    extraLogLevels: singbox,
    // silent:mihomo 有,honk 没有
    silentLogLevel: mihomo || singbox,

    // ---------- honk 内核侧 ----------
    // GET /stats:honk 独有的用户态运行时快照。方向与上面那批相反,
    // 故不接 displayAllFeatures —— 那个开关说的是「我的 fork 也支持 mihomo 扩展」。
    runtimeStats: honk,
  }
})

const hard = computed(() => {
  const clash = !!activeBackend.value && channel.value === Channel.Clash
  const singbox = !!activeBackend.value && channel.value === Channel.Singbox

  return {
    rules: clash,
    dnsQuery: clash,
    dnsFlush: clash,
    fakeIPFlush: clash,
    coreActions: clash,
    // sing-box 1.14 的 Clash API 与 mihomo 均提供 POST /upgrade/ui。
    dashboardUpgrade: clash && core.value !== Core.Honk,
    tools: singbox,
    goroutines: singbox,
    startedAt: singbox,
    usbip: singbox && apiVersion.value >= USBIP_MIN_API_VERSION,
    openvpn: singbox && apiVersion.value >= OPENVPN_MIN_API_VERSION,
    taildrop: singbox && apiVersion.value >= TAILDROP_MIN_API_VERSION,
  }
})

export type Cap = keyof typeof soft.value | keyof typeof hard.value

export const can = (cap: Cap): boolean => {
  if (!activeBackend.value) return false

  if (cap in hard.value) return hard.value[cap as keyof typeof hard.value]
  return soft.value[cap as keyof typeof soft.value]
}

// 后端连通性探测(供 Setup / EditBackend / 连接失败页使用)。
// 结果形状统一成 ProbeResult:成功带耗时,失败带可诊断的分类,
// 由 helper/connectivity 的 describeProbeFailure 翻译成给用户看的一句话。
export const probeBackend = async (
  backend: Backend,
  timeout: number = 10000,
  signal?: AbortSignal,
): Promise<ProbeResult> => {
  if (backend.type === 'singbox') {
    const { probeSingboxChannel } = await import('@/api/singbox/client')
    return probeSingboxChannel(backend, timeout, signal)
  }
  return probeClashChannel(backend, timeout, signal)
}

export const isBackendAvailable = (backend: Backend, timeout: number = 10000) =>
  probeBackend(backend, timeout).then((result) => result.ok)
