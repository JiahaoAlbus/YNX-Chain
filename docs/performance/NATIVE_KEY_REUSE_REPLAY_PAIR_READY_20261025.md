# 公钥复用源码：有限四节点对照 READY

SOURCE `f2ffa01ba006a8a2aba3ca3a9f09b04311857731` / CODE `e7beff99ac8b4e19efa83e5d6a5f4198182cdf9e`；普通CI40185564279已SUCCESS，四节点步骤skipped。remote冻结ref `codex/chain-native-key-reuse-replay-pair-f2ffa01ba0` 已exact回读。

这是条件READY，`executionAdmitted=false`、`rootGrantReceived=false`、`dispatched=false`。必须等Root新鲜窗口及新的once grant；不继承旧授权、不得自动重试。UNKNOWN先恢复原远端结果。原slot：普通CI job121145501300于2026-10-25T10:43:57Z结束SUCCESS，原watch68616 exit0；旧401832仅为Root既有接受上下文，未重读、下载或重跑。

沿用原 `native-prepared-grouped-replay-timing` pair：两case均diagnostictrue/prepared/current-input-reuse8/grouped-cadence4；2048发送者×4轮、每case8192、8提交者/4观察者、节点GOMAXPROCS1/原state hash。唯一变量仍为客户端GOMAXPROCS1→2。新公钥解析修复位于两case共同SOURCE；本次pair只能比较新SOURCE上的客户端核数，不能用旧VM结果推断修复因果收益。本机Verify7.90%仍仅函数收益。

同一新Linux VM、同SOURCE，一次构建四个ELF；新build实际SHA/bytes/buildinfo现在仍未知，构建后必须记录并在每case前复核一致，两case原receipt均须匹配。没有复制旧ELF摘要。六个string输入、JSON stdin、客户端/节点argv、14个冻结reader和构建合同均已绑定。

所有原guard不变：45秒active+15秒cleanup/case总60秒、pair120秒；采样RSS1GiB、320线程、10个owned进程、case private256MiB/pair retained512MiB、原log/build/stream限额；client退出后两遍独立完整checker必须在原45秒内完成，post-fsync双launcher-only closure。首因、UNKNOWN、原证据不完整或清理失败禁止进入after，不能删失败测试或降低验签/nonce/手续费/完整状态/BFT/持久化要求。

## 新鲜远端准入

新runner未分配、容量未观测；队列快照不是内存/磁盘容量。原`--check-runner`在四次go build前读实际/proc/meminfo/statvfs/owned tasks，随后pair及每case初始sample、200ms全窗持续检查。由精确原CAPS导出：

- prebuild磁盘floor+root+compile+private32MiB：2626682880字节。
- pair初始磁盘floor+root+compile+retained512MiB：3129999360字节。
- 连续磁盘floor+root：1519386624字节。
- MemAvailable下限：1207959552字节。

原新Linux现场检查失败必须保留原错并拒绝激活/after；Mac压力、旧runner容量和旧空闲快照均不能替代。remoteLinux only，本地A heavy未授权，整体job20分钟不变。

将报告实际offer/有效入块/最终确认速率、错误/UNKNOWN/积压/CPU/RSS，保留本地reader replay全部children、节点Commit编码/写入/fsync/checkpoint子项，并全量恢复原公开成员、8192逐笔join节点Finalize/durable Commit及首/第三/全部副本P50/P95/P99。local memoryCommit不是磁盘；第三副本不是按投票权BFT quorum形成时刻；子项不能重复相加。没有600秒持续1000TPS验收。

证据：[固定READY索引](evidence/native-key-reuse-replay-pair-ready-20261025.json)。唯一request为20709B / SHA `bb09af5bb9ec7dbec1eeb85a01d5d7e68b777fafafa276a00fc242ad084e2cf3`；validation1189B / SHA `80fa3a7c9cad36118dd18334125b3c394dfdabf981e6d24fed23379570f62bdb`，53次exact reference检查、30条独立路径、14文件与GitSOURCE一致。小packet在本worktree `artifacts/chain-performance-20261017/native-key-reuse-replay-pair-source-f2ffa01ba0/`；large同名目录在西数 `chain-performance-20261017/`，没有旧run原数据读取。
