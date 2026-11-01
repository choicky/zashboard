import { activeBackend } from '@/store/setup'
import type { Backend, BackendType } from '@/types'
import { clashDriver } from './clash'
import { daeDriver } from './dae'
import type { Driver } from './types'

const drivers: Record<Exclude<BackendType, 'singbox'>, Driver> = {
  clash: clashDriver,
  dae: daeDriver,
}

export const driverFor = (backend?: Backend | null) => {
  if (backend?.type === 'singbox') {
    throw new Error('sing-box native API support is pending')
  }

  return drivers[backend?.type as Exclude<BackendType, 'singbox'>] ?? clashDriver
}

export const driver = () => driverFor(activeBackend.value)

export * from './types'
