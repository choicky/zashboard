import { useStorage } from '@/composables/use-storage'
import type { Backend } from '@/types'
import { isEqual, omit } from 'lodash'
import { v4 as uuid } from 'uuid'
import { computed, ref } from 'vue'
import { sourceIPLabelList } from './settings'

type LegacyBackend = Omit<Partial<Backend>, 'type'> & { type?: string; singboxChannel?: unknown }

const isLegacyBackend = (item: LegacyBackend) =>
  !item.type || 'singboxChannel' in item || item.type === 'singbox'

const migrateBackendList = (list: LegacyBackend[]): Backend[] =>
  list.map((item) => ({ ...(omit(item, 'singboxChannel') as Backend), type: 'clash' }))

export const backendList = useStorage<Backend[]>('setup/api-list', [])

if ((backendList.value as LegacyBackend[]).some(isLegacyBackend)) {
  backendList.value = migrateBackendList(backendList.value as LegacyBackend[])
}

export const activeUuid = useStorage<string>('setup/active-uuid', '')

if (activeUuid.value && !backendList.value.some((item) => item.uuid === activeUuid.value)) {
  activeUuid.value = ''
}
export const activeBackend = computed(() =>
  backendList.value.find((backend) => backend.uuid === activeUuid.value),
)

export const setActiveBackend = (uuid: string) => {
  activeUuid.value = uuid
}

export type BackendManagerView =
  { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; uuid: string }

export const backendManagerView = ref<BackendManagerView | null>(null)

export const openBackendManager = (view: BackendManagerView = { mode: 'list' }) => {
  backendManagerView.value = view
}

export const closeBackendManager = () => {
  backendManagerView.value = null
}

export const switchActiveBackend = (direction: 1 | -1) => {
  if (backendList.value.length < 2) {
    return null
  }

  const currentIndex = backendList.value.findIndex((backend) => backend.uuid === activeUuid.value)
  const startIndex = currentIndex >= 0 ? currentIndex : 0
  const nextIndex = (startIndex + direction + backendList.value.length) % backendList.value.length

  const nextBackend = backendList.value[nextIndex]

  if (!nextBackend) {
    return null
  }

  setActiveBackend(nextBackend.uuid)
  return nextBackend
}

export const addBackend = (backend: Omit<Backend, 'uuid'>) => {
  const currentEnd = backendList.value.find((end) => {
    return isEqual(omit(end, 'uuid'), backend)
  })

  if (currentEnd) {
    setActiveBackend(currentEnd.uuid)
    return currentEnd.uuid
  }

  const id = uuid()

  backendList.value.push({
    ...backend,
    uuid: id,
  })
  setActiveBackend(id)
  return id
}

export const updateBackend = (uuid: string, backend: Omit<Backend, 'uuid'>) => {
  const index = backendList.value.findIndex((end) => end.uuid === uuid)
  if (index !== -1) {
    backendList.value[index] = {
      ...backend,
      uuid,
    }
  }
}

export const removeBackend = (uuid: string) => {
  const wasActive = activeUuid.value === uuid

  backendList.value = backendList.value.filter((end) => end.uuid !== uuid)

  if (wasActive) {
    setActiveBackend(backendList.value[0]?.uuid ?? '')
  }

  sourceIPLabelList.value.forEach((label) => {
    if (label.scope && label.scope.includes(uuid)) {
      label.scope = label.scope.filter((scope) => scope !== uuid)
      if (!label.scope.length) {
        delete label.scope
      }
    }
  })
}
