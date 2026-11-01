import assert from 'node:assert/strict'
import { canActivateBackend, nextActivatableBackend } from '../src/store/backend-activation.ts'

const backend = {
  uuid: 'backend',
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  password: '',
  secondaryPath: '',
  label: '',
}

assert.equal(canActivateBackend({ ...backend, type: 'clash' }), true)
assert.equal(canActivateBackend({ ...backend, type: 'dae' }), true)
assert.equal(canActivateBackend({ ...backend, type: 'singbox' }), false)
assert.equal(canActivateBackend(undefined), false)

const clashA = { ...backend, uuid: 'clash-a', type: 'clash' }
const native = { ...backend, uuid: 'native', type: 'singbox' }
const dae = { ...backend, uuid: 'dae', type: 'dae' }
assert.equal(nextActivatableBackend([clashA, native, dae], clashA.uuid, 1)?.uuid, dae.uuid)
assert.equal(nextActivatableBackend([clashA, native, dae], dae.uuid, -1)?.uuid, clashA.uuid)
assert.equal(nextActivatableBackend([clashA, native], clashA.uuid, 1), undefined)

console.log('backend activation guard: supported and native scenarios passed')
