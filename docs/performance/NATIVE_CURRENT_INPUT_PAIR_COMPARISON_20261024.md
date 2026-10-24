# 同条件当前输入复用：run40047424926

同一原生Linux VM、同一源码147eae73eb9435cdfff6a3dcec4fc3a254c35885和四个ELF，两侧均为bounded-cadence，只有currentInputReuse从false切换true。硬件型号AMD EPYC7763，runner实际分配4 logical CPU；GOMAXPROCS=1/GOGC=100/GOMEMLIMIT=off。两侧分别使用全新的隔离测试夹具、2048发送账户×4轮，共8192笔真实签名业务交易。不能与旧9V74或另一7763 VM跨run作优化归因。

原workflow、两侧native post-fsync verdict与独立完整读回均通过：nativePairQualified=true、slotReturned=true；每侧输入/提交/接收/有效入块/quorum/有效final均8192，失败/UNKNOWN/timeout/notSubmitted均0。总配对88.487秒，每侧44.456/41.087秒；40s客户端、45+15s每侧60、pair120及原全部资源守卫保持。原编译在pair外，仅由整个job20分钟（含前置CI）约束，没有新增编译期硬RSS或独立超时。

## 实质效果与代价

|指标|关闭复用|开启复用|变化|
|---|---:|---:|---:|
|有效final/s|229.240|252.644|+10.21%|
|客户端CPU秒|29.195|25.328|-13.24%|
|reader decode累计秒|16.711|12.461|-25.43%|
|reader gate hold累计秒|19.367|14.367|-25.81%|
|reader gate wait累计秒|24.332|19.267|-20.82%|
|private Validate次数|143.000|36.000|-74.83%|
|private Validate累计秒|3.813|1.284|-66.33%|
|采样RSS峰MiB|952.965|979.211|+2.75%|

新路径真实命中90次、未命中39次、错误0；保留输入逻辑计费21,681,955B，查找比较累计16.052ms。每笔原签名、手续费、nonce、Info与最终确认门仍运行。RSS峰从999,256,064增加到1,026,777,088B，均低于1GiB；不能说全部资源指标改善，也不能据一次固定先后顺序实验默认推广。阶段wall totals与并发等待嵌套重叠，不能相加。

## 完整8192笔延迟

单位ms，区间包含1ms直方图分辨率。客户端是实际观察时刻；节点点按endpoint、交易blockHash及state/Info各自高度post-state hash关联全部8192行。

|阶段|关闭P50|开启P50|关闭P95|开启P95|关闭P99|开启P99|
|---|---:|---:|---:|---:|---:|---:|
|offer→客户端有效入块观察|1221.000–1222.000|1227.000–1228.000|1883.000–1884.000|1754.000–1755.000|2206.000–2207.000|2030.000–2031.000|
|offer→客户端final观察|1589.000–1590.000|1544.000–1545.000|2286.000–2287.000|2083.000–2084.000|2623.000–2624.000|2289.000–2290.000|
|offer→节点Finalize返回|988.971–990.000|1005.978–1007.000|1606.971–1608.000|1570.978–1572.000|1729.971–1731.000|1674.978–1676.000|
|offer→节点durable Commit返回|1034.971–1036.000|1054.978–1056.000|1676.971–1678.000|1621.978–1623.000|1787.971–1789.000|1731.978–1733.000|
|节点Commit→客户端final观察|523.971–525.000|471.978–473.000|818.971–820.000|617.978–619.000|1335.971–1337.000|790.978–791.797|

P95/P99的客户端入块和final尾部均改善，有限case的final P95低于3秒；客户端入块P50以及节点Finalize/Commit P50略升，照实保留。节点校准误差上界before14,607ns、after10,799ns。before242行state前进、189行Info前进；after172行Info前进，各自高度hash均与原节点日志匹配。节点Commit返回不是最早quorum形成瞬间；原native/source/BFT资格与后验clock关联分别记录，不让单节点时间点代替共识证明。分位不能相加。

## Commit编码与落盘

只取原业务交易高度：before43高度×4=172次Commit，after39高度×4=156次；不同批次密度不能把节点阶段变化全部归因客户端复用。单位ms。

|Commit阶段|关闭平均|开启平均|关闭P95|开启P95|
|---|---:|---:|---:|---:|
|commit|43.923069|41.995419|80.149444|82.950638|
|validate|40.727941|38.778507|74.019583|71.292304|
|validate.app_hash|26.468191|24.989294|49.352938|48.714811|
|validate.semantics|14.198460|13.660215|28.253457|24.732892|
|delta_encode|0.213528|0.197244|0.343622|0.417260|
|write|0.159059|0.186033|0.267159|0.344965|
|file_sync|1.185633|0.962656|3.409610|3.181104|
|journal_maintenance|1.577577|1.779145|4.781948|22.337235|

Commit本身P95从80.149升到82.951ms，不能声称每个节点阶段都更快。端到端final P95下降更多对应客户端Commit之后的观察/读回等待缩短。原观察重试也保留在证据，终态业务0失败不代表没有轮询重试。

## 证据与下一步

独立原verdict620,069B，SHA256 `5ad17f1b0a748f78956e56c165d45e4d061c3c1f66eef919c1d226cf680799d7`。原artifact12542361319共99,757,921B，只恢复545个选中公开成员、43,804,004B；manifest `938de4544faafe95dc7c98becc9d2e2140d081fd287da8a790f04d378e70ddb9`。最终零网络字节重验CRC/SHA和两侧完整原流；先前8次60秒期限、1次TimeoutError及未全输入时的本地pending诊断都保留，没有重跑实验或whole ZIP下载。

[可审阅指标](evidence/native-current-input-run40047424926-qualified-comparison.json)。原源/配置/CI/单次授权、固定读取器、完整日志及capture保存在原owner artifacts目录。用原证据上下文重验（输出必须是新文件）：

```sh
python3 -B docs/performance/evidence/native-current-input-qualified-pair-reader-20261024.py \
  artifacts/chain-performance-20261017/native-current-input-pair-source-147eae73e \
  artifacts/chain-performance-20261017/native-current-input-pair-run-40047424926/capture \
  artifacts/chain-performance-20261017/native-current-input-pair-source-147eae73e/original-full.raw \
  artifacts/chain-performance-20261017/native-current-input-pair-source-147eae73e/original-terminal-run.json \
  /tmp/ynx-qualified-input-pair-new.json
```

开启复用后decode仍累计12.461秒，其中suffixReplay3.738秒、certificatePublish3.106秒、suffixEncode1.523秒、privateValidate1.284秒，privateNativeClone仅0.409秒。下一源码工作先拆certificatePublish中的payload复制/严格JSON规范化/私有clone，评估保全规范化语义、完整Validate与别名隔离的显式候选；不跳验证或削减持久化。

本次是一次有限固定顺序配对，未测连续600秒、未达到1000有效final/s；3,000–5,000及更高目标同样未达。不得把+10.21%或3秒以内有限case的P95当作持续目标完成。
