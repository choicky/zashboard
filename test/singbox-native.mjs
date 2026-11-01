import assert from 'node:assert/strict'

const baseUrl = process.env.SINGBOX_API_URL || 'http://127.0.0.1:19092'
const secret = process.env.SINGBOX_SECRET || ''

const frame = (payload = new Uint8Array()) => {
  const result = new Uint8Array(5 + payload.length)
  result[4] = payload.length
  result.set(payload, 5)
  return result
}

const readVarint = (bytes, start) => {
  let value = 0
  let shift = 0
  let index = start
  while (index < bytes.length) {
    const byte = bytes[index++]
    value += (byte & 0x7f) * 2 ** shift
    if (!(byte & 0x80)) return [value, index]
    shift += 7
  }
  return [0, start]
}

const getVersion = (bytes) => {
  let version = ''
  let apiVersion = 0
  for (let i = 0; i < bytes.length;) {
    const [tag, next] = readVarint(bytes, i)
    i = next
    const field = tag >> 3
    if (field === 1) {
      const [length, body] = readVarint(bytes, i)
      version = new TextDecoder().decode(bytes.slice(body, body + length))
      i = body + length
    } else if (field === 2) {
      ;[apiVersion, i] = readVarint(bytes, i)
    } else break
  }
  return { version, apiVersion }
}

const call = async (method, body, signal, stream = false) => {
  const response = await fetch(`${baseUrl}/daemon.StartedService/${method}`, {
    method: 'POST',
    headers: {
      Origin: 'http://127.0.0.1:19080',
      'Content-Type': 'application/grpc-web+proto',
      'x-grpc-web': '1',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: frame(body),
    signal,
  })
  if (stream) {
    const reader = response.body.getReader()
    const first = await reader.read()
    return { response, bytes: first.value || new Uint8Array(), text: '' }
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { response, bytes, text: new TextDecoder().decode(bytes) }
}

const version = await call('GetVersion')
assert.equal(version.response.status, 200)
assert.match(version.response.headers.get('content-type') || '', /grpc-web/)
assert.deepEqual(getVersion(version.bytes.slice(5, 5 + version.bytes[4])), {
  version: process.env.SINGBOX_EXPECTED_VERSION || '1.14.4',
  apiVersion: 4,
})

const unauthorized = await fetch(`${baseUrl}/daemon.StartedService/GetVersion`, {
  method: 'POST',
  headers: {
    Origin: 'http://127.0.0.1:19080',
    'Content-Type': 'application/grpc-web+proto',
    'x-grpc-web': '1',
  },
  body: frame(),
})
assert.equal(unauthorized.headers.get('grpc-status'), '16')

const controller = new AbortController()
const stream = await call(
  'SubscribeStatus',
  Uint8Array.of(8, 128, 148, 235, 220, 3),
  controller.signal,
  true,
)
assert.equal(stream.response.status, 200)
controller.abort()

console.log(
  `native gRPC-Web GetVersion ${getVersion(version.bytes.slice(5, 5 + version.bytes[4])).version}, auth rejection, and stream cancellation passed`,
)
