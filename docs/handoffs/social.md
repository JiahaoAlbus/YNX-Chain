# YNX Social handoff

## Source and baseline

- Branch: `codex/ecosystem-social`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain-social`
- Returned candidate baseline: `7f034342be9ed5eab3765c42238b22fb66673205`
- Owned paths only: `apps/social/**`, `internal/social/**`, `internal/appgateway/**`, `apps/mobile/**`, release/build scripts, and this handoff.
- Native identity: Android/iOS `com.ynx.social`; callback `ynx-social://com.ynx.social`.
- 更新时间: 2026-07-17

## 本轮目标完成情况（按验收项映射）

### 1. 钱包身份升级（完成）

- `apps/social/src/walletAuth.ts` 使用 `requestingProduct=social`、`productClientId=ynx-social-v1`、`bundleId=com.ynx.social`、`callback=ynx-social://com.ynx.social`、`scopes=["account:read","profile:link"]`、`productDeviceAlgorithm=p256-sha256`。
- `apps/social/src/api.ts` 与服务端 `POST /social/v1/wallet/challenge`、`POST /social/v1/wallet/login` 不接受 legacy query 参数；`Wallet` 回调仅解析单一 `response`。
- 服务端验签链路要求 `requestingProduct/productClientId/bundleId/algorithm/callback/scopes` 全量一致、同一个 `requestDigest`、时间窗有效、签名低-S、重放与篡改拒绝。
- `apps/mobile/app.config.js` 与 `apps/social/app.config.js` 均保持 `scheme` 与 `bundleId` 为 Social 独立产品，`com.ynx.social`。 
- 兼容性边界：当前仍使用本仓库自有适配实现（wallet-auth package 尚未在本仓合并），字段语义与主干预期一致。

### 2. 中央编排联动（完成）

- `internal/appgateway` 已接入 social 上游：
  - 配置新增 `YNX_APP_GATEWAY_SOCIAL_URL` 与 `YNX_APP_GATEWAY_SOCIAL_API_KEY`
  - `gateway` 路由白名单新增 `/social/v1/...` 的公开/受保护策略
  - `native` 绑定新增 `ynx-social://com.ynx.social`
  - `health` 指标返回 social upstream 健康信息
- `cmd/ynx-app-gatewayd/main.go` 能解析和下发 social 配置并参与 `YNX_APP_GATEWAY_SOCIAL_URL` 检查。
- `scripts/verify/app-gateway-check.sh` 已补充社交路由与 upstream 健康联动检查。

### 3. 关键闭环补齐（完成）

- 联系人关系链：
  - 发现与请求：`/social/v1/contact-requests`、`/social/v1/contact-matches`
  - 生命周期：`/social/v1/contact-requests/{id}`（accept/reject/withdraw）、`/social/v1/contacts/delete`
  - 阻断与静音：`/social/v1/privacy/block`、`/social/v1/privacy/mute`
- 群组与消息链路：
  - 群组创建：`POST /social/v1/conversations/groups`
  - 群组成员变更：`POST /social/v1/conversations/{id}/members`
  - 消息收发与回执：`/social/v1/conversations/{id}/messages`、`/social/v1/conversations/{id}/messages/{id}/delivered|/read`
  - 限制与鉴权：成员必须是已接受联系人、容量边界、活动设备边界、服务端幂等与重放控制。
- 报告与申诉：
  - `/social/v1/reports` 创建报告
  - `/social/v1/reports/{id}` 查看
  - `/social/v1/reports/{id}/appeal` 申诉
- AI 草稿与翻译审批：
  - AI 任务创建 `POST /social/v1/ai/jobs`
  - 状态流转 `POST /social/v1/ai/jobs/{id}`
  - SSE 变更 `POST /social/v1/ai/jobs/{id}/stream`
- 告警生命周期：
  - 列表 `/social/v1/notifications`
  - 标为已读 `/social/v1/notifications/{id}/read`
- 持久化恢复：
  - 聊天消息与群组成员变更均有持久化 + 重启恢复 + 重放路径测试
  - `social`、`chat`、`square` 路径均有网关与服务端测试覆盖

### 4. 隐私/安全闭环（部分完成）

- Social 侧已提供完整自有数据导出/删除：
  - `GET /social/v1/privacy/export`
  - `DELETE /social/v1/privacy/delete`
- 仍待补齐：`Square/Chat` 的跨产品集中导出与擦除（中央仓统一治理链路）尚未在本提交中加入。

### 5. 生产配置清单（完成）

- 应用身份：
  - Android/iOS: `com.ynx.social`
  - Scheme: `ynxsocial`
  - Deep link callback: `ynx-social://com.ynx.social`
- 生产参数：
  - `.env.deploy.example` 增加 `YNX_APP_GATEWAY_SOCIAL_URL` 与 `YNX_APP_GATEWAY_SOCIAL_API_KEY` 说明位
  - 构建/签名脚本支持 Social 包名校验
- 下载入口与产物：
  - `scripts/verify/mobile-product-split-check.sh`（包名、scheme、product 分离）
  - `scripts/package/mobile-android-release.sh` 与 `scripts/verify/mobile-android-release-verify.mjs`（产物完整性、签名、manifest 合规）

## 证据与命令输出路径

- `go test ./internal/social ./internal/appgateway`  
  - `tmp/social-evidence/go-test-social-appgateway-20260717T164301Z.log`
- `go test ./...`（仓库级；当前仅已知基线缺口：`internal/bftgateway` 与 `internal/consensus` 依赖项，非本任务变更引入）  
  - `tmp/social-evidence/go-test-worktree-20260717T164304Z.log`
- `npm --prefix apps/social run check`  
  - `tmp/social-evidence/social-npm-check-20260717T164314Z.log`
- `npm --prefix apps/social run smoke`  
  - `tmp/social-evidence/social-npm-smoke-20260717T164314Z.log`
- `make app-gateway-check`  
  - `tmp/social-evidence/app-gateway-check-20260717T164343Z.log`
  - `tmp/social-evidence/app-gateway-check.log`
- `make mobile-product-split-check`  
  - `tmp/social-evidence/mobile-product-split-check-20260717T164343Z.log`
  - `tmp/social-evidence/mobile-product-split-check.log`
- `make mobile-android-release-check`  
  - `tmp/social-evidence/mobile-android-release-check-20260717T164343Z.log`
- `make mobile-android-release-installed-check`（当前环境无设备）  
  - `tmp/social-evidence/mobile-android-release-installed-check-20260717T164734Z.log`
- 本地 smoke 与快检：
  - `tmp/social-evidence/social-smoke.log`
  - `tmp/social-evidence/social-gateway-go-test-20260717T163013Z.log`
  - `tmp/social-evidence/mobile-android-release-check-20260717T164343Z.log`

## 风险与未完成项（仅用于验收判断，不误标“已完成”）

- **网站产品目录**：仓库外的官网目录入口（例如 `YNX-Chain-website`）未在本次提交里更新；独立可发现入口仍需网站侧联动验证。
- **跨产品隐私擦除**：本次提交完成 Social 自有范围导出/擦除，但未覆盖 Chat/Square 全链路的联合擦除接口联通。
- **iOS 安装/发布链路**：当前环境未提供完整 Xcode + 原生签名链路验证，iOS 真实下载安装与 store 提交流程待在具备环境处补测。
