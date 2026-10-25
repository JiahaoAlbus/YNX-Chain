# PQ 客户端分阶段计时与原证明收集

当前状态：源码与针对性轻测已验证，未部署、未执行新四节点压测、未证明持续 1000 有效业务 TPS。

原性能 CLI 现在在实际生产调用路径记录单调时钟耗时：输入读取与 canonical 解码、原签名 intent 创建/编码/文件及目录同步、提交 HTTP、提交响应身份校验、原交易查询 HTTP、原查询响应校验、证明 HTTP、collector 身份校验、原始证明响应文件及目录同步。HTTP 包含服务端等待，不能据此拆出节点的 Commit 编码、write、fsync、BFT 形成时间。`observationElapsedNs` 只覆盖提交与原查询，不包含输入持久化或随后证明收集；阶段耗时与总耗时不可重复相加。

`-pq-member <original-member.bin> -pq-gateway <isolated-gateway> -pq-collect-proof -output <new-report.json> -timeout 5s` 使用现有 `GET /txs/{ABCIhash}/pq-finality-proof`。当前原 collector 调用仅适用 Native N1 transfer；Whole 或开户与该选项组合会在提交前拒绝，不虚构第二个接口。

原始 bounded 响应按字节保存至 `<new-report.json>.pq-proof.json`，使用 O_EXCL、0600、文件及目录 fsync，并在报告记录 SHA256/字节数。pending、错交易/高度/index、RPC 自称独立 finality 均保留响应并报告失败，已有 committed 交易观察仍保留；证明失败不能触发重发。恢复使用 `-pq-readback-only` 和新报告路径。

`collected_unverified` 只表示 collector 身份匹配且原始材料已持久化，不验证内部证明，不计最终确认 TPS。后续应将原 proof 与独立 host 选定的目标交给既存 `cmd/ynx-consensus-proof-verify`；该入口要求正常 `--trust-context` 和外部 `--trust-context-sha256`，不得从 RPC 响应生成信任或目标。当前缺少真实 host 供给，独立 finality 与持续 TPS 标记保持 false。

10 个顶层 race 测试（包含三个真实 main CLI 子进程）通过，7.842s。新增用例实际注入有界 HTTP 等待，核对分段计时、原始证据 SHA 与字节、重复运行和只读恢复不重发，并将 collector 单元对象交 canonical verifier 确认缺独立信任不能通过。它们是受控本机测试，不能当作多节点业务吞吐或确认延迟。

上一提交 caf16fa62 的正常 CI40202828126 首因是 canonical core 的 `pq_wallet_query.go:205/208` 跨包 alias 位置字段未通过 go vet，已交原 Protocol/core owner 修复；保留原检查，不放宽 vet。

原始命令、SHA 与边界：[证据](evidence/pq-client-phases-proof-20261025.json)。下一步消费原 owner 修复，接正常独立 host trust/target 与同源新账户测试资金材料，在 Root 安排的隔离四节点窗口采集业务入块和最终确认数据。
