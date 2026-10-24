# 规范化证书构造同条件四节点结果：run40055278746

本次单次固定顺序配对观察到端到端回退，不能估计实验方差；候选保持显式实验、默认关闭。证书发布累计耗时下降18.77%，但有效final速率328.219→321.801/s（−1.96%），客户端入块与最终确认P95/P99均变差。原两侧各8192笔签名业务全部提交、执行、有效入块、BFT确认和持久化，失败/UNKNOWN/timeout/notSubmitted均0；一次有限配对不能证明持续1000有效final/s×600秒。

同一源码4e4d26a71205866765b57b000c5adf1b6361342a、同一次四ELF构建、同一原生Linux VM。AMD EPYC9V74型号标称80核，runner实际分配4 logical CPU；Go1.25.14/linux-amd64，GOMAXPROCS1/GOGC100/GOMEMLIMIT off。两侧均2048发送账户×4轮、bounded-cadence、输入复用开启、8提交者/4观察者、原suffix初始化；唯一开关为native-canonical-certificate false→true。不能拿本轮328/s与旧7763 VM的252/s作优化归因。

## 吞吐、客户端成本和原始资源代价

配置offer1000/s，但实测offer仅345.750→340.700/s；本轮负载发生器尚未持续提供1000/s，不能声称节点已承受该目标压力。以下速率按原完整客户端measurement window，编译/节点启动/清理不计入业务窗口。提交、接收、有效入块及final全覆盖8192，故这些窗口速率相同。

|指标|对照|候选|变化|
|---|---:|---:|---:|
|有效final/s|328.219|321.801|-1.96%|
|提交/s|328.219|321.801|-1.96%|
|接收接受/s|328.219|321.801|-1.96%|
|有效入块/s|328.219|321.801|-1.96%|
|实测offer/s|345.750|340.700|-1.46%|
|客户端CPU秒|17.785|18.006|+1.24%|
|reader decode秒|7.966|7.776|-2.39%|
|证书发布秒|1.686|1.369|-18.77%|
|增量重放秒|2.844|3.218|+13.16%|
|reader gate持有秒|9.201|9.005|-2.13%|
|reader gate等待秒|10.547|9.956|-5.60%|
|采样RSS峰MiB|955.008|1002.305|+4.95%|

CPU和reader/parent阶段单位秒，RSS单位MiB。耗时总量可包含并发等待和嵌套子项，不得相加。发布29→30次，候选30次接受、0次严格JSON回退；原严格JSON1.472秒被候选复制/重新编码比较1.212秒等工作替代，nativeClone子项部分工作移到canonicalNative，不能单独夸大该子项下降。完整Validate、原验签和最终确认门保留。

进程RSS合计是采样值，非分配/GC计数或硬cgroup上界。总采样RSS峰增加49,594,368B（+4.95%），两侧均低于原1GiB。峰值当时client为300,453,888→310,910,976B（+3.48%）；launcher为36,352,000→66,187,264B，第二侧同时保留第一侧receipt/result，固定顺序会影响launcher内存。不能把全部49.6MB归因于候选客户端或宣称GC已是实证首因。独立角色峰不能相加；机器JSON保留同一总峰样本的完整拆分。

## 完整8192笔延迟

单位ms，区间保留1ms直方图分辨率和节点时钟校准包络。每侧全部8192行按endpoint、交易高度blockHash、state/Info各自高度post-state hash关联。节点返回是实际完成观察，不能冒充最早quorum形成瞬间。

|阶段|对照P50|候选P50|对照P95|候选P95|对照P99|候选P99|
|---|---:|---:|---:|---:|---:|---:|
|offer→客户端有效入块|1177.000–1178.000|1205.000–1206.000|1598.000–1599.000|1757.000–1758.000|1796.000–1797.000|2004.000–2005.000|
|offer→客户端final|1411.000–1412.000|1427.000–1428.000|1843.000–1844.000|1957.000–1958.000|2127.000–2128.000|2259.000–2260.000|
|offer→节点Finalize返回|983.999–985.000|1019.973–1021.000|1425.999–1427.000|1510.973–1512.000|1641.999–1643.000|1816.973–1818.000|
|offer→节点durable Commit返回|1025.999–1027.000|1063.973–1065.000|1467.999–1469.000|1554.973–1556.000|1690.999–1692.000|1853.973–1855.000|
|节点Commit→客户端final观察|391.999–393.000|360.973–362.000|608.999–610.000|471.973–473.000|674.999–675.828|493.973–495.000|

校准误差上界对照491ns、候选13,651ns，两侧state/Info前进关联行数均0。Commit后的客户端观察P95下降，但offer到节点完成及整体final尾部变差，分位不能相加。有限case的final P95都在3秒内，不代表600秒持续目标达成。

## Commit编码、完整校验与落盘

只取业务高度：对照29高度×4=116样本，候选30×4=120。4节点重复执行不计为4倍业务TPS；实际批次密度变化，不能把节点阶段差异全部归因客户端开关。单位ms。

|阶段|对照平均|候选平均|对照P95|候选P95|
|---|---:|---:|---:|---:|
|commit|32.706439|35.100623|70.485452|61.897595|
|validate|28.282505|28.903362|51.296749|56.671511|
|validate.app_hash|17.644999|18.512790|31.187238|36.180547|
|validate.semantics|10.484790|10.299728|19.262822|21.159767|
|delta_encode|0.187454|0.174621|0.390260|0.339575|
|write|0.175921|0.228288|0.372864|0.334207|
|file_sync|2.558388|3.296349|16.871088|14.522217|
|journal_maintenance|1.350448|2.222827|2.766162|1.118098|

Commit平均32.706→35.101ms，P95却70.485→61.898ms，保留均值和尾部不同方向。平均完整校验约28–29ms，其中AppHash约18ms；编码约0.18ms、fsync约2.6–3.3ms。本轮不能把编码或磁盘一概当主瓶颈，也不能以客户端重放的memoryCommit代替节点落盘。

## 原授权、原运行和独立证据

Root once grant2922B/SHA9289d4f3a2da194e3eb6f3e675919cc13fc2a525a940dc8d92d99d55ee14d40e。正常CI40054594269成功，冻结tag codex/chain-native-canonical-pair-4e4d26a71精确指向4e4。实际dispatch开始02:42:15.248706Z、原run40055278746/job120756796984完成SUCCESS。首次gh JSON布尔输入在本地解析即拒绝，查无对应run后改raw-field，所有原命令/首因保留，未重发未知远端操作。

原两侧native post-fsync verdict合格，32.616/32.836秒；pair67.755秒合格，firstCause null。原40s客户端、45+15/60s每侧、120s配对、RSS1GiB/进程10/线程320/private256MiB每侧/512MiB总量/log2MiB/build1GiB守卫未扩。post-fsync采样及双launcher-only扫描均同39029/startTicks59139，原节点已关闭。编译在pair前，只受原整个job20分钟约束，不虚构编译期独立硬RSS/timeout。

独立qualified verdict531,117B，SHA7861c05d0a95ba1874217daf73d7fbe1ac43db6c9e5ace417a152bc46b17a1db；nativePairQualified=true/slotReturned=true/sustainedTPSQualified=false。原artifact12545396925共98,359,737B，仅恢复545个选中公开成员43,316,445B；manifest f151729cf643e4d7069ee6b9c1cba22bbf93c412982d67900b24a9debe0428bf。最终0网络字节重验全部CRC/SHA与完整两侧流；没有whole ZIP下载或网络重跑。

第一次原归档reader遗漏新case标签，只取pair总receipt后FileNotFoundError；保留原失败。posthoc-reader-v2严格限制为两个标签/对应槽位的两行修复，原11个reader、request/plan/grant/tag均未覆写；修复原CI40056195764成功。后续60秒读回期限失败及全部partial/cache保留，第11次完整恢复成功。这些是读取器首因/未完成诊断，不是原网络失败或重复实验。

[完整机器指标、时钟和资源拆分](evidence/native-canonical-run40055278746-qualified-comparison.json)。原source/capture/cache/log/grant保存在owner artifacts的native-canonical-pair-source-4e4d26a71及native-canonical-pair-run-40055278746目录。便携独立读取器需原source包和capture，输出必须使用新文件：

```sh
python3 -B docs/performance/evidence/native-canonical-qualified-pair-reader-20261024.py SOURCE_PACKET CAPTURE ORIGINAL_FULL_LOG TERMINAL_GH_JSON NEW_VERDICT
python3 -B docs/performance/evidence/native-canonical-qualified-comparison-reader-20261024.py NEW_VERDICT NEW_COMPARISON
```

下一源码动作：补匹配载荷下的分配/GC实测，解释候选重新编码比较及执行/seal成本；同时沿实测增量重放3.218秒、suffix初始化0.731秒和实际offer约340/s定位供给瓶颈，复用已有私有已验证状态的初始化候选做单轴接入。维持canonical候选默认关闭及已验证的输入复用成果，不删完整Validate、不清手续费历史，不用延长超时掩盖回退；新四节点窗口仍由Root具体排程。
