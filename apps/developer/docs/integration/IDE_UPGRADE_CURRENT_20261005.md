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

## 当前项目 Chain 接入与并行整合

统一 reader 源提交 0887ba10b3a72bbfb37d127dda1e2311366601ce。现新增本地项目 Chain 工具：正常命令/Tools 树配置 ynx-chain-project.json；查询操作及交易引用写入当前项目 .ynx/chain-history；重开历史与同一引用重新批准查询。配置、可编辑历史和录入 hash 都不是身份、授权或 IDE 部署证明。无正式获准运输层时明确拒绝，零请求；没有换端点、fetch fallback 或签名接口。39 项 agent 回归通过（项目11/shared reader4/既有Tools24）；root 项目11项复验、全部命令标题和59条中文映射检查通过。测试使用受控接口/临时项目，真实 Wallet、实时链和最终 App 未通过。日志 /private/tmp/ynx-chain-project-final-tests-20261005.log 与 /private/tmp/ynx-chain-project-integrated-tests-20261005.log。

本轮总控准确依赖材料：/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/coordination-01a094cc/recovery-20261005/ide-existing-dependency-contracts-root-20261005-8c102fd6/REPORT.md 与 INPUT_PINS.json，已全文读取。共享 Wallet/Auth 源1.2.0没有交同代正式 supplier；IDE vendor旧candidate未部署，v2 Browser身份与v1部署不可拼成已接通。Chain authority pin已于9/27到期；consumer的address/function与BFT源address/calldata存在差异，必须按实际target能力核接，不能自行改链或猜接口。AI缺真实provider/身份接线；Cloud source完整1894/root928e存在，但后端NOT_RUNNING，静态READY不是存储/计算业务。真实QA身份和dot调用入口未提供。普通IDE代码继续，暂停的network/package-egress/LXD/remote/shared发布没有恢复。

扩展只读核验：用户原65条/63唯一清单真实存在，未有完整逐项功能矩阵；原Pylance/C++/RemoteSSH许可限制不能静默迁移。当前默认扩展API为框架1.139.0，不能用Monaco版本或semver匹配认定兼容。在线市场后端被整树deny network策略拒绝。兼容性核验另发现drivelist最终link和process-tree编译漏minimum target，现二进制都27.0；本机签名Node24.19.0仅系统库且minos13.5，加载检查通过，但尚无新的相容整包或旧OS证明。

异常测试/调试启动清理已整合：actual Theia TestController/TestRun/DebugExtImpl/tracker 与实际短子进程退出回归27 PASS/0 FAIL/0 SKIP，root复验相同结果；只对未终态Queued/Running标Errored，取消保留未知，保留Passed/Failed/Skipped，迟建run和迟到输出不能恢复运行，多请求隔离，正常launch后仍等测试pipe结果。没有放宽debugpy/socket或网络隔离。真实断点、变量、单步与新组件GUI尚待验。日志 /private/tmp/ynx-test-failure-cleanup-integrated-20261005.log。Workbench版本0.3.20，后续实际构建/封存仍另记。

AI审阅模型绑定已从硬编码qwen改为现router configured catalog：proposal、批准、调用和记录统一模型；批准后变更、排队执行前变更均要求新审阅；返回模型不匹配则不提供编辑/保留生成文本。缺配置不冒充可用模型。使用原reviewed上下文与一次性ticket，不扩大网络、provider或费用权限。40 PASS/0 FAIL/0 SKIP（含已review离线0.8.24 compiler），日志 /private/tmp/ynx-tools-model-binding-pinned-tests-20261005.log；这仍是受控服务回归，不是genuine在线模型验收。

只读身份核验进一步确认：真实local Theia没有legacy React Wallet桥；v2仅factory/options/Guest，没有正常beginYNX/handleReturn/restore/disconnect消费；IndexedDB设备签名与随机loopback origin可能换key，Keychain session持久不证明设备签名跨重启。需要IDE-owned真实native设备签名及root消费者接线，使用canonical SDK，不新写Auth。独立browserSSO不能当ProductSession，ProductSession也不能自动当部署动作授权。
