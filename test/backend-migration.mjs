import assert from 'node:assert/strict'
import { migrateBackendList } from '../src/store/backend-migration.ts'

const base = {
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  secondaryPath: '',
  password: 'secret',
  uuid: 'base',
}

const legacyClash = migrateBackendList([{ ...base }], () => 'unused')
assert.equal(legacyClash.length, 1)
assert.equal(legacyClash[0].type, 'clash')
assert.equal(legacyClash[0].host, base.host)

const native = migrateBackendList([{ ...base, type: 'singbox' }], () => 'unused')
assert.equal(native.length, 1)
assert.equal(native[0].type, 'singbox')
assert.equal(native[0].password, base.password)

const mixed = migrateBackendList(
  [
    { ...base, type: 'dae', uuid: 'dae' },
    {
      ...base,
      uuid: 'clash',
      label: 'home',
      singboxChannel: {
        protocol: 'https',
        host: '10.0.0.2',
        port: '9443',
        secret: 'native-secret',
      },
    },
  ],
  () => 'native-generated',
)
assert.deepEqual(
  mixed.map(({ type, uuid }) => ({ type, uuid })),
  [
    { type: 'dae', uuid: 'dae' },
    { type: 'clash', uuid: 'clash' },
    { type: 'singbox', uuid: 'native-generated' },
  ],
)
assert.equal(mixed[2].host, '10.0.0.2')
assert.equal(mixed[2].password, 'native-secret')

console.log('backend migration: 3 scenarios passed')
