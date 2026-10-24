# 增量日志重放细项计时

上一同条件四节点实验中，开启输入复用后suffixReplay累计3.738秒；规范化证书配对源4e4d26a71已冻结并通过原CI40054594269，等待Root新鲜窗口。本次源码继续拆解增量重放，不改该tag、其二进制或实验条件。

新增显式 `DecodeWithSuffixReplayPhaseTiming`，记录suffixReplay内部顺序子阶段：读帧与原长度/载荷校验、严格JSON记录解码、请求protobuf解码、Finalize、完整响应摘要与AppHash比较、内存Commit、末尾完整Validate。另保留checkpointValidate计数，但该API只细测增量路径，冷fullReplay不被冒记为增量细项。旧Decode与两个既有计时API省略新字段；未选择时不读取细项时钟。子项已包含于父suffixReplay，不能重复相加，未计时的分支检查等开销保留为父阶段余量。

本机Go1.25.7/darwin/arm64、GOMAXPROCS1/GOGC100/GOMEMLIMIT off，真实32笔签名、执行、Commit及原日志恢复得到2次冷重放、30次增量重放。没有独占主机，也没有原生多节点共识资格。非race测量如下：

|增量重放阶段|实际调用|累计ms|
|---|---:|---:|
|suffixReplay父阶段|30|5.889959|
|读帧及校验，含EOF|60|0.024829|
|严格JSON记录解码|30|0.121335|
|请求解码|30|0.007998|
|Finalize|30|4.733336|
|响应摘要及AppHash核对|30|0.014212|
|内存Commit|30|0.007250|
|末尾完整Validate|30|0.942203|

Finalize占父阶段80.36%，末尾Validate占16.00%。内存Commit只推进用于重放的私有应用状态，不写节点数据库，不能将这份0.007ms当成实际持久化延迟；真实节点Commit编码、write、fsync仍由原节点计时与后续网络实验测量。不能把本机32笔比例套算到旧Linux3.738秒或推导新的TPS提升。

[机器可读计数、比例与raw摘要](evidence/native-suffix-replay-local32-20261024.json)。原raw在owner的 `artifacts/chain-performance-20261017/native-stream-small-source/`，`native-suffix-child-real32-complete.raw` PASS0.676s；受影响block journal/native suffix测试race PASS11.388s，consensus/client vet通过。新计时值按值累计，客户端统计快照深复制新对象。验证覆盖原规范字节与状态完全相等、旧API输出形状、原完整Validate，以及坏帧、非法protobuf请求、响应错配原错误和旧证书保留、取消不执行后续工作。

最初两处测试夹具假设失败均保留raw：第33笔会触发checkpoint压缩，不能假定原字节前缀仍成立；`blockJournalFrame`只返回header，坏帧反例必须附上完整payload，不能把原有“不完整尾部可恢复”当成失败。修正后用真实31→32追加和完整坏帧，不改变恢复语义或删除拒绝断言。最初一次测试名称过滤零命中也保留，不计作通过证据。

复现新增差量：

```sh
GOMAXPROCS=1 GOGC=100 GOMEMLIMIT=off go test ./internal/consensus -run '^TestBlockJournalPrefixSuffixReplayDetails' -count=1 -v
GOMAXPROCS=1 go test -race ./internal/consensus -run '^Test(BlockJournal|NativeSuffix)' -count=1 -timeout=45s
```

原CI的prefix差量步骤自动匹配新测试。该细项API尚未被网络客户端选择，旧客户端计数与规范化证书配对读取器保持原形状。下一源码定位转向Finalize中的账户/手续费状态复制、交易执行与seal/app-hash成本，保留验签与完整Validate；网络对比仍只等待已提交Root的4e4d26a71具体一次性授权。持续1000有效final/s×600秒目标未达。

## Finalize进一步细分

后续诊断把同一原Finalize实现分为私有重放用计时入口：复制执行状态、执行交易及生成交易结果、seal状态、构造响应。原公开FinalizeBlock仍调用同一实现且不选计时；只在显式suffix细项API中分配Finalize计数。错误返回、单交易失败结果、持久化请求所有权和锁边界保持。新增计数嵌套在原Finalize内，原Finalize又包含在suffixReplay内，各层不能相加；聚合与客户端快照均深复制这层对象。

另一次本机32笔真实签名日志测得30次增量Finalize累计12.405665ms：

|Finalize子阶段|调用|累计ms|占本轮Finalize|
|---|---:|---:|---:|
|复制执行状态|30|0.146626|1.18%|
|执行交易及结果构造|30|8.729128|70.36%|
|seal状态|30|3.458666|27.88%|
|构造响应|30|0.015374|0.12%|

本轮主机未独占，绝对耗时与上面的早一轮明显不同，不能把12.406/4.733作为性能回退或仪表开销的同条件证据。当前结论只限定本轮内部占比：下一步重点是执行与seal内部真实成本，而不是继续盲改最外层复制。小账户/短手续费历史的占比也不能代替2048发送账户原生网络的结果。

[本轮原始计数与摘要](evidence/native-finalize-children-local32-20261024.json)。原raw `native-finalize-child-real32-first.raw` PASS1.394s；新增子计数守恒与嵌套别名断言后，受影响block journal/native suffix/application/commit timing组race PASS12.125s，客户端快照race PASS1.674s，consensus/client vet通过。必要测试仍由原CI匹配，不另造网络或合成业务资格。

Root后来签发了绑定冻结4e4d26a71的once grant。实际唯一Hosted dispatch开始02:42:15.248706Z，原run40055278746/job120756796984精确使用4e4；最初CLI JSON布尔值本地解析拒绝、未创建run的首因已保留，改用gh声明支持的raw-field输入后创建原run，没有重跑未知远端结果。源包记录所有原命令、时间、CI、grant及固定reader。此后Finalize诊断源码与该冻结网络源分离；原网络仍在途，结果未读回前不报告新TPS或延迟提升。

## 原生交易执行进一步细分

在显式suffix细项API内新增transactionDetails：封套类型解析、nativeDecodeVerified、nativeApplyState，以及嵌套在state内的nativeFeeEventAppend。原入口使用同一实现但不记录时钟；nonce/余额/lot/手续费事件/回滚逻辑保留。newCurrentFeeEvent及不可变journal追加作为真实调用测量，不把历史seal拷贝混入每笔追加。原交易执行阶段还包含生成交易结果等剩余开销，各子阶段与父阶段不可相加。

本机非race 32笔真实签名、执行、Commit与重放，30次suffix交易执行累计6.216792ms：封套解析0.125748ms，验签解码5.793334ms（占执行93.19%），账户状态更新0.184542ms；其中手续费事件构造和追加0.065377ms（占执行1.05%，嵌套在状态更新内）。32笔只验证一次，verification facts为lookups32/hits0/success32。nativeDecodeVerified仍包含摘要、缓存查询、解析和数学验签，不能把整个5.793ms称为纯数学验签。该小账户短历史的费用追加占比不能代替长历史seal、完整Validate或实际2048账户网络结果，也不能据此降低验签。

坏封套、坏签名、合法签名但错误nonce和成功路径均与原未计时入口逐字段比较输出及错误分类；失败不产生后续手续费事件，借用的提交状态不变。32笔子阶段计数/父子包含关系/聚合与快照隔离race通过；原native delta差分/晚手续费失败/验签缓存及重启/混合交易手续费顺序组race PASS13.352s，客户端嵌套快照race PASS1.792s，vet通过。新测试名匹配原CI的TestBlockJournalPrefix步骤。

[本轮全部计数、运行条件和原raw摘要](evidence/native-execution-children-local32-20261024.json)。所有前置样本保留，绝对耗时随主机负载变化，不以不同轮次的时间变化宣称优化收益。

当前冻结suffix初始化对比使用独立tag codex/chain-native-suffix-pair-ea2dc6b80（原CI40060431754 SUCCESS），Root新once grant对应唯一run40060919778/job120774026990；本段新增交易子计时不进入该冻结源码。旧canonical配对40055278746已完整读回并保留其端到端回退，详见对应比较报告。新配对尚未完成读回，持续1000有效final/s×600秒仍未达。
