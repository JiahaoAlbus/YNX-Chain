# 默认关闭的区块高度提示候选

当前是已实现、源码轻测已验证、未做四节点性能对比。候选只改变客户端发现新区块的方式，不启用任何默认优化，也没有新的网络 TPS 收益结论。

原 run40060919778 完整观察计数显示 block_query 为699/718次，block_capture_and_merkle 为157/156次。源码每轮刷新都取最新整块，即使高度没有变化，也会重复传输、解码已有交易。候选 `-native-block-tip-hint` 用 Status 的高度和哈希发现变化；每个新高度仍取完整区块，执行原 commit、validator quorum、区块身份、Merkle、交易结果及 fresh durable 核对。Status 不能产生入块或最终确认凭证。

同一个签名 fixture 连续刷新9次：默认路径取9次整块，候选取9次 Status 和1次整块；两侧都验证1个区块，候选继续核对3笔真实签名、执行和持久化交易。每次重复整块含1239字节交易载荷。这是实际调用次数证据：整块响应减少8次，而发现与取块的总RPC数从9增至10。尚未测量网络字节、整体耗时或网络吞吐收益，不能据此计算 TPS 倍数。

候选拒绝错误链、异常高度/哈希、回退、冲突的已认证边界和缺少 Status 能力；没有回退到其他模式。上下文取消不得推进游标或发表缓存。追赶仍每轮最多8个高度，原128高度窗口、16块/8MiB缓存上限保留。已缓存证据仍不能绕过当前磁盘数据核对；损坏签名、交易载荷、执行结果及 durable 状态的反例保持失败。

Go scanner/scope race 检查通过；新增成对运行和停止规则17项、报告与资源边界89项、公开归档恢复23项通过。公开归档测试使用本轮 Go 实际102笔签名、执行、Commit、nonce34及证据恢复的产物；其中 quorum 是明确标记的单元门，不是多节点共识。新 scanner race 检查接入原 chain-core CI。

单轴配置为 `paired-native-block-tip-hint`：同一构建、同VM，8提交者/4观察者、bounded-cadence、currentInputReuse=true；两侧 canonicalCertificate=false、nativeSuffixSetup=false，只有高度提示开关变化。原每case40秒业务窗口、60秒含清理上限和120秒pair、资源与证据预算保持。第一轮失败、UNKNOWN、文件不完整、二进制或host改变、进程未清理时不启动第二轮。

```sh
GOMAXPROCS=1 go test -p 1 -race ./cmd/ynx-consensus-perf-client -run '^Test(BlockScanner|ObserverPhaseTiming|NativeStreaming.*Scope)' -count=1 -timeout=45s -v
python3 -B -m unittest discover -s scripts/loadtest -p test_native_stream_pair.py
python3 -B -m unittest discover -s scripts/loadtest -p test_supply_linux_window.py
python3 -B scripts/loadtest/supply-linux-window.py --prepare-pair --pair-kind native-block-tip-hint --observer-phases --transport grpc --profile supply-native-stream-2048x4
```

机器事实、源码文件SHA和原始输出SHA见 [本地证据](evidence/native-block-tip-hint-local-20261024.json)。`--prepare-pair` 只生成配置，没有启动节点。四节点运行仍需 Root 新鲜压力等级1及明确资源窗口。下一轮分别报告 Status查询/校验、整块查询、commit/validator/quorum、Merkle、持久化读取的真实次数与耗时，并与实际供给、有效入块和最终确认速率及P50/P95/P99关联。1000有效final/s连续600秒目标未达。
