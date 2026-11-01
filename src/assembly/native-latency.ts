export const isFreshNativeLatency = (delay: number, time: string, initialTime: number) =>
  delay > 0 && Date.parse(time) > initialTime

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
