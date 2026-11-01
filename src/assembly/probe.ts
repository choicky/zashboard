import type { ProbeResult } from '@/helper/connectivity'
import type { Backend } from '@/types'
import { driverFor } from './driver'

export const probeBackend = (
  backend: Backend,
  timeout: number = 10000,
  signal?: AbortSignal,
  authenticate = false,
): Promise<ProbeResult> => {
  if (backend.type === 'singbox') {
    return Promise.resolve({
      ok: false,
      latency: 0,
      kind: 'unsupported',
      message: 'sing-box native API support is pending',
    })
  }

  return driverFor(backend).system.probe(backend, timeout, signal, authenticate)
}

export const isBackendAvailable = (backend: Backend, timeout: number = 10000) =>
  probeBackend(backend, timeout).then((result) => result.ok)
