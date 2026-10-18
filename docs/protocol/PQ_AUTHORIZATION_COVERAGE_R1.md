# PQ authorization coverage R1

日期：2026-10-18。源码基线：`69e788b4bd726689ea5d1709fd5ba0162c6ec0da`。

这是当前 Protocol 工作树的只读授权入口盘点。父任务已报告该基线远端 Run8 `39059614316` 的 `focused-go` job overall success，另一个 `verify` job skipped；job 内也有 skipped post steps，不能称所有 steps 均运行通过。本次盘点没有运行本地 Go、外网探测或部署验证，也没有把未测试的新发现算作已通过。这里的“可用”表示该源码有实际验证和执行入口，仍需正常余额、nonce、资源、业务权限及运行配置满足要求。

**结论：Devnet 的 PQ 转账、迁移、撤销及 11 种 Action 已有实际入口；11 种 Action 并未覆盖所有原生合法写入。ABCI 新交易目前只有 PQ 转账、迁移和撤销。旧签名拒绝是关闭旧授权，不代表替代业务已完成。**

## 1. 高度与身份边界

本文的 active 指在实际执行高度 `H` 已激活的 owner；revoked 指 `H >= RevokedFrom`。撤销在 `H` 由当时合法完整双 PQ keys 授权，终止高度固定为 `H+1`。同一 `H` 的正常历史证明仍有效；不能用当前 tombstone 使过去的合法签名失效。

- `State.PolicyAt(owner,H)` 保留完整历史注册语义。`RequireLegacy` 因该 owner 曾在 `H` 激活而继续拒绝 classic，撤销不恢复 classic。
- `State.TrustedRegistration(owner,purpose,H)` 同时处理历史 keys、rotation 和 tombstone。Member 与 Whole 每次实际使用必须在 ledger 锁内重新查询，不能把 `PolicyAt` 手工改成 `Enabled:true`。
- 普通 rotation 由当前 lawful pair 批准下一对独立 keys，按原 active height 生效；terminal revocation 永久关闭该 owner 后续 PQ 花费/登记，保留原 records 和已取消的 pending rotation 记录。没有 classic、guardian 或“知道新公钥即可恢复”的 native 恢复入口。
- 首次 tombstone 将全链 policy 从 v1 显式升至 v2；其他 owner 不因全局 v2 停摆。账户 HTTP view 仅投影该 owner 的 records/revocations：无本 owner tombstone 时 `policyVersion=v1`，另以 `globalPolicyVersion` 呈现全链版本。投影不可重新灌回全链持久状态。
- 原 wire/hash 的幂等返回是旧 receipt 的查询/不确定写入对账，不是重新执行。未知持久化结果必须围绕原 wire/hash 恢复。
- 转入资产、faucet 发放、历史 receipt 查询与原生出账授权不同；终止 owner 签署权不等于禁止其他合法 owner 向该地址转入。

证据：`internal/ynxauth/policy.go`、`revocation.go`；`internal/chain/pq_authorization.go`、`pq_batch.go`、`pq_revocation.go`；`internal/api/pq_authorization.go`、`pq_revocation.go`。

## 2. 账本入口矩阵

| 入口 / 执行器 | active owner | revoked owner | 实际覆盖与缺口 |
| --- | --- | --- | --- |
| Devnet `POST /transactions/pq/broadcast` → `SubmitPQTransfer` | 当前 pair 的合法 Member 可转账 | 新转账拒绝 | 完整 Member、精确网络/owner/message/nonce；旧历史按原高度验证 |
| Devnet `POST /transactions/pq/batches/broadcast` → `SubmitPQBatch` | 当前 pair 的合法 Whole 可转账 | 新批次 / 已验 handle 后续使用拒绝 | Whole 仅转账；逐 member 重查 `TrustedRegistration`；不支持 mixed Actions |
| Devnet `POST /transactions/pq/actions/broadcast` → `SubmitPQAction` | 下节 11 种动作可用 | 新 Action 拒绝 | 完整原 Member，可来自任意合法 batch N；不是 Whole Action 提交接口 |
| Devnet `POST /accounts/{address}/authorization/migrate` | 当前 pair 授权 rotation | 拒绝 | 初次迁移发生在合法 classic 阶段；activation 后不可再用旧 secp key；terminal tombstone 后不可追加 registration |
| Devnet `POST /accounts/{address}/authorization/revoke` | 当前 pair、精确 nonce/height、fee 1 可撤销 | 新撤销拒绝；原 wire 可对账 | v1→v2、next-height 生效、fee/lot/bandwidth/持久化和历史双向绑定 |
| Devnet classic `POST /transactions/broadcast` | 新出账拒绝 | 新出账拒绝 | API secp 验签后由 `SubmitSignedTransfer` 在锁内执行 policy gate |
| ABCI `pq_transfer` | 当前 pair 的 Member 可用 | 拒绝 | CheckTx/proposal/finalize/commit 实际 adapter；不是 Devnet HTTP 路由的自动转发 |
| ABCI `account_migration` / `account_revocation` | rotation / terminal revoke 可用 | 新登记/新撤销拒绝 | v2 policy、proof history、fee、nonce、源历史迁移与重启保全已有适配 |
| ABCI 新 Whole / 新 PQ non-transfer Action | 无入口 | 无入口 | source Whole/Action 历史导入与验签不等于 target 新交易 admission |
| ABCI classic transfer / `application_action` | 新交易拒绝 | 新交易拒绝 | `applyTransaction` / `applyApplicationAction` 在 module dispatch 前调用 `requireConsensusLegacy` |

API 实际 method 名以 `internal/api/pq_authorization.go`、`pq_action.go` 为准。核心源码：`internal/chain/pq_action.go:28`、`pq_authorization.go:49`、`pq_batch.go`；`internal/consensus/application.go:625`、`:705`、`account_policy.go`、`account_revocation.go`。

## 3. 11 种 PQ Action 的完整清单

以下均使用 `YNX-NATIVE-ACTION/v1` 的完整 canonical typed payload，外层 `YNX-BATCH` Member、transaction purpose、原 genesis、native chain ID、owner、nonce 和 fee。编码支持不代替业务执行验证。Devnet `SubmitPQAction` 在同一 `d.mu` 内完成 current policy 验证与执行。

| Kind | Devnet 现有实际业务 | Fee | ABCI 新 PQ 执行 |
| --- | --- | --- | --- |
| `stake` | owner 质押余额、资源更新 | 0 | 无 |
| `resource_delegation_create` | provider 签署向 beneficiary 委托资源；policy/request hash 绑定 | 0 | 无 |
| `resource_rental_create` | renter 签署 provider、资源数量、quote/expiry、policy、max price；保留 sponsor reservations | 0 | 无 |
| `dex_asset_create` | 创建资产及初始供应 | 1 | 无 |
| `dex_asset_mint` | 现有 issuer 权限下增发 | 1 | 无 |
| `dex_asset_transfer` | 资产余额转账 | 1 | 无 |
| `dex_pool_create` | 创建 pool、资产顺序和费率约束 | 1 | 无 |
| `dex_liquidity_add` | 添加流动性，数量/min shares/deadline | 1 | 无 |
| `dex_liquidity_remove` | 移除流动性，shares/min amounts/deadline | 1 | 无 |
| `dex_swap_exact_input` | exact input，min output/deadline | 1 | 无 |
| `dex_swap_exact_output` | exact output，max input/deadline | 1 | 无 |

八种 DEX 写覆盖当前 Devnet DEX HTTP 写目录。合法接收者、委托 beneficiary 和收取市场收入的 provider 不会自动成为签名者；不得把接收资产/已有市场安排误称为重新授予 revoked owner 出账能力。

源码：`internal/ynxauth/action.go:18`；`internal/chain/pq_action.go`、`pq_action_resource.go`、`native_dex.go`。已有真实签名测试入口包括 `TestPQActionAllNativeBusinessPathsAndHistoricalRestart`、`TestPQActionFailsClosedWithoutBusinessMutation`、`TestPQActionMutationDurabilityUnknownAndRollback`。这不表示下面未实现的动作已有测试或功能。

## 4. 其他原生写入与关闭面

| 现有表面 | active / revoked owner 的行为 | 当前缺口或边界 |
| --- | --- | --- |
| `/transfer`、`/staking/stake`、`/ide/deploy`、`/ide/execute` | public 网络 `unsignedDevnetRoute` 直接 403；非 public 进入核心后仍受 owner classic gate | stake 有上述 PQ 替代；contracts deploy/execute 没有 |
| 旧 `/resource-market/delegations`、`/resource-market/rent` | provider / renter 的核心 classic gate 拒绝 | 可改走对应 PQ Action；HTTP gateway transport key 本身不是账户签名 |
| `/resource-market/pools`、pool fund/policy/status、`/resource-market/sponsorships` | 各自 secp authorization 之后拒绝 active/revoked signer；消费池时另查 canonical pool owner 的 classic policy | 五类 sponsor 操作没有 PQ payload/执行入口；已迁移 owner 无法用 PQ 管理或终止旧 pool，不能宣称资源业务全覆盖 |
| `/dex/*` 八种旧 mutation | classic application action 签名与路径核对后，核心 `requireLegacyAccountLocked(signer)` 拒绝 | 使用上述八种 PQ Action；普通 DEX role/balance 仍需满足 |
| 原生 unstake / unbond / stake withdraw | 在当前 `internal/chain`、`internal/api`、`internal/consensus` 未找到对应函数、路由或 Action kind | 不是已有 classic 操作只缺 PQ adapter；该业务本身未实现，不能把 stake 支持写成完整进出质押周期 |
| Pay intent/invoice/refund/webhook、AI permission/proposal/approve/reject、Trust label/evidence/appeal、Governance request/review 等 Devnet records | 多数由可配置 gateway upstream key 和各自记录约束保护；不查询 owner policy，没有整体 active/revoked 关闭语义 | 这些 records 不因此成为已授权原生转账；若产品把记录当“当前 owner 批准”，尚缺账户 PQ 语义 |
| Pay settlement / refund completion | 核对已有 committed transaction、主体/金额/绑定及防重复，不自行新建转账 | 撤销前合法付款的后续核销不应伪装为撤销后新花费；付款仍须独立通过 ledger 授权 |
| ABCI AI/Pay/Trust/Governance/Resource/DEX/IDE classic application actions | `requireConsensusLegacy` 在 dispatch 前拒绝 active/revoked signer；resource sponsorship 另查 pool owner | 所有这些 module 的新 PQ Action adapter 都没有接入；source 模块状态迁移只保历史 |
| Faucet、读取、compile、监控、validator/peer 操作 | 不等同账户出账；按其独立服务/操作边界处理 | operator rollout、导入/复制也不能授予账户 proof；snapshot/history validation 保全已经签署的状态 |

上述业务记录 API 不能概括为“所有 legacy 已关闭”。本轮没有重新审计 gateway 的所有部署配置，也没有证明任意产品实际暴露可利用越权；这里只记录当前 Core source 的授权模型差异。Trust 风险标签显式仅 advisory，拒绝冻结/扣押/转移资产效果。

### 4.1 必须单列的合约 verify 状态写入

`POST /ide/verify` 在 `internal/api/server.go:216`、`:1547` 直接调用 `Devnet.VerifyContract`，不经过 public unsigned gate，也不要求 owner 签名。`devnet.go:2807` 只核对源代码 hash，然后重新调用 `buildContractArtifactWithArgs`；仅恢复原 `DeployedAt`，没有保留执行后的 `RuntimeStorage`。builder 在 `devnet.go:4240` 用 source/constructor 重新计算初始 storage，并在返回 artifact 中写入它。

因此，已执行写入的 contract 再收到公开已知且 hash 正确的 source verify 请求，会把 runtime storage 替换为初始值；owner active/revoked 状态不参与该路径。**这个入口不能列作只改验证标记的无状态 API。** 这是基线源码可达的具体缺口，公网实际可达性本轮未验证。新增 `internal/chain/pq_contract_verify_regression_test.go` 以真实 compiled counter/ERC20 执行后迁移/撤销、重复 verify 和 cold restart 建立反例。公开验证源代码本身应继续允许，修复应保证 verification 仅改可验证元数据而保留运行态，不应凭此增加无必要的 owner gate。

后续证据：父任务读取 Run9 `39085111463`（`a0201636d985ee0292734b89813dd801bb7d65ab`）失败日志，确认是实际运行态 RED：counter `12→7`，ERC20 owner `999750→1000000`、recipient `250→0`，cold restart 仍保留错误结果；chain 18.736s FAIL，API 4.602s PASS。原反例 SHA256 `6ac8dc6f9c0a74e8320374a4e2e7dd2f57587bcc3ab6407574d70f8ee4757251` 保持逐字不变。

Run10 待验证候选仅窄改 `VerifyContract`：将 builder 返回值作为验证候选，核对 source/code/artifact/compiler config 以及 compiler provenance/build-info/ABI identity，一致后只复制 `Verified`、`VerifiedAt`、`VerifierStatus`、`ReproducibleBuild`、`ReproducibilityStatus`、`DeployedBytecodeComparisonStatus`。原 artifact 的 runtime storage/slots、owner/address、constructor、ABI/compiler identity、部署时间和其他运行字段不替换。源或身份不匹配不写 ledger；不加 owner gate。此处只记录源码修复候选，不宣称 Run10 已通过；本地未运行 Go。

## 5. Ethereum 兼容入口

| 入口 | active / revoked owner | 精确边界 |
| --- | --- | --- |
| `eth_sendRawTransaction` 的 Ethereum RLP type 0 | secp EIP-155/low-S 验证后，native `SubmitSignedTransfer` policy gate 拒绝新出账 | 只支持 whole-YNXT plain native transfer，fee 1；20-byte recipient、无 calldata、无 creation、无 typed/EIP-1559 envelope；原 Ethereum raw 在核心再次核对 |
| 同 method 的旧 native JSON hex fallback | native secp 验签后同一 ledger gate 拒绝 | 不是 PQ raw wire 自动解析入口；PQ 用明确 HTTP/ABCI adapter |
| `eth_sendTransaction` | native adapter 开启时直接 unsupported；旧 adapter public 网络禁止；非 public contract call 进入 `ExecuteContract` 后拒绝 active/revoked caller | node 没有 Ethereum signing key；未提供替代 PQ 合约提交 |
| `eth_call`、balance/nonce/receipt/log 查询 | 读历史或当前数据，不授予出账资格 | bounded runtime；`eth_getCode` 不能给现有 native artifact 伪造标准 Ethereum runtime bytecode |
| `eth_sign`、`personal_sign`、typed-data signing、ERC-7769 Bundler 方法 | 当前 Core RPC switch 没有对应处理 | 不存在把 PQ 账户降级为 Ethereum signer 的服务入口；Wallet 自行生成签名不等于 Core 接受 |

源码：`internal/api/server.go:696`、`:1821`、`:1894`、`:1907`；`internal/api/ethereum_native.go:19`；`internal/ethnative/transaction.go:78`。兼容 adapter 自己声明 `fullEVM=false`。本轮未探测公共 RPC。

## 6. Wallet session、恢复与 delegation

**版本范围：以下只描述本 Protocol 基线仓内代码，不描述外部 Auth/SDK owner 独立冻结的 R2a / ProductSessionV3 候选。不能据此推断外部最新候选缺少 policy gate，也不能将候选能力倒灌为当前 Protocol 仓或部署的事实。应由原 owner 对固定 source/hash 做差异核对。**

| 路径 | 当前源码是否绑定 native owner policy | active / revoked 与缺失能力 |
| --- | --- | --- |
| Go `internal/appgateway` classic ownership flow | 有：固定 Core origin + 原 genesis + chain ID，每次 challenge、verify、protected session use 重读 next-execution policy；缺失/错误/未知配置失败关闭 | active 返回 `ErrPQSessionRequired`；本 owner tombstone 投影 v2 因精确 v1 gate 返回 unavailable，仍失败关闭。没有 PQ login。token-bound logout 清理仍可用 |
| Go Gateway 的 canonical product proxy | 与上面的 classic gate 是不同入口 | `TestClassicSessionUnconfiguredRegistryDoesNotBlockCanonicalProxy` 明确保留该边界；不能声称 classic gate 自动保护 central canonical 服务 |
| 仓内 Wallet/Auth v1 `crypto.js` / `session.js` | 无 ledger policy 输入：账户 secp256k1 approval + P256 device completion | 验证身份/请求绑定，不能单独证明 migrated/revoked owner 的当前链上资格；需部署 owner 的 authoritative gate / PQ protocol |
| 仓内 v2 `ProductSessionAuthority` / `ProductSessionGatewayKernel` | 维护本地 session/device/account cutoff、重放、请求/回调/设备绑定；账户 approval 仍是 secp256k1；未接 Core tombstone | 本地 logout/recovery 机制不等于 native terminal revocation；不能把 `active:true` 解释为链上可签名。外部冻结候选另核 |
| 仓内 `wallet-session-control.js` | owner control proof 使用 secp256k1、本地时间/nonce/path/body 绑定，无 native registry 查询 | 列举/撤销产品 session 不生成 native 出账能力，也没有完成 PQ owner control 替代 |
| `internal/canonicalwallet` + resource/trust product consumers | 解析上游 verified session，验证产品/设备/作用域/有效期与 P256 HTTP proof；该层无 native policy resolver | 信任上游 canonical authority，不能替代其最新 policy 校验；本次未证明该上游部署状态 |
| `product-session-recovery.js` | 恢复 pending request、ACK/outbox、既有 session、网络重连；使用 gateway 返回的产品权限 | 是产品会话恢复，不是恢复已 terminal 撤销的 native keys；不应把相同英文 recovery 名称合并 |
| `mandate.js` / `mandate-lifecycle.js` | 有精确策略目标/额度/时间/nonce-domain 和本地 revoke/kill/exit；无 native PQ resolver | 属策略 delegation 的独立边界；不能据其允许结果提交未获 native proof 的交易 |
| `contracts/wallet/YNXSmartAccount.sol` | ECDSA owner/session、WebAuthn passkey、guardian delayed recovery；无 native PQ registry 联动 | 是独立 Solidity account 模型。该 contract 的 owner/session/recovery 不表示可以恢复原 native terminal owner，也没有在当前 Core 上完整 ERC-4337 runtime 激活证据 |
| `smart-account.js` / `bundler.js` | sponsorship policy 和 ERC-7769 client adapter | SDK 能构造/请求不等于 Core 支持 EntryPoint/account/paymaster 执行或公共 sponsored receipt |

Go classic gate 的 Core HTTPS response 是固定 operator 信任边界，不是共识/light-client proof。其他 owner 即使全局 v2，其无 tombstone 的完整 owner 投影仍为 v1，不会只因全局 version 被该 parser 关闭。

智能账户源代码确实具有 session revoke、epoch 和 guardian recovery；这里既不否认这些合同源码，也不将本地合同或旧 handoff 的历史探测视为当前公共部署。`packages/wallet-auth/integration/CHAIN_ERC4337_HANDOFF.md` 的旧探测日期只作为已有边界说明，不作为本次在线证据。

## 7. 后续最小交付顺序与验收边界

1. 先为 `/ide/verify` 保持 runtime storage 建立真实反例，独立修复。不要通过扩大 owner gate 来掩盖“verification 重置已执行状态”的问题。
2. 为已有 bounded contracts deploy/execute 增加明确 PQ Action payload 与实际执行 adapter，绑定 code/source identity、calldata、目标和执行前 storage；保留当前 runtime 支持范围。完整 EVM、任意合约或 ERC-4337 不能随这两个 Action 一并宣称完成。
3. 按实际业务需求补 sponsor pool 五类 PQ actions，包括 old pool 的管理/撤销与 beneficiary/pool-owner authority；不能只增加 kind 常量或移除 classic gate。
4. ABCI 需要独立新 PQ Action / Whole admission、execution、持久化/history/fee/event/source import 适配，不能因 Devnet HTTP 可用就标完成。保持当前失败关闭直到对应 adapter 具备验证。
5. 将本仓 Wallet/Auth 行为与原 owner 的 R2a/ProductSessionV3 固定候选对照，确认 challenge/complete/introspection/protected use/cached replay/control/recovery 的 policy 与撤销语义，再安排产品真实集成；不重复造另一套登录/恢复引擎。

新增业务至少需真实双签的合法接受、任一签名错误、错 owner/network/nonce/purpose/height、旧 classic 拒绝、rotation、撤销前历史与撤销后拒绝、其他 owner 正常、failed mutation 无泄漏、UNKNOWN 原 hash 恢复、snapshot/import/restart。这里列的是后续验收要求，不是本轮已经运行的结果。
