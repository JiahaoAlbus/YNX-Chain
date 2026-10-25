# 原开户证明消费者

已实现并验证开户原collector的生产消费路径；开户的离线CLI独立证明验证尚待canonical owner补齐原枚举与同源公共夹具，不能冒完整开户最终性通过。

`-pq-register <original-member> -pq-collect-proof`现在接已有 `/txs/{ABCIhash}/pq-finality-proof`，与原账户登记及original readback组成同一身份链。检查原hash/H/index、collector source/status，保留bounded原始响应/SHA；错高度失败不覆盖原证据。`-pq-readback-only`恢复不发送POST。没有新增网关接口、修改core或限制initial Member为N1（合法N/index仍由canonical decoder处理）。

登记即使将来经原独立verifier确认成功，也只记 `registrationFinalized=true`，`effectiveBusinessIncludedObserved` 与 `effectiveBusinessFinalized`都保持0；不得把开户或准备资金计入1000有效业务TPS。业务transfer的既存成功计数仍为1。共享原离线verifier消费者保持独立context/executable SHA和exact原字节/目标，未从collector制造信任。

针对性race测试PASS1.983s，原规范双PQ签名的持有证明真实验证，但HTTP是单元collector观察：测试验证birth不计业务、不冒finality、恢复不重发、错高度拒绝。没有把这个unit对象当共识证明。

实查canonical core已在 `pq_transaction_proof.go` 接入 `PQInitialRegistrationType`，初始账户原source测试也已通过独立直接verifier。但原 `cmd/ynx-consensus-proof-verify/transaction.go` 的decodeTransactionExpected枚举仍漏initial，已交原Protocol owner补原枚举，同时索取现有 `YNX_PQ_INITIAL_FUNDED_FIXTURE_OUT` 公共材料准确路径或原producer初始账户case。本线程不修改其proof CLI/core，不自造Root/allowlist/funds，不以这项缺口停其他源码。

[命令路径、原测试及边界](evidence/pq-initial-proof-consumer-20261026.json)。下一步消费原owner精确差量和原signed public case，验证开户最终确认仍计0业务，再衔接普通测试资金转账的真实阶段延迟与Root四节点排程。
