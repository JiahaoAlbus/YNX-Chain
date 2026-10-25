# 新协议 Whole 有界业务客户端

本owner在独占`chain-batch-v01-performance` worktree，基于Protocol冻结SOURCE `b777232db1701d1e7cb41bd6e0bbe55452664c8d`，接入原性能客户端正常CLI：`-pq-whole`、`-pq-gateway`、`-pq-readback-only`。只消费canonical已签Whole，不另造签名器、协议DTO、账户批准或endpoint，不修改internal协议叶。

实际callee为 `ynxbatch.DecodeWhole` / `ynxauth.DecodeTransfer` / `consensus.EncodePQTransaction(PQWholeType,wire)` / `chain.PQBatchTransactionHash`，并使用原 `bftgateway.PQWholeView` 与POST `/transactions/pq/batches/broadcast`、GET `/transactions/pq/wholes/{ABCIhash}`。新的Whole入口先于classic execute路径，不进入sender_pool的secp256k1 `NewSignedTransfer`。原生hash与ABCI envelope hash分开；每个结果必须对应canonical成员哈希和顺序，partial Whole只计admitted业务数。

真实canonical ML-DSA-87 AND SLH-DSA-SHA2-256f签名输入及两分支各自损坏反例、一次POST与UNKNOWN原hash只读恢复、307不可重POST、意图保全/重复output拒绝、partial业务计数、真实main CLI子进程共4项race轻测通过。正常执行前持久化原signed intent，现有输出不能复用。HTTP RPC测试明确只是本地消费契约测试，不伪造节点/BFT最终性。

RPC返回的committed只记录`configuredRPCObservationOnly=true`，独立最终性和持续TPS仍false。下一实际接线消费canonical `PQFinalityView`/`PQTransactionProofRequest`并调用 `VerifyPQTransactionProof`，信任输入必须来自normal trusted host，不能从collector或submitted wire自行授信。新账户allowlist/birth由Protocol原owner供货，未accepted的部分不冒可用；旧资产迁移不作为消费者源码前置。真实新账户链路/测试网窗口尚未执行，不能把N成员伪成N条Comet交易或把Devnet durable当入块。

仍存在的旧ECC调用分域：legacy性能sender_pool/fixture仍是secp256k1测试基线；main里的Ed25519用于旧Comet共识证明；它们没有被新Whole入口用于交易签名或最终性冒报。新协议最终性接原PQ verifier后再替换该域，不能删验证假装完成。Go TLS/外链标准与交易批签分别处理；本owner不碰聊天ECDH。原classic401954只保必要失败/阶段耗时/完整原数据收尾，不再循环重压。

本次边界仅性能client及必要原CI。证据：[源码与轻测](evidence/pq-whole-case-source-light-20261025.json)。本地没有新heavy，多节点准确READY尚需canonical新账户供货、独立信任入口和Root新窗口。
