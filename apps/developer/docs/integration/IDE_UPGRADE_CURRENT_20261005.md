# IDE 升级当前基线与接入交接

目标：用户提供 YNX_IDE_Upgrade_Goal_v1_ZH.txt，SHA256 91284ddb49ae52ff93e2141037d8e692cdffaf01daa196c0968ceeaf7047f854。原 IDE_VSCODE_GAP_AUDIT_20261005.md 保留为历史证据，本次不改写其结论。总体 NOT_COMPLETED；D17 纵向流程优先，但 D01—D20 全部保留。

| 层级 | 精确基线 | 当前证明范围 |
| --- | --- | --- |
| IDE 独占源码 | ide-quota-command-diagnostics/YNX Chain，codex/ide-quota-command-diagnostics-20261002；起点 e5ecde0dff6fc564d783232facc5263004c868f4，干净 | 本轮在 apps/developer 内改动，不动共享 Auth/Chain/Wallet 源码 |
| 最新封存组件 | 1c44921f3；tree 2bc69baaf9e42a564b21f7986e7c51c7dcfe51e0377439dc323ebc463d1ee9ca | 测试取消组件 GUI、正常 unittest；新 profile 首次自动发现仍缺失；不是完整 App |
| 最新完整 Mac 包 | 2b25b2412125d0a88713477c554523484096ac4c；DMG 046cc1e34160e7dd4e00a2e6532b9d66bdcd7fd11acaa7a0d5f7f968d5fae573 | 包含树刷新修复；后续取消修复和本轮接入未进入该包；最新桌面完整流程未验 |
| 正式服务 | 待唯一总控核对实际 source/image/config/deployment tuple | 旧公共候选及 HTTP 状态不能替代当前真实服务验证 |

| 依赖/职责 | 真实协调对象与状态 | 所需下一输入/动作 |
| --- | --- | --- |
| 唯一总控 | 现有“接续测试网生态审计工作”，01a094cc-0ba3-7901-bcd5-56fce8330c0d；已实际发送本轮目标与精确请求 | 核对 owner、暂停原因和最小批准请求；最多两个并发写任务 |
| Wallet/Auth | 消费现有 canonical root，不新增 Auth；当前 owner/获准版本请总控确认 | QA 正常登录/连接入口，IDE 与第三方 DApp 各自 client identity/scopes |
| Chain/Explorer | IDE 现有 ynx-code-chain/v1 只读服务；外部节点能力未在本轮验证 | 权威能力/部署与调用契约、实际 SDK/CLI 版本、QA Wallet/Explorer，缺引擎由 Chain owner 处理 |
| AI Gateway / Cloud | 已有 model-router 及共享消费方向；真实获准接口请总控确认 | 获准模型/预算/上下文规则、Cloud 最小存储或部署接口及跨项目权限 |
| network/package-egress/远程/LXD | 仍停止；没有代理或扩大整个沙盒 | 总控查明原拒绝与 owner 后集中提出必要最小请求；可设计代码，不自动启用 |
| dot（MONSTER） | 已向总控请求真实现有入口，未创建同名代理 | QA 身份/独立项目/桌面控制，按最终候选正常流程测试 |

本轮实际实现：抽取已有 Chain 服务的只读契约为 chain-reader.mjs，由服务和 IDE 前端共同消费。没有新增默认联网、Session、Secret 或签名接口；运输层继续走现有会话入口。可复用于后续获准 SDK/CLI/AI 工具，但尚未完成它们的集成。校验协议、6423/YNXT 身份、RPC 方法、交易 hash/回执/block 关联；null 数据保持未知，不变成零。confirmed、失败 status、索引与源码验证不混同。17 项本地服务/HTTP契约回归通过；这些使用合成测试 owner/upstream，不是真实 Wallet 或链部署。

macOS 27.0 来源已进一步定位：包内 Node 本体 LC_BUILD_VERSION minos=13.5/sdk=26.5；runtime/distribution.json 记录 libcrypto.3.dylib、libssl.3.dylib minos=27.0，运行时闭包 floor=27.0，主程序也编译为27.0。不能只降 plist；后续需许可适用且受支持的实际二进制闭包、ABI/扩展/签名/旧系统实测。尚未下载或替换运行时。

最终候选验收账本：D01—D20 当前均未完整通过。D01/D02/D03/D04/D05/D18 有明确旧包或组件辅助证据；D06/D07/D08/D09/D10 仍需实现或执行；D11—D17 缺真实纵向接入与外部授权证据；D19/D20 缺各平台最终包、签名状态及真实 dot/下载入口验证。这些不全归为外部阻塞，内部未实现仍由 IDE owner 继续完成。原14主题、中文、Logo、用户项目、设置、扩展及未提交成果保留。

回滚只针对本轮源码/程序版本：保留原包和 source commits，未发布共享服务、未迁移用户数据、未修改链历史。当前更新源构建不等于 integrated/testedOnExactPackage/deployed/publicVerified/signed/notarized/securityReviewed/userAccepted。
