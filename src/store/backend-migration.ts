export type BackendRecord = {
  type?: string
  protocol?: string
  host?: string
  port?: string
  secondaryPath?: string
  password?: string
  username?: string
  uuid?: string
  label?: string
  disableUpgradeCore?: boolean
  disableTunMode?: boolean
  singboxChannel?: {
    protocol?: string
    host?: string
    port?: string
    secret?: string
  }
}

export type MigratedBackend = Omit<BackendRecord, 'singboxChannel' | 'type'> & {
  type: 'clash' | 'dae' | 'singbox'
}

const isBackendType = (type: string | undefined): type is MigratedBackend['type'] =>
  type === 'clash' || type === 'dae' || type === 'singbox'

const withoutChannel = (record: BackendRecord): Omit<BackendRecord, 'singboxChannel'> => {
  const { singboxChannel: _channel, ...base } = record
  return base
}

export const migrateBackendList = (
  list: BackendRecord[],
  createUuid: () => string,
): MigratedBackend[] => {
  const migrated: MigratedBackend[] = []

  for (const item of list) {
    const base = withoutChannel(item)
    const type = isBackendType(item.type) ? item.type : 'clash'

    // A record that was explicitly native must remain native. It must never be
    // made reachable through the Clash driver as a side effect of migration.
    migrated.push({ ...base, type })

    // Old releases stored a second native connection under singboxChannel.
    // Preserve it as a separate, explicit pending-native backend.
    const channel = item.singboxChannel
    if (channel?.host && item.type !== 'singbox') {
      migrated.push({
        ...base,
        type: 'singbox',
        protocol: channel.protocol || 'http',
        host: channel.host,
        port: channel.port || '9090',
        secondaryPath: '',
        password: channel.secret || '',
        uuid: createUuid(),
        label: base.label ? `${base.label} (sing-box native, pending)` : 'sing-box native (pending)',
      })
    }
  }

  return migrated
}
