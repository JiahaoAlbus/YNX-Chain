# certificatePublish 细项计时

前一同条件四节点实验40047424926已验证输入复用带来约10.21%的有限final速率改善，但开启后decode仍累计12.461秒，其中certificatePublish3.106秒、suffixReplay3.738秒。此次差量先测清发布内部成本，没有删除任何解码、完整Validate、规范化或持久化步骤。

新增显式 `DecodeWithCertificatePhaseTiming`，将原certificatePublish里的工作分为：

- payloadCopy：原规范化载荷的私有复制，以及当前日志前缀SHA256。
- strictJSON：原严格JSON解码与规范化。
- nativeClone：原私有native clone、载荷摘要及native身份封装。

记录实际调用/错误/墙时、载荷字节和被摘要的前缀字节。三项是父阶段的嵌套子项，不能再加到父阶段或总decode上。原 `Decode` 和 `DecodeWithPhaseTiming` API保持旧字段与行为；当前显式native streaming诊断路径选择细项API。统计按值累加、返回时深复制细项指针；失败规范化不发布新证书，旧前缀高水位和调用方状态隔离保持。

本机Apple M4/arm64、10 logical CPU，Go1.25.7，GOMAXPROCS1/GOGC100/GOMEMLIMIT off，非race的真实102笔签名/执行/Commit/nonce34/恢复夹具得到：

|阶段|调用|累计ms|
|---|---:|---:|
|certificatePublish父阶段|102|38.008414|
|payloadCopy及前缀摘要|102|2.547459|
|strictJSON规范化|102|32.677634|
|nativeClone及身份封装|102|2.707745|

实际载荷总计4,123,395B，前缀摘要总计3,526,513B。strictJSON约占父阶段86%。同机仍有源码轻测并行，wall时间包含调度/GC；这是定位后续候选的本机应用/读取器证据，quorum标记仍为unit gates。不能用该比例拆算旧Linux的3.106秒，也不能声称四节点吞吐再次提高。

[机器可读证据](evidence/native-certificate-publish-local102-20261024.json)。原raw在owner的 `artifacts/chain-performance-20261017/native-stream-small-source/`：

- `native-certificate-publish-details-red.raw`：原真实Go公开夹具缺少细项计数的RED。
- `native-certificate-parts-signed-plain.raw`：上述非race、单Go逻辑核真实夹具，PASS2.120s。
- `native-certificate-parts-prefix-regression.raw`：原prefix/native clone/计时与新增失败、别名、高水位race回归，PASS3.230s。
- `native-certificate-parts-native-reader-race.raw`：当前输入复用及新计数快照隔离，PASS2.250s。
- `native-certificate-parts-reader-final.raw`、`native-certificate-parts-controller-all.raw`、`native-certificate-parts-artifact-final.raw`：32项读取、88项控制器、21项归档通过。

读取器严格绑定子项分支调用、错误守恒、父子时间关系及字节上限；未选择时缺省字段仍省略。Go公开真实fixture与Python消费合同已联动验证，避免再次只用合成旧字段覆盖producer。

下一步评估保全JSON规范化语义的显式native证书构造候选，覆盖nil/empty、时间值、未来字段回退、不可变别名和完整Validate。尚未实现该优化或进行新的网络实验；1000有效final/s持续600秒目标仍未达到。新的四节点重负载仍由Root按具体源码/预算排程。

## 规范化复制候选的实际组件对比

新增 `cloneCanonicalNativeCommittedState` 私有候选，尚无decoder构造器或运行参数选择它。原native私有复制后，对封闭原生账户/手续费结构恢复严格JSON往返的对象语义：omitempty空容器、时间值的UTC/单调时钟/时区规范化，以及独立账户Lots和手续费切片。无法支持的未来字段、JSON自定义编码器、歧义标签、无效UTF8或时间返回false；后续调用方必须保留原严格JSON回退与完整Validate。

同机同配置使用32笔真实签名、Finalize、Commit与日志恢复产生的同一份25,763B规范载荷，交替先后顺序测7轮，每轮每路径32次，总计224次。原严格JSON解码加私有复制累计55.233ms，候选规范化复制10.857ms，组件累计耗时下降80.34%。逐轮结果和原raw SHA见[机器可读组件证据](evidence/native-canonical-certificate-component32-20261024.json)。测量前证明对象DeepEqual、编码字节相等与完整Validate；计时不包含签名、执行、Commit、完整Validate或网络共识，不代表整条发布链或网络提升。没有排他占用主机，轮次存在调度/GC变化，不能将组件比例外推至旧Linux实验。

复现命令（仅显式轻量组件测量）：

```sh
YNX_MEASURE_CANONICAL_NATIVE=1 GOMAXPROCS=1 GOGC=100 GOMEMLIMIT=off go test ./internal/consensus -run '^TestBlockJournalCertificateCanonicalNativeMatchedMeasurement$' -count=1 -v
```

普通CI自动运行该候选的规范化、未来字段拒绝、别名隔离与真实签名状态一致性测试；上述性能测量仅显式选择。下一步将候选接入独立显式decoder模式，绑定分支计数与回退证明，再安排四节点同条件比较。当前网络成绩仍为252.644有效final/s的有限case。
