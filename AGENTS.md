# Agent working rules

## Project

Zashboard fork that follows upstream while keeping sing-box Clash-compatible
and native gRPC-Web support. `custom` is the product and release branch.

## Branches

- `main`: clean mirror of `Zephyruso/zashboard:main`. No fork commits, never a
  release source. Sync only fast-forwards it from upstream.
- `custom`: maintained product branch and only release source.
- Temporary branches: implementation only; reach `custom` through a reviewed
  PR. Never reverse these roles.

## How to work

- Read the relevant code and documents completely before editing.
- Keep small fixes small; do not build a framework for a one-line problem.
- Identify directly related defects first, then fix them together coherently.
- Make minimal incremental changes to mature working code.
- Reuse existing helpers and workflows; remove unnecessary duplication.
- Record one subject in one authoritative place. Link instead of repeating.
- Consider performance, stability, concurrency and idempotency.
- Run real validation. Never report a skipped check as passed.
- Do not merge PRs, publish Releases, or change production systems or devices
  without explicit authorization.

## Documents

- Project, downloads, usage: [README.md](./README.md)
- Branch, sync, version and release decisions: [docs/DECISIONS.md](./docs/DECISIONS.md)
- sing-box support, config, tests, limits: [docs/sing-box-compatibility.md](./docs/sing-box-compatibility.md)
- Historical upstream removal: [docs/sing-box-deprecation.md](./docs/sing-box-deprecation.md)
- Test commands and usage: [test/README.md](./test/README.md)
