import assert from 'node:assert/strict'
import { runStream } from '../src/api/singbox/streams.ts'
import { channelSpecificCapabilities } from '../src/assembly/channel-capabilities.ts'
import {
  coordinateNativeTest,
  freshNativeLatencyResults,
  isFreshNativeLatency,
} from '../src/assembly/native-latency.ts'
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
assert.equal(
  isFreshNativeLatency(120, '2026-11-01T00:00:01.000Z', Date.parse('2026-11-01T00:00:00.000Z')),
  true,
)
assert.equal(
  isFreshNativeLatency(120, '2026-11-01T00:00:00.000Z', Date.parse('2026-11-01T00:00:00.000Z')),
  false,
)
assert.equal(isFreshNativeLatency(0, '2026-11-01T00:00:01.000Z', 0), false)
assert.deepEqual(
  freshNativeLatencyResults(
    ['reachable', 'unreachable'],
    {
      reachable: { delay: 120, time: '2026-11-01T00:00:01.000Z' },
      unreachable: { delay: 300, time: '2026-10-31T23:59:59.000Z' },
    },
    new Map([
      ['reachable', Date.parse('2026-11-01T00:00:00.000Z')],
      ['unreachable', Date.parse('2026-11-01T00:00:00.000Z')],
    ]),
  ),
  { reachable: 120 },
)

let rejectedAbort = 0
const rejectedWaiter = Promise.reject(new Error('waiter failed'))
await assert.rejects(
  coordinateNativeTest({
    rpc: new Promise(() => {}),
    waiter: rejectedWaiter,
    abort: () => rejectedAbort++,
  }),
  /waiter failed/,
)
assert.equal(rejectedAbort, 1)

let rpcAbort = 0
const rpcFailure = Promise.reject(new Error('rpc failed'))
await assert.rejects(
  coordinateNativeTest({
    rpc: rpcFailure,
    waiter: new Promise(() => {}),
    abort: () => rpcAbort++,
  }),
  /rpc failed/,
)
assert.equal(rpcAbort, 1)

console.log('native session, stream cancellation, and channel capability regressions passed')
