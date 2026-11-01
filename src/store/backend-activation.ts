import type { Backend } from '@/types'

export const canActivateBackend = (backend: Backend | undefined) => backend !== undefined

export const nextActivatableBackend = (
  backends: Backend[],
  activeUuid: string,
  direction: 1 | -1,
) => {
  const candidates = backends.filter(canActivateBackend)
  if (candidates.length < 2) return undefined

  const currentIndex = candidates.findIndex((backend) => backend.uuid === activeUuid)
  const startIndex = currentIndex >= 0 ? currentIndex : 0
  return candidates[(startIndex + direction + candidates.length) % candidates.length]
}

export const firstActivatableBackend = (backends: Backend[]) => backends.find(canActivateBackend)
