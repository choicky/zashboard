export const isFreshNativeLatency = (delay: number, time: string, initialTime: number) =>
  delay > 0 && Date.parse(time) > initialTime
