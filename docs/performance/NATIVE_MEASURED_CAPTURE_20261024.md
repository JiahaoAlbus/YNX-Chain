# 按实际哈希长度一次分配持久化捕获缓冲

新高度提示原run40068452896的后侧触发原1GiB RSS守卫：采样1,077,927,936B，超4,186,112B；原对照通过，后侧失败，pair无资格、没有收益结论，grant已耗尽且不重试。原post-fsync清理检查均回到同launcher。完整失败artifact仍续读，RSS峰值来源尚未最终归因。

本轮对真实102笔签名、执行、Commit、nonce34及恢复单元做alloc_space诊断，发现持久化读取的io.ReadAll缓冲扩容是实际分配热点。没有以此声称网络RSS根因。已在现有显式native-current-input-reuse模式内，按原第一遍完整哈希实际读到的长度预分配一次，分块读取全部数据，再额外探测一个字节确认EOF。仍在原journal读锁、profile预算锁下，保留第二遍完整SHA、长度、文件身份检查及之后的原验证。缩短、增长、错误读取、无进展和取消均失败；不允许截取前缀作为证据。默认/legacy模式保留原ReadAll路径，未调整GOGC、RSS上限或历史。

同一份3111字节真实签名业务journal，SHA26b9230092754d72d0df2dae35aab41afe0acae3f9be812d2425ce974ac7146b，分别捕获16次：原累计分配193664B，新52224B（约−73.03%）；每次分配8→3。全部捕获SHA/长度一致。这是捕获组件的同输入证据，不是总内存或网络吞吐收益。race下记录的时间不用于速度结论。

新增边界测试及原current-input的验签/fee/nonce/scope、rename/truncation、并发预算、独立store、取消反例均race通过。原102笔实际签名、执行、Commit和流恢复通过；quorum仍是单元门，不能称四节点共识。测试名TestNativeStreamingMeasuredCapture已被原chain-core的NativeStreaming race入口覆盖，无需额外测试入口。

两次完整102单元的分配profile使用不同临时身份和时序，采样alloc_space只能作热点诊断，不能当严格同输入全流程或RSS前后收益；原始profile和测试输出全部保留。[机器证据](evidence/native-measured-capture-allocation-local-20261024.json)记录精确源码SHA及原始输出SHA。

```sh
GOMAXPROCS=1 go test -p 1 -race ./cmd/ynx-consensus-perf-client -run '^TestNativeStreaming(MeasuredCapture|CurrentInput)' -count=1 -timeout=45s -v
GOMAXPROCS=1 go test -p 1 ./cmd/ynx-consensus-perf-client -run '^TestNativeStreamingRealExecutionNonceEvidenceAndRecovery$' -count=1 -timeout=45s -v
```

下一步继续读回失败原件，按原实际每个进程和交易进度定位峰值，保留首因、UNKNOWN和部分证据；源码CI成功后再由Root决定新的同条件窗口。没有新执行授权，也未证明1000有效final/s持续600秒达标。
