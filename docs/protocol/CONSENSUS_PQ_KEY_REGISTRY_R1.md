# Validator 双 PQ key registry / logical identity R1

状态：纯 candidate codec、真实密码验证与不可变内存历史。未接 ABCI FinalizeBlock、Comet engine、PubKey proto、remote signer、light client 或持久层。本轮不新增签名器或 HRS 状态，不修改既有 batch v0.1、consensus Request、Signer state 或 engine limits。

## 1. 信任边界与身份

`RegistryAnchor = (GenesisID[32], ChainID)` 必须来自调用方已认证的 genesis/checkpoint。GenesisID 非全零、恰好 32 B；ChainID 保留既有候选规则：非空、有效 UTF-8、最多 50 B，逐字节绑定，不作大小写/Unicode normalization。

逻辑 validator identity 始终为首次可信旧 Ed25519 公钥的 `SHA256(publicKey)[:20]`。首次登记同时核实际 H 的可信 membership source、完整旧公钥、该地址派生、旧钥签名与两把新钥 PoP。后续保持这 20 B logical address，不将双 PQ keys cast 为 Ed25519。

`KeyHistory` 实现既有 `Registry` 查询接口，但不是自证 committed state。创建、Append、snapshot import 都是纯函数/内存对象；调用方必须将完整 operation、history root、validator/activation 变更与对应执行结果原子持久化后，才能把新对象发布为可信 Registry。构造出一个 KeyHistory 或成功验证 proof 均不证明它已被网络提交。

**Genesis 域边界：** 本文件的 registration、authority approval、PoP、logical key binding、event/root/snapshot 均绑定完整 genesis32。现有冻结 `Request.SigningBytes` 的 Proposal/Vote/Extension message 只含 chainID/address/H/R/kind/epoch 与 canonical message；registration 绑定 genesis 不会自动为这些普通共识签名添加跨 genesis 隔离。Engine activation 前必须另做明确版本化的 Request/Signer-state 迁移及固定 fork wire，或证明不可复用的严格 validator-key/network 约束；不能仅相信 peer 自报 registry。本切片 PASS 也不代表该门已完成。

## 2. 固定密码套件与 proof 路由

- 旧 authority：标准 Ed25519，公钥 32 B、签名 64 B，仅用于该 logical identity 的首次登记。
- PQ A：FIPS 204 ML-DSA-87，公钥 2592 B、签名 4627 B。
- PQ B：FIPS 205 SLH-DSA-SHA2-256f，公钥 64 B、签名 49856 B。
- A/B 均使用完整消息、空 context、pure-message 模式，必须同时验证成功。固定实现为已有 CIRCL v1.6.5 provider；`KeyHistory.Append` 不接受调用方的签名验证回调或 verified bool。
- 新公钥 A 和 B **分别**必须未在该 anchored history 任意 validator 的登记中使用过，包括 retired/revoked keys。不能只换一支，也不能复活旧 key 或跨 logical identity 重用一支。

| Kind U32 | authority slots | possession slots | 效果 |
|---|---|---|---|
| 1 RegisterValidator | 旧 Ed25519 签名，两个 PQ authority slot 必须空 | 新 A、B 两签都必需 | 首次 epoch=1、sequence=1 |
| 2 RotateValidator | 当前 active A、B 两签都必需，旧 Ed slot 必须空 | fresh A、B 两签都必需 | epoch 必须当前 epoch+1 |
| 3 RevokeValidator | 当前 active A、B 两签都必需，旧 Ed slot 必须空 | 都必须空，新 keys 也必须空 | terminal tombstone，涵盖最新已登记 epoch（含 pending） |

授权与 PoP 域不同，不能把 PoP、共识 vote signature 或新钥单签当旧 authority 授权。不对任何分支省略验证，不提供 classic/new-key-only fallback。

本包只导出待签完整消息和验证/codec；没有新增生产 raw signing API。真实测试通过包内 test-only 代码使用三代独立真实 keypair 签这些域；既有 CandidateKey、Signer、HRS 与签名保留规则不变。将来 key ceremony/客户端的登记签名入口需单独接入授权流程，不能用另一个 consensus HRS 文件绕过已有 signer。

## 3. Canonical E 字节契约

`E(f0,...,fn)` 为每字段 `U32BE(length) || field` 的顺序连接，无 field-count、无 padding。所有普通整数为 4 B big-endian；每个 uint64 为 **两个独立 E 字段**：`U32(high32), U32(low32)`。高度也是此格式，但必须在 `[1, MaxInt64]` 内。以下域字符串的 `\0` 表示末尾一个 NUL byte，不是两个可见字符。所有外层/内层拒绝未知版本、额外字段、截断、错误整数宽度和溢出。

Intent 共 22 个字段，次序冻结：

| index | 字段 |
|---|---|
| 0 | `YNX-CONSENSUS-KEY-INTENT/v1\0` |
| 1 | RegistryVersion U32 = 1 |
| 2 | Kind U32 = 1/2/3 |
| 3 | 完整 GenesisID 32 B |
| 4 | 完整 ChainID UTF-8 |
| 5 | 稳定 logical ValidatorAddress 20 B |
| 6,7 | Sequence high/low U32 |
| 8,9 | AuthorizingEpoch high/low U32 |
| 10,11 | Epoch high/low U32（撤销时为 through/latest registered epoch） |
| 12,13 | ApprovedAt high/low U32（exact execution H） |
| 14,15 | EffectiveAt high/low U32 |
| 16 | PreviousEventHash 32 B（首次全零；后继恰等于该 logical identity 上一完整 event hash） |
| 17 | 完整 LegacyEd25519PublicKey（首次 32 B，后继空） |
| 18 | 完整 AuthorityMLDSA87PublicKey（首次空，后继 2592 B） |
| 19 | 完整 AuthoritySLHDSASHA2256fPublicKey（首次空，后继 64 B） |
| 20 | 完整新 MLDSA87PublicKey（登记/轮换 2592 B，撤销空） |
| 21 | 完整新 SLHDSASHA2256fPublicKey（登记/轮换 64 B，撤销空） |

首次 AuthorizingEpoch=0；rotation AuthorizingEpoch 为 H 的 active epoch，Epoch=AuthorizingEpoch+1；revocation AuthorizingEpoch 为 H 的 active epoch，Epoch 为完整历史最新已登记 epoch，可大于当前 active epoch。

授权签名字节：`E("YNX-CONSENSUS-KEY-AUTH/v1\0", U32(1), fullIntentWire)`。

新钥 PoP 签名字节：`E("YNX-CONSENSUS-KEY-POP/v1\0", U32(1), fullIntentWire)`。两支均覆盖相同完整字节，不以 intent hash 代替消息。

Operation 共 8 字段：`E("YNX-CONSENSUS-KEY-OP/v1\0", U32(1), fullIntentWire, legacyApproval, authorityA, authorityB, possessionA, possessionB)`。各 slot 必须严格符合上表长度，包括必须为空的 slot。这里使用 raw fixed-suite signatures，不借用普通 consensus Envelope 的 epoch/purpose。

`EventHash = SHA256(E("YNX-CONSENSUS-KEY-EVENT/v1\0", fullOperationWire))`，包含全部原始签名。即使同一个 intent 采用另一组合法随机签名，它也是不同的 exact operation；不能用它覆盖已入历史的 event。

## 4. 高度、序列与终端撤销

- 首次/轮换/撤销均精确批准于 intent.ApprovedAt=caller.executionHeight=source.Height=H。`H <= MaxInt64-2`，`EffectiveAt >= H+2`；这是 key/membership 生效边界，独立于 Comet params 的 H+1 规则。
- 同一 logical identity 的 sequence 从 1 连续加一、previous hash 连续；跨 identity 的全局 event 顺序须按 execution height 非递减。错误高度重放、缺前驱、序列跳跃/溢出均拒绝。
- 同一 identity 同时最多一个 pending key 轮换；下一轮换必须待上一 key 已 active，且由该当前完整 pair 授权。
- terminal revoke 可由 H 的 current active pair 撤销已经登记但还 pending 的下一 epoch。它必须签 through/latest epoch 和最新 previous event hash。revoke effective 之后所有 epoch 均不可用，包括未曾 active 的 pending pair。
- 一旦 tombstone 被追加，即使其 EffectiveAt 尚未来到，也不再接受该 identity 的登记/轮换/第二次撤销。历史 H < revoke effective 仍查询原 lawful key；`HasPQHistory` 永久为 true，禁止解释成 classic 复位。
- 首次登记尚 pending 时没有 active PQ authority，因此本版不能撤销它；不为此增加旧 Ed25519 或 proposed-key fallback。未来如果需要独立治理/恢复机制，必须另立授权协议。
- 删除旧 keys、改写旧 valid-from、原地关闭旧记录都不允许。`ConsensusKeysAt` 从 immutable events 派生 half-open 有效区间 `[from, until)`；rotation/revocation 只影响该查询的派生 until。

撤销是 **key authorization** 的 terminal 结果；最终 ledger/engine 还需原子安排 voting-power removal/update、处理 proposer/validator set、保留重放所需历史。纯 registry 不暗中修改 membership 或保证共识活性。

## 5. Candidate logical PQ public key

`LogicalPublicKey` 不实现 stock `crypto.PubKey`，没有 VerifySignature/GetPubKey 或私钥回调。其 bytes 为 12 个 E 字段：

`E("YNX-CONSENSUS-LOGICAL-PUBKEY/v1\0", U32(1), genesis32, chainID, logicalAddress20, epochHi, epochLo, validFromHi, validFromLo, originalRegistrationEventHash32, fullPKA, fullPKB)`。

登记 event hash 固定该 epoch 的最初完整批准记录，validFrom 不因后续撤销重写。当前有效性由 `AuthenticatePublicKeyBinding(wire,height)` 对 trusted KeyHistory 在该高度的精确 canonical bytes 比较决定；只是 Decode 成功没有授权。未来 fork 必须把完整 binding 纳入真实 proto/validator hash，并在可信历史上下文核准，不能拿 peer 随意附带的 logical address 当真实 validator identity。

## 6. History root、完整恢复与资源边界

空历史 root：`SHA256(E("YNX-CONSENSUS-KEY-ANCHOR/v1\0", U32(1), genesis32, chainID))`。

每追加一条全局 event：`newRoot = SHA256(E("YNX-CONSENSUS-KEY-HISTORY/v1\0", U32(1), previousRoot32, EventHash32))`。

Snapshot bytes：`E("YNX-CONSENSUS-KEY-SNAPSHOT/v1\0", U32(1), genesis32, chainID, U32(eventCount), operationWire0, ..., operationWireN-1, root32)`。

导入要求 caller 提供 **独立已认证** 的 anchor+expectedRoot；wire 自带 root 不授予信任。恢复依次重验每个 event 的原始 membership H、真实 old/current authority、真实双 PoP、序列/前驱/freshness/H+2/终端规则，最后核 root。完整 root 阻止删除、重排、替换/改写 event 后自行宣告新状态。membership source 必须能提供原历史，不能拿今天的 set 替代已移除 validator 的旧资格。

边界：intent ≤8 KiB，operation ≤128 KiB，logical binding ≤8 KiB；先检查输入长度和字段长度再复制。snapshot 导入 `HistoryIngressLimits{MaxBytes,MaxEvents}` 必须显式为正；在分配事件列表前核整体 bytes、count 上限、以及输入能容纳至少 N 个完整双签 proof。Replay 的 [][]byte 参数已由 caller 创建，caller 须先限制其外层解析；二进制 snapshot decoder 实现该前置界限。

不设全链永久 64 MiB/4096 等小累计 admission 硬帽。snapshot 的 MaxBytes/MaxEvents 是一次 ingress/export 的资源预算；Append 的历史增长最终由 ledger 持久化/归档策略管理。本版纯实现每次 Append 复制 event 索引并保留完整 proof，重放逐条真验，不宣称其累计性能或可长期无界内存驻留；上线前持久层索引/归档及资源预算另验。

## 7. 已实现接口与集成义务

```go
NewKeyHistory(anchor RegistryAnchor) (*KeyHistory, error)
(*KeyHistory).Append(wire []byte, executionHeight int64,
    source RegistrationStateSource) (*KeyHistory, error)
(*KeyHistory).ConsensusKeysAt(chainID string, address []byte, height int64) (KeyRecord, error)
(*KeyHistory).PublicKeyBindingAt(chainID string, address []byte, height int64) ([]byte, error)
(*KeyHistory).AuthenticatePublicKeyBinding(wire []byte, height int64) (KeyRecord, error)
(*KeyHistory).Root() [32]byte
(*KeyHistory).EventWire(index int) ([]byte, error)
(*KeyHistory).MarshalSnapshot(maxBytes int) ([]byte, error)
DecodeKeyHistorySnapshot(wire []byte, anchor RegistryAnchor, expectedRoot [32]byte,
    source RegistrationStateSource, limits HistoryIngressLimits) (*KeyHistory, error)
```

`RegistrationStateSource.ConsensusRegistrationStateAt(genesisID,chainID,address,H)` 必须返回一致、detached、可信的 GenesisID/ChainID/ValidatorAddress/Height、正 VotingPower；首次还须 LegacyEd25519PublicKey。不存在可外传的 verified bool，source 不代替密码验证。

Append 拒绝 exact duplicate；ledger 的 UNKNOWN/retry 必须查原 operation wire/hash 与原 durable receipt，而不能把 rejected retry 重执行成新登记。immutable predecessor 可用于构造候选，但 caller 必须在同一 ledger 锁/commit 下比较 expected root；若把旧 predecessor 当当前状态重放，则纯对象无法辨认其外部提交时序。选择最新 committed history、publication、root CAS、完整对象覆盖及 crash/UNKNOWN 恢复由后续 ABCI adapter 实现。

注册 proof 不授予 app account 权限、不表示 validator 当前仍有 voting power、也不替代 proposer 选择。普通共识验签调用者仍须按同高度可信 validator set/membership/params 执行所有 checks。历史 query 可以返回已离开当前 set 的过去 key，供 evidence/light 等历史验证。

## 8. 本轮验证与待办

新增测试源码覆盖 canonical U32 hi/lo 最大值、未知版本/kind、错误长度/overflow/trailing、三代真实 CIRCL keys、旧 Ed25519 首次 authority、每个双签分支损坏、完整字段/域替换、缺支/额外支、new-key-only 拒绝、可信 H/membership/source 不匹配、两支分别 fresh、H+2、pending 冲突、terminal revoke 覆盖 pending、历史保留、input/output alias、logical binding 篡改、完整 snapshot restart/root 删除改写、import 资源前置限制和既有共识 Verifier 查询接线。

本机只运行 gofmt 与静态差异检查；尚未编译或执行新测试。建议下一次远端 CI 聚焦：

```sh
go test -p 1 -count=1 -timeout=120s ./internal/ynxconsensusauth -run '^(TestRegistration|TestKeyHistory)'
```

这条命令本轮未运行。完成后仍须另验完整 `ynxconsensusauth` 回归；不由这两个命令推断 ABCI persistence、engine fork、transport、跨 genesis consensus message、BFT 多节点或部署完成。
