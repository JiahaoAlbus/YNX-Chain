# Devnet → Comet 全状态迁移字段与执行差异 R1

日期：2026-10-18。范围：生产工作树 `ynx-pq-public-upgrade/YNX Chain`，`65efa82e06158f9616172144c3c9efdd8088f227` 派生树；读取时 HEAD 为 `ada7ae3a09b6f0a0c26b838cfafe83ffc0c468bf`，含正在集成的 Devnet PQ 未提交代码。本文件是迁移修复前的静态基线，不是随后并行桥接实现的验收报告。未读取实际账户秘密、未运行 Go 编译、未导入或修改线上状态。

## 结论与证据边界

当前 `ConsensusMigrationState` 只有 15 个字段。它迁出账户、验证人、资源市场政策、DEX，以及区块 tip/供应量摘要。`initialCommittedState` 仅安装账户和 DEX，将 Pay、AI、Trust、资源租赁/赞助、合约等集合初始化为空。Devnet 的 `AccountPolicy`、完整区块/交易历史、全局 lot 元数据都没有目标字段。因此当前 exporter 不是全状态业务迁移器。

目标已经实现多个模块的执行，并不代表已有这些模块的历史导入。旧对象普遍缺少目标要求的 `Signer`、签名动作 `TxHash`、动作执行高度、请求哈希或重放索引。某些旧方法只写状态，从未产生交易。不能把导入时的验证人、当前时间、虚构交易哈希或 QA 签名填入这些字段。

可选择实现有来源标识的类型化转换，或复用旧类型和确定性执行逻辑建立真正被 Comet 查询、交易、AppHash、提交和重启消费的兼容状态。两者均须保全既有权利与历史；仅把 JSON/哈希放进附加字段，只证明备份存在。

基线主文件 SHA-256（便于区分后续并行修改）：

| 文件 | SHA-256 |
| --- | --- |
| `internal/chain/consensus_migration.go` | `cc815dc70540fbf70024a6588fac8918a05a67d07133fbdf5af60308a44b726f` |
| `internal/consensus/state.go` | `b4f09ddc3e7f2a4812a143a96e397f22942d7cbf8b1f395d05aab19b2c678968` |
| `internal/consensus/application.go` | `6e0b96ca1326ff5c661ce82e4c64675660a934ea9da2f12cf340ac10cad75a40` |
| `internal/consensus/migration_dex.go` | `f044d2365428ef056e587c73f36bf14db78d552dc65c62f82da3972c2e429e71` |
| `internal/consensus/ide_application.go` | `00f4238cdc7f2f75b90563402f43796973b470dd475f6f7d1e0846a85b8df7a1` |
| `internal/chain/bounded_contract.go` | `f879e4da9b77a93096f519361727ece453aa760bd83a2cee5676675ff34c7035` |

下文类型没有包前缀时，源类型来自 `chain`，目标 `BFT*` 来自 `consensus`。表中“未导入”指上述基线的真实代码；不代表应丢弃该项。所有 map→slice 转换必须保留 key 与对象 ID 的绑定、拒绝冲突，按目标唯一排序规则排序；不能仅取 map value 后忽略不一致 key。

## 一、devnetSnapshot 的全部 41 个字段

定义：`internal/chain/devnet.go:268`；完整取值/恢复：`internal/chain/replication.go` 的 `snapshotLocked` / `applySnapshotLocked`。普通快照 v2；含 PQ 政策时 v3。

| # | 源字段及精确类型 | 当前 migration / Comet 落点 | 类型、语义与缺口 |
| --- | --- | --- | --- |
| 1 | `AccountPolicy *ynxauth.State` | 无 | 缺网络域、EnableAt、完整双 PQ 注册/轮换历史；不可只迁当前公钥。见第六节。 |
| 2 | `Version int` | migration `Version=1`；committed `Version=14` | 三个独立 schema，不是简单复制数字；v3 防降级要求必须延续。 |
| 3 | `SavedAt time.Time` | 无 | 本地持久化时刻，不能冒充区块时间/交易时间；应保留为迁移来源元数据。 |
| 4 | `StateIntegrity string` | 新算 `StateHash` / `AppHash`，并非原值 | 原全状态 seal 与目标两个 hash 域不同；应保存原 seal 与内容关联，目标 hash 覆盖实际可执行状态。 |
| 5 | `Config NetworkConfig` | migration `Network NetworkConfig`；committed `ChainID int64` | Network 八字段完整保留在 anchor，执行器用其 ChainID；不能仅保 chainId 丢原 genesis 身份。 |
| 6 | `Blocks []Block` | 仅最后一个的 `Height uint64`、`LastBlockHash string` | 完整历史/交易/日志/lot flows/原时间/原 validator 全未导入；Comet blockstore 不会自动出现旧块。 |
| 7 | `Pending []Transaction` | 无 | 旧 pending 通常已作用于账户/模块；与 Comet mempool、`Application.pending` 均不等价。不能重播。 |
| 8 | `Accounts map[string]*Account` | `Accounts []ConsensusAccount` → `CommittedState.Accounts` | 六个内层字段同形；map key 与 `Address` 一致、nil、规范地址/系统账户、排序、金额溢出需核对。 |
| 9 | `Validators []Validator` | `Validators []ConsensusValidator` → Comet genesis validator set | 仅 Address/Moniker/VotingPower/Active；新增真实共识 key binding。Host/Role/PeerID/PeerReady/PeerStatus/LatestHeight/LastSeenAt/UpdatedAt/PeerEvidence 不进入该对象。 |
| 10 | `Peers map[string]ValidatorPeer` | 无 | P2P/运维观测，不应变成共识投票证明；需另保留运维配置/历史映射。 |
| 11 | `PeerSyncs map[string]ValidatorPeerSync` | 无 | 同上，旧同步状态不能证明新 Comet 同步成功。 |
| 12 | `Lots map[string]TrustTraceLot` | 无；仅账户内 `Lots` 数量保留 | 丢全局 `LotID/Amount/Origin/RiskWeight/LastInbound`；目标 trace 会生成通用 origin，无法还原旧来源/风险/入账链接。 |
| 13 | `PayIntents map[string]PayIntent` | 目标 `[]BFTPayIntent`，未导入 | 目标新增授权/动作元数据，反而没有源 PayoutAddress/RefundedAmount/RefundStatus。 |
| 14 | `Invoices map[string]Invoice` | 目标 `PayInvoices []BFTPayInvoice`，未导入 | 目标新增结算链接与授权字段；源退款累计字段没有同名落点。 |
| 15 | `Refunds map[string]RefundRecord` | 目标 `PayRefunds []BFTPayRefund`，未导入 | 完成动作的 RequestHash/Height/TxHash 在源无对应；源付款 BlockNumber 不能复制成动作高度。 |
| 16 | `PaySettlements map[string]PaySettlement` | 目标 `[]BFTPaySettlement`，未导入 | 需要实际付款 receipt、invoice 互链、claim 去重；旧 BlockNumber 与目标 BlockHeight 语义不同。 |
| 17 | `Webhooks map[string]WebhookSignature` | 目标 `PayWebhooks []BFTPayWebhook`，未导入 | 原签名、SignedAt、算法、重放键须保留；目标新增 Merchant/Signer/RequestHash/Height/TxHash/AuditHash。历史 webhook 不应重新发送或重签。 |
| 18 | `PayEvents map[string]PayEvent` | 目标 `[]BFTPayEvent`，未导入 | 目标加 Signer/Height/TxHash；事件 ID/审计 hash 域也不同。 |
| 19 | `RiskLabels map[string][]RiskLabel` | 目标 `TrustLabels []BFTTrustLabel`，未导入 | 扁平化须保留 subject 与全部 label；wrapper 要 Issuer/Signer/Height/TxHash/AuditHash。 |
| 20 | `Evidence map[string]EvidencePacket` | 目标 `TrustEvidence []BFTTrustEvidence`，未导入 | 内含 Trace/Labels/RiskSummary/RelatedTxs/JSONHash；目标加 Requester/Signer/动作元数据，packet hash 域不同。 |
| 21 | `Governance map[string]GovernanceRequest` | 目标 `GovernanceRequests []BFTGovernanceRequest`，未导入 | wrapper 新增 Signer/Reviewer/Height/TxHash/AuditHash；不是协议治理执行清单。 |
| 22 | `Appeals map[string]TrustAppeal` | 目标 `TrustAppeals []BFTTrustAppeal`，未导入 | 目标新增 Signer/ReviewerSigner/动作元数据并校验 claimant/appellant/审核者绑定。 |
| 23 | `Tracking map[string]TrackingPolicyReview` | 目标 `TrackingReviews []BFTTrackingReview`，未导入 | 原分类、范围、置信度、到期/申诉/透明度链接须保留；缺目标签名归属。 |
| 24 | `AIPerms map[string]AIPermissionGrant` | 目标 `AIPermissions []BFTAIPermission`，未导入 | 源没有 Signer/Height/TxHash；旧 grant 不能自动成为某钱包的签名许可。 |
| 25 | `AIActions map[string]AIActionProposal` | 目标 `AIActions []BFTAIAction`，未导入 | 目标新增 Signer/Height/TxHash；源 `TransparencyEntryID` 没有同名目标字段。 |
| 26 | `Transp map[string]TransparencyEntry` | 目标 `Transparency []BFTTransparencyEntry`，未导入 | 保留 RequestID/AppealID/Subject/Action/Classification/Status/Reasons/CreatedAt；目标额外要求签名归属与动作锚。 |
| 27 | `Delegation map[string]ResourceDelegation` | 目标 `ResourceDelegations []BFTResourceDelegation`，未导入 | 业务体嵌入；新增 Signer/IdempotencyKey/RequestHash/Height/TxHash/AuditHash。账户 Staked 已含委托效果。 |
| 28 | `Rentals map[string]ResourceRental` | 目标 `ResourceRentals []BFTResourceRental`，未导入 | 同上；目标还要求完整对应 ResourceQuote，源 snapshot 根本无 quotes 集合。 |
| 29 | `Income map[string]ResourceIncomeRecord` | 目标 `ResourceIncome []BFTResourceIncome`，未导入 | 新增 Signer/Height/TxHash/AuditHash；旧租赁与收益 CreatedAt 可不同，目标要求一致。 |
| 30 | `Policy ResourceMarketPolicy` | migration `ResourcePolicy`；由 `a.migration` 供查询/执行 | 同型直接复制并 Validate；不是 CommittedState 内可变字段。旧不同 PolicyHash 的历史记录不能改写成当前政策。 |
| 31 | `Pools map[string]ResourcePool` | 目标 `ResourcePools []BFTResourcePool`，未导入 | 业务体嵌入；新增 LastAction/LastSigner/Height/TxHash/AuditHash；须保留 consumed、allowance、status、expiry/白名单。 |
| 32 | `Sponsors map[string]ResourceSponsorship` | 目标 `ResourceSponsorships []BFTResourceSponsorship`，未导入 | 业务体嵌入；新增 Signer/Height/TxHash/AuditHash，TxHash 必须等原 TransactionHash。 |
| 33 | `SponsorIDs map[string]ResourceSponsorIdempotency` | 目标 `ResourceSponsorIdempotency []BFTResourceSponsorIdempotency`，未导入 | `Key→IdempotencyKey`，`TransactionHash→TxHash`；ID 域不同；PoolSnapshot 类型变化，目标另有 SponsorshipSnapshot。 |
| 34 | `ActionRefs map[string]string` | 目标 `ResourceSponsorActionRefs []BFTResourceSponsorActionRef`，未导入 | 旧 actionReference→sponsorshipID；目标要求 ID/ActionRef/SponsorshipID/TxHash；必须保全唯一占用、防重放。 |
| 35 | `SponsorLog []ResourceSponsorAuditEvent` | 目标 `ResourceSponsorAudit []BFTResourceSponsorAudit`，未导入 | 目标新增 Height/TxHash；审计 hash/PreviousHash 链不能无说明重算替换原链。 |
| 36 | `SponsorIntegrity string` | 无 | 旧赞助子状态 seal；保留并验证原链，再锚进目标 AppHash，不能拿 AppHash 当原 seal。 |
| 37 | `Contracts map[string]ContractArtifact` | 目标 `Contracts []BFTContract`，未导入 | 数据、地址推导、可执行代码与验证规则不等价；见第五节。 |
| 38 | `DexAssets map[string]NativeDexAsset` | migration `[]NativeDexAsset` → `[]BFTDexAsset` | 已有转换；目标不保 SchemaVersion/BlockHash，AuditHash 重算；源原记录仍应保留可查。 |
| 39 | `DexBalances map[string]map[string]int64` | migration `[]NativeDexBalance` → `[]BFTDexBalance` | 按 assetID/account 展平排序；金额不换算；原生 YNXT 余额来自 Accounts/池储备，不能另造副本。 |
| 40 | `DexPools map[string]NativeDexPool` | migration `[]NativeDexPool` → `[]BFTDexPool` | Shares map→`[]BFTDexShare`；保 NativeLots0/1；目标丢 SchemaVersion/BlockHash，重算 AuditHash。 |
| 41 | `DexEvents []NativeDexEvent` | migration 同型 → `[]BFTDexEvent` | 保原序列；目标高度 uint64→int64，丢 SchemaVersion/BlockHash，重算 AuditHash。 |

`Account` 与 `ConsensusAccount` 的六字段一一同型：`Address string`、`Balance int64`、`Staked int64`、`Nonce uint64`、`ResourceUsage ResourceUsage`、`Lots map[string]int64`。`ResourceUsage` 五项 BandwidthUsed/ComputeUsed/AICreditsUsed/TrustUsed/PayCreditsUsed 均为 int64。不能因为模块集合丢失就重置计数、stake 或 nonce。

`NetworkConfig` 的八字段：Name/Slug/NativeCoinName/NativeCurrencySymbol/ChainIDConflictCheck 为 string，ChainID 为 int64，Decimals 为 int，IsPublicNet 为 bool。金额按现账本整数原样迁移，Decimals 只保元数据，不引入新缩放。

## 二、ConsensusMigrationState 的全部 15 个字段

实现：`internal/chain/consensus_migration.go:21`、`:65`、`:165`；版本 1，SourceFormat 固定 `ynx-devnet-state-v1`（并不表示源完整快照版本仍为 v1）。

| 字段/类型 | 来源 | 目标实际用途与约束 |
| --- | --- | --- |
| `Version int` | 常量 1 | anchor schema 校验。 |
| `SourceFormat string` | 固定字符串 | 只接受上述格式；没有全模块清单。 |
| `Network NetworkConfig` | `d.cfg` | ChainID、政策执行上下文；Comet chain ID 为 `ynx_<ChainID>-1`。 |
| `Height uint64` | `blocks[len-1].Height` | CommittedState.Height 转 int64，genesis InitialHeight=`int64(Height)+1`；需显式限制 `Height<=MaxInt64-1`，不能允许高位溢出。 |
| `LastBlockHash string` | 源 tip hash | 保存在 migration 锚中；不是新 Comet 区块 hash，也不等于完整历史。 |
| `Accounts []ConsensusAccount` | 账户复制/按 Address 排序 | 初始可执行账户。Validate 校验非负/总额/nonce 类型保留；地址目前主要为非空约束，不能据此声称所有账户能签名。 |
| `Validators []ConsensusValidator` | 四个业务字段，后绑定三个共识 key 字段 | BuildCometGenesis 只取 active；`BindConsensusValidatorKeys` 要与全列表一一对应；Ed25519 公钥32B、canonical base64、address=SHA256(pub)前20B uppercase hex。账户双 PQ key 不能当共识 key。 |
| `DexAssets []NativeDexAsset` | ID 排序的源资产 | `dexStateFromMigration`。 |
| `DexBalances []NativeDexBalance` | 展平，asset/account 排序 | 同上。 |
| `DexPools []NativeDexPool` | ID 排序/复制 share 与 lot map | 同上。 |
| `DexEvents []NativeDexEvent` | 原序复制 | 同上。 |
| `ResourcePolicy ResourceMarketPolicy` | 当前资源政策 | Validate + resource execute/query 使用；没有旧政策历史集合。 |
| `LiquidSupplyYNXT int64` | sum(accounts.Balance)+DEX 原生币储备 | 不含新执行效果；是锚总额，不能再次把 DEX 储备加到账户。 |
| `StakedSupplyYNXT int64` | sum(accounts.Staked) | 目标验证 liquid+staked+DEX escrow 总额守恒；stake 与 delegation 关系需另校验。 |
| `StateHash string` | 清空本字段后 JSON 的 SHA-256 | 绑定这15字段，不覆盖遗漏模块。validator key binding 后重算；不等原快照 StateIntegrity。 |

现 `Validate` 校验账户/验证人排序与供应总额、资源政策、DEX 和 anchor hash。它没有检查 pending 为空、AccountPolicy、旧历史覆盖、Pay/AI/Trust/合约等内容，因为这些不在类型内。仅通过该 Validate 不能作为全状态准入证明。

## 三、CommittedState 的全部 47 字段与 executionState 的全部 41 字段

定义：`internal/consensus/state.go:34`、`internal/consensus/application.go:43`。除以下六项元数据，CommittedState 的其余41项与 executionState 一一对应；`cloneExecutionState` 和 `sealCommittedState` 是复制/提交接线，不提供 Devnet 类型转换。

| CommittedState 元数据 | 类型 | executionState 对应 | 当前语义 |
| --- | --- | --- | --- |
| `Version` | int | 无 | 14。 |
| `ChainID` | int64 | 无 | migration.Network.ChainID。 |
| `MigrationStateHash` | string | 无 | migration.StateHash，必须相等。 |
| `Initialized` | bool | 无 | 初始 false；NewApplication 测试/内存路径置 true；持久路径由后续 seal 进入 true。不能靠强行设 true 绕过初始锚一致性。 |
| `Height` | int64 | 无 | 提交高度；不在 AppHash 文档内，空块不因高度本身改变应用 hash。PQ 激活等高度语义仍必须保留准确高度。 |
| `AppHash` | string | 无 | 初始 anchor hash；之后 state hash。新增字段必须同时接 hash 文档、clone、seal、Validate、load/save。 |

下表“初始空”是代码实际 `[]T{}`，不是确认生产源中相应集合为空。

| CommittedState 字段 | executionState 字段 | 精确集合类型 | 初始来源 / 已有业务执行 |
| --- | --- | --- | --- |
| Accounts | accounts | `[]chain.ConsensusAccount` | migration / transfer、各动作共同使用。 |
| FeeEvents | feeEvents | `[]BFTFeeEvent` | 初始空 / 新费用分账记录；不能伪造旧交易符合当前 fee policy。 |
| NativeTransfers | nativeTransfers | `[]BFTNativeTransfer` | 初始空 / transfer 执行；Pay 历史付款/退款需要原始 receipt 导入或有来源索引。 |
| AIPermissions | permissions | `[]BFTAIPermission` | 初始空 / AI permission create。 |
| AIActions | actions | `[]BFTAIAction` | 初始空 / proposal create/approve/reject。 |
| AIAuditEvents | auditEvents | `[]BFTAIAuditEvent` | 初始空 / 新 AI 动作审计；源无同型独立集合。 |
| PayIntents | payIntents | `[]BFTPayIntent` | 初始空 / `applyPayAction`。 |
| PayInvoices | payInvoices | `[]BFTPayInvoice` | 同上。 |
| PaySettlements | paySettlements | `[]BFTPaySettlement` | 同上；依赖 NativeTransfers。 |
| PayRefunds | payRefunds | `[]BFTPayRefund` | 同上；完成退款依赖原结算及转账。 |
| PayWebhooks | payWebhooks | `[]BFTPayWebhook` | 同上；只记录签名材料，迁移不是外发 webhook。 |
| PayEvents | payEvents | `[]BFTPayEvent` | 初始空 / 新 Pay action 生成。 |
| PayIdempotency | payIdempotency | `[]BFTPayIdempotency` | 初始空 / 源主要以内嵌 IdempotencyKey 查询，不是同一索引域。 |
| ResourceQuotes | resourceQuotes | `[]BFTResourceQuote` | 初始空 / 源 snapshot 无完整 quote 集合。 |
| ResourceDelegations | resourceDelegations | `[]BFTResourceDelegation` | 初始空 / `applyResourceAction`。 |
| ResourceRentals | resourceRentals | `[]BFTResourceRental` | 同上。 |
| ResourceIncome | resourceIncome | `[]BFTResourceIncome` | 同上。 |
| ResourceEvents | resourceEvents | `[]BFTResourceEvent` | 初始空 / 源无同型独立集合。 |
| ResourceIdempotency | resourceIdempotency | `[]BFTResourceIdempotency` | 初始空 / 源 delegation/rental 无对应动作重放索引。 |
| ResourcePools | resourcePools | `[]BFTResourcePool` | 初始空 / `applyResourceSponsorAction`。 |
| ResourceSponsorships | resourceSponsorships | `[]BFTResourceSponsorship` | 同上。 |
| ResourceSponsorIdempotency | resourceSponsorIdempotency | `[]BFTResourceSponsorIdempotency` | 初始空 / 新旧结构、ID域不同。 |
| ResourceSponsorActionRefs | resourceSponsorActionRefs | `[]BFTResourceSponsorActionRef` | 初始空 / 原 ActionRefs 需保持同一消费屏障。 |
| ResourceSponsorAudit | resourceSponsorAudit | `[]BFTResourceSponsorAudit` | 初始空 / 不能替换原 hash chain。 |
| GovernanceRequests | governanceRequests | `[]BFTGovernanceRequest` | 初始空 / `applyTrustAction`。 |
| TrustAppeals | trustAppeals | `[]BFTTrustAppeal` | 同上。 |
| TrustCorrections | trustCorrections | `[]BFTTrustCorrection` | 初始空 / 新 appeal 决议生成；源可能通过 label/appeal 表达，没有同型表。 |
| TrustLabels | trustLabels | `[]BFTTrustLabel` | 初始空 / label create。 |
| TrustEvidence | trustEvidence | `[]BFTTrustEvidence` | 初始空 / evidence create。 |
| TrackingReviews | trackingReviews | `[]BFTTrackingReview` | 初始空 / tracking create。 |
| Transparency | transparency | `[]BFTTransparencyEntry` | 初始空 / trust/治理记录。 |
| Contracts | contracts | `[]BFTContract` | 初始空 / `applyIDEAction`，仅固定 bounded 注册表。 |
| EVMReceipts | evmReceipts | `[]BFTEVMReceipt` | 初始空 / 源 receipt 信息分散在 Blocks.Transaction/日志与临时执行结果，不能补造 OpcodeStepCount/StorageWrites。 |
| EVMLogs | evmLogs | `[]BFTEVMLog` | 初始空 / 源 EVMLog 还含 BlockHash/交易序号/LogIndex/Removed，目标结构没有这些字段。 |
| IDEIdempotency | ideIdempotency | `[]BFTIDEIdempotency` | 初始空 / 源 Deploy/Execute 没有同型索引。 |
| GovernanceExecutions | governanceExecutions | `[]BFTGovernanceExecution` | 初始空 / `applyProtocolGovernanceAction`；不能从 GovernanceRequest 自动变出部署/验证执行事实。 |
| GovernanceExecutionAudit | governanceExecutionAudit | `[]BFTGovernanceExecutionAudit` | 初始空 / 执行审计；源快照无同型表。 |
| DexAssets | dexAssets | `[]BFTDexAsset` | `dexStateFromMigration` / `applyDexAction`。 |
| DexBalances | dexBalances | `[]BFTDexBalance` | 同上。 |
| DexPools | dexPools | `[]BFTDexPool` | 同上。 |
| DexEvents | dexEvents | `[]BFTDexEvent` | 同上。 |

`Application.pending *CommittedState` 是 FinalizeBlock 后、Commit 前的候选整个状态；它不属于上述 executionState，也不是 Devnet.Pending 交易列表。Commit 先调用 `saveCommittedState` 成功后才替换 committed。必须保留这一提交/失败边界。

## 四、pending、历史、幂等与金额的实际语义

1. Devnet 的 `stageFaucetLocked`、转账、DeployContractWithArgs、ExecuteContract 等先修改账户/lot/storage，再将交易放入 pending。`ProduceBlock`（`devnet.go:3002`）拿走 pending、填区块/日志、finalize DEX 记录；不是重新应用所有交易效果。当前 export 使用这一实时账户状态，却只写最后一个已产生区块的 height/hash，且没有 pending guard。
2. 最简单可验证切点是停止新写入、让既有 pending 正常结块、确认该块和全模块快照的持久化、pending 为空，再一致读取全状态。若必须迁 pending，必须带准确的“效果已应用”语义及原记录，证明新引擎不会重复扣款/增 nonce/执行 storage。不能只把旧交易 JSON 放进 Comet mempool。
3. `Blocks` 需要保留完整 `Height uint64/Hash/ParentHash/Time/Validator/Transactions`。Transaction 的 Hash/Type/From/To/Amount/Fee/Nonce/BlockHash/BlockNum/Timestamp/LotFlows/Logs/Memo/Sponsor/SponsorPoolID/ResourceSource/ResourceType/ResourceConsumed/ActionReference 都可能承担索引、审计或验签作用。PQ migration/transfer 与 Ethereum 原文存于特定 Memo 编码；不能只保支付字段。
4. 旧 Transaction 不是 `SignedTransaction` 或 `SignedApplicationAction`：其通用类型并无 PublicKey/Signature 字段。历史普通收据不能凭空重构为新 BFT 签名包。旧块也不能宣称拥有新 Comet commit 签名；应保留来源 era 与迁移锚，并让历史查询仍可检索旧交易 hash、区块、日志、费用和证明。
5. `uncertainTransactions`、`durableCheckpoint`、lastPersistenceError 是 Devnet 运行态，不在41字段快照内。切点必须借 `TransactionWithDurability` / checkpoint 机制核对既有不确定写入，不得把进程内存在当已耐久；迁移不可重试未知外部效果。旧不确定记录未核销时，不可宣称完整切换。
6. 普通金额为 int64，Nonce/原区块与政策高度为 uint64；中间 JSON 工具不能转成浮点数。Comet int64 高度需要显式有界转换，政策 nonce/revision 等 uint64 不得收窄。所有原地址/ID/外部引用应稳定；需要地址规范化时必须验证无碰撞，系统账户 `ynx_faucet`、`ynx_protocol_resource_pool` 等不能被替换成虚构钱包。
7. 供应量校验只约束金额总和，不证明 pay claim、资源权益、lot 元数据、赞助 allowance、历史 receipt 已保留。账户 stake 已包含旧委托；重放委托会重复质押，丢委托又会丢 provider 权利和查询。

## 五、各模块不可直接映射的细节

### Pay

`pay_action.go:82` 起的目标对象均带新动作来源。Signer 必须是实际 canonical 账户；Merchant 是业务标识，不能用于猜测 signer。`PayIntent` 源还有 PayoutAddress、RefundedAmount、RefundStatus；目标 intent 不保存它们。源 Invoice 同样有退款累计字段，目标改为 Payer/SettlementID/TransactionHash/SettledAt 链接；不能未经全关联对账就删除旧值。

`PaySettlement.BlockNumber uint64` 是付款原生交易所在区块，目标 `BFTPaySettlement.BlockHeight int64` 是登记结算的 application action 高度，目标还有独立 `TxHash`（登记动作）与 `TransactionHash`（付款）。Refund 的源 BlockNumber 也是付款/退款转账事实，目标区分初始 refund action 与 completion action 的高度、hash、requestHash。两种高度绝不能按名字近似复制。

`validatePayCommittedState` 校验 settlement↔invoice↔NativeTransfers、付款方向/金额/fee=1/先后高度、退款累计、同一转账不得多重 claim。`applyPayAction` 还检查提交时间顺序和 signer/merchant。必须保留对应旧转账与 claim fence，不能只导 Pay 对象。历史 webhook `SignedAt` 不能通过新动作当前 blocktime ±10分钟窗口重播；记录迁移不触发外发。

### AI 与 Trust

`RequestAIPermission`（`devnet.go:2236`）仅在内存 map 写入并 persist，无链上签名交易；不能从它恢复不存在的 Signer/TxHash/BlockHeight。源 AIAction 的 approval/rejection/scope/session/requester/expiry/permission 链及 `TransparencyEntryID` 必须保留；迁移本身不授予新 signer 权限，也不把 expired/rejected 变成 active。

Trust 的七种目标 wrapper 嵌入源业务对象，但 `validateTrustCommittedState` 强制 canonical signer、requester/claimant/appellant/issuer 关系、24 hex record ID、新 audit hash、完整 transparency/appeal 链。嵌入不代表无损直用。源 `EvidencePacket.JSONHash` 及完整 RelatedTxs 是原证据；重新计算为目标域只能作为新派生证明，不能抹去原 hash。

全局 `TrustTraceLot` 没有目标状态。当前 `buildExecutionTrustTrace` 只从账户 lot 数量生成 `Origin="committed-chain-lineage"`，未保原 RiskWeight/LastInbound。保数量同时丢来源不能称完整 Trust 迁移；必须让历史来源和新的转移链能继续被 query/执行消费。

### 资源租赁与赞助池

`BFTResourceDelegation/Rental` 嵌入旧体但增加 Signer、IdempotencyKey、RequestHash、动作高度/hash、AuditHash。`validateResourceCommittedState` 要每 rental 有一个完整 ResourceQuote，quote/rental 同动作与高度且未过期、政策可重算；event 数=delegation+rental 数、幂等数=event 数，income 的时间/hash/高度与 rental 相同。

旧 `ResourceQuote` 是即时计算对象，未保存在 snapshot；rental 只有 QuoteID。`RentResources`（`devnet.go:2593`）本身只改余额/usage/rental/income 后 persist，不产生 pending 交易，并分别取 `time.Now()`。因此缺失的 quote ExpiresAt、原动作签名/hash、统一时间不能通过填当前时间“恢复”。应使用明确的历史资源记录语义继续 provider 权益和查询；新租赁才遵循新动作结构。

赞助池还必须保留 Pool 的 public/白名单/scopes/resource types/PerActionLimit/CumulativeAllowance/Consumed/ExpiresAt/Status/PolicyHash，以及所有已消费 ActionReference。旧幂等索引有原 `PoolSnapshot`；目标加 `SponsorshipSnapshot`，ID 域和 hash 链也不同。重放历史创建/充值/消费会重复增加 allowance 或 consumed；仅复制 Pools 而丢 SponsorIDs/ActionRefs 同样会允许重放。旧 audit chain 应原样保全并单独锚定，新 BFT audit 接续不得伪装为原记录。

### 合约、执行字节码与日志

源 `ContractArtifact` 同时包含编译/验证证据、ABI/events/functions、constructor、runtime storage/storage slots、deployed time/verified time。目标 `BFTContract` 仅保 Address/Name/Deployer/SourceHash/DeployedBytecodeHash/DeployedBytecode/ConstructorArgs/RuntimeStorage/RuntimeMode/BlockHeight/TxHash/LastUpdatedHeight/LastCallTxHash/AuditHash；编译证据、ABI 等无同名落点。

四个明确阻断点：

- 旧地址使用 `hashParts("contract", deployer, name, sourceHash, UnixNano)`；`validateIDECommittedState` 强制 `ideContractAddress(deployer, txHash)`。即使 bytes/storage 可取到，直接导入保原地址也会被拒绝。不能为满足校验重部署到新地址、改变已有链接或假造 txHash。
- 源仅在 `CompilerArtifact.ArtifactPath` 指向外部 artifact，未内联完整 deployedBytecode。旧 `ExecuteContract` 运行时从该路径读真实字节码；单独 JSON 未必能运行。需要把实际字节码、对应 hash 和所需证明一并准备，不能只携路径或 hash。
- 目标 `ValidateBoundedPinnedIdentity` 目前只接受 `SampleEVMWriteCounter` 与 `SampleYNXTCompatibleERC20` 的固定 identity；不得把任意旧合约改名冒充注册项。必须逐个实物核对并实现所需执行支持，未支持项明确阻断迁移完结。
- 必须保最后 RuntimeStorage 与已有 contract address，不运行 `BoundedContractInitialStorage` 覆盖现状态，不重放 constructor。源日志有 BlockHash/BlockNumber/TransactionIndex/LogIndex/Removed；目标 BFTEVMLog 无这些完整索引。旧存量日志需要独立可查询历史，原 receipt 未保留的 step count/storage write 不能推测补齐。

可复用 `chain.ExecuteBoundedContract` / `CallBoundedContract` 与真实 bytecode，前提是同一 storage、caller、calldata 下验证一致；这并不等于通用 EVM 或所有合约都可执行。

### DEX

这是唯一已有专门业务转换函数的模块：`dexStateFromMigration` 将资产/余额/池/事件接到初始 executable state；Shares 按账户排序、NativeLots0/1 复制，目标 audit hash 重算。实际源 SchemaVersion/BlockHash/旧 AuditHash 仍存在 migration 内原 DEX 对象，目标查询不是原完整记录。需要保持该来源可检索。

DEX 资产/池/事件的 BlockHeight 从 uint64 直接 cast int64，应在迁移边界拒绝超界；pending DEX 记录可能尚未 finalization，不应当成已提交历史导入。供给检查必须同时对账账户 YNXT、池内原生储备、非原生资产余额/供应和 LP shares、池内 lot。

## 六、账户政策与验证人身份

`ynxauth.State` 四项：Version string、NetworkID []byte（原 genesis raw32）、EnableAt uint64、Records []Record。每个 Record 八项：AlgorithmVersion string、Owner string、PKA/PKB []byte、Revision/RegisteredAt/ActiveFrom/LedgerNonce uint64。双公钥2592/64字节、旧 revisions、未来尚未激活 revision 均必须保留。仅以最新 key 覆盖旧 key 会破坏历史验签与激活前行为。

读取基线的 `internal/consensus` 无 AccountPolicy/ynxauth 接线。`applyTransaction` / `applyApplicationAction` 只调用 secp256k1 `tx.Verify(chainID)`；故把现账户余额导入并不携带“已激活后拒 classic”的规则。迁移必须让政策进入实际 execution、clone/seal/hash/persistence 与所有 spend/action 入口，验证原 genesis domain、nonce、原执行高度，并保留所有合法迁移证明与对应不可变记录的双向覆盖。不能只存 policy JSON 不调用它。

原注册证明在历史交易中的合法性应复用 `validateAccountPolicySnapshot` / `validateHistoricalPQTransaction` 与 `ynxauth.State.Validate/RequireLegacy/VerifyMember/AdmitMigration` 的语义。Comet 迁移高度继续原高度；不能因新 genesis 将 EnableAt/ActiveFrom 重置。保存过去历史时不能用现在 key 重验原时刻的授权。

账户双 PQ 与验证人 Ed25519 共识 key 是不同边界。已有 `BindConsensusValidatorKeys` / `ValidateConsensusValidatorKeys` / `BuildCometGenesis` 可以复用，但真实 validator→public key→consensus address 绑定、节点独立密钥、签名状态/防双签和实际网络同步仍需另验。PeerReady/旧 PeerSync 状态不等于新 validator 启动或 commit 验收。

## 七、现成可复用入口及其限度

| 入口 | 可复用能力 | 不能据此声称的能力 |
| --- | --- | --- |
| `Devnet.ReplicationSnapshotJSON`、`snapshotLocked`、`sealDevnetSnapshot` | 一致读取41字段、完整序列化、原 seal | 当前未保证 pending 空/耐久切点；输出不是 Comet 执行状态。 |
| `ApplyReplicationSnapshotJSON`、`ApplyReplicationBatchJSON`、`validateReplicationSnapshot/BlockHistory`、`validateDevnetSnapshotIntegrity` | 已有 Devnet 完整恢复与历史/来源校验；可以作为原状态验证器 | 只恢复 Devnet，不会填 CommittedState，也不会自动把 time.Now、外部 artifact、未签名元数据动作变成确定性 BFT 事务。 |
| `applySnapshotLocked` | 逐集合安装到真实 Devnet 内存，含 AccountPolicy | 内部 helper，调用者先验证；`ensureStateDefaults` 行为必须审计，不能为缺失业务数据引入替代 fixture。 |
| `ExportConsensusMigrationState`、`CanonicalJSON`、`Validate` | 现有账户/DEX/政策/validator 锚、排序与供应量检查 | 无全模块导入，且不能验证缺失字段。 |
| `dexStateFromMigration`、`committedDexMatchesMigration` | 已有 DEX 类型转换和初始一致性比较 | 不覆盖别的模块，也不保完整旧日志 schema。 |
| `NewPersistentApplication`、`initialCommittedState`、`loadCommittedState` | 初始化或加载真实 BFT 状态；检查锚和权限 | 现 load 支持 v13/v8→v14 升级的是既有 CommittedState，不是 Devnet snapshot。把文件改 Version 或 Initialized 不能绕过来源证明。 |
| `cloneExecutionState`、`applyTransaction`、`sealCommittedState`、`CommittedState.Validate` | 同一候选状态的确定性执行、验证/封装 | 不负责历史转换；新增模块必须贯穿全部这些函数与 hash document。 |
| `CheckTx`、`PrepareProposal`、`ProcessProposal`、`FinalizeBlock`、`Commit` | 同一交易执行器用于提案/执行，Commit 耐久后发布状态 | 检查成功不是已提交；旧 pending 不等于它们的输入。 |
| `applyPayAction`、`applyResourceAction`、`applyResourceSponsorAction`、`applyTrustAction`、`applyIDEAction`、`applyProtocolGovernanceAction`、`applyDexAction`、AI action switch | 已有各模块的未来签名交易执行逻辑 | 重新调用 create/settle/delegate/deploy 会产生新身份、费用、nonce或重复效果，不是历史导入方法。 |
| `ResourceQuoteForPolicy`、`ResourcePoolPolicyHash`、`ClassifyGovernanceRequest`、`ClassifyTrackingPolicyReview`、`TrustRiskSummaryForLabels` | 已有计算/验证规则可以共享 | 缺失原输入、expiry、签名主体时不能逆向创造事实。 |
| `ValidateBoundedPinnedIdentity/Contract`、`ExecuteBoundedContract`、`CallBoundedContract` | 两固定身份的真实 bounded bytecode 执行 | 不是任意合约迁移；旧地址与验证证据仍需专门兼容。 |
| `saveCommittedState` | Validate、0600 临时文件、fsync、rename、目录 fsync | 内存 JSON 或 raw archive 不等于已持久化业务状态；错误/重启需实测。 |
| `Application.Query` | 查询实际 committed 的各模块与 `/state`、`/migration` | 单独新 `/legacy-json` 下载端点不足以证明原对象可继续操作。 |

可在同一 `chain` 包内复用未导出 helpers；跨包不能直接调用，需最小清晰接口，不另造第二套账本权威。兼容执行器如确有必要，必须保证单一余额/nonce/storage 来源，不能让新旧状态各自扣款。

## 八、后续闭包的可核验完成条件

这些是本映射导出的实现/验收要求，本次未执行：

1. 固定真实切点与完整清单：41项源字段计数、关键 ID 集、金额/储备/份额/委托/赞助 consumed 与 policy revision 全量对账；空集必须由源证明。保留完整旧块/交易与 module audit，区分运维状态和共识状态。
2. 首次导入后，Query/业务路径读到的是带正确来源的真实状态；创建新交易可以引用旧 invoice、refund、permission、appeal、pool、contract、DEX pool/asset 并遵循原 ownership/nonce/idempotency。不能通过给旧对象贴新签名来获得“可操作”。缺无法恢复的授权要如实失败并保留记录，不能伪造或放宽到任意用户。
3. PQ账户在激活前后、已轮换/待激活、旧历史验签情况下正确工作；任何 classic spend/action 都不能绕过已激活 policy。原 NetworkID 和 uint64 高位不变。
4. 原 contract address、bytecode hash、storage 一致；迁后读取和真实允许的写调用验证 storage/日志增量，并重启再查。未支持合约不能以原 JSON 存在宣布完成。
5. 全字段进 deterministic AppHash、validator 从同一输入独立得到相同结果；map 排序、time、height、外部资源与随机性不能造成分叉。确认旧 hash 链仍可验证，新 hash 域与原证明分开标识。
6. 注入持久化失败/重启后验证不会丢已确认状态、不重复 pending/claim/sponsor 消费、不把 UNKNOWN 当失败再执行。原完整历史仍可按旧 hash/height/receipt 查询；新 Comet finality只用于新时期。

本报告只完成源代码字段与语义核对。没有执行真实存量导出、跨引擎业务操作、节点启动/共识或重启验收，不能据此宣称已完成全状态迁移或上线。

## 交接时的并行修改说明

文档覆盖检查时，另一位已授权的实现负责人已经开始修改上面冻结的源码：migration 新增 `OriginalGenesisHash string`、`AccountPolicy *ynxauth.State`、`Runtime *ConsensusRuntimeState`；CommittedState 新增 `AccountPolicy *ynxauth.State`、`PQHistory []PQCommittedAuthorization`；executionState 新增 `accountPolicy *ynxauth.State`、`pqHistory []PQCommittedAuthorization`。当时字段数因此变为 18/49/43；源 devnetSnapshot 仍为41。

这些是进行中的实现观察，不属于本文 SHA 对应的基线，也未在本任务编译/验证。R1 的15/47/41字段表描述的是修复前缺口，不能用来断言新增代码仍然缺同一字段，更不能仅凭新增字段认定执行、历史来源、AppHash、持久化和业务续用已经闭环。后续报告须针对实现完成后的精确版本逐项复核本清单。
