export type OptionalCoreUpdateCheck = {
  check: () => Promise<boolean>
  isCurrent: () => boolean
  onResult: (available: boolean) => void
  onFailure: () => void
}

export const runOptionalCoreUpdateCheck = (options: OptionalCoreUpdateCheck) => {
  void options.check().then(
    (available) => {
      if (options.isCurrent()) options.onResult(available)
    },
    () => {
      if (options.isCurrent()) options.onFailure()
    },
  )
}
