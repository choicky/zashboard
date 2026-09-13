# sing-box support

This fork restores the sing-box support removed from upstream zashboard 3.23.0 and
maintains it on top of newer zashboard releases.

## Supported integration modes

1. **Clash API** (`type=clash`) for standard sing-box deployments using
   `experimental.clash_api`. This is the recommended mode for standalone and OpenWrt
   sing-box installations.
2. **Native API** (`type=singbox`) for applications exposing the sing-box gRPC-Web
   daemon API.

## Compatibility baseline

- zashboard base: 3.26.0
- sing-box: 1.14.0
- Native API schema: `daemon/started_service.proto` from the official sing-box
  `v1.14.0` tag

When updating sing-box compatibility, replace the vendored schema from the new official
tag, run `pnpm generate`, then run `pnpm type-check` and `pnpm build`.
