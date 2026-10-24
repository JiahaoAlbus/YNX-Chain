# 私有已验证 suffix 初始化同条件四节点结果：run40060919778

完整独立读回已通过。初始化累计耗时下降20.80%，有效final速率253.694→260.333/s（+2.62%），但入块和最终确认尾延迟均变差；finiteJointImprovementObserved=false，候选保持默认关闭。两侧各8192笔签名业务全部提交、接受、有效入块、BFT确认和持久化，业务终态失败/UNKNOWN/timeout/notSubmitted均0。业务终态成功不等于观察轮询全无错误：原summary.errorOccurrences为50040/51095，完整机器JSON已保留；该计数包含逐交易的block_scan_wait等诊断累计，不等同50040/51095次独立RPC失败；其中block_results_query错误6/8次、durable_business_batch错误3/5次，不能写成所有RPC/观察尝试error为0。单次固定顺序不能估计方差，也未达到持续1000有效final/s×600秒。

冻结源码ea2dc6b80b17f49751dbf7752e167c051564e20d，tag codex/chain-native-suffix-pair-ea2dc6b80，原CI40060431754成功。AMD EPYC7763型号标称64核，runner实际分配4 logical CPU；Go1.25.14/linux-amd64，GOMAXPROCS1/GOGC100/GOMEMLIMIT off。相同一次四ELF构建、相同VM/boot/PID namespace与launcher。两侧均2048发送账户×4轮、bounded-cadence、输入复用开启、8提交者/4观察者、canonical证书关闭；唯一开关native-suffix-setup false→true。不能与旧EPYC9V74 VM的328/s作跨运行优化归因。后续只读字段计划源码7585b33c6没有进入本次冻结运行。

## 完整窗口吞吐与客户端阶段

配置offer1000/s，实际仅270.789→272.741/s，因此节点尚未受到持续1000/s供给。编译、启动、清理不计入下表客户端业务窗口。

|指标|对照|候选|变化|
|---|---:|---:|---:|
|有效final/s|253.694|260.333|+2.62%|
|提交/s|253.694|260.333|+2.62%|
|接收接受/s|253.694|260.333|+2.62%|
|有效入块/s|253.694|260.333|+2.62%|
|实际offer/s|270.789|272.741|+0.72%|
|业务窗口秒|32.290846|31.467346|-2.55%|
|客户端CPU秒|25.047340|24.582309|-1.86%|
|reader decode秒|12.682304|11.957670|-5.71%|
|suffix初始化秒|1.250157|0.990179|-20.80%|
|suffix重放秒|4.141749|3.793538|-8.41%|
|证书发布秒|3.137707|2.925647|-6.76%|
|私有完整Validate秒|1.298332|1.400155|+7.84%|
|suffix编码秒|1.496826|1.442945|-3.60%|
|reader gate持有秒|14.475134|13.682611|-5.48%|
|reader gate等待秒|17.782534|17.678397|-0.59%|
|采样RSS合计峰B|1,048,297,472|1,020,837,888|-2.62%|

初始化调用35→34次，证书发布38→37次，批次密度不同。不能把累计下降都当作单调用加速，也不能把这些嵌套/并发wall总量相加。输入复用和完整Validate保留；仍全部使用原严格JSON证书路径，没有把canonical候选混入比较。

提交回调8192次均返回，峰值并发8。回调wall均值23.724→24.121ms，排队均值70.228→103.448ms、峰值609.590→798.063ms；回调占用总量可跨worker重叠，不是纯网络或节点CPU。每秒桶观察的offered-not-yet-final峰981→992，结束时清空；不能据结束无积压声称整个窗口没有积压。该排队变化是下一步定位提交/供给链路的实证，不能只继续改初始化。

## 全部8192笔的延迟

单位ms，区间保留原1ms直方图及节点时钟包络。客户端有效入块是实际观察到的有效入块；节点Finalize/Commit是对应交易高度的实际完成返回，不是最早quorum形成瞬间。

|阶段|对照P50|候选P50|对照P95|候选P95|对照P99|候选P99|
|---|---:|---:|---:|---:|---:|---:|
|offer→客户端有效入块|1262–1263|1259–1260|1746–1747|1835–1836|2012–2013|2024–2025|
|offer→客户端final|1543–1544|1555–1556|2054–2055|2138–2139|2221–2222|2293–2294|
|offer→节点Finalize返回|1014.888–1016|1018.965–1020|1537.888–1539|1624.965–1626|1710.888–1712|1744.965–1746|
|offer→节点durable Commit返回|1058.888–1060|1062.965–1064|1579.888–1581|1674.965–1676|1762.888–1764|1782.965–1784|
|节点Commit→客户端final观察|479.888–481|467.965–469|656.888–658|675.965–677|685.888–687|761.965–763|

两侧分别完整关联8192行，最大时钟校准误差界56,244ns/17,472ns。对照Info前进0行、durable state前进6行；候选Info前进9行、state前进0行。各自按本身高度/post-state hash核对，不能把交易高度H的header AppHash直接等同H的执行后状态，也不丢弃前进记录。分位不能相加。有限case的P95小于3秒，不证明1000/s或600秒条件下达标。

## Commit编码、完整校验与落盘

只取业务高度：对照38高度×4=152样本，候选37×4=148样本。4节点重复执行业务不是4倍业务TPS。单位ms，所有P50/P95/P99保留在机器JSON。

|阶段|对照平均|候选平均|对照P95|候选P95|
|---|---:|---:|---:|---:|
|Commit|41.120360|42.292202|74.293211|80.192377|
|完整Validate|37.550727|38.720849|63.163569|71.569994|
|Validate AppHash|24.035557|24.844040|41.425214|47.321877|
|Validate语义|13.434787|13.811859|24.975310|25.816589|
|delta编码|0.213242|0.193952|0.424444|0.435123|
|write|0.206331|0.195263|0.430956|0.341639|
|fsync|0.970433|1.046404|2.931493|3.003458|
|journal maintenance|2.116084|2.063223|23.926911|20.321707|

本轮主要成本是完整校验，不能把编码或磁盘一概当主瓶颈。节点阶段还受批次密度与调度影响，不能把全部差异归因客户端初始化。采样RSS均低于原1GiB守卫；角色同时峰值与独立峰值均在机器JSON，独立峰不能相加，也不以RSS下降推断GC首因。

## 原授权、完整证据与复跑

Root新once grant2781B/SHAe7366518909e1b404fa3d53c21f3784c325ae4b3829e9f700c94a9524d835e7c，fresh pressureLevel1。实际唯一dispatch于2026-10-24T04:04:56Z创建原run40060919778/job120774026990，完整工作流SUCCESS。native步骤04:10:59→04:13:36，原两case post-fsync verdict40.959/40.118秒均合格；原pair84.000秒合格/null，三组双扫描同launcher39217/startTicks51320，仅launcher存留。源码/11个固定reader/同VM/四ELF buildInfo及SHA、原守卫和原始节点日志均复核。

原40s客户端、每侧45+15/60s、配对120s、采样RSS1GiB/线程320/进程10/private256MiB每侧/总保留512MiB/log2MiB/build1GiB不扩。编译在pair前，受原整个job20分钟约束，没有虚构独立编译硬RSS/timeout。

完整原artifact12547476746为99,597,608B，仅选取545个公开成员43,604,223B；manifest cc20f3c62945f56a9e8b234aaccb0ebe340b7ca09e5f767a3fe98d7cd2cbde2e。最终离线0网络字节重验全部CRC/SHA与两侧完整流。独立verdict600197B/SHA9966c308c44d1a7a18fec285fbc31cc31a7013a91ba75fb630875d5f26c4a1d6：nativePairQualified=true/slotReturned=true/firstCause=null/sustained=false。

首次读回调用缺少本地run父目录，保留FileNotFoundError及首因后仅创建owned父目录；02–14各原60秒读回期限结束，原partial/cache全保留，15完整成功。冻结reader在本次无需任何posthoc修复，未下载wholeZIP、未重跑网络或丢失原失败。

[完整机器指标、时钟、资源与公开证据身份](evidence/native-suffix-run40060919778-qualified-comparison.json)。原source/capture/cache/log/grant均在owner artifacts的native-suffix-pair-source-ea2dc6b80及native-suffix-pair-run-40060919778目录。便携读取器已实际复跑：完整指标、节点关联及资源JSON均逐字段完全复现；配对资格除读取器自身身份外一致。读取器接受原source包与capture，输出必须是新文件：

```sh
python3 -B docs/performance/evidence/native-suffix-qualified-pair-reader-20261024.py SOURCE_PACKET CAPTURE ORIGINAL_FULL_LOG TERMINAL_GH_JSON NEW_VERDICT
python3 -B docs/performance/evidence/native-suffix-qualified-comparison-reader-20261024.py ORIGINAL_QUALIFIED_VERDICT NEW_COMPARISON
python3 -B docs/performance/evidence/native-suffix-node-completion-reader-20261024.py SOURCE_PACKET ORIGINAL_CASE NEW_NODE_JOIN
python3 -B docs/performance/evidence/native-suffix-node-resources-reader-20261024.py ORIGINAL_QUALIFIED_VERDICT NEW_RESOURCES
```

下一具体动作：原初始化候选不启用；沿实际callback约24ms、排队尾部增长和reader decode约12秒继续拆提交等待与客户端工作。已独立实现的只读canonical字段计划（源码05af0e5ff，原CI40062742188已成功）接着据同载荷组件证据准备下一单轴窗口材料，不能把其本机组件收益写成本次网络收益。持续1000有效final/s×600秒仍未达。
