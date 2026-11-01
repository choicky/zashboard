# sing-box 兼容性指南

## 当前范围

`custom` 同时维护 sing-box 的 Clash-compatible REST/WebSocket 通道和原生
gRPC-Web 通道。两条通道按保存的 backend 类型选择；不会把 native 记录静默
转换成 Clash，也不会在 native 不可用时切换到另一条通道。

原生通道使用官方 `sing-box` 1.14.4 的 `daemon.StartedService` 协议，支持
版本探测、代理组/节点选择、URLTest、traffic/memory、活动连接、按 ID 关闭
连接和日志；若原生服务返回非空 Clash mode 列表，面板也会显示并调用 mode
切换。连接流会在 backend 切换时取消，旧流的事件会被丢弃；
历史 closed 连接不会重新显示为活动连接。

当前不支持或明确关闭：原生配置编辑/重载、核心升级/重启、面板自动升级、
rules/provider 管理、DNS/fake-IP 操作、连接 block、runtime stats，以及
USB/IP、OpenVPN、Taildrop 等扩展。sing-box dashboard 自动更新闭环仍未完成
真实核心验证，因此保持关闭。

## 版本与协议矩阵

| 核心/通道                       | 选择理由                                          | 状态               |
| ------------------------------- | ------------------------------------------------- | ------------------ |
| sing-box 1.14.4 Clash API       | 当前 stable，Phase 1 已验证                       | 已支持             |
| sing-box 1.14.4 native gRPC-Web | 与 vendored proto 同源，官方 amd64 分发二进制验证 | Phase 2 支持       |
| sing-box 当前 stable            | 每次发布前用官方分发二进制回归                    | 未验证前不扩大声明 |
| sing-box `testing`              | 监测协议和构建变化                                | 非阻塞早期预警     |
| Mihomo Clash API / Dae          | 保持既有回归                                      | 必须通过           |

native 协议源固定为 sing-box `v1.14.4`（tag commit
`c005f35300ce76427dc285481ec5695f5b179cd2`）的
`daemon/started_service.proto`，Git blob SHA 为
`2c27937b6c58e4fae1eb9cd2b231e45841be7838`。生成命令：

```bash
pnpm install --frozen-lockfile
pnpm exec buf generate
```

不得手工编辑 `src/gen/daemon/started_service_pb.ts`；更新协议时先更新固定
源和 SHA，再生成并审阅完整差异。

## 原生 API 配置

官方服务名是 `daemon.StartedService`。服务配置是顶层 `services` 中的 API
service，不是 `experimental.clash_api`：

```json
{
  "services": [
    {
      "type": "api",
      "listen": "127.0.0.1",
      "listen_port": 19092,
      "secret": "REPLACE_WITH_LOCAL_SECRET",
      "access_control_allow_origin": ["http://127.0.0.1:8080"],
      "access_control_allow_private_network": true,
      "dashboard": { "enabled": false }
    }
  ]
}
```

官方 v1.14.4 Linux amd64 分发二进制实测接受
`application/grpc-web+proto`，`GetVersion` 返回 `1.14.4` 和 API version `4`；
Bearer secret 缺失返回 gRPC `Unauthenticated`。浏览器页面需要把实际页面
origin 放入 `access_control_allow_origin`。建议只绑定 localhost 或受控 LAN/VPN，
不要公开管理端口。

Clash API 用户继续使用 `experimental.clash_api.external_controller`、
`external_ui`、`external_ui_download_url` 和 `secret`；它与上述 native
service 是两种独立连接记录。首次下载时 UI 目录为空，sing-box 下载固定
Release ZIP 并解压；手动更新时下载并校验 `SHA256SUMS`，准备新目录后替换，
失败则保留旧目录。面板内升级对 sing-box 保持禁用。

## 平台

- OpenWrt：使用应用可写的配置目录，管理端口只放行 LAN/VPN。
- Linux：使用运行用户可读写的配置目录，不需要 root 或公网暴露。
- Windows：使用 sing-box 配置目录下的 UI 目录，固定 Release URL 并核对哈希。
- Android：使用应用可写目录和 localhost/VPN；不要假定桌面路径可访问。

## 测试与限制

单元/回归测试、Clash endpoint smoke、native gRPC-Web endpoint/stream 测试和
真实 Chrome UI acceptance 必须分开记录；`test/native-browser.mjs` 使用真实
sing-box API，并与 mock-backed `test:verify` 分开。PR 校验在 `validate-sync` 的
`native-browser` job 中以 PR merge ref 构建并运行官方 amd64 二进制；Chrome 调试
端点不可用是失败或未执行，不是通过。下载失败回滚、PWA cache 更新、Android/Windows
实机和 native dashboard 自动升级仍未作为已验证能力声明。官方 v1.14.4
隔离验收配置返回空 mode 列表，因此该环境的 mode UI 被隐藏；原生 mode
切换未宣称为已完成浏览器验收。

兼容性检查支持 `workflow_dispatch` 和计划运行：读取官方 stable release、下载
分发二进制、运行 type-check/build/native smoke，并以 testing 版本做非阻塞预警；
不会改写协议、发布 stable、部署设备或扩大支持矩阵。使用 `GITHUB_TOKEN` 只读权限，
不依赖长期 PAT。计划任务要求 workflow 已在仓库默认分支启用；由 token 产生的 PR
不会自动触发后续 workflow 时，手动运行必须选择明确的 PR merge ref。

## 上游同步

`.github/workflows/sync-upstream.yml` 每日运行并支持手动触发：只在 `main` 没有
fork-only 分叉时 fast-forward 到 upstream/main；按 ancestry 判断 upstream 是否
已经包含在 custom，已包含时成功 no-op，不创建空 PR。同步 PR 复用已有 PR，保留
上游提交 ancestry；冲突留给维护者解决，不自动覆盖兼容代码。手工解决后运行
`pnpm install --frozen-lockfile`、`pnpm run type-check`、`pnpm run build` 和兼容性检查。
