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

The mirror push uses the `SYNC_TOKEN` secret (fine-grained, this repository
only, Contents and Workflows write) so upstream workflow changes can be
mirrored; without it `GITHUB_TOKEN` is used. Never name it `PAT`: the mirrored
upstream "Build and Deploy" workflow reads `secrets.PAT` and must stay disabled
in this fork.

- Fast-forward fork `main` only when it is an ancestor of upstream `main`.
  Divergence or fork-only commits are a hard failure, never an overwrite.
- Upstream already in `custom` is a successful no-op. Keep exactly one open
  `main → custom` PR; reuse and refresh it, refuse duplicates.
- Never merge automatically, never push upstream code straight into `custom`,
  and never publish from a `main` sync.

## Merge and release boundaries

Every PR merged into `custom` from this repository publishes a release: the
`main → custom` sync PR and feature PRs alike. Before merge, `validate` and
`native-browser` are required checks on `custom`; after merge, validation of
the exact merge commit must succeed again before tagging.

- The merge commit must be the current HEAD of `custom`. If several PRs merge in
  quick succession, an older merge already contained in `custom` is skipped
  successfully; the newest merge publishes and includes it.
- PRs from other repositories and direct pushes never publish.
- Publication is reachable only from auto-release: no tag-push or manual entry
  in the build workflow. Manual dispatch of auto-release retries an
  already-merged PR.

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
