# 私有 prepared snapshot 编码器单轴对照

CODE `c6521f78d583209277c97894cd2ef0a1858c312d`；源码及轻测通过，尚未执行四节点网络对照。此前 fee/time JSON 优化的本地收益仍只具有本地函数范围，不能据此声明网络吞吐提高。

沿用原 controller、reader 和 CI，增加显式 `native-prepared-grouped-json-encoding` pair：before 为 `original-json`，after 为 `fee-time-json-indent`。同一 SOURCE、四个 ELF、Linux VM；两组固定 client GOMAXPROCS1、8 submitters、4 observers、grouped-cadence4、prepared/currentreuse/replayTiming，state hash 保持 original。只在私有 snapshot 构造时选择 encoder；完整字节、独立副本、锁序、持久化、签名、nonce、手续费历史与原限额保持。

selector 绑定 CLI、plan、实际 decoder constructor getter、真实正数编码次数、report、worker selection 和原 archive reader。未选择该诊断时旧标记省略；原 11 种 pair recipe 与已接受源码逐项相同。混入 client2/hash candidate、伪造标记、零工作量、错误计数、改变 plan 或 constructor 的输入拒绝。

本轮真实签名各 102 笔、Commit/reopen/nonce 拒绝、race、取消保全、两种真实 CLI setup failure、未知 CLI encoder 拒绝已执行。公开两流完整验签读取通过；controller 101 项通过（2 项平台条件跳过），pair 47、archive 23、source guard 26 项通过。archive 初跑缺 fixture 的失败日志保留，补本轮真实 fixture 后通过；未伪装为零跳过。

原 45s active+15s cleanup/case、60s/case、120s/pair、RSS1GiB/threads320/process10、private256MiB/case/retained512MiB/pair、原 log/build/disk/memory/stream bounds 不变。client 退出后两遍独立完整 checker 仍计入原45s；post-fsync 双 launcher-only closure 仍强制。首因/UNKNOWN/不完整证据/清理失败禁止 after。新 workflow choice 已准备，但只在 Root 核新窗口与 once grant 后运行；旧105129已消费，不复用；本机 heavy 未获授权。

普通 CI 完成后另封固定 SOURCE/ref/CI 的单次条件 READY。目标仍是持续有效1000TPS及真实入块、最终确认延迟；本次有限每组8192输入不等于600秒持续验收。最早按投票权 BFT quorum 形成时刻仍须区分节点 Finalize、durable Commit 和客户端观察，不能以第三副本替代。

证据：[源码与轻测索引](evidence/prepared-json-encoding-pair-source-20261025.json)。大型原始日志保留在西数既有 owner 目录。
