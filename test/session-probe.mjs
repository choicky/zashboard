import assert from 'node:assert/strict'
import { runOptionalCoreUpdateCheck } from '../src/assembly/core-update.ts'
import { runSessionAfterProbe } from '../src/assembly/session-boundary.ts'

let initialized = false
assert.equal(
  await runSessionAfterProbe(
    async () => {
      throw new Error('unsupported native API version')
    },
    async () => (initialized = true),
  ),
  false,
)
assert.equal(initialized, false)
assert.equal(
  await runSessionAfterProbe(
    async () => {},
    async () => (initialized = true),
  ),
  true,
)
assert.equal(initialized, true)

let initializedAfterOptionalFailure = false
let optionalFailureObserved = false
let optionalFailureSettled
const optionalFailure = new Promise((resolve) => (optionalFailureSettled = resolve))
await runSessionAfterProbe(
  async () => {
    runOptionalCoreUpdateCheck({
      check: async () => {
        throw new Error('GitHub rate limit')
      },
      isCurrent: () => true,
      onResult: () => {},
      onFailure: () => {
        optionalFailureObserved = true
        optionalFailureSettled()
      },
    })
  },
  async () => (initializedAfterOptionalFailure = true),
)
await optionalFailure
assert.equal(optionalFailureObserved, true)
assert.equal(initializedAfterOptionalFailure, true)

console.log('session probe boundary regression passed')
