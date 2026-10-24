# 严格解码私有证据状态的重复复制

原102笔真实执行/Commit/nonce34/恢复分配采样中，JSON Decoder.refill占16.81%居首，strict JSON后的再次完整私有复制也产生分配。本差量保留原strict decoder，减少解码账户/手续费数组的增长及随后的重复数组复制；不宣称消除了Decoder.refill热点。

仅原显式native prefix构造路径生效，原普通prefix默认路径及canonical编译化选择保持。已知输出行数仅作容量提示，提示受payload尺寸约束，不能作为校验权威。仍原DisallowUnknownFields、完整解码及EOF检查。缺失/null/实际行数不符时重新用fresh target做原解码，保持nil/empty及错误语义；不支持的结构或容量增长仍走原clone/fallback。私有局部状态可直接接管精确容量账户/手续费数组，原Lots映射复制保留，避免保留解码映射增长桶。公开返回仍完整私有clone，所有完整Validate、签名、hash、fee、nonce和恢复检查保持。

同一真实1024笔历史，同一个候选二进制，原strict decode+clone oracle与新owned decode+map-copy交错ABBAAB，50ms/子样本，GOMAXPROCS=1，Apple M4/Go1.25.7 darwin arm64：

| 每次完整strict解码和私有发布 | 原路径中位数 | 候选中位数 |
|---|---:|---:|
| 分配字节 | 3554072 | 2811346 |
| 分配次数 | 9578 | 9542 |
| 耗时ns | 3995853 | 3977484 |

分配字节减少20.8979%。最终耗时样本交叠，且同期有聚焦race轻测，不声称稳定耗时加速。该组件基准不包括外层payload复制/SHA、整个应用或节点；不是网络RSS/吞吐收益。旧原型与中间测量raw保留，没有覆盖。

新增反例对照原严格解码的首错误与完整对象，包括未知字段、尾部、多值、字段类型、空值/缺失、重复字段及大小写字段；真实状态检查所有值、原容量、调用方修改和完整public Validate。原native clone/损坏私有fee/损坏payload/并发/重启反例保留。最终完整consensus、ABCI、perf client套件分别7.940/0.604/17.046秒通过，聚焦race2.068秒通过。原make consensus-abci-check自动覆盖新增测试，不新建CI入口。

原四节点失败run40075983041还未启动新核验子进程；本源码没有参与该run。其client.log已自报8192 final后context canceled，源码显示reader被defer stats持有到客户端内部全流证据核验结束；下一具体动作是在所有观察worker已join后固化原stats、释放reader引用，再执行原完整核验。此为下一待测生存期差量，不把本分配结果当成已解决RSS限制。

原始输入、源码和raw精确SHA及可复跑样本见[机器证据](evidence/native-owned-strict-certificate-local-20261024.json)。运行命令：

```sh
GOMAXPROCS=1 GOPROXY=off GOTOOLCHAIN=local go test -p 1 ./internal/consensus -run '^TestBlockJournalOwnedCertificate' -bench '^BenchmarkBlockJournalOwnedCertificateActualHistory$' -benchtime=50ms -count=1 -timeout=45s
```

源码固定关系与正常CI将在本次提交后核验。仍未证明四节点RSS修复、有效吞吐提升或持续1000final/s×600秒。
