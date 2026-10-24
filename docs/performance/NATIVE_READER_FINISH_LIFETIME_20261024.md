# 全流核验前释放测量 reader

原四节点失败run40075983041在client仍存活时超过1GiB RSS2228224B。client.log在context canceled前已经自报8192 final，但这不是独立合格结果。源码显示reader通过defer stats保持到客户端内部verifyStreamingWorkloadEvidence完成；此前把父进程最终核验移入短生命周期子进程，无法解除这一客户端内部阶段的重叠。

本差量在原显式nativeStream8测量返回、所有观察worker已join、CPU及测量墙钟已固化后，保存同一reader.stats，再解除reader引用，然后继续原summary完整性检查、plan SHA、完整intent/terminal证据读回、报告编码和Sync。默认legacy仍到原函数结束才保存统计。所有提前失败仍由defer保存统计；重复finish不覆盖先前快照。不清除历史、不改变签名/nonce/fee/共识检查，不强制GC或调整GOGC/预算。

原保留行为被真实反例复现：1笔实际签名执行/Commit后的双路径reader缓存，在核验阶段仍可达，测试RED；修复后reader、prefix decoder、slot和原输入缓冲的weak指针全部失效，原正对照仍保持可达。统计在释放前后DeepEqual，重复及defer finish不覆盖。该小夹具统计编码输入6222B；这里只证明生存期，没有把它称作网络RSS下降量。GC仅测试观察使用，运行源码无GC调用。

共享102笔真实签名、执行、Commit、nonce34、流恢复和重启/重放拒绝流程，已改为在原完整证据读回前释放reader，并用完整保存的统计导出。普通native、canonical、suffix三模式均通过。初次共享测试导出仍访问已释放reader产生panic，原raw保留；已修为使用完全相同的保存统计，最终三模式全部通过。quorum仍为单元门，不能称真实BFT压测。

完整consensus/ABCI/perf-client套件分别7.306/0.510/16.386秒通过，聚焦native current-input/102/lifetime race5.786秒通过。继承原CI入口，无新增节点或heavy运行。源码与raw精确SHA见[机器证据](evidence/native-reader-finish-lifetime-local-20261024.json)。

```sh
GOMAXPROCS=1 GOPROXY=off GOTOOLCHAIN=local go test -p 1 ./cmd/ynx-consensus-perf-client -run '^TestNativeStreamingFinishedReader' -count=1 -v -timeout=45s
GOMAXPROCS=1 GOPROXY=off GOTOOLCHAIN=local go test -p 1 ./cmd/ynx-consensus-perf-client -run '^TestNativeStreaming(RealExecutionNonceEvidenceAndRecovery|CanonicalCertificateRealExecutionAndRecovery|SuffixRealExecutionAndRecovery)$' -count=1 -v -timeout=45s
```

本修复与已交付的strict解码数组接管/fee audit临时分配优化可同时进入新的冻结源码。后续同条件四节点窗口仍须Root新鲜压力等级1排程和Linux临启guard，保留原失败阻after、45+15/60秒case、120秒pair及全部资源限制。任何通过只说明该有限样本，不自动推断稳定1000final/s×600秒或P95最终确认达标。当前尚无网络RSS修复或吞吐改善证明。
