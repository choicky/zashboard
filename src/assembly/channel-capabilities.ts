/** Capabilities which depend on the selected transport, not merely the core. */
export const isSingboxNativeChannel = (backendType: string | undefined) => backendType === 'singbox'

export const channelSpecificCapabilities = (backendType: string | undefined) => {
  const native = isSingboxNativeChannel(backendType)
  return {
    dns: !native,
    customTestUrl: !native,
    nodeLatencyTest: !native,
  }
}
