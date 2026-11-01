export const isFreshNativeLatency = (delay: number, time: string, initialTime: number) =>
  delay > 0 && Date.parse(time) > initialTime

export const isNativeDirectOutbound = (connection: { outboundType: string; outbound: string }) =>
  connection.outboundType === 'direct'

export const freshNativeLatencyResults = (
  names: string[],
  samples: Record<string, { delay: number; time: string } | undefined>,
  initialTimes: Map<string, number>,
) =>
  Object.fromEntries(
    names
      .map((name) => {
        const sample = samples[name]
        return [
          name,
          sample && isFreshNativeLatency(sample.delay, sample.time, initialTimes.get(name) ?? 0)
            ? sample.delay
            : 0,
        ] as const
      })
      .filter(([, delay]) => delay > 0),
  )

export const coordinateNativeTest = async <T>(options: {
  rpc: Promise<unknown>
  waiter: Promise<T>
  abort: () => void
}) => {
  let aborted = false
  const abortOnce = () => {
    if (aborted) return
    aborted = true
    options.abort()
  }
  const waiterFailure = options.waiter.then(
    () => new Promise<never>(() => {}),
    (error) => {
      abortOnce()
      throw error
    },
  )

  try {
    await Promise.race([options.rpc, waiterFailure])
    return await options.waiter
  } catch (error) {
    abortOnce()
    throw error
  }
}
