# Authoritative decisions

This file is the single source of truth for branch, synchronization and
release decisions that are not derivable from code. Implementation details
live in the workflows; this file records the rules they implement.

## Branches

- `main` is a clean mirror of `Zephyruso/zashboard:main`. It carries no fork
  commits and is never a release source.
- `custom` is the maintained sing-box-compatible product branch and the only
  fork release source. It is the repository's default branch.
- Implementation happens on temporary branches and reaches `custom` only
  through a reviewed PR. These roles are never reversed.

## Synchronization

The only supported flow is
`Zephyruso/zashboard:main` → `choicky/zashboard:main` → PR `main → custom` →
validation and review → manual merge → automatic fork Release.

- Fast-forward `main` only when it is an ancestor of upstream `main`. A mirror
  with fork-only commits or diverged history is a hard failure, never an
  overwrite.
- Upstream already contained in `custom` is a successful no-op.
- Exactly one open `main → custom` PR is allowed. An existing PR is reused and
  refreshed; duplicates are refused.
- The PR is never merged automatically and upstream code is never pushed
  directly into `custom`. Synchronizing `main` never publishes a Release.

## GITHUB_TOKEN event propagation

Do not rely on a `GITHUB_TOKEN` side effect to start the next workflow.

- A PR created by `sync-upstream.yml` produced a `pull_request` run of
  `validate-sync.yml`, but that run stopped at `action_required` with zero
  jobs. The explicit `workflow_dispatch` of `validate-sync.yml` executed both
  validation jobs successfully. The sync workflow therefore dispatches
  validation itself and verifies the new run appeared.
- A tag pushed with `GITHUB_TOKEN` must likewise not be assumed to start
  `build-release.yml`. `auto-release.yml` dispatches `build-release.yml`
  explicitly and verifies the new run appeared.
- `workflow_dispatch` and `repository_dispatch` are the only events exempt
  from `GITHUB_TOKEN` event suppression. No PAT is introduced for these
  chains; workflow permissions are granted explicitly and per workflow.

## Fork release versioning

Stable fork tags are exactly `sb-vMAJOR.MINOR.PATCH` so the dashboard's
`parseReleaseTag` keeps treating them as stable. Prereleases use suffixes such
as `-rcN` and `-phase2-rcN`.

For each qualifying synchronization PR merge:

1. Read the upstream-facing `package.json` version from the reviewed merge
   commit as the base `MAJOR.MINOR.PATCH`.
2. Collect every existing `sb-v*` tag and Release. Only exact stable tags
   count towards the highest existing stable version.
3. If the base version is greater than the highest existing stable version,
   use it; otherwise bump the highest stable version's patch by one. This
   keeps releases monotonic even when upstream does not change its version.
4. If the resulting tag already exists as a tag or Release, bump the patch
   again until it is free. Never overwrite a tag or Release.

The rule is implemented in `scripts/resolve-release-version.mjs` and tested in
`test/auto-release.mjs`. It requires no manual tag calculation.

## Release trigger scope

Automatic publishing happens only for a PR that is merged, based on `custom`,
with head `main` from the same repository, and whose reviewed merge commit is
the current HEAD of `custom`. The tag points exactly at that commit.

Arbitrary pushes and unrelated PRs do not publish. `build-release.yml` keeps
its existing tag-based and manual `workflow_dispatch` paths for test builds
and explicit releases; `auto-release.yml` keeps a scoped `workflow_dispatch`
with `pr_number` to retry an already-merged synchronization PR.
