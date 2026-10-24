# checkpoint 编码临时复制

原失败run40075983041的4节点日志，在高度18记录journal维护均值174.999ms、最大213.683ms，与原每16块checkpoint边界一致。维护还包含锁/身份检查、编码、写入、Sync、rename和目录同步；没有子阶段实测就不把这些耗时全归因于JSON。本差量只减少其中明确存在的完整payload额外复制，不推断消除了fsync尾延迟。

原encodeBlockCheckpoint使用json.Marshal，编码缓冲之外再分配完整owned payload。替换checkpoint时，现在用原json.Encoder缓冲同步完成全部原frame写入，排除且仅排除Encoder的最后一个framing换行，回调返回后不保留该slice。原初始checkpoint/其他调用的Marshal接口保留。所有payload尺寸限制、frame hash/长度、原Write、文件Sync/Close、rename、目录Sync、身份更新及故障hook顺序保留；不减少历史、Sync或校验，不改checkpoint间隔或任何cap。

同一真实1024笔历史，同候选二进制原Marshal与同步借用Encoder缓冲ABBAAB，50ms/子样本；两侧都完整SHA消费payload，核相同输出。Apple M4/Go1.25.7 darwin/arm64，GOMAXPROCS=1：

| checkpoint编码+完整SHA消费，每次中位数 | 原Marshal复制 | 借用缓冲 |
|---|---:|---:|
| 分配字节 | 707591 | 76787 |
| 分配次数 | 2052 | 2052 |
| 耗时ns | 864147 | 767543 |

该局部样本分配减少89.15%，耗时减少11.18%。不是实际磁盘checkpoint总耗时、完整Commit或业务吞吐；没有方差/持续负载资格，也不能据此推断节点RSS。JSON时间字段等原有分配仍然存在。

字节oracle覆盖原真实完整状态、空状态及Unicode/NUL/HTML/无效UTF8/特殊时区、Lots顺序；payload和frame逐字节等于原Marshal。实际隔离journal替换后的整个文件等于原header/frame/payload，重开后完整状态相等。原编码失败时不调用持久化回调；回调错误保持首因；compaction_synced/compaction_renamed失败后原writer保持poisoned，只能重开恢复。单写入framing及重复调用反例保留。

完整consensus/ABCI/client套件7.382/0.540/14.626秒通过，新增及原跨checkpoint/异常退出路径聚焦race9.618秒通过。继承原consensus CI入口，不另起节点。原始输入、源码、输出SHA与精确指标见[机器证据](evidence/block-checkpoint-borrowed-payload-local-20261024.json)。

```sh
GOMAXPROCS=1 GOPROXY=off GOTOOLCHAIN=local go test -p 1 ./internal/consensus -run '^TestBlockCheckpointBorrowed' -bench '^BenchmarkBlockCheckpointPayloadActualHistory$' -benchtime=50ms -count=1 -timeout=45s
```

当前Hosted run40078716515冻结1c86e2bad；本差量不在该run中，不污染其同条件结果。后续正常CI及真实多节点验证仍待完成。持续1000有效final/s×600秒未达到。
