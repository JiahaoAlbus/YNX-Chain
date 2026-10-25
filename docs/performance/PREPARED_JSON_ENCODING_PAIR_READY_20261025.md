# 私有快照 JSON 编码器：有限四节点对照 READY

SOURCE `c14aee1e21894407cb09aff19ff26786e22eddf8` / CODE `4d016eb1e81f6093717dbb1c7732fdb132b8e30c`；普通 CI [40194100827](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/40194100827) SUCCESS，四节点步骤 skipped。冻结 tag `codex/chain-snapshot-json-pair-c14aee1e21` 已 exact remote 回读。

这是条件 READY，`executionAdmitted=false`、`rootGrantReceived=false`、`dispatched=false`。等 Root 新鲜资源窗口与新的 once grant；旧105129已消费，不复用，不自动重试。原普通 CI job121171862923于2026-10-25T12:49:16Z结束SUCCESS，原watch73894 exit0，原API/完整日志已封存。首版40193998392真实CLI检查失败及一行环境修复保留；没有删失败断言或冒用前版CI。

原 controller 的 `native-prepared-grouped-json-encoding` pair 可实际执行：before `original-json`，after `fee-time-json-indent`。只变私有 prepared snapshot encoder；同 SOURCE、同一新 Linux VM、一次构建同四个 ELF，两组 client GOMAXPROCS1、node1、submit8、observe4、grouped/prepared/currentreuse/replayTiming、original state hash，均2048发送者×4轮/8192实际签名输入。只在两组之间切 encoder，不能用旧 VM、client1→2或本地函数收益推断编码器网络因果收益。

32份冻结源码快照均与Git SOURCE全字节相同，15个reader冻结；六个string型workflow输入、原CLI/client/node argv、原四次build命令、实际构造路径标记与正数编码次数已绑定。最终ELF SHA/bytes/buildinfo目前null：新runner构建后现场记录并在每case前复核，两receipt必须相同；没有借旧产物摘要。

原guard全部保留：45秒active+15秒cleanup/case、60秒/case、120秒/pair；RSS1GiB、320线程、10个owned进程、private256MiB/case、retained512MiB/pair，以及原log/build/disk/memory/stream限额。client退出后2遍独立完整checker仍在原45秒内；post-fsync双launcher-only closure强制。首因、UNKNOWN、证据不完整或清理失败禁止after。签名、nonce、完整状态/手续费历史/完整bytes、锁序、持久化和default均不改变。

新runner容量未观测。队列快照近期20项无非terminal，只是调度元数据，Root须重核；不能替代现场 `/proc/meminfo`、statvfs与owned task检查。原 `--check-runner` 在四次build前运行；pair/case初始与200ms全窗持续采样。prebuild磁盘需求2626682880字节、pair初始3129999360、连续floor+root1519386624；MemAvailable floor1207959552。检查失败保留原错并拒绝激活/after。remote Linux only，本机A heavy无授权，整体job20分钟不变。

实际读数覆盖client供给/签名/编码/intent持久化/队列、reader gate及replay子阶段、私有快照normalize/jsonEncode/publicCopy，和节点Commit的validation/appHash/encode/write/fsync/checkpoint。全量8192逐笔join节点Finalize/durable Commit、首/第三/全部副本及client inclusion/final P50/P95/P99；子项不重复相加，memoryCommit不是落盘，第三副本不是按投票权BFT quorum形成时刻。最早BFT quorum形成瞬间尚未测得；本次有限对照不是600秒持续1000TPS验收。

证据：[固定READY索引](evidence/prepared-json-encoding-pair-ready-20261025.json)。request 10375B / SHA `71a1e5bb7ccd4da0065ee8ce597db38898fca625221ebc8bcd88044203b51b18`；60次完整引用校验、54条独立路径通过。源码JSON快照按原始源码字节冻结，不把其中历史文字中的路径解释为本次新证据依赖。小packet位于本owner worktree `artifacts/chain-performance-20261017/prepared-json-encoding-pair-source-c14aee1e21/`，大型原始日志和源码快照保留在西数既有owner目录。
