# ABCI 原生 PQ 资源委托与租赁候选 R1

状态：已实现源码，未运行本地 Go；等待固定提交远端 CI。不是网络部署、公开激活或产品业务恢复。此片只属于 Chain 原生协议，未接 DEX 后继，也未恢复暂停产品。

## 实际路径与计费

原 `pq_action` JSON envelope 携带既有 v1 Action Member，不改二进制编码、双 PQ AND 或账户授权域。`EncodePQNativeActionTransaction` 新增允许 `resource_delegation_create` 与 `resource_rental_create`，`applyPQActionTransaction` 路由到真实 `applyPQResourceAction`。它校验原 Member、当前 owner 策略、真实网络/高度、撤销/激活、重复原件和精确下一 nonce。

已真实验经典签名且通过 `RequireLegacy` 的 `applyResourceAction` 与 PQ 入口共同进入包私有 `applyAuthorizedResourceAction`。该执行器不接收伪签名、验证布尔值或替代公钥。原始签名验证不由业务描述值代替。

| 效果 | 原经典 Resource action | PQ 原生 Resource action |
| --- | --- | --- |
| 手续费 | 1 YNXT，入现行 fee recipient | 0 |
| 带宽增量 | 1 | 0 |
| nonce | 精确下一 nonce，成功一次递增 | 同左 |
| 委托 | liquid 转为签定 beneficiary 的 stake | 同一执行器 |
| 租赁 | 原 policy quote、provider/protocol 分账、usage 扣减与 reservation floor | 同一执行器 |
| lot 状态 | 保留现有 Resource 业务的 Lots/TraceLots，不制造转账流 | 同左；零费用不伪造 fee LotFlows |

两种收费规则不同，没有声称费用等价。此处保留已有资源业务的 lot 模型，未将 lot ID 存在或未改动当作全历史货币重放证明。所有会改动的账户与资源数组先分离，错误不污染调用者候选。收款人/付款人别名按净额核溢出；经典 fee recipient 溢出同样拒绝。

同一 quote ID 再次使用会在写入前拒绝：原表模型一个 quote 对应一个 rental，原路径可插入重复 quote 而使随后完整校验/恢复失败；此修复保持既有合法唯一 quote 历史。

## 持久历史与恢复

新 memo 为 `ynx-abci-pq-resource-v1:` 加原始 JSON transport 的规范十六进制；ABCI transaction hash 与 native Member hash 分开保留。业务对象 ID 继续由真实 BFT 原始 transport hash 产生，非冒充源 Devnet 对象 ID。

不新增 schema 字段或重写旧 app-hash domain。使用已有 `PQHistory` 和 Resource delegation/rental/income 已有的可省略 `PQTransactionHash` 字段。旧经典记录与源 `LegacyResourceMarket` 不重编码；旧不支持该 memo 的版本会拒绝新历史，不能仅放开版本号后绕过新验证器。

完整 `CommittedState.Validate` 保留现有 common metadata/高度/重复检查，增加以下闭环：

- 原始 Member 在原历史高度真实双签验证；现在的 rotation/revocation 不抹掉原合法记录。
- 同一个确定性构造器生成并比对完整 delegation/rental/quote/income/event/idempotency；quote 由可信 policy 重算，绑定真实执行时间、TTL、原 max-price 与 request hash。
- 每个标记必须有唯一原件，每个原件必须有完整效果；禁止 fee-zero 动作获得 fee event，禁止注入未执行的 Sponsor/Resource/Logs/BlockHash/LotFlows。
- PQHistory 和 ResourceEvents 保留真实顺序，未来 delegation 不能授权先前 rental。源 provider 只能来自完整可信 migration checkpoint；当前新增 provider 必须先有合法事件。
- 原 resource validator 的完整 stake 方程不变，继续叠加既有 PQ stake 原件贡献。原资源使用下界改为按历史顺序折叠 contract/stake 与 rental；租赁只扣先前使用，不能删除后续调用费用。现存 reservation floor 也不能被租赁抹除。
- 资源 owner 的原件 nonce 不回退，首次资源 PQ 执行后连续消费，最终 nonce 对应最后保留原件；生产路径每次都核精确下一 nonce。

`pqContractRemainingSourceUsage` 仍只从已验证经典、执行前租赁/退款扣减 source base。新 PQ 租赁只有在原件与完整记录已双向校验后，才在原 PQHistory 位置折叠。旧 contract/stake 反例测试文件逐字保留，未降低断言。

经典历史未保留的原签名原件与所有外部余额变化不能从现有字段独立恢复；此片不编造这些材料。未知经典正向 usage 不计入下界，source sponsor 以后被他人合法消费时当前 reservation floor 是保守下界。重新伪造整个自封快照并同时删除全部政策、证明、效果及最终状态，仍须独立可信 migration/checkpoint 和现有 append-only continuation 防回滚；可重写 marker 不能代替可信根。

## 验证源码与交付边界

新 `pq_native_resource_test.go` 使用真实 KeyGen、双 PQ Member 与经典签名，经 CheckTx/PrepareProposal/ProcessProposal/FinalizeBlock/Commit、持久冷恢复验证；没有 mock 接受路径。包含两种收费、委托 beneficiary、provider 分账/self alias、真实编译 counter 调用和 stake/rental 交错、source provider、reservation、两个 owner 与终态撤销、原 A/B 损坏/错误 key/nonce/fee/network/policy/request/quote、21 类重封历史篡改、收款溢出、原 quote 重用，以及前 rename 回滚/后 rename UNKNOWN/原候选重试。

本地仅 gofmt 和 `git diff --check`；未本地 Go 编译/测试、未启动节点，未运行远端 CI。由父线程固定这组源码送原持续集成。既有 stake/contract 原测试 SHA-256 保持 `5e034d93ee0f0512441d2ec7fcf022ba523400b58caae60f449b0690033ed002` / `f6095b70d07e2b9a889597b45856f5065879af846fc312b53187671416df083b`。

## Consumer source delta

本片相对 `5294cb2d91ced414ee16edde39318de017404e53` 改动 `account_policy.go` 的 typed-history 分流，并保留所有共用门。该文件原 SHA-256 为 `d691e3f8b5dc932d52faecf4e25285c333074c10c211889ced759598a4fdefcf`；新精确 SHA 与完整 7 个 Go 叶列于同目录 `PQ_ABCI_NATIVE_RESOURCE_SOURCE_R1.sha256`。这是后继 consumer delta，不修改之前已提交的 R1 consumer snapshot 说明或证据。
