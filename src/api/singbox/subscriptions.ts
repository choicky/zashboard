// sing-box 常驻订阅流的统一入口。
//
// 订阅走 WebSocket 承载(见 serverStream.ts),不占用浏览器对单 host 的
// HTTP/1.1 并发连接配额,因此每个 tab 直接各自起流即可,无需跨 tab 共享。
// 每次订阅都新开一条流,天然拿到服务端下发的全量初始快照。
import { StartedService } from '@/gen/daemon/started_service_pb'
import type { Backend } from '@/types'
import { serverStream } from './serverStream'
import { runStream, type StreamHandle } from './streams'

export type SubscriptionId = 'logs' | 'connections' | 'status' | 'groups' | 'outbounds'

// SubscribeStatus / SubscribeConnections 的上报间隔(1s in ns)。
const INTERVAL = 1_000_000_000n

const { method } = StartedService
const factories: Record<
  SubscriptionId,
  (signal: AbortSignal, backend?: Backend | null) => AsyncIterable<unknown>
> = {
  logs: (signal, backend) => serverStream(method.subscribeLog, {}, signal, backend),
  connections: (signal, backend) =>
    serverStream(method.subscribeConnections, { interval: INTERVAL }, signal, backend),
  status: (signal, backend) =>
    serverStream(method.subscribeStatus, { interval: INTERVAL }, signal, backend),
  groups: (signal, backend) => serverStream(method.subscribeGroups, {}, signal, backend),
  outbounds: (signal, backend) => serverStream(method.subscribeOutbounds, {}, signal, backend),
}

export const subscribeStream = <T>(
  id: SubscriptionId,
  onMessage: (msg: T) => void,
  backend?: Backend | null,
): StreamHandle => {
  const selectedBackend = backend
  return runStream(
    (signal) => factories[id](signal, selectedBackend),
    onMessage as (msg: unknown) => void,
  )
}
