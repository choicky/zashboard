# Authoritative decisions

One subject, one place. Workflows and scripts implement these rules; do not
repeat them elsewhere.

## Branch roles

- `main`: clean mirror of `Zephyruso/zashboard:main`; no fork commits; never a
  release source.
- `custom`: maintained sing-box-compatible product branch and only release
  source; repository default branch.
- Temporary branches: implementation only; merged into `custom` by reviewed PR.

## Synchronization

Flow: upstream `main` → fork `main` → PR `main → custom` → validation and
review → manual merge → automatic fork Release.

- Fast-forward fork `main` only when it is an ancestor of upstream `main`.
  Divergence or fork-only commits are a hard failure, never an overwrite.
- Upstream already in `custom` is a successful no-op. Keep exactly one open
  `main → custom` PR; reuse and refresh it, refuse duplicates.
- Never merge automatically, never push upstream code straight into `custom`,
  and never publish from a `main` sync.

## Merge and release boundaries

A release is created only for a PR that is merged, based on `custom`, with head
`main` from the same repository, and whose merge commit is the current HEAD of
`custom`. Validation of that exact commit must succeed first. Arbitrary pushes
and unrelated PRs do not publish. Manual dispatch is limited to retrying an
already-merged sync PR.

## Stable version selection

Stable tags are exactly `sb-vMAJOR.MINOR.PATCH`; prereleases use suffixes.
Base the version on the merge commit's `package.json`. If it is not greater than
the highest existing stable tag, bump that tag's patch. Bump again on any tag
collision. Never overwrite a tag or Release.

## Partial-failure recovery

One state decision per merge commit:

- No stable tag at the merge SHA: allocate one collision-free tag.
- One stable tag at the merge SHA: reuse it, whether the Release is absent,
  incomplete, or failed partway. Never allocate another version.
- Several stable tags at the merge SHA: fail on inconsistent state.
- Tag present but pointing at another SHA: fail; never overwrite.

Publication and asset checks run again on a reused tag, so repeated runs
converge without a second verification implementation.

Repeated runs after any intermediate failure converge on the same tag and
Release.

## Minimum workflow permissions

Grant only what a job uses, at the job level:

- Validation: `contents: read`, `pull-requests: read`.
- Sync PR creation: `contents: write`, `pull-requests: write`.
- Tag creation and Release publication: `contents: write`.

`workflow_call` gives callers the real result synchronously, so no workflow
needs `actions: write` and no polling for another run's ID.
