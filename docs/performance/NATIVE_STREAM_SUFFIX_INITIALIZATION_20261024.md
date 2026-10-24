# 显式流模式私有状态初始化与分配测量

原四节点40055278746已证实canonical证书候选端到端回退，仍默认关闭。本轮继续source/light，不启动新节点/重构建/GUI或复用旧grant；新heavy仍须Root具体排程。

## 同载荷分配/GC：纠正未验证解释

沿用真实32笔签名、执行、Commit与日志恢复所得25,763B规范载荷，对完整证书发布函数交替顺序测7轮×32次，每路径224次。在调用段前后读取同一Go进程MemStats，不强制GC、不改GOGC/GOMEMLIMIT：

|指标|原严格JSON+私有复制发布|canonical复制+编码比较发布|
|---|---:|---:|
|TotalAlloc差值B|29,793,872|23,008,808|
|每次平均分配B|133,008.36|102,717.89|
|Mallocs差值|74,592|52,461|
|观察到的NumGC增量|7|4|
|GC PauseTotalNs增量|109,667|64,208|

该本机样本分配少22.77%，不支持“候选必然分配更多或GC次数更多导致网络RSS上涨”的解释。计数是整个测试进程的区间值，GC周期会跨调用边界，PauseTotalNs不代表全部GC CPU成本，也不能解释另一Linux VM的RSS。网络峰值还包含launcher保留第一侧结果等内存。保留网络回退结论，不把这份组件证据反向当成网络优化成功。

[实际分配计数及raw摘要](evidence/native-canonical-publication-allocation32-20261024.json)。原raw为owner artifacts的 `native-stream-small-source/native-publication-allocation32.raw`，非race PASS0.730s。该显式轻测继续使用 `YNX_MEASURE_CANONICAL_NATIVE=1`，普通CI不把未选择测量算通过。

## 复用已有初始化候选，显式接入有界native stream

原对照suffixSetup累计0.891秒；candidate一侧0.731秒，两者都仍使用原NewApplication初始化。这不是编码/落盘时长，也不能直接推导改构造器的网络收益。

新增 `NewBoundedBlockJournalNativeSuffixPrefixDecoder`，复用已存在的 `newSuffixApplicationForValidatedPrivateState`：保留迁移CanonicalJSON完整校验与独立深复制，在当前私有state完整Validate通过后使用它，避免重复校验同一迁移并创建随后立即丢弃的genesis state。实例16..512MiB限制与实际流32MiB选择不变，原reader预算/gate、签名、手续费、nonce、恢复与最终确认门不变。

现有默认关闭的 `-native-suffix-setup` 允许显式native stream8选择。canonical和suffix构造候选互斥，默认仍为原suffix初始化。实际构造器通过不可变getter绑定prefixReplay.nativeSuffixSetup，durable plan同时记录originalSuffixSetup=false；旧有限native8语义不扩大。已有原模式拒绝测试改为继续拒绝混合canonical/suffix，另加新模式正反例，不删除断言。

真实3临时发送账户×34 nonce周期完成102笔签名、执行、Commit、重开与原公开流读回：7次冷重放、95次suffix初始化，95次复用完整Validate、102次签名验证，仍102次原严格JSON证书构造，canonical未选择。quorum为unit gates，不是网络BFT资格。Go race实际夹具PASS5.680s，scope/default/实际构造器及原模式race PASS1.883s；有界限制、迁移隔离/非法迁移和同签名历史反例race PASS1.886s；三份真实Go fixture的Python消费37项PASS0.401s，consensus/client vet通过。原CI接入独立suffix fixture生产、消费和归档，不覆盖旧fixture。

## 同一原始迁移的ABBA构造器轻测

直接只读原run40055278746选中且CRC/SHA核验的bound-migration.json：847,001B、2055账户，SHA4076f35f04a2a7e1d10cab3eec961e93a7be12f0e13ce8ffc928df9ed420a609。前后SHA不变，没有重建账户、改原输入或重新运行网络。先对真实迁移的两种Application构造结果DeepEqual，再用原benchmark按A/B/B/A，每项4个计时调用：

|序列|ns/op|B/op|allocs/op|
|---|---:|---:|---:|
|control-A|9,938,677|5,586,080|34,979|
|candidate-B|8,426,562|4,663,864|24,702|
|candidate-B2|8,259,604|4,663,864|24,702|
|control-A2|9,169,250|6,110,542|34,986|

等调用数均值耗时下降12.67%，分配字节下降20.25%；控制组自身存在时序/池/GC变化，样本很小，只用于决定后续候选验证。Apple M4/arm64、Go1.25.7、GOMAXPROCS1/GOGC100/GOMEMLIMIT off，非race、非独占主机；不能套算旧Linux0.891秒或声称新TPS。

[真实迁移身份、全部ABBA行和102笔计数](evidence/native-stream-suffix-initialization-20261024.json)。首份未加大迁移DeepEqual前置断言的探测raw也保留，最终raw为 `native-stream-suffix-original2048-qualified-abba.raw`，PASS0.714s。

```sh
YNX_SUFFIX_MIGRATION_FIXTURE=/absolute/original/bound-migration.json GOMAXPROCS=1 GOGC=100 GOMEMLIMIT=off go test ./internal/consensus -run '^$' -bench '^BenchmarkPrivateSuffixApplicationOriginalMigration$' -benchtime=4x -count=1
YNX_NATIVE_SUFFIX_PUBLIC_FIXTURE_DIR=/absolute/new-fixture GOMAXPROCS=1 go test -race ./cmd/ynx-consensus-perf-client -run '^TestNativeStreamingSuffix' -count=1 -timeout=30s -v
```

当前源码和轻测已验证；四节点控制器尚未登记新的suffix流配对，现有接收器会拒绝该未登记模式，没有网络收益或部署资格。下一步绑定原recipe/命令/plan/backend的单轴选择，再完成原CI并提交Root新的必要窗口材料；1000有效final/s×600秒仍未达。
