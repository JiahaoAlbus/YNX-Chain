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
