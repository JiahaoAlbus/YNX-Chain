# Ordinary consensus genesis-boundary regression R1

状态：新增预期失败的真实密码/冷启动测试源码，**尚未执行，不称为已取得 RED**。须与已冻结 registry 源码单独安排远端波次；不要混进 registry 首轮本应绿色的全包运行。

依赖：`CONSENSUS_PQ_KEY_REGISTRY_SOURCE_R1.sha256`（manifest SHA256 `4a3933350409d989813ac5ac2057bddaf51cc09e011ab782961e91d3e87c6979`），既有 v1 `Request`/`Policy`/`Signer` API。测试没有调用未实现的新构造函数，也没有靠编译错误制造失败。

`TestConsensusGenesisBoundaryReplayRejected` 固定同一个 chainID、logical address、完整 ML-DSA87+SLH-DSA-SHA2-256f pair、epoch、H/R/step 和 vote 的所有字段；在两个不同 genesis32 anchor 中分别取得真实旧 Ed25519 authority + 双 PoP 的独立登记。各自 history root 不同，A 的 logical key binding 在 B 被拒，先证明 registry 的 genesis 门有效。

普通 vote 使用现有 durable `Signer.Sign`。正例控制包括 A 上真实双验、冷启动 A 后原签名字节重试不变、同 HRS 不同 BlockID 被拒。之后两条回归断言要求：

1. B 的现有 Verifier 拒绝 A 的普通 vote signature。
2. A 的持久 HRS 文件不能以 B 的 Registry 冷启动恢复，且失败不能改写原文件。

目前源码阅读显示 `Request.SigningBytes` 和 `signerState.Policy` 都没有 genesis32，预计这些断言会失败。只有实际远端日志能将预计变成 RED；若 setup/正例控制失败，应先修测试或真实问题，不能把它称为此边界的成功复现。

建议远端精确命令（本机未运行）：

```sh
go test -p 1 -count=1 -timeout=120s ./internal/ynxconsensusauth -run '^TestConsensusGenesisBoundaryReplayRejected$'
```

取得真实 RED 后才另作版本化修复：完整 genesis32 进入普通 proposal/vote/extension 签名字节、policy/network identity 与持久 signer state；恢复阶段在任何 reconfirm write 前核网络、版本和原 HRS。旧候选存储缺失 genesis 时 fail closed 并保留文件，不猜测网络、不 reset、不通过重新建文件消除 UNKNOWN。历史高度的原 canonical 验证仍保留，但必须在匹配的可信网络上下文内。

此回归不修改原 YNX-BATCH v0.1，也不表示完成固定 Comet fork、PubKey/proto、remote signer、light client、多节点或公网切换。
