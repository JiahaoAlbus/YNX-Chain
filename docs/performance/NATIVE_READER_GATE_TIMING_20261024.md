# 原生流式读回外层锁耗时

状态：源码轻测已验证；未测网络收益。冻结成对实验仍使用 `codex/chain-native-cadence-pair-6d653b638`，不含本差量。

原8192笔实验的 prefix 内部 gateWait 只有0.000166698秒，但整个大文件读回由外层 `profileMu` 串行化；原报告没有它的等待耗时，不能据此断言“锁没有竞争”。本差量只给显式 nativeStream8 且启用了串行reader budget的原互斥锁增加计时，没有改变锁、缓存、验证、费用、nonce或持久化路径。

原 `durableReadback.readerGate` 固定大小字段：

- `acquisitions`：进入原外层互斥锁的次数，包含持锁后失败或取消的请求；输入校验前即失败的请求不计入。
- `waitNs` / `maxWaitNs`：调用Lock前到实际取得锁的累计及单次最大wall耗时，包括调度延迟。
- `holdNs` / `maxHoldNs`：实际取得锁到释放前的累计及单次最大wall耗时，包括嵌套load/hash/decode/replay/index/交易验证与slot锁处理。

读取stats本身不增加这些业务计数，返回副本。旧模式省略整个字段。nativePrefix计划增加 `readerGateTiming`，按原cache budget选择；原Python读回器要求选中计时的计划必须有完整原统计，核验整数、次数覆盖、最大值不超过总量和空记录；回执measurement保留原计时。

累计wait可以因并发观察者重叠超过整个负载窗口；hold包含内部阶段，不能和内部耗时相加当作额外关键路径。该字段没有宣称CPU占比、GC归因或网络吞吐。

先保存缺字段RED，再用实际互斥锁阻塞/释放及真实签名临时journal读回验证等待和持锁均存在。损坏当前journal仍失败且保留计时，旧profile不增字段，修改stats副本不影响内部计数。另跑原生流式、共享reader并发/取消/缓存与失败测试及原Python身份读回。测试不启动节点，不计为有效业务网络TPS。
