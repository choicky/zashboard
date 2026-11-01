import type { Backend } from '@/types'

export const canActivateBackend = (backend: Backend | undefined) =>
  backend !== undefined && backend.type !== 'singbox'
