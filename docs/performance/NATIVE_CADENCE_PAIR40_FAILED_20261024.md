# 四节点 pair40 run40037942357：真实失败与阶段耗时

冻结源码 `d6fb96d3ef08ac25e755695cba1a3701d3a8a244` 的 relative 首侧触发原 40 秒客户端期限；第二侧未启动。它不是完整 8192 笔成功实验，也没有前后对比结论。硬件为 AMD EPYC7763、4 logical CPU，不能与另一 VM 的历史结果作优化归因。

## 原报告与完整性边界

|字段|数量|
|---|---:|
|input|8192|
|offered|7936|
|submitted|7933|
|checkTxAccepted|7928|
|includedCodeZero|7806|
|effectiveBusinessIncluded|7665|
|quorumConfirmed|7806|
|finalSubmitted|7665|
|submissionUnknown|5|
|timedOut|263|
|notSubmitted|259|

失败报告窗口 39.445918858 秒，部分有效 final 194.316680/s；实际 offer 事件间隔速率 201.728386/s。不能据此宣称完整负载或稳定 TPS。保留所有 UNKNOWN/timeout/未提交记录，不重放。

## 读回竞争与节点 Commit

原 readerGate 累计 wait 21.497046268s、hold 20.360420236s。累计 decode 约18.029s、prefix private Validate约4.167s、private clone约0.950s。这些嵌套阶段与并行等待有重叠，不能相加作为关键路径。

以下来自原四份 ABCI 日志，按有已确认业务观察的47个高度筛选，共188次 Commit，单位 ms：

|阶段|平均|P50|P95|P99|
|---|---:|---:|---:|---:|
|commit|40.179408|36.831245|78.111973|122.291194|
|validate|36.257819|34.467079|67.342451|82.307402|
|validate.app_hash|24.005828|22.791082|47.251719|56.235977|
|validate.semantics|12.183617|11.369723|23.089282|29.014560|
|delta_encode|0.184757|0.121358|0.254596|2.627709|
|write|0.134808|0.126597|0.200024|0.418443|
|file_sync|1.081255|0.616124|3.317681|5.306922|
|journal_maintenance|2.441706|0.085009|20.855475|65.201523|

Validate 子项已包含在 Validate 和 Commit 中，百分位不能相加。编码和 fsync 已分别测量；这轮更大的已测开销是完整验证和客户端读回竞争，不能把全部耗时归咎落盘。

## 延迟与证据

仅7665笔 confirmed 子集的 offer→有效入块观察 P50/P95/P99 为1.137–1.138 / 1.636–1.637 / 1.818–1.819秒；offer→最终确认观察为1.436–1.437 / 1.955–1.956 / 2.186–2.187秒。其余527个计划输入不在分布中，不能证明完整负载延迟达标。此版本未记录节点绝对完成时刻，这些是客户端观察区间。

原 artifact12538112811，45,260,536B；原范围缓存最终恢复266个选中公开文件、20,660,978B，manifest SHA da42c2767580fdd1f0d07bd791af633a106506a15053ab42efb3fd2260fd99f8。原中断与失败均保留，不重新下载整个 ZIP。原 post-fsync 样本和双空扫齐全，slotReturned=true 与 nativePairQualified=false 分开记录。

[指标证据](evidence/native-cadence-pair40-run40037942357-failed-side.json) SHA256 `140ebf9b97caec2bc8786f37a254c3748ab7ac1a31cb2a929e7a04840f602726`。读取器核对完整 signed/terminal 身份与链、原报告 SHA、四份节点日志；不重新验证 BFT 密码学，也不启动网络：

```sh
python3 -B docs/performance/evidence/native-cadence-pair40-failed-side-reader-20261024.py \
  artifacts/chain-performance-20261017/native-cadence-pair40-source-d6fb96d3e \
  artifacts/chain-performance-20261017/native-cadence-pair40-run-40037942357 \
  /tmp/ynx-pair40-failed-side-new-output.json
```

下一动作是当前输入复用差量：在原 reader 预算、锁及逐笔验证门内减少重复解码/完整验证，两侧同为 bounded-cadence，只切换复用开关。参见 [源码差量](NATIVE_CURRENT_INPUT_REUSE_20261024.md)。须原 CI 成功并由 Root 重新排单次窗口，原两个 grant 均已消费；不再靠延长客户端期限掩盖瓶颈。
