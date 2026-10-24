# 当前输入复用实验40044977213：首侧完成观测与原失败

原冻结源码 `7c4cac62a6e434d2ee7eb6c3793421c95a3035b7`，唯一run40044977213。第一侧使用 bounded-cadence、input reuse=false。原控制器仍期望旧maxRuntimeMs=30000，而producer/命令/计划均为40000，故原case判失败；第二侧未启动。不得把事后修复读取器的诊断结果改写为原配对通过，也没有cache前后收益结论。

## 完整读回后的实际业务观察

原客户端报告8192笔offered/submitted/accepted/code-zero included/effective included/quorum/final，UNKNOWN/timeout/notSubmitted均0；29.396732799秒窗口报告278.670424 final/s，实际offer事件间隔296.775318/s。原signed/terminal全部8192身份、顺序、nonce、hash/seal与四份节点日志/回执已完成后验读回。没有另跑节点，也没有补发交易。终态业务错误为零不代表没有观察重试：完整终端记录累计57,339次block_scan_wait、1,301次local_durable_readback，与原报告errorOccurrences=58,640一致。

273个选中公开成员、21,260,490B完成原ZIP范围CRC/SHA验证，manifest `a258c2199e284b9138e0230d1261238a01f680df6cb3808ebdcf3c965e1e8375`。最终重验0网络字节；先前三次60秒读取超时原样保留。原nativePairQualified=false、slotReturned=true分别记录，case36.268秒、pair36.576秒，同launcher38995/startTicks70748的post-fsync样本与双空扫齐全。

## 节点完成点与客户端观察

按原endpoint、交易高度/blockHash、持久化state与Info各自高度/post-state hash关联8192行。46行Info已前进到stateHeight+1，其真实下一高度hash也与对应节点日志匹配；没有将下一高度hash冒充交易高度post-state。整体client/node校准误差上界12,589ns，固定1ms直方图给出包含漂移的区间。下表单位ms：

|阶段|P50区间|P95区间|P99区间|
|---|---:|---:|---:|
|offer→节点Finalize返回|1031.975–1033.000|1479.975–1481.000|1827.975–1829.000|
|offer→节点durable Commit返回|1082.975–1084.000|1531.975–1533.000|1876.975–1878.000|
|节点Commit→客户端final观察|397.975–399.000|571.975–573.000|615.975–617.000|
|offer→客户端有效入块观察|1219.000–1220.000|1687.000–1688.000|2119.000–2120.000|
|offer→客户端final观察|1494.000–1495.000|2008.000–2009.000|2313.000–2314.000|

节点Finalize和Commit返回点是实际应用完成观测；它们不是最早quorum形成瞬间。后验关联不重新执行BFT密码学验证，也不代替原同VM/native资源准入。原实验失败和无第二侧结论保持。各分位不能相加得到另一阶段分位。

## 编码、落盘与读回竞争

34个有确认业务观察的高度×4节点，共136次Commit，单位ms：

|Commit阶段|平均|P50|P95|P99|
|---|---:|---:|---:|---:|
|commit|38.678527|32.365980|93.798308|165.578282|
|validate|28.151287|27.981912|48.931510|66.491087|
|validate.app_hash|18.025481|17.552140|33.304757|38.827594|
|validate.semantics|10.045660|9.303397|17.236866|30.547197|
|delta_encode|0.171777|0.145238|0.296494|0.984693|
|write|0.161784|0.144216|0.287220|0.590544|
|file_sync|5.006999|0.520990|57.984006|70.972004|
|journal_maintenance|4.919479|0.087301|47.852666|125.485280|

本轮fsync尾部显著，P95约57.98ms，不能拿另一VM的旧3ms结果替代。客户端outer reader gate累计wait13.078973187秒、hold12.589858882秒；这些累计时间与decode/验证/并行等待嵌套重叠，不能相加。后续应在同VM对比cache off/on后，再按真实阶段变化处理读回竞争和存储尾延迟。

## 已复现并修复的消费者缺陷

- maxRuntimeMs的30s旧常量：对齐原已选择40s budget，追加顶层timeout严格绑定；未延长任何预算。
- nativePrefix精确对象比较遗漏producer的readerGateTiming/clientClockTiming/currentInputReuse：按真实字段保持严格模式，拒绝未知字段、错误类型和不同选择。
- 归档要求Info严格等于state高度：对齐原Go verifyJournalPublishedState，允许Info推进；同高度必须同hash。节点时刻关联分别核对各自高度hash，倒退、错误hash或缺节点点仍拒绝。
- 原Go公开unit fixture遗漏真实Info apphash：现从实际app.Info结果导出；102笔签名/执行/Commit/nonce34/恢复race4.346秒通过，29项Python、88项控制器和21项ZIP轻测通过。旧失败、缺字段fixture及诊断raw均保留。

证据：[完整指标](evidence/native-current-input-run40044977213-diagnostics.json)、[节点逐笔关联](evidence/native-current-input-run40044977213-node-points.json)。保持原归档后可零网络复跑关联（输出须是新路径）：

```sh
python3 -B docs/performance/evidence/native-current-input-node-points-reader-20261024.py \
  artifacts/chain-performance-20261017/native-current-input-pair-source-7c4cac62a \
  artifacts/chain-performance-20261017/native-current-input-pair-run-40044977213/capture/before-native-input-separate \
  /tmp/ynx-original-input-pair-node-points-new.json
```

下一次仍须最终修复源原CI成功、新冻结ref和Root新单次grant。两侧都用bounded-cadence，仅切换reuse，保留同VM/四ELF和原40/60/120秒预算。持续1000有效final/s至少10分钟仍未达成；本次完整首侧后验观测不能替代它。
