# sing-box 兼容性指南

## 当前范围

`custom` 目前维护 sing-box 的 Clash-compatible REST/WebSocket API；它不把
Clash 通道误标成 sing-box 原生 gRPC 通道。版本探测识别 `/version` 返回的
`sing-box <version>`，并由 assembly 能力表关闭不会成功的 Mihomo 操作。

已恢复并按当前 sing-box Clash API 源码核对的功能：核心识别、代理组选择、
单节点/节点组测速、traffic/memory、活动连接、按 ID 断开连接、日志、DNS
查询/缓存清理、规则读取和 Clash mode 切换。sing-box 当前 Clash API 的
`/connections` 仍支持按 ID 删除，不把“关闭全部”冒充为单连接操作。

当前隐藏或不宣称支持：核心升级/重启、配置重载、GeoIP 更新、Mihomo
provider 管理和规则 provider 更新、Mihomo storage 同步、Mihomo 专属网络
端口/TUN 设置，以及历史 native gRPC dashboard。sing-box 的 Clash API
provider endpoint 当前返回空集合/只读占位，因此 UI 不显示会必然失败的
provider 操作。

## 版本矩阵

| 核心 | 用途 | 状态 |
| --- | --- | --- |
| sing-box 1.14.x | 选定稳定基线；当前发布线且包含 `/ui` 下载与 Clash API 路由 | 阻塞发布前验证 |
| sing-box 当前 stable | 发行前回归 | 手动触发，阻塞该版本发布 |
| sing-box 1.15.0-alpha | API 变化早期预警 | 非阻塞 |
| Mihomo 当前稳定 | 上游回归 | 必须保持通过 |

本文件中的路由和日志级别来自 sing-box `testing` 分支源码快照，实际
接受的日志级别为 `trace/debug/info/warn(or warning)/error/fatal/panic`；
面板不会发送 `silent` 给 sing-box。

## sing-box 配置

以下是脱敏示例，管理端点默认只监听本机或受控 LAN/VPN；`secret` 请在本机
生成并替换，不要提交到仓库或截图：

```json
{
  "experimental": {
    "clash_api": {
      "external_controller": "127.0.0.1:9090",
      "external_ui": "zashboard",
      "external_ui_download_url": "https://github.com/choicky/zashboard/releases/download/sb-v3.30.0-rc1/zashboard-singbox-full.zip",
      "external_ui_download_detour": "direct",
      "secret": "REPLACE_WITH_LOCAL_SECRET",
      "access_control_allow_origin": ["http://127.0.0.1"],
      "access_control_allow_private_network": true
    }
  }
}
```

首次安装时 `zashboard` 目录为空，sing-box 下载并解压
`external_ui_download_url`，页面地址是 `http://127.0.0.1:9090/ui/`。
空目录自动下载是 sing-box 行为，不等于面板更新已验证。

手动更新：先停止/隔离管理端点的访问，在临时目录下载固定 Release URL，核对
`SHA256SUMS`，解压到新的目录后原子替换 `external_ui` 目录；失败时保留旧目录
并恢复 `external_ui` 指向旧目录。移动更新 URL（例如 `/releases/latest/`）只适合
明确接受漂移的测试环境；生产建议固定 `sb-vX.Y.Z`。

本阶段未声称已验证 sing-box 版本中的面板内 `/upgrade/ui` 更新闭环；该按钮
依赖 sing-box 自己的 `external_ui_download_url`，不能改写为 upstream URL。
在该闭环得到真实核心集成证据前，请使用上述手动更新方法。

### 平台

- OpenWrt：将 ZIP 解压到 sing-box 配置目录下的 `zashboard`，保持管理端口仅 LAN，必要时在防火墙放行 LAN 而非 WAN。
- Linux：使用配置目录相对路径或绝对路径，下载/替换由运行用户完成，不需要 root 公网暴露。
- Windows：使用配置目录下的 `zashboard`；避免给下载 URL 增加查询参数，固定 Release 资产并核对哈希。
- Android：使用应用可写的配置目录和 localhost/VPN 访问；不要假定 Android 能访问桌面文件系统路径。

## 测试与限制

已执行的是源代码、类型和构建检查；尚未执行真实 sing-box 二进制驱动的
下载、解压、`/ui` 刷新、PWA cache 更新、连接关闭和 mode 切换验收，也未执行
native gRPC Phase 2。没有这些证据时，不把“HTTP 能连通”描述为完整兼容。

Phase 2 native API 仍是后续 stacked work：需要重新固定 distributed binary 的
service name/auth/transport/API version，生成 protobuf 文件并验证取消、重连、
closed connection 和资源清理；当前版本会明确使用 Clash API，不会静默切换通道。

## 上游同步与冲突

`.github/workflows/sync-upstream.yml` 每日运行，也支持 `workflow_dispatch`。它
只允许 `main` 在 fork 未分叉时 fast-forward 到 upstream/main；发现 fork-only
提交或分叉会失败并保留现场。随后为 `custom` 创建一个可审阅的同步 PR，冲突由
维护者解决，不会自动选择 upstream 覆盖兼容代码。由于 GitHub 使用
`GITHUB_TOKEN` 触发的 PR 不会继续触发后续 workflow，PR 检查请手动点
Actions 的 workflow_dispatch；不要求额外长期 PAT。

自助处理冲突：在本地 `git fetch --all`，确认 `main` 只含 upstream 祖先后
`git switch main && git merge --ff-only upstream/main`，再从 `custom` 合并
`main` 并运行 `pnpm install --frozen-lockfile`、`pnpm run type-check` 和
`pnpm run build`。不要 force-push 或直接在 production checkout 操作。
