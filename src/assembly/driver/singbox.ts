import { getSingboxClient, probeSingboxChannel, validateSingboxVersion } from '@/api/singbox/client'
import { subscribeStream } from '@/api/singbox/subscriptions'
import {
  isLatencyTestable,
  proxyGroupList,
  proxyMap,
  proxyProviederList,
} from '@/assembly/proxies/state'
import { LOG_LEVEL } from '@/constant'
import {
  ConnectionEventType,
  LogLevel,
  type ConnectionEvents,
  type Groups,
  type OutboundList,
  type Connection as PbConnection,
  type Log as PbLog,
  type Status,
} from '@/gen/daemon/started_service_pb'
import { iconReflectList } from '@/store/settings'
import { activeBackend } from '@/store/setup'
import type { Backend, Config, Connection, Log, Proxy } from '@/types'
import { shallowRef, watch } from 'vue'
import { coordinateNativeTest, freshNativeLatencyResults } from '../native-latency'
import type {
  ConnectionAccessor,
  ConnectionsPayload,
  Driver,
  ProxiesPayload,
  Stream,
} from './types'

const unsupported = (name: string): never => {
  throw new Error(`sing-box native API does not support ${name}`)
}

const toNumber = (value: bigint | number | undefined) => Number(value ?? 0)
const handles = new Set<{ close: () => void }>()
const proxyHandles = new Set<{ close: () => void }>()

const track = <T extends { close: () => void }>(handle: T, owner = handles): T => {
  owner.add(handle)
  const close = handle.close
  handle.close = () => {
    owner.delete(handle)
    close()
  }
  return handle
}

let proxyKey = ''
let groups = new Map<string, Groups['group'][number]>()
let outbounds = new Map<string, OutboundList['outbounds'][number]>()
let proxyReady: Promise<void> | undefined
let resolveProxyReady: (() => void) | undefined
let rejectProxyReady: ((reason: Error) => void) | undefined
let proxyGeneration = 0

const proxyFromItem = (item: OutboundList['outbounds'][number]): Proxy => ({
  name: item.tag,
  type: item.type || 'Unknown',
  now: '',
  history:
    item.urlTestDelay > 0
      ? [
          {
            time: new Date(toNumber(item.urlTestTime) * 1000).toISOString(),
            delay: item.urlTestDelay,
          },
        ]
      : [],
  extra: {},
  icon: '',
})

const rebuildProxies = (): ProxiesPayload => {
  const proxies: Record<string, Proxy> = {}
  for (const item of outbounds.values()) proxies[item.tag] = proxyFromItem(item)
  for (const group of groups.values()) {
    for (const item of group.items) if (!proxies[item.tag]) proxies[item.tag] = proxyFromItem(item)
    proxies[group.tag] = {
      name: group.tag,
      type: group.type || 'Selector',
      now: group.selected,
      all: group.items.map((item) => item.tag),
      selectable: group.selectable,
      history: [],
      extra: {},
      icon: '',
    }
    for (const item of group.items) {
      const node = proxies[item.tag]
      if (node && !node.all?.length && item.urlTestDelay > 0) {
        node.history = [
          {
            time: new Date(toNumber(item.urlTestTime) * 1000).toISOString(),
            delay: item.urlTestDelay,
          },
        ]
      }
    }
  }
  for (const proxy of Object.values(proxies)) {
    const icon = iconReflectList.value.find((item) => item.name === proxy.name)
    if (icon) proxy.icon = icon.icon
  }
  const payload = { proxies, providers: [] }
  proxyMap.value = proxies
  proxyGroupList.value = Object.values(proxies)
    .filter((proxy) => proxy.all?.length)
    .map((proxy) => proxy.name)
  proxyProviederList.value = []
  return payload
}

const startProxyStreams = (backend: Backend) => {
  const key = backend.uuid
  if (proxyKey === key && proxyReady) return
  rejectProxyReady?.(new Error('sing-box proxy subscription replaced'))
  proxyHandles.forEach((handle) => handle.close())
  proxyHandles.clear()
  groups = new Map()
  outbounds = new Map()
  proxyKey = key
  const generation = ++proxyGeneration
  proxyReady = new Promise((resolve, reject) => {
    resolveProxyReady = resolve
    rejectProxyReady = reject
  })
  setTimeout(() => {
    if (proxyGeneration !== generation || !resolveProxyReady) return
    const error = new Error('sing-box proxy subscription did not become ready')
    rejectProxyReady?.(error)
    proxyHandles.forEach((handle) => handle.close())
    proxyHandles.clear()
    proxyKey = ''
    proxyReady = undefined
    resolveProxyReady = undefined
    rejectProxyReady = undefined
  }, 10000)
  track(
    subscribeStream<Groups>(
      'groups',
      (message) => {
        if (proxyGeneration !== generation || activeBackend.value?.uuid !== key) return
        groups = new Map(message.group.map((group) => [group.tag, group]))
        rebuildProxies()
        resolveProxyReady?.()
        resolveProxyReady = undefined
        rejectProxyReady = undefined
      },
      backend,
    ),
    proxyHandles,
  )
  track(
    subscribeStream<OutboundList>(
      'outbounds',
      (message) => {
        if (proxyGeneration !== generation || activeBackend.value?.uuid !== key) return
        outbounds = new Map(message.outbounds.map((outbound) => [outbound.tag, outbound]))
        rebuildProxies()
      },
      backend,
    ),
    proxyHandles,
  )
}

const reset = () => {
  proxyGeneration++
  rejectProxyReady?.(new Error('sing-box proxy subscription cancelled'))
  rejectProxyReady = undefined
  resolveProxyReady = undefined
  proxyHandles.forEach((handle) => handle.close())
  proxyHandles.clear()
  handles.forEach((handle) => handle.close())
  handles.clear()
  proxyKey = ''
  proxyReady = undefined
  resolveProxyReady = undefined
  groups = new Map()
  outbounds = new Map()
}

const waitForNativeLatency = (names: string[], timeout: number, backend: Backend) => {
  const initialTimes = new Map(
    names.map((name) => {
      const time = proxyMap.value[name]?.history.at(-1)?.time
      return [name, time ? Date.parse(time) : 0]
    }),
  )

  let finish: (error?: Error, value?: Record<string, number>) => void = () => {}
  let stop = () => {}
  const promise = new Promise<Record<string, number>>((resolve, reject) => {
    let settled = false
    const complete = (error?: Error, value?: Record<string, number>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stop()
      if (error) reject(error)
      else resolve(value!)
    }
    finish = complete
    const timer = setTimeout(
      () => {
        const fresh = freshNativeLatencyResults(
          names,
          Object.fromEntries(
            names.map((name) => {
              const sample = proxyMap.value[name]?.history.at(-1)
              return [name, sample]
            }),
          ),
          initialTimes,
        )
        complete(undefined, Object.fromEntries(names.map((name) => [name, fresh[name] ?? 0])))
      },
      Math.max(1000, timeout) + 1000,
    )
    stop = watch(
      [proxyMap, activeBackend],
      () => {
        if (activeBackend.value?.uuid !== backend.uuid) {
          complete(new Error('sing-box URLTest session changed'))
          return
        }
        const result = freshNativeLatencyResults(
          names,
          Object.fromEntries(
            names.map((name) => {
              const sample = proxyMap.value[name]?.history.at(-1)
              return [name, sample]
            }),
          ),
          initialTimes,
        )
        if (Object.keys(result).length === names.length) {
          complete(undefined, result)
        }
      },
      { deep: true },
    )
  })
  return { promise, cancel: (error: Error) => finish(error) }
}

const runNativeURLTest = async (names: string[], timeout: number, requestTag = names[0]) => {
  const backend = activeBackend.value
  const client = getSingboxClient(backend)
  if (!client || !backend || names.length === 0)
    throw new Error('sing-box URLTest target unavailable')
  const waiter = waitForNativeLatency(names, timeout, backend)
  const controller = new AbortController()
  const rpc = client.client.uRLTest({ outboundTag: requestTag }, { signal: controller.signal })
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeout) + 1000)
  try {
    const result = await coordinateNativeTest({
      rpc,
      waiter: waiter.promise,
      abort: () => {
        controller.abort()
        waiter.cancel(new Error('sing-box URLTest cancelled'))
      },
    })
    if (activeBackend.value?.uuid !== backend.uuid)
      throw new Error('sing-box URLTest session changed')
    return result
  } finally {
    clearTimeout(timer)
  }
}

const resolveLatencyTargets = (name: string, seen = new Set<string>()): string[] => {
  if (seen.has(name)) return []
  seen.add(name)
  const proxy = proxyMap.value[name]
  if (!proxy?.all?.length) return isLatencyTestable(name) ? [name] : []
  return proxy.all.flatMap((child) => resolveLatencyTargets(child, seen)).filter(isLatencyTestable)
}

const splitHostPort = (value: string): [string, string] => {
  const index = value.lastIndexOf(':')
  if (index < 0) return [value, '']
  const host =
    value.startsWith('[') && value.includes(']')
      ? value.slice(1, value.indexOf(']'))
      : value.slice(0, index)
  return [host, value.slice(index + 1).replace(/].*$/, '')]
}

type NativeConnection = {
  id: string
  chains: string[]
  download: number
  upload: number
  downloadSpeed: number
  uploadSpeed: number
  start: number
  rule: string
  rulePayload: string
  metadata: Record<string, string>
}

const asNative = (connection: Connection) => connection as unknown as NativeConnection

const nativeConnection = (value: PbConnection): NativeConnection => ({
  ...value,
  id: value.id,
  download: toNumber(value.downlinkTotal),
  upload: toNumber(value.uplinkTotal),
  downloadSpeed: 0,
  uploadSpeed: 0,
  chains: value.chainList.length ? value.chainList : [value.outbound].filter(Boolean),
  rule: value.rule,
  rulePayload: '',
  start: toNumber(value.createdAt),
  metadata: {
    destinationIP: splitHostPort(value.destination)[0],
    destinationPort: splitHostPort(value.destination)[1],
    host: value.domain,
    sniffHost: value.domain,
    network: value.network,
    type: value.inboundType,
    sourceIP: splitHostPort(value.source)[0],
    sourcePort: splitHostPort(value.source)[1],
    inboundName: value.inbound,
    inboundPort: '',
    inboundUser: value.user,
    remoteDestination: value.destination,
    process: value.processInfo?.packageNames[0] || '',
    processPath: value.processInfo?.processPath || '',
  },
})

const accessor: ConnectionAccessor = {
  chains: (connection) => asNative(connection).chains,
  download: (connection) => asNative(connection).download,
  upload: (connection) => asNative(connection).upload,
  start: (connection) => asNative(connection).start,
  rule: (connection) => asNative(connection).rule,
  rulePayload: (connection) => asNative(connection).rulePayload,
  sourceIP: (connection) => asNative(connection).metadata.sourceIP,
  sourcePort: (connection) => asNative(connection).metadata.sourcePort,
  network: (connection) => asNative(connection).metadata.network,
  networkType: (connection) =>
    `${asNative(connection).metadata.type} | ${asNative(connection).metadata.network}`,
  hostname: (connection) =>
    asNative(connection).metadata.host || asNative(connection).metadata.destinationIP,
  host: (connection) =>
    asNative(connection).metadata.host || asNative(connection).metadata.destinationIP,
  process: (connection) =>
    asNative(connection).metadata.process || asNative(connection).metadata.processPath || '-',
  destination: (connection) => asNative(connection).metadata.destinationIP,
  inboundUser: (connection) =>
    asNative(connection).metadata.inboundUser || asNative(connection).metadata.inboundName || '-',
  sniffHost: (connection) => asNative(connection).metadata.sniffHost,
  remoteAddress: (connection) => asNative(connection).metadata.remoteDestination,
  isDirect: () => false,
  smartBlock: () => undefined,
}

const logType = (level: LogLevel): Log['type'] =>
  ({
    [LogLevel.PANIC]: LOG_LEVEL.Panic,
    [LogLevel.FATAL]: LOG_LEVEL.Fatal,
    [LogLevel.ERROR]: LOG_LEVEL.Error,
    [LogLevel.WARN]: LOG_LEVEL.Warning,
    [LogLevel.DEBUG]: LOG_LEVEL.Debug,
    [LogLevel.TRACE]: LOG_LEVEL.Trace,
    [LogLevel.INFO]: LOG_LEVEL.Info,
  })[level] || LOG_LEVEL.Info

const logLevel = (level: string) =>
  (
    ({
      panic: LogLevel.PANIC,
      fatal: LogLevel.FATAL,
      error: LogLevel.ERROR,
      warning: LogLevel.WARN,
      warn: LogLevel.WARN,
      info: LogLevel.INFO,
      debug: LogLevel.DEBUG,
      trace: LogLevel.TRACE,
    }) as Record<string, LogLevel>
  )[level.toLowerCase()]

const emptyConfig = (mode = ''): Config => ({
  port: 0,
  'socks-port': 0,
  'redir-port': 0,
  'tproxy-port': 0,
  'mixed-port': 0,
  'allow-lan': false,
  'bind-address': '',
  mode,
  'mode-list': [],
  modes: [],
  'log-level': '',
  ipv6: false,
  tun: { enable: false },
})

export const singboxDriver: Driver = {
  type: 'singbox',
  reset,
  system: {
    probe: probeSingboxChannel,
    fetchVersion: async () => {
      const client = getSingboxClient()
      if (!client) throw new Error('sing-box backend unavailable')
      return validateSingboxVersion(await client.client.getVersion({})).version
    },
    upgradeCore: () => unsupported('core upgrade'),
    restartCore: () => unsupported('core restart'),
    upgradeUI: () => unsupported('dashboard upgrade'),
    getStorage: async () => ({}),
    setStorage: async () => {},
    deleteStorage: async () => {},
  },
  metrics: {
    traffic: () =>
      nativeStatus((status) => ({
        down: toNumber(status.downlink),
        up: toNumber(status.uplink),
        downTotal: toNumber(status.downlinkTotal),
        upTotal: toNumber(status.uplinkTotal),
      })),
    memory: () => nativeStatus((status) => ({ inuse: toNumber(status.memory) })),
    fetchRuntimeStats: async () => unsupported('runtime stats'),
  },
  proxies: {
    fetch: async () => {
      const backend = activeBackend.value
      if (!backend) return { proxies: {}, providers: [] }
      startProxyStreams(backend)
      const ready = proxyReady
      if (!ready) throw new Error('sing-box proxy subscription unavailable')
      await ready
      return rebuildProxies()
    },
    select: async (group, name) => {
      const backend = activeBackend.value
      const client = getSingboxClient(backend)
      if (!client) return
      await client.client.selectOutbound({ groupTag: group, outboundTag: name })
    },
    clearFixed: async () => unsupported('fixed proxy'),
    testNode: async (name, _url, timeout) => {
      const result = await runNativeURLTest([name], timeout)
      return result[name]
    },
    testProviderNode: async () => unsupported('provider latency'),
    testGroup: async (group, _url, timeout) => {
      const names = resolveLatencyTargets(group)
      return runNativeURLTest(names, timeout, group)
    },
    updateProvider: async () => unsupported('provider update'),
    healthCheckProvider: async () => unsupported('provider health check'),
    fetchSmartWeights: async () => ({}),
    flushSmartWeights: async () => {},
  },
  rules: {
    fetch: async () => ({ rules: [], providers: [] }),
    updateProvider: async () => unsupported('rules'),
    toggleDisabled: async () => unsupported('rules'),
  },
  config: {
    fetch: async () => {
      const status = await getSingboxClient()?.client.getClashModeStatus({})
      const config = emptyConfig(status?.currentMode || '')
      config['mode-list'] = status?.modeList || []
      config.modes = status?.modeList || []
      return config
    },
    patch: async (config) => {
      if (typeof config.mode === 'string')
        await getSingboxClient()?.client.setClashMode({ mode: config.mode })
    },
    reload: async () => unsupported('config reload'),
    load: async () => unsupported('config load'),
    updateGeoData: async () => unsupported('geodata'),
    flushFakeIP: async () => unsupported('fake-ip cache'),
    flushDNSCache: async () => unsupported('DNS cache'),
    queryDNS: async () => unsupported('DNS query'),
  },
  logs: {
    subscribe: (level, onBatch) =>
      track(
        subscribeStream<PbLog>('logs', (message) => {
          if (message.reset) {
            onBatch([])
            return
          }
          const batch = message.messages
            .filter((item) => !logLevel(level) || item.level <= logLevel(level)!)
            .map((item) => ({ type: logType(item.level), payload: item.message }))
          if (batch.length) onBatch(batch)
        }),
      ),
  },
  connections: {
    accessor,
    subscribe: () => {
      const data = shallowRef<ConnectionsPayload>()
      const active = new Map<string, NativeConnection>()
      const handle = track(
        subscribeStream<ConnectionEvents>('connections', (message) => {
          const closed: NativeConnection[] = []
          if (message.reset) active.clear()
          for (const event of message.events) {
            const previous = active.get(event.id)
            const connection = event.connection
              ? nativeConnection(event.connection)
              : previous
                ? { ...previous, metadata: { ...previous.metadata } }
                : undefined
            if (!connection) continue
            if (!event.connection && previous) {
              connection.download += toNumber(event.downlinkDelta)
              connection.upload += toNumber(event.uplinkDelta)
            }
            connection.downloadSpeed = toNumber(event.downlinkDelta)
            connection.uploadSpeed = toNumber(event.uplinkDelta)
            if (
              event.type === ConnectionEventType.CONNECTION_EVENT_CLOSED ||
              Number(event.connection?.closedAt || 0) > 0
            ) {
              active.delete(event.id)
              closed.push(connection)
            } else active.set(event.id, connection)
          }
          data.value = {
            connections: Array.from(active.values()) as unknown as Connection[],
            closed: closed as unknown as Connection[],
          }
        }),
      )
      return { data, close: () => handle.close() }
    },
    disconnect: async (id) => {
      await getSingboxClient()?.client.closeConnection({ id })
    },
    disconnectAll: async () => {
      await getSingboxClient()?.client.closeAllConnections({})
    },
    block: async () => unsupported('connection block'),
  },
}

function nativeStatus<T>(map: (status: Status) => T): Stream<T> {
  const data = shallowRef<T>()
  const handle = track(subscribeStream<Status>('status', (status) => (data.value = map(status))))
  return { data, close: () => handle.close() }
}
