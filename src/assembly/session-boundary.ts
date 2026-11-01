export const runSessionAfterProbe = async (
  probe: () => Promise<unknown>,
  initialize: () => Promise<void>,
) => {
  try {
    await probe()
  } catch {
    return false
  }

  await initialize()
  return true
}
