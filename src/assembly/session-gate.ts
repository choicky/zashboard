export const createSessionGate = () => {
  let generation = 0

  return {
    begin: () => ++generation,
    isCurrent: (token: number) => token === generation,
  }
}
