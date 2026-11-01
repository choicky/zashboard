import { useStorage } from '@/composables/use-storage'
import type { Backend } from '@/types'
import { isEqual, omit } from 'lodash'
import { v4 as uuid } from 'uuid'
import { computed, ref } from 'vue'
import { sourceIPLabelList } from './settings'
import { migrateBackendList } from './backend-migration'
import {
  canActivateBackend,
  firstActivatableBackend,
  nextActivatableBackend,
} from './backend-activation'
import { showNotification } from '@/helper/notification'

type LegacyBackend = Omit<Partial<Backend>, 'type'> & {
  type?: string
  singboxChannel?: {
    protocol?: string
    host?: string
    port?: string
    secret?: string
  }
}

const isLegacyBackend = (item: LegacyBackend) =>
  !item.type || 'singboxChannel' in item || item.type === 'singbox'

export const backendList = useStorage<Backend[]>('setup/api-list', [])

if ((backendList.value as LegacyBackend[]).some(isLegacyBackend)) {
  backendList.value = migrateBackendList(backendList.value as LegacyBackend[], uuid) as Backend[]
}

export const activeUuid = useStorage<string>('setup/active-uuid', '')

// Do not reopen a preserved native entry as if it were a usable Clash session.
// Leaving it unselected keeps the connection details available in the manager
// while directing the user to an explicitly supported backend.
if (
  activeUuid.value &&
  backendList.value.find((item) => item.uuid === activeUuid.value)?.type === 'singbox'
) {
  activeUuid.value = ''
}

if (activeUuid.value && !backendList.value.some((item) => item.uuid === activeUuid.value)) {
  activeUuid.value = ''
}
export const activeBackend = computed(() =>
  backendList.value.find((backend) => backend.uuid === activeUuid.value),
)

export const setActiveBackend = (uuid: string) => {
  if (!uuid) {
    activeUuid.value = ''
    return true
  }

  const backend = backendList.value.find((item) => item.uuid === uuid)

  if (!canActivateBackend(backend)) {
    showNotification({ content: 'singboxNativePending', type: 'alert-warning' })
    return false
  }

  activeUuid.value = uuid
  return true
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
  const nextBackend = nextActivatableBackend(backendList.value, activeUuid.value, direction)

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
    setActiveBackend(firstActivatableBackend(backendList.value)?.uuid ?? '')
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
