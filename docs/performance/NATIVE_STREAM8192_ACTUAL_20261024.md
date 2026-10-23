# 原四节点8192笔实测，2026-10-24

本次完成8192笔有效业务入块及最终提交，客户端完整测量窗口27.616621710秒，均为296.632951笔/秒。配置1000offer/s，实际offer事件间隔速率310.342122笔/秒。最终确认观测P95在1.624–1.625秒；本次负载没有持续达到1000笔/秒，也不是同条件前后对比。

原run [40026609226](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/40026609226)，attempt1/SUCCESS。准确源码 `c06b56ccf371a096614238e78439ac7b06c8cfff`，不可变tag `codex/chain-native-stream-small-c06b56ccf`，原普通CI40024869115通过后，由Root一次grant执行。仅隔离临时账户/数据/loopback节点，未压公开链。

| 条件 | 实际值 |
|---|---|
| 硬件 | AMD EPYC9V45，4logical CPU |
| 共识/进程 |4CometBFT0.38.23 +4ABCI，原4ELF/source/VCS校验通过|
| 业务 |2048临时账户×4轮nonce，transfer amount1/fee1，8192笔|
| 发送/观察 |8submitters/4observers，ready-pool/relative，队列2048|
| 环境 |GOMAXPROCS1/GOGC100/GOMEMLIMIT off，节点与客户端一致|
| 有效入块/最终提交 |8192/8192，均296.632951/s，按完整客户端窗口|
| 实际offer/submit事件速率 |310.342122/309.279339/s，按各自事件间隔，不代替完整窗口TPS|
| 完整case |34.077s，含生成、启动、Go/控制器读回、cleanup及receipt fsync|
| 业务拒绝/失败/UNKNOWN/超时 |0；观察失败/未提交也均0|
| 瞬态观察记录 |57174次：block_scan_wait57121、local_durable_readback53；重复次数按原error.count累计，不是57174笔业务失败|
| 采样峰值 |RSS1028100096B、67threads、逻辑私有文件127758578B、build119068924B|
| reader预算 |输入缓存21777128B，0evictions；per-store32MiB/cache64MiB保留|
| 队列峰值 |offered-awaiting-submit42，accepted-awaiting-observation741，in-flight账户768|

RSS为采样观测，非cgroup硬峰值；privateBytes按原stat.st_size逻辑留存字节加receipt计量，空闲物理块由statvfs独立约束。没有把Mac空闲当作native Linux容量。

## 延迟与各阶段真实耗时

以下从客户端offer起算，使用全部8192条原终态重算的1ms直方图闭区间；表中秒值右端向上取整展示。它们是已认证业务入块及BFT/quorum、持久状态/Info核验后的客户端观测时间，不是内部投票瞬间。

| 观测延迟 |P50秒|P95秒|P99秒|
|---|---:|---:|---:|
|offer→有效业务入块|1.089–1.090|1.447–1.448|1.660–1.661|
|offer→最终确认|1.283–1.284|1.624–1.625|1.887–1.888|

逐笔先相减再汇总的平均阶段分别为：队列17.912ms、CheckTx12.533ms、CheckTx→观测入块1028.653ms、观测入块→最终确认189.805ms。不能用两个P95相减，也不能把observer/CPU/node累计时间相加为最终确认延迟。

| 原主发送器耗时 |累计秒|覆盖|
|---|---:|---:|
|pacingWait|23.475728|8192offers|
|其中正间隔余量|7.948456|8080future targets|
|其中定时唤醒迟到|15.527179|max60.806116ms|
|签名|0.519950|6144successors|
|编码|0.953887|6144successors|
|签名意图持久化|0.566601|128批/8192envelopes|
|终态sink|0.747721|8192records/128sealed segments|
|等待新nonce供应|0|0attempts|
|最终排空等待|1.204883|8attempts|

客户端CPU17.438202秒，占一个核63.143842%。callback忙时102.681498秒跨8worker重叠，不能加到客户端wall。prefix replay119次/8.118688秒，其中private native clone116次/0.442294秒、完整private Validate116次/1.737064秒、suffix replay30次/2.115132秒、certificate publish33次/1.674893秒。原Go完整证据读回1.547358秒，控制器完整读回0.569039秒，两者均计入case预算，未伪装进CPU bracket。

## Commit编码与落盘

四份原ABCI日志共有152次Commit，下面仅取33个业务高度×4节点的132次Commit；空块启动/排空样本保留在证据，未混入此表。单位ms，来自原逐Commit原始时间，不是相加的分位数。

|业务块Commit阶段|平均|P95|
|---|---:|---:|
|Commit整体|23.793343|46.347951|
|完整Validate|19.515868|32.227181|
|其中app_hash|12.362803|21.638319|
|其中semantics|7.084488|11.588647|
|delta_encode|0.140516|0.249057|
|write|0.181494|0.231450|
|file_sync|0.852951|2.688925|
|journal_maintenance|3.032033|25.908167|

validation子项已经包含在Validate/Commit中。当前编码与file_sync不是本次低offer的主要解释；native私有复制也只有0.442秒累计。主发送器的正间隔外唤醒迟到15.527秒，且从未等待新nonce供应、in-flight峰值768低于2048上限，因此下一改动优先接入原有有界cadence补偿，并保留四offer上界及长停顿丢弃规则。节点CPU/GC的独立归因未采集，不能仅凭这些wall totals声称纯CPU或磁盘饱和。

## 原始证据与闭合

原artifact12533112601共49331677B。第一次恢复遵守硬60s退出，保留首因/cache/已恢复成员；Root明确允许同immutable artifact、同ETag、原cache每次原60s只续尚缺只读Range。前三次timeout原样保留，第4次新增720896B后完成274公开成员/21124097decodedB。没有重发native、重取已验证HTTP块、清cache、换artifact或扩限，也未计算整ZIP哈希。

全部128intent/128terminal、8192签名身份及latest2048slots、六组Go latency及额外逐笔gap/offer-inclusion区间与原receipt逐项一致。四份Comet日志的33业务高度交易数、FinalizeBlock后AppHash及后一高度Header承诺，与全部8192终态和四份ABCI日志一致。锁定Comet0.38.23的`state/execution.go:443`在committed-state日志打印`block.AppHash`，承诺前一高度状态，故按后一高度校验，未误当同高度post-state。

原receipt SHA256 `b13bee278f39e5a50ea6df40dcaee4b05ba4f8d25e4f7660731ca701c00a6637`；原完整CI log652890B SHA256 `dbaadea1b809b4b7f6e90c229d7aac27bbaced9d38339e69fd2a53952098f2be`。原资格读回75423B SHA256 `82a254c6368495966f7b8404c6116ed1080f7ea5967633ea88df2340870f8143`，portable归档reader重现相同字节。

全部8个node进程spawn完毕标记为UTC21:30:13.305680086，早于Root截止21:53:15.767155。这是首node开始时间的上界，未单独记录首node精确瞬间。receipt后两次原生扫描均仅保留launcher38721/startTicks50653；nodes/worker已闭合，原workflow成功退出。未冒称直接proc观察到launcher退出或整个进程组为空。原grant已消费，不能再发。

[完整实测、分位区间、逐秒数据、ELF与原文件哈希](evidence/native-stream8192-run40026609226-actual.json)。[可复跑原case资格reader](evidence/native-stream-original-case-reader-20261024.py)接收source-context、capture、原log、terminal-run.json和新output；[逐块/phase reader](evidence/native-stream-phase-block-reader-20261024.py)接收已核验root和新output。原Root授权与冻结readers在本owner原artifact上下文保存。

候选bounded-cadence目前只有CODE/轻测证据；relative仍是默认。后续必须在同VM/同4ELF/相同8192业务与资源限制下做relative→bounded的顺序比较，并重新取得Root exact once grant。本次不是1000TPS、10分钟稳定性或matched A/B验收。
