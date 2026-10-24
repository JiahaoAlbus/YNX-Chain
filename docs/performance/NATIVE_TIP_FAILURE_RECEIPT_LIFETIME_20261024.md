# 高度提示原窗口RSS拒绝及调度回执生命周期修复

原run40068452896/job120796540496在后侧约20秒触发RSS守卫，pair失败，未重试。原前侧post-fsync qualified=true，后侧qualified=false；完整公共流仍在读回，不能把后侧作为8192笔成功结果，也没有可用的成对吞吐收益。原grant5713B/SHAa8eb606732ecf79f82d8b7831e8a1a30e1e88e305cb17f80261e780bd0b8ae2f已消费。原两侧和pair的两次清理检查均仅剩同launcher39057/startTicks31849。

原请求、固定源码12文件、正常CI、唯一dispatch、原完整日志、pair/两侧receipt SHA与同VM/四ELF已逐项核对；独立资源诊断reader拒绝任何不匹配。不是完整交易流资格验证，也不新增网络资格。

| 聚合RSS峰值时的角色 | 前侧字节 | 后侧拒绝样本字节 |
|---|---:|---:|
| 合计 | 1042145280 | 1077927936 |
| launcher | 36397056 | 65699840 |
| client | 329490432 | 321417216 |

原上限1073741824B，后侧超4186112B；线程65，未调高上限。四ABCI/四Comet分项与完整原始样本见机器JSON。两列是各自不同时间和交易进度的聚合峰值，不能说客户端减少、launcher增长就是候选的因果效果，独立各角色峰值也不能相加。原前侧完成后的post-fsync launcher已约62MB，提示其元数据/读取阶段高水位会进入后侧；仍不能把全部29MB归因于某个对象。

源码确认原控制器把baseline=row和局部row留到后侧run()调用期间。先加入weakref生命周期反例，原实现RED：完整前侧回执进入第二侧激活时仍存活。修复只保留原sourceCommit/sourceTree/internalTree/compiler/binaries/environment和host.uname/cpuCount比较字段，在完成完整资格验证、保存结果和清理检查后释放row。required measurement、summary、node phases、原始完整磁盘回执/资源/首因均保留，未降低任何比较门或采样门。

修复后19项pair测试GREEN，覆盖首轮UNKNOWN/失败/二进制/host变化/清理失败不启动后侧、post-fsync失败不得通过、回执SHA和选择模式绑定。身份投影对每个原比较字段的变化与缺失都拒绝。使用无Mock参数历史持有的验证函数，确保weakref证明的是控制器生命周期。

同一份原1161924B回执（SHA6848ddf918a93bf230e8bbc204c9451f9e7b3b6ee53d63725e16cdb9ea901826）实测：解析后Python live traced allocation2061988B，释放完整row、保留原必要结果和精简身份后244726B，释放1817262B。该诊断为统计存活对象而调用gc.collect；生产路径没有新增GC调用。它不是OS RSS、不是分配器归还保证、不是网络内存修复结论。

[机器证据](evidence/native-tip-failure-and-receipt-lifetime-20261024.json)保留原资源诊断、source SHA、RED/GREEN和live allocation输出SHA；[原资源重现reader](evidence/native-tip-failed-resource-reader-20261024.py)参数为source packet、selected capture、NEW output，只读原件，不运行节点。

```sh
python3 -B -m unittest discover -s scripts/loadtest -p test_native_stream_pair.py
python3 -B docs/performance/evidence/native-tip-failed-resource-reader-20261024.py SOURCE_PACKET SELECTED_CAPTURE NEW_OUTPUT
```

继续原failed artifact12550367816的同cache有界恢复，保留partials及首因。已有Go捕获缓冲差量与本控制器修复都保持默认关闭模式、原内存预算、GOGC和历史边界。新窗口必须等原CI和Root新鲜压力等级1/精确一次授权；不复用旧grant。持续1000有效final/s×600秒仍未达。
