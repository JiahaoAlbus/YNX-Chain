# 客户端调度核数同条件对比：40176399057

本轮有限对比已独立核验合格，实际送入329.205→499.982笔/秒，最终有效业务确认311.172→468.727笔/秒（本次+50.63%）。客户端最终确认P95稍差，因此不满足联合全面改善，也不切默认配置。持续1000笔有效业务交易/秒×600秒仍未达成。

SOURCE31fe7b86ca74c290dfcd410eea27d1b44f379b31 / CODEa0f41eb38c129247cceb9e24d988f58edfb2e31c；普通CI40175709390 SUCCESS；精确Root授权11728B /0844cd09b1dfa81bf002b7c1a0cfaedf507cc0742f875050de0b6d86a8f63728。仅一次正常派发，run40176399057/attempt1 SUCCESS，原session99257及watch95320均exit0，派发前原API零个运行、之后唯一运行。两组同一4逻辑CPU Linux VM/boot/namespace/source/四ELF，prepared/current reuse/原hash/grouped pacing/8 submitters/4 observers不变，节点GOMAXPROCS1。仅after客户端显式GOMAXPROCS2。

各8192笔最终有效交易；UNKNOWN/超时/执行失败/拒绝均0。原45+15秒/案例60秒、pair120秒、RSS1GiB/320线程/10并发进程/private256MiB及所有原资源守卫保留。两轮原完整checker均在本案例active45秒内；案例终态35311/26135毫秒，整组62184毫秒。双次post-fsync清理扫描均仅原launcher39722/startTicks53554。终态总时长包括校验清理，不能直接换算TPS。

| 实测项目 | client1 | client2 |
|---|---:|---:|
| 实际送入笔/秒 |329.205|499.982|
| 完整测量窗最终有效笔/秒 |311.172|468.727|
| 测量窗秒 |26.3263|17.4771|
| 客户端CPU秒 / 单核等价利用率 |17.6149 /66.91%|17.7638 /101.64%|
| 1秒桶末待确认最大值 / 最终 |896 /0|1288 /0|
| 采样RSS字节 |1001312256|1024692224|
| reader gate hold / wait秒 |7.4500 /8.3739|5.8243 /8.9763|
| 读回解码累计秒 |6.3930|5.3217|
| pacing唤醒迟到累计秒 |9.9174|4.3917|

这支持客户端调度争用限制送入量的判断，不证明链上限为469。平均CPU工作量接近，但更快完成；仍受读回/观察及供给等约束。readback wait/hold/CPU/嵌套阶段会重叠，不能相加。70552→65402是重复诊断错误事实出现次数，不是业务交易失败数。采样RSS及桶末待确认量不是硬内存峰值或瞬时积压峰值。

P50/P95/P99均为1毫秒桶上界，单位毫秒；全部8192行按height/blockHash/AppHash/业务数与真实节点完成记录关联：

| 时间边界 | client1 P50/P95/P99 | client2 P50/P95/P99 |
|---|---|---|
| 客户端观察到有效入块 |1260/2102/2411|1213/2021/2225|
| 实际端点Finalize执行返回 |1076/1856/2181|1041/1803/1989|
| 实际端点持久化Commit返回 |1140/1978/2248|1095/1845/2022|
| 客户端最终确认观察 |1463/2262/2582|1480/2277/2486|
| 首个副本持久化 |1094/1906/2189|1050/1781/1949|
| 第三个副本持久化 |1140/2004/2235|1129/1873/2069|
| 全四副本持久化 |1175/2029/2251|1169/1890/2086|

节点Commit→客户端最终观察的逐笔P95为513→579毫秒。校时误差上界14.221→94.229微秒。Finalize返回是执行完成，不是提议到达；第三副本不是按投票权计算的法定票数，最早BFT法定票数形成时刻仍未测量。不同分布的分位数不能相减得到阶段延迟。

业务块每副本28→18，平均293→455笔/块。四副本合计112→72个业务块样本，不能乘成四倍业务TPS。Commit均值42.443→49.167毫秒，但总时长4753.640→3540.037毫秒；每块批量不同必须一起看。validate26.976→31.170，其中嵌套AppHash17.474→20.195；delta encode0.211→0.340、write0.217→0.396、append fsync11.842→10.864毫秒。checkpoint encode17.097→19.371、fsync41.644→62.491毫秒，含空块中的checkpoint，不与上述业务均值相加。单次pair及fsync波动不能证明稳定因果增益。

after解码5.322秒中，suffixReplay2.492、fullReplay0.813、suffixEncode0.688、privateValidate0.582、suffixSetup0.424秒，私有native clone仅0.075秒。后续沿最大重放子项继续定位。新增combined timing API和后续源码CI单独记录在SUFFIX_REPLAY_COMBINED_TIMING_20261025.md；它未用于本轮，不能混入收益。

原始证据全部位于西数 `chain-performance-20261017/prepared-grouped-procs2-run-40176399057/`：549个公开成员44307580字节，原CRC/SHA/manifest全量恢复，并由冻结reader再次零网络审计；未重算整个97828124字节ZIP摘要。各60秒范围读取中断及缓存均保留，没有重新压测或放宽守卫。

- 独立结论506190B /b62b34d309f78796f08928d0dfbc13befdcf1eb02f3c4840214d00b656fb23ce：nativePairQualified=true、slotReturned=true、sustainedTPSQualified=false。
- 完整原公开恢复55755B /bdb0d24932f6c64849222172fc89e05f5145a4e43b81ebd4dbaf9d5bdfe1bc86。
- 阶段及逐笔节点完成汇总25859B /cfc68f06b847a16a540d590befaa28b3dbcaf5ef209498ea643208c357f75ede。
- 原CI完整日志815994B /1a34f5cfa2fd575f15952920c681c3e1ff1d144cbc797e84a3d81ec10965b4c3。

精确路径、全部延迟、变化项及限定见 evidence/native-procs2-run40176399057-qualified-20261025.json。此前401132结果保持其原来源，不重验、不混做本轮对照。

对应只读消费者已保存为 evidence/native-procs2-*-20261025.py/mjs，与原WD实际执行脚本逐字节一致；涉及 `Path(__file__).parent` 的消费者需复制回原run目录后按文件头参数执行，使用新的输出名。它们不启动节点、不派发工作流，历史Root守卫按Root原pin和git31原对象认证原始留存字节。
