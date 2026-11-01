import assert from 'node:assert/strict'
import { runStream } from '../src/api/singbox/streams.ts'
import { channelSpecificCapabilities } from '../src/assembly/channel-capabilities.ts'
import { createSessionGate } from '../src/assembly/session-gate.ts'

const gate = createSessionGate()
const first = gate.begin()
const second = gate.begin()
const third = gate.begin()
assert.equal(gate.isCurrent(first), false)
assert.equal(gate.isCurrent(second), false)
assert.equal(gate.isCurrent(third), true)

let aborted = false
const handle = runStream(
  async function* (signal) {
    signal.addEventListener('abort', () => (aborted = true), { once: true })
    await new Promise(() => {})
    yield 1
  },
  () => {},
)
handle.close()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(aborted, true)

assert.deepEqual(channelSpecificCapabilities('clash'), {
  dns: true,
  customTestUrl: true,
  nodeLatencyTest: true,
})
assert.deepEqual(channelSpecificCapabilities('singbox'), {
  dns: false,
  customTestUrl: false,
  nodeLatencyTest: false,
})

console.log('native session, stream cancellation, and channel capability regressions passed')
