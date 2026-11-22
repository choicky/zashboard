export type OptionalCoreUpdateCheck = {
  check: () => Promise<boolean>
  isCurrent: () => boolean
  onResult: (available: boolean) => void
  onFailure: (error: unknown) => void
}

export const runOptionalCoreUpdateCheck = (options: OptionalCoreUpdateCheck) => {
  void options.check().then(
    (available) => {
      if (options.isCurrent()) options.onResult(available)
    },
    (error) => {
      if (options.isCurrent()) options.onFailure(error)
    },
  )
}
