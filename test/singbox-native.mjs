import assert from 'node:assert/strict'

const baseUrl = process.env.SINGBOX_API_URL || 'http://127.0.0.1:19092'
const secret = process.env.SINGBOX_SECRET || ''

const frame = (payload = new Uint8Array()) => {
  const result = new Uint8Array(5 + payload.length)
  result[4] = payload.length
  result.set(payload, 5)
  return result
}

const websocketRequestFrame = (payload = new Uint8Array()) => {
  const result = new Uint8Array(6 + payload.length)
  result[2] = (payload.length >>> 24) & 0xff
  result[3] = (payload.length >>> 16) & 0xff
  result[4] = (payload.length >>> 8) & 0xff
  result[5] = payload.length & 0xff
  result.set(payload, 6)
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

const readMessageFields = (bytes) => {
  const fields = []
  for (let i = 0; i < bytes.length;) {
    const [tag, next] = readVarint(bytes, i)
    i = next
    const field = tag >> 3
    const wire = tag & 7
    if (wire === 0) {
      const [value, end] = readVarint(bytes, i)
      fields.push({ field, value })
      i = end
    } else if (wire === 2) {
      const [length, body] = readVarint(bytes, i)
      fields.push({ field, bytes: bytes.slice(body, body + length) })
      i = body + length
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`)
    }
  }
  return fields
}

const readStringField = (bytes, field) => {
  const value = readMessageFields(bytes).find((item) => item.field === field)?.bytes
  return value ? new TextDecoder().decode(value) : ''
}

const encodeStringFields = (...values) => {
  const chunks = []
  for (const [field, value] of values) {
    const bytes = new TextEncoder().encode(value)
    chunks.push(Uint8Array.of((field << 3) | 2, bytes.length, ...bytes))
  }
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
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

const websocketStream = (
  method,
  body = new Uint8Array(),
  streamTimeout = 5000,
  streamSecret = secret,
) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${baseUrl.replace(/^http/, 'ws')}/daemon.StartedService/${method}`,
      ['grpc-websockets'],
    )
    socket.binaryType = 'arraybuffer'
    let buffer = new Uint8Array()
    let settled = false
    let stop
    const finish = (error, payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve(payload)
    }
    const timer = setTimeout(() => finish(new Error(`${method} WebSocket timeout`)), streamTimeout)
    stop = () => finish(new Error(`${method} WebSocket closed before a message`))
    socket.addEventListener('open', () => {
      const headers = `content-type: application/grpc-web+proto\r\nx-grpc-web: 1\r\n${streamSecret ? `authorization: Bearer ${streamSecret}\r\n` : ''}`
      socket.send(new TextEncoder().encode(headers))
      socket.send(websocketRequestFrame(body))
      socket.send(Uint8Array.of(1))
    })
    socket.addEventListener('error', () => finish(new Error(`${method} WebSocket failed`)))
    socket.addEventListener('close', stop)
    socket.addEventListener('message', (event) => {
      const chunk = new Uint8Array(event.data)
      const merged = new Uint8Array(buffer.length + chunk.length)
      merged.set(buffer)
      merged.set(chunk, buffer.length)
      buffer = merged
      while (buffer.length >= 5) {
        const flags = buffer[0]
        const length = new DataView(buffer.buffer, buffer.byteOffset + 1, 4).getUint32(0)
        if (buffer.length < length + 5) return
        const payload = buffer.slice(5, length + 5)
        buffer = buffer.slice(length + 5)
        if (flags & 0x80) {
          const metadata = new TextDecoder().decode(payload)
          if (!metadata.toLowerCase().includes('grpc-status:')) {
          } else if (!metadata.includes('grpc-status: 0')) {
            finish(new Error(metadata))
          }
        } else {
          finish(null, payload)
        }
      }
    })
  })

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

const mode = await call('GetClashModeStatus')
assert.equal(mode.response.status, 200)
const selected = await call('SelectOutbound', encodeStringFields([1, 'auto'], [2, 'direct']))
assert.equal(selected.response.status, 200)
const urlTest = await call('URLTest', encodeStringFields([1, 'auto']))
assert.equal(urlTest.response.status, 200)

const controller = new AbortController()
const stream = await call(
  'SubscribeStatus',
  Uint8Array.of(8, 128, 148, 235, 220, 3),
  controller.signal,
  true,
)
assert.equal(stream.response.status, 200)
controller.abort()

for (const method of [
  'SubscribeGroups',
  'SubscribeOutbounds',
  'SubscribeConnections',
  'SubscribeStatus',
  'SubscribeLog',
]) {
  const payload = await websocketStream(method)
  assert.ok(payload instanceof Uint8Array, `${method} did not return a business frame`)
  if (method === 'SubscribeGroups') {
    const group = readMessageFields(payload).find((item) => item.field === 1)?.bytes
    assert.equal(readStringField(group || new Uint8Array(), 1), 'auto')
  }
  if (method === 'SubscribeConnections' || method === 'SubscribeLog') {
    assert.equal(readMessageFields(payload).find((item) => item.field === 2)?.value, 1)
  }
}

// A second subscription through the same application transport exercises a fresh
// connection after the first one was closed, rather than treating abort() as cleanup proof.
const reconnectedGroups = await websocketStream('SubscribeGroups')
assert.equal(
  readStringField(
    readMessageFields(reconnectedGroups).find((item) => item.field === 1)?.bytes ||
      new Uint8Array(),
    1,
  ),
  'auto',
)

await assert.rejects(
  websocketStream('SubscribeLog', new Uint8Array(), 2000, ''),
  /16|authorization/i,
)

console.log(
  `native gRPC-Web fetch auth/cancellation and grpc-websockets business streams passed for ${getVersion(version.bytes.slice(5, 5 + version.bytes[4])).version}`,
)
