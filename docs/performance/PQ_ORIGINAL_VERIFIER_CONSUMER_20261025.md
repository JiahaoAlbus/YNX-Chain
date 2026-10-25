# 性能消费者接入原最终性验算入口

已实现并通过针对性轻测，未部署、未新跑四节点、持续 1000 有效业务 TPS 与 offer→finality 延迟尚未验证。

原 `cmd/ynx-consensus-perf-client` 的 N1 transfer 只读恢复现在可接既存 `cmd/ynx-consensus-proof-verify`。在原 `-pq-member / -pq-gateway / -pq-collect-proof / -pq-readback-only / -output` 参数之外，提供 `-pq-proof-verifier`、`-pq-proof-verifier-sha256`、`-pq-trust-context`、`-pq-trust-context-sha256`。两条路径和 SHA 都是独立 host/operator 输入；不由 RPC 生成，不扩展信任框架。该组合必须只读，不能重新提交。

消费者保留原交易字节，检查 host context 的完整 envelope/native wire/hash、type、H/index 与原观察一致，再将原 context 内的 expected 和原 collector 的 proof 交 unchanged verifier stdin/flags。原 verifier 负责完整 context schema、原文件加载、独立 light anchor、H/H+1、双 PQ 共识及交易执行证明校验。客户端不签名、不建 allowlist、不提供 Root 或测试资金。

只有原程序成功且完整 typed result 为该原交易 included/finalized/executionSuccessful、零错误 code、两次 commit/light transition 均通过，才标记 `independentFinalityVerified=true`、`effectiveBusinessFinalized=1`。返回字节另存 O_EXCL/0600 的 `.pq-verification.json`，文件及目录 fsync，报告记录 SHA、verifier SHA 和 context SHA。缺材料、程序失败、超时、错目标、执行证明篡改都保留失败，不重发。原二进制/context 在调用后按独立 SHA 复核。

总验算耗时与准备、子进程、证据落盘、结果复核分别记录。实测本机受控签名夹具一次为总 624.417ms、准备265.129ms、原程序256.817ms、证据落盘4.693ms、结果/文件复核97.741ms；子阶段与总耗时不能重复相加。此数不是业务最终确认延迟。恢复 invocation 没有原 offer 时钟，`actualOfferToFinalityMeasured` 和 `sustainedTPSQualified` 保持 false。

验证沿用原 `TestPQConsensusTransactionProofPublicFixture`（4.198s）：真实双 PQ 签名、标准 Comet BlockExecutor/BlockStore、独立测试信任文件；syntheticOnly=true、actualCometNode=false，无公网/账户/资金授权。12 个顶层客户端 race 测试通过10.462s；随后把正例接到生产 execute 入口的差量测试通过4.419s，实际0POST，篡改执行证明由原程序拒绝。原 CI 增加同一有界夹具producer/原verifier build并供给客户端测试，避免把缺夹具skip算成功。

CI40207382388 的客户端与控制器组已通过，整轮仍因 canonical core 两处 alias 位置字段 go vet 失败。现仅消费 canonical f1bb10bb1 对 `internal/consensus/pq_wallet_query.go` 的两行修复，形成 f069b0898；修复前 blob 一致，本地 go vet ./internal/consensus 已 PASS。未整入其他 main 合流，未删门。

[原始证据及硬件条件](evidence/pq-original-verifier-consumer-20261025.json)。下一步跟进正常 CI，消费真实隔离节点的独立 host context/target；在 Root 新窗口内做有界四节点与同条件对比，测 offer→入块→最终确认，逐级推进至少十分钟1000有效业务TPS验收。
