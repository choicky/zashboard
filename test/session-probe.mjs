import assert from 'node:assert/strict'

const initializeAfterProbe = async (probe, initialize) => {
  try {
    await probe()
  } catch {
    return false
  }
  await initialize()
  return true
}

let initialized = false
assert.equal(
  await initializeAfterProbe(
    async () => {
      throw new Error('unsupported native API version')
    },
    async () => (initialized = true),
  ),
  false,
)
assert.equal(initialized, false)
assert.equal(
  await initializeAfterProbe(
    async () => {},
    async () => (initialized = true),
  ),
  true,
)
assert.equal(initialized, true)

console.log('session probe boundary regression passed')
