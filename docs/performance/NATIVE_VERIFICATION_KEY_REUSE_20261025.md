# Native验签：复用本次调用的公钥解析

基于已严格验收的[40183256447原始分层结果](NATIVE_REPLAY_TIMING_RUN40183256447_QUALIFIED_20261025.md)，原owner继续源码优化。CODE `e7beff99ac8b4e19efa83e5d6a5f4198182cdf9e`。本地与准确SOURCE普通CI均已验证；没有新四节点运行、双核默认晋升、放宽限额或持续1000TPS结论。

## 8192次查找、0命中的真实含义

原两个case的`blockJournalNativeVerificationFacts`均为capacity4096、string_byte_limit4194304、lookups8192、hits0、successful_verifications8192、entries4096。有效业务输入共8192个不同的canonical signed envelopes；发送者下一nonce会签出新字节，因此原交易的事实缓存不能替它验证。prefix certificate 已认证前缀直接复用，本轮累计重放输入恰好8192，并没有对同一8192笔做多轮完整验签。fullReplay3/2次可能从新的checkpoint开始，并不表示把全部历史输入重新验签3/2遍。

生命周期：一个durableReader持有prefix decoder，decoder内的full decoder持有有界native事实cache。每次新suffix Application通过`replayVerificationFacts=&d.full.native`共享本decoder内的数学事实；重建Application不会重置这份cache。条目按链ID、SHA及完整canonical bytes匹配，仅成功验签后保留，FIFO按4096条/4MiB字符串双限额淘汰。缓存不包含余额/nonce/授权/可变执行状态。独立节点、客户端、checker进程不共享这份事实；进程结束或新建decoder后重新验证。0命中在这轮主要表示首次新输入，不是扩容即可解决的历史缓存失效。原cache限额不变。

## 最小CODE修复

`SignedTransaction.Verify`原来先调用`NativeAddress(publicKeyBytes)`解析压缩公钥并求owner，随后为了ECDSA验证又对同一字节调用`ParsePubKey`。现在在同一次调用内解析一次，用私有helper从已解析公钥派生相同地址，并将这个本地公钥传给原完整ECDSA验证。公共NativeAddress接口仍自行解析输入，兼容压缩/非压缩key。

所有原基本校验、链ID、owner、DER、low-S、签名字节、ECDSA校验及拒绝先后顺序保留；没有跨交易公钥cache，没有跳验签、改canonical JSON、改nonce、改state hash或持久化。坏点解析仍返回原NativeAddress的首因文本。此修复会影响native完整验签路径，不是只改性能客户端。

## 同输入轻量前后对照

本地Apple M4/darwin arm64、GOMAXPROCS1、同16个真实signed inputs、每组300ms×3。对照保留SOURCE af06的完整Verify及NativeAddress代码，仅在test内调用；每次迭代仍执行完整ECDSA验证，没有verification cache。修复前两条路径约87.5–88.0微秒，分配均1720B/26次，确认控制组一致。最终源码同进程对照：

| 完整Verify | 三次ns/op | 中位ns/op | 分配 |
|---|---|---:|---:|
| 原双parse | 87506 / 87722 / 87482 | 87506 | 1720B / 26次 |
| 当前复用 | 80577 / 80705 / 80591 | 80591 | 1640B / 25次 |

完整Verify中位耗时减少7.90%，每次少80B/1次分配。这不是整个reader decode降7.90%，也不能外推四节点TPS或最终确认延迟收益。

带race的11个顶层针对性测试通过（1.853秒）：完整原版/新版拒绝结果对照覆盖字段篡改、错链、坏公钥/owner、坏DER、高S及空签名；保留原本接受的签名hex大小写行为和公共地址bytes；原canonical/mobile vector、缓存边界/并发、可变nonce/余额重查、真实CheckTx→Finalize→durable Commit→重启、replay拒绝和durable失败不推进均通过。新的拒绝测试已接原`chain-core.yml`，原源码guard按新CODE/tree/delta更新且25条通过；原runtime/网络历史证明仍只属于各自固定SOURCE。

证据索引：[本地原始输出与SHA](evidence/native-verification-key-reuse-local-20261025.json)。大raw保留在西数`chain-performance-20261017/native-verification-key-reuse-20261025/`。客户端观察尾延迟、状态哈希/完整校验仍是后续瓶颈；本次小修复不宣称解决它们。下一网络比较仍需要新准确SOURCE CI、冻结READY与Root新鲜排程。

准确SOURCE `f2ffa01ba006a8a2aba3ca3a9f09b04311857731` 的普通CI [40185564279](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/40185564279) 已SUCCESS，完整consensus/ABCI、新增签名拒绝race组、public signed fixtures、原source contracts全部通过；四节点heavy步骤明确skipped。原API/完整日志及源码exact pins见[CI验收证据](evidence/native-verification-key-reuse-source-ci-20261025.json)。source-ci-qualified-01.json为2957B / SHA `58432f959d7b02fc7ab71dae885197a121e314240de8a24c27a8cef9e57156d9`。源码已验证，未部署；客户端默认核数未改变，网络收益未测量。
