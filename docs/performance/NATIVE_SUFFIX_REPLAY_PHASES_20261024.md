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
