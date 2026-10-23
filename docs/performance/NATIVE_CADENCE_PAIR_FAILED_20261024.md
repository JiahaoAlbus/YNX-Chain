# 原四节点成对实验 40034580462：失败与实测耗时

本次relative侧触发30秒客户端期限，第二侧没有启动。8192笔全量未通过，不能给出A/B收益或持续1000TPS结论。冻结源码6d653b638，正常前置CI40033709946成功；原workflow dispatch于2026-10-23T22:35:18Z发生一次，run于22:43:16Z失败退出，没有重试。硬件AMD EPYC7763、4 logical CPU，与此前AMD9V45样本不同，不能跨run作优化归因。

## 原失败业务与清理

|原报告计数|数量|
|---|---:|
|计划输入|8192|
|offered / submitted / accepted|6533 / 6525 / 6517|
|观察到有效入块及最终确认|6312|
|UNKNOWN / timeout|8 / 205|
|未提交（含从未offered）|1667|

原始终端流6533行分为confirmed6312、submission_unknown8、timeout205、not_submitted8；另1659个计划输入没有offered。6592个原始签名意图、两条完整hash/seal链与所有已有终端身份均已读回核对，失败没有被改写为成功。8个取消前未提交的终端行本身不含签名载荷，保持为失败行。新nonce供应等待为0；在途账户峰640，提交前队列峰51，接收后等待观察完成峰627。

实际offer事件间隔速率222.445/s。失败报告的29.391853秒窗口内已观察到6312笔final，即214.753/s；这是失败窗口的部分完成率，不能作为8192笔成功负载的TPS。首侧终态34.275秒，pair34.600秒。原末端两次proc扫描均为launcher39035/startTicks45502、owned仅[39035]；workflow已退出，独立失败verdict的slotReturned=true、nativePairQualified=false。

## 真正采集到的阶段耗时

|发送/观察阶段|累计秒|
|---|---:|
|pacingWait|26.326116|
|其中正间隔余量|6.299473|
|其中唤醒迟到|20.027519|
|签名4544次|0.794290|
|编码4544次|1.404238|
|意图落盘103批|0.115133|
|终端sink6533次|0.551526|
|持久化读回load|13.076676|
|其中decode|11.591945|
|其中prefix private Validate114次|2.515713|
|其中private native clone114次|0.569638|

客户端CPU21.983140秒，占一个核74.7933%；callback busy累计153.044275秒跨8个worker重叠。外层读回互斥锁wait/hold未在此冻结版记录，内部prefix gateWait仅0.000109秒不能代替它。读回load/decode/prefix子阶段嵌套，CPU、并发wait和阶段wall totals不能相加当作关键路径。原cache输入17,567,260B、evictions0；采样RSS峰953,520,128B，未触1GiB守卫。没有独立归因纯GC或各节点CPU。

下面来自原四份ABCI日志，取有已确认业务观察的35个高度、140次Commit，单位ms：

|Commit阶段|平均|P95|
|---|---:|---:|
|整体|32.969993|64.130728|
|完整Validate|29.611590|55.182204|
|其中app_hash|19.103071|36.718271|
|其中semantics|10.453504|20.122749|
|delta_encode|0.190364|0.283822|
|write|0.137177|0.207018|
|file_sync|1.202881|3.391413|
|journal_maintenance|1.757409|12.072262|

validation子项已包含在Validate及Commit里。当前证据支持先处理发送节拍及读回归因；手续费历史私有复制累计0.570秒并不是这轮最大的已测阶段。

## 延迟的证据边界

仅对6312笔confirmed子集，从原始逐行字段重折1ms区间，offer→有效入块观察P50/P95/P99为1.115–1.116 / 1.505–1.506 / 1.760–1.761秒；offer→原生最终确认观察为1.394–1.395 / 1.798–1.799 / 2.094–2.095秒。其余1880个计划输入不在该分布内，因此它不能证明完整负载P95目标通过。它测量客户端观察上界，未提供单独的节点精确入块/持久化完成绝对时刻；不把块头时间冒充完成时间。

## 已完成的源码修复与下一动作

- 下一差量新增显式native stream外层readerGate等待/持锁计时；CODE a20ce9313、固定证据228f580e4，正常CI40034982817成功，未混入本次冻结实验。
- 本次pair终态postFsyncSample=null的原因是原PairBudget.observe采样/enforce/保存后没有return，已补RED与真实返回值，并拒绝缺失采样的成功终态。
- 原范围读回的中断成员原先遇到FileExistsError；现逐字节核对保留前缀后续写，完整成员SHA/CRC一致后才发布。原3,400,312B前缀的SHA保留，完成后7,007,118B原客户端结果与原回执hash一致。
- 下一版显式客户端期限40秒，两侧计划与命令一致；原45秒active、15秒cleanup、60秒单侧、120秒pair及资源上限不变。期限调整不能当作吞吐收益。

这组三项CODE 88b34c5ce，固定证据d6fb96d3e；正常CI40036621797成功。新的四节点执行须由Root按新源和预算另排一次窗口，原grant已消费。本次不重发、不回放UNKNOWN、不缩小8192输入制造通过。

原artifact12537260325共37,414,933B，按原范围/ETag/cache恢复223个选中公开文件、18,705,950B；最后纯离线重验没有新网络字节。选中成员manifest SHA为8d35e88c052a20936704f9377b4023a524b2088a2b58f57b9b87d6b85bf6db85，无完整ZIP摘要冒报。原60秒超时、FileExistsError、metadata漂移拒绝与后续恢复均保留。完整恢复与业务失败分别记录。

证据：[失败侧指标](evidence/native-cadence-pair-run40034580462-failed-side.json)。复跑原读取器（只读，不运行节点）：

```sh
python3 -B docs/performance/evidence/native-cadence-pair-failed-side-reader-20261024.py \
  artifacts/chain-performance-20261017/native-cadence-pair-source-6d653b638 \
  artifacts/chain-performance-20261017/native-cadence-pair-run-40034580462 \
  /tmp/ynx-original-failed-side-new-output.json
```

便携读取器已对原数据重放，输出18,480B、SHA e0ad6eca1699520fc725b098bd77ce1dae34a1304bbc4e715af0aa38e4dd0963，与原诊断完全一致。它不独立重做BFT密码学验签，不给失败负载授予成功资格。
