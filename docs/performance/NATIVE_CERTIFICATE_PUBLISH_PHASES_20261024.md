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

细项计时完成时，下一步为评估保全JSON规范化语义的显式native证书构造候选，覆盖nil/empty、时间值、未来字段回退、不可变别名和完整Validate。后续源码进展见下文；尚未进行新的网络实验，1000有效final/s持续600秒目标仍未达到。新的四节点重负载仍由Root按具体源码/预算排程。

## 规范化复制候选的实际组件对比

提交e451b4359新增 `cloneCanonicalNativeCommittedState` 私有候选，当时尚无decoder构造器或运行参数选择它。原native私有复制后，对封闭原生账户/手续费结构恢复严格JSON往返的对象语义：omitempty空容器、时间值的UTC/单调时钟/时区规范化，以及独立账户Lots和手续费切片。无法支持的未来字段、JSON自定义编码器、歧义标签、无效UTF8或时间返回false；调用方必须保留原严格JSON回退与完整Validate。

同机同配置使用32笔真实签名、Finalize、Commit与日志恢复产生的同一份25,763B规范载荷，交替先后顺序测7轮，每轮每路径32次，总计224次。原严格JSON解码加私有复制累计55.233ms，候选规范化复制10.857ms，组件累计耗时下降80.34%。逐轮结果和原raw SHA见[机器可读组件证据](evidence/native-canonical-certificate-component32-20261024.json)。测量前证明对象DeepEqual、编码字节相等与完整Validate；计时不包含签名、执行、Commit、完整Validate或网络共识，不代表整条发布链或网络提升。没有排他占用主机，轮次存在调度/GC变化，不能将组件比例外推至旧Linux实验。

复现命令（仅显式轻量组件测量）：

```sh
YNX_MEASURE_CANONICAL_NATIVE=1 GOMAXPROCS=1 GOGC=100 GOMEMLIMIT=off go test ./internal/consensus -run '^TestBlockJournalCertificateCanonicalNativeMatchedMeasurement$' -count=1 -v
```

普通CI自动运行该候选的规范化、未来字段拒绝、别名隔离与真实签名状态一致性测试；上述性能测量仅显式选择。当前网络成绩仍为252.644有效final/s的有限case。

## 显式decoder接入与完整发布函数对比

新增 `NewBlockJournalCanonicalNativePrefixDecoder`，继承原native suffix模式，仅在显式构造器中选择候选。复制后的对象重新编码后，必须逐字节等于原SnapshotJSON才接受；不支持的结构、编码错误或字节不一致均回到旧严格JSON路径。旧构造器和默认运行参数保持原路径，签名、执行、持久化、前缀高水位及复用时的完整Validate保持。`canonicalNative`嵌套计时包含候选复制、编码和字节比较，`canonicalNativeAccepted`记录接受次数；这些成本已包含在父certificatePublish里。旧模式省略新增字段。读取器须显式选择canonical_native才能接受新计数，并验证接受/回退/严格解码/封装调用守恒；统计快照深复制新的计时指针。

同一32笔真实历史、同一载荷、7轮交替顺序、每路径224次，完整 `makePrefixCertificate` 的旧路径累计40.436ms，候选32.710ms，下降19.11%。这里包含payload复制、前缀SHA、重新编码比较、payload摘要与封装；组件80.34%的收益不能直接替代该结果。原始逐轮数据见[完整发布函数证据](evidence/native-canonical-certificate-publication32-20261024.json)，同一显式测量命令可复现。这仍是本机函数测量，没有网络共识或持续TPS资格。

真实4笔签名日志同时覆盖冷读、suffix、相同输入复用、旧输入高水位、调用方修改隔离、候选拒绝及字节不一致回退、畸形JSON原错误和取消。Go实际输出计数已交给Python消费者验证：4次候选接受、0次严格JSON；未选择候选模式则拒绝这份输出。原prefix及新增测试race通过3.446s。

前一提交的CI40053396149在go vet失败：测试中故意重复的静态JSON标签触发structtag检查。保留原失败raw，将同一歧义schema改为reflect.StructOf动态构造，保留拒绝断言；没有禁用vet或删反例。本机针对consensus/client的vet已通过。一次本机消费者调用漏选原Go fixture而失败、一次Go名称过滤零命中均保留；补跑均使用明确fixture/真实测试名，不计作通过证据。

下一步将显式模式接入受约束客户端参数与四节点同条件配对，绑定配置、实际计数和原始读取器资格；尚未启动新的四节点测试。

## 客户端显式模式与真实102笔读回

客户端新增默认关闭的 `-native-canonical-certificate`，只允许原native stream8范围选择；原有限native8、普通stream或缺失原校验/资源约束均不能选它。模式同时写入顶层报告、durable plan的nativePrefix及实际prefixReplay计数。新的有界构造器保留原stream的suffix初始化和实例字节上限，仅改变证书构造；不会把先前独立suffix候选混进本次对比。当前四节点配对控制器尚未生成该候选命令，默认路径不推广该参数。

实际客户端使用3个临时发送账户×34个nonce周期，完成102笔真实签名、状态执行、Commit、日志重开和读取器验证；原公开流完整读回得到102行及3个最新槽位。实际canonicalNative尝试/接受均102、strictJSON调用0、原交易签名验证102；复用路径完整Validate95次，其余冷重放保留原校验。原32MiB输入/规范载荷边界、缓存预算和reader gate保持。该夹具中的quorum仍为unit gates，不证明网络共识或性能。

[实际102笔客户端计数和fixture摘要](evidence/native-canonical-client-real102-20261024.json)。原raw为owner artifacts下的 `native-canonical-client-first.raw`（race PASS8.299s），公开fixture为 `native-stream-controller/public-go-canonical-client-fixture`。Python35项（包括两项新增真实候选fixture消费）PASS0.441s，有界构造器race PASS1.434s，针对consensus/client的vet通过。原CI新增候选fixture独立目录及同任务消费/归档，避免覆盖原对照fixture；候选实际102次构造、plan/backend选择、原完整流和未选择模式拒绝自动验证。

复现真实客户端夹具（目录必须是尚不存在的绝对路径）：

```sh
YNX_NATIVE_CANONICAL_PUBLIC_FIXTURE_DIR=/absolute/new-fixture GOMAXPROCS=1 go test -race ./cmd/ynx-consensus-perf-client -run '^TestNativeStreamingCanonical' -count=1 -v
```

四节点报告校验已显式绑定canonical选择、实际backend、子分支计数和原字节上限；不匹配或未选择模式拒绝。下一步将单轴开关接入原同条件pair recipe/command及durable plan验证，完成原CI后提交Root具体窗口申请。尚无新网络吞吐或入块/最终确认延迟结果，持续1000有效final/s×600秒仍未达。
