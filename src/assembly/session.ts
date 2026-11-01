import { activeBackend } from '@/store/setup'
import { watch } from 'vue'
import { can } from './backend'
import { fetchConfigs } from './config'
import { initConnections, stopConnections } from './connections'
import { fetchDaeRuntime } from './dae'
import type { Driver } from './driver'
import { driver } from './driver'
import { initLogs, stopLogs } from './logs'
import { initSatistic, stopSatistic } from './overview'
import { fetchProxies } from './proxies'
import { fetchRules } from './rules'
import { runSessionAfterProbe } from './session-boundary'
import { createSessionGate } from './session-gate'
import { probeActiveBackend } from './version'

const EVENT_DEBOUNCE = 400

let events: { close: () => void } | undefined
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let sessionDriver: Driver | undefined
const sessionGate = createSessionGate()

const scheduleRefresh = () => {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    fetchProxies().catch(() => {})
    fetchRules().catch(() => {})
    fetchConfigs().catch(() => {})
  }, EVENT_DEBOUNCE)
}

const stopEvents = () => {
  clearTimeout(refreshTimer)
  refreshTimer = undefined
  events?.close()
  events = undefined
}

const initEvents = () => {
  stopEvents()

  const subscribe = driver().events?.subscribe

  if (!subscribe || !can('backendEvents')) return

  events = subscribe((kind) => {
    if (kind === 'generation.changed') scheduleRefresh()
  })
}

export const startBackendSession = async () => {
  const generation = sessionGate.begin()
  const selectedBackend = activeBackend.value
  const nextDriver = driver()
  sessionDriver?.reset?.()
  sessionDriver = activeBackend.value ? nextDriver : undefined

  stopConnections()
  stopLogs()
  stopSatistic()
  stopEvents()
  nextDriver.reset?.()

  if (!selectedBackend) {
    probeActiveBackend()
    return
  }

  await runSessionAfterProbe(probeActiveBackend, async () => {
    if (!sessionGate.isCurrent(generation) || activeBackend.value?.uuid !== selectedBackend.uuid)
      return

    fetchConfigs().catch(() => {})
    fetchProxies().catch(() => {})
    fetchRules().catch(() => {})

    initConnections()
    initLogs()
    initSatistic()
    initEvents()

    if (activeBackend.value.type === 'dae') {
      fetchDaeRuntime().catch(() => {})
    }
  })
}

watch(activeBackend, startBackendSession, { immediate: true })
