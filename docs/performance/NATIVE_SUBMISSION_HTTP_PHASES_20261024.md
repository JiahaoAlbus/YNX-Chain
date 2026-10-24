# 原8192×2完整流的提交HTTP子阶段诊断

原run40060919778已经记录每笔提交的HTTP钩子，本次复用原完整签名/终态流读取，未新增RPC、提交或压测。原独立配对verdict为600197B/SHA9966c308c44d1a7a18fec285fbc31cc31a7013a91ba75fb630875d5f26c4a1d6；原93729B/d7b370ee完整comparison没有覆写。这份诊断不增加网络、BFT或持续TPS资格。

新读取器先核原grant/request/frozen reader、case/client SHA及原完整readback，再对全部8192笔已匹配原签名身份的终态记录折叠HTTP事实。只保留最多8192条薄HTTP记录；缺失/重复钩子、错误次数、边界不序或覆盖不全均拒绝该诊断，不能造0ms等待。原102笔Go unit流没有HTTP事实时明确拒绝，不拿unit quorum冒充网络证据。未选择新join的原读取器输出保持不变。

## 原单调时钟边界

对照为原suffix初始化，候选为私有已验证初始化；两侧各8192条、每个钩子各一次、writeErrors=0，写出/首字节钩子重叠为0。单位ms，分位是原ns事实的精确最近秩，区别于之前完整offer/finality的1ms直方图区间。

|阶段|对照均值|候选均值|对照P50|候选P50|对照P95|候选P95|对照P99|候选P99|
|---|---:|---:|---:|---:|---:|---:|---:|---:|
|回调起点→GetConn|0.043|0.039|0.036|0.036|0.064|0.063|0.191|0.106|
|GetConn→GotConn|9.421|9.630|0.003507|0.003667|55.970|54.790|102.284|113.360|
|GotConn→写出|0.060|0.066|0.011|0.010|0.036|0.034|0.201|0.228|
|写出→首字节|9.971|10.456|2.001|2.100|36.664|40.637|98.240|105.487|
|首字节→回调返回|4.229|3.929|0.169|0.163|22.037|20.734|40.306|36.606|
|完整提交回调|23.724|24.120|3.302|3.525|106.405|108.398|184.063|189.731|

连接获取并非纯TCP连接耗时：它包括池可用性、拨号及Go调度；写出到首字节包括传输、服务端和调度；响应尾包括读取、JSON-RPC解码、身份核对及客户端调度。分位不能相加，worker wall累计可以重叠。复用连接8181/8183条，新增连接仅11/9条；复用连接获取均值9.433/9.640ms，新连接组均值0.694/0.306ms。新增组很小，不能作统计估计，但它说明长等待不能简单归因“每次新建TCP”。仅凭这些钩子也不能把全部等待断言为池阻塞。

当前源newClients共享HTTP transport，MaxConnsPerHost=4；观察与提交请求共享该上限。下一步在保持总连接上限、请求数、deadline与UNKNOWN语义的条件下复现观察请求占池对提交的影响，再决定是否做角色隔离或调整调度。原流还显示block_query699/718次、真正block_capture_and_merkle157/156次；源scanner每次refresh先取完整Block(nil)，应单独验证是否能用高度提示减少未前进时的重复块载荷，不能省略新块的签名、quorum、Merkle和持久化检查。

## 业务失败与观察诊断分开

业务终态失败/UNKNOWN/timeout/notSubmitted各为0，不等于所有观察尝试error为0。逐交易诊断计数准确复现原summary.errorOccurrences：

|诊断stage|对照|候选|
|---|---:|---:|
|block_scan_wait|49,963|50,891|
|local_durable_readback|77|204|
|合计|50,040|51,095|

这些是逐交易记录的累计诊断，不能当作相同数量的独立RPC失败。原观察阶段另有block_results_query错误6/163、8/164次，durable_business_batch错误3/130、5/129次。所有原诊断与消息保留在原流中，最终确认完成没有抹掉它们。

## 校验与复跑

原Go夹具及原读取器43项通过；原supply89项、pair15项、归档23项通过。新join覆盖缺钩子、重复/乱序/布尔类型混淆、错误次数、重叠分母、连接复用分组、计数界限、薄记录所有权及原完整签名身份不变。必要测试直接由原CI的test_native_stream_evidence.py步骤收取。两侧8192均实际通过新诊断，原public member manifest与callback累计精确一致。

[全部原始ns计数、P50/P95/P99、连接分组与输入身份](evidence/native-submission-http-run40060919778-20261024.json)。原误差与scope不变；不由本次读取宣称1000TPS达标，也不把新版只读字段计划收益写入旧运行。

```sh
python3 -B scripts/loadtest/native-stream-submission-trace.py --source-packet ORIGINAL_SOURCE_PACKET --case ORIGINAL_CASE --qualified-pair ORIGINAL_QUALIFIED_VERDICT --output NEW_OUTPUT
```
