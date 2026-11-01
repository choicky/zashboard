import assert from 'node:assert/strict'
import { canActivateBackend } from '../src/store/backend-activation.ts'

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

console.log('backend activation guard: supported and native scenarios passed')
