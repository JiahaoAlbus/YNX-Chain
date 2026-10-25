# Prepared native快照JSON编码优化

CODE `fac954ca6f8b4e2cc58076dbccb6ffd68fb321bf`。本地已验证，准确SOURCE普通CI待完成；未部署、未启动新多节点运行。原40186554841报告与证据身份保持不变，不能把本次局部收益算成该已封存运行的网络收益。

## 实测热点与最小改动

已验收运行的客户端2中，prepared JSON encode累计1.215秒，包含在reader decode7.868秒及全局reader gate持有8.606秒中。全局锁同时保护原共享读者/跨slot预算与逐笔校验，不能只取消锁来制造并发收益。本次保持原锁和预算，优化已有显式prepared路径内的编码。

旧prepare先拥有并JSON规范化native状态，再标准编码整份快照并缩进。本次保留规范化、私有state、独立public副本和全部原校验；仅让已存在的exact-byte fee/time编码器处理fee历史，使用原标准Encoder产生其余state scaffold，再用标准json.Indent逐fee写入相同缩进的输出。完整字段顺序、nil/empty、HTML/Unicode/非法UTF8规则、时间表示和最后LF均必须逐字节相同。没有整份compact-fee中间缓冲、没有新解析框架、没有持久化缓存。每次调用只复用完全相同time.Time值的编码，不复用签名或授权。

只替换`prepareCanonicalNativeSnapshotWithTiming`中的一个编码调用。默认state hash仍为original-json；节点checkpoint/持久化编码、AppHash域和全量验证、原strict fallback、签名/nonce/手续费、reader锁次序与所有限额保持。容量hint不是接受数据的新上限；没有扩大reader/cache限额或默认双核。

## 保留的性能反例

首个原型先积累整份compact历史，再做原缩进。完整字节对照通过，但同1024笔实际历史中耗时2.886/2.899ms，对照2.836/2.856ms；分配字节2.519MB，对照1.338MB。该版本未接入，source、raw和拒绝原因保存在证据索引，未挑绿或删除失败结果。

## 最终CODE的同输入测量

Apple M4/darwin arm64，GOMAXPROCS1，200ms×3；同进程ABBA子组，各模式6个样本。控制组保留新改动前SOURCE f2ffa的规范化/原JSON操作；两组都包含完整prepared私有对象和独立public副本，计时前核对完整state及所有snapshot字节。未把旧strict round-trip较慢路径当控制组。

| 输入与完整prepare操作 | 原中位 | 新中位 | 耗时减少 | 原/新分配字节 | 原/新分配次数 |
|---|---:|---:|---:|---:|---:|
| 保留的1024笔实际历史 | 3.119ms | 2.972ms | 4.73% | 2500536 / 2272201 | 4001 / 2996 |
| 新真实签名128笔、4个块 | 0.365ms | 0.325ms | 10.78% | 290813 / 249548 | 302 / 181 |

128笔不是手改fee时间：实际构造并完整验签、4次Finalize/Commit，每块32笔成功+1笔重复nonce拒绝+1笔坏envelope拒绝；原full journal decoder、完整Validate及重启均核对状态/AppHash，重启后拒绝已提交nonce。它与1024历史是两种输入形状，不能互相当优化倍数，也不是网络TPS。原型期和初步完整pipeline（5.59%/13.18%）等全部raw也保留；以上采用最终CODE对应的复测结果，不挑较高数字。B/op是分配量，不是RSS或原1GiB上限已经通过的新证据。

## 正确性与CI

带race的相关回归23个顶层测试通过（5.915秒）；原prepared CI分组也通过（internal5.706秒、client8.211秒，仍30秒原timeout），包含两种客户端核数下各102笔真实signed execution→Commit→native readback→nonce34→stream recovery流程。该quorum仍为unit gates，不是新多节点验收。

新增对照逐一变更每个Fee字段，覆盖控制字节、HTML/Unicode/非法UTF8、特殊zone及非法时间的原MarshalerError/首因；坏/重复scaffold、nil/empty、并行输出所有权均拒绝或保持原字节。额外framing差量race1.898秒通过。原prepared snapshot ownership、全部非native域fallback、不得授予Validate、两checkpoint epochs、payload/state损坏、任意payload/producer mismatch、context取消、旧capture高水位、签名/nonce/余额重查与持久化失败回归均保留。

新测试已加入原chain-core prepared group，没有放宽timeout；原source guard按CODE/tree/delta更新，25条通过。源码和raw/SHA见[本地证据索引](evidence/prepared-native-fee-json-local-20261025.json)，大raw仍在西数 `chain-performance-20261017/prepared-native-json-20261025/`。下一网络验证必须单独绑定新SOURCE、准确CI、同VM/实际二进制与原限额的新READY/Root窗口；不继承已consumed grant，不宣称达到持续1000×600秒或最早BFT形成时刻已测。
