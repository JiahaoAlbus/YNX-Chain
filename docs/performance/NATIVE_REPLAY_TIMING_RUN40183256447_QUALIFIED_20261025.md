# 原始四节点 replay 分层计时：40183256447

2026-10-25，SOURCE `af06b34b1c0c257d56cb579421351e8640c9f24a` / CODE `50aae532583951fe728c6d67681ce5b6095a6b52`。原 Root 条件 once grant 仅派发一次，attempt1 SUCCESS；两个8192笔有限 case 完成独立全量验收，`nativePairQualified=true`、`slotReturned=true`。目标持续1000笔有效业务交易/秒、600秒仍未达到；没有默认晋升或新重跑授权。

## 同条件结果与退化

同一 Linux VM、同源码、同四个 ELF、节点均 GOMAXPROCS1、8提交者/4观察者、2048发送者×4轮、prepared/current-input reuse/grouped-cadence4、replay timing 均开启；只改客户端 GOMAXPROCS1→2。每个case所有8192笔有效入块且最终确认，无UNKNOWN、超时、CheckTx拒绝、执行失败或观察失败。诊断 error fact 次数53115/41884为重复观察事实，不能当成失败业务笔数。

| 项目 | 客户端1 | 客户端2 |
|---|---:|---:|
| 实际提供速率（笔/秒） | 293.583 | 428.327 |
| 全测量窗口有效入块/最终确认速率（笔/秒） | 281.053 | 409.326 |
| 客户端测量窗口（秒） | 29.148 | 20.013 |
| 每节点业务块数 / 平均每业务块交易数 | 35 / 234.06 | 23 / 356.17 |
| 每秒桶末待最终确认最大值 / 结束值 | 993 / 0 | 1058 / 0 |
| 采样合计RSS峰值（字节） | 976543744 | 1018781696 |

有限窗口最终确认速率增加45.64%，实际提供速率增加45.90%；但入块P95、最终确认P95/P99恶化，原 `finiteJointImprovementObserved=false`。不能概括成整体变快，也不能外推稳定容量。case终态39493/30418ms和pair70733ms包括校验与清理，不能用作业务TPS分母。

以下为逐笔8192样本、1毫秒桶的P50/P95/P99**上界**（毫秒）：

| 起点→终点 | 客户端1 P50/P95/P99 | 客户端2 P50/P95/P99 |
|---|---:|---:|
| offer→客户端核实有效入块 | 1223 / 1707 / 1980 | 1236 / 1779 / 1947 |
| offer→客户端最终确认 | 1466 / 1969 / 2145 | 1606 / 2156 / 2670 |
| offer→对应节点Finalize返回 | 1013 / 1505 / 1671 | 1020 / 1480 / 1678 |
| offer→对应节点durable Commit返回 | 1052 / 1565 / 1721 | 1081 / 1527 / 1739 |
| 节点Commit→客户端最终观察 | 409 / 571 / 664 | 497 / 1109 / 1402 |
| offer→首个副本durable Commit | 1003 / 1516 / 1656 | 1020 / 1448 / 1624 |
| offer→第三副本durable Commit | 1072 / 1569 / 1737 | 1094 / 1533 / 1728 |
| offer→全部副本durable Commit | 1097 / 1587 / 1770 | 1132 / 1566 / 1764 |

原时钟校准最大误差界41837/21059ns。Finalize返回是执行完成，不是提案到达；第三副本持久化时刻不是按投票权证明的BFT quorum形成时刻。最早BFT最终性形成时间仍未直接测量。客户端最终确认与节点落盘分开报告。

## 节点真实Commit：编码与落盘已拆开

仅业务块；四副本分别140/92个样本，不能算成4倍业务交易。单位为每业务块每副本平均毫秒，子项不能与父项相加：

| 阶段 | 客户端1 | 客户端2 |
|---|---:|---:|
| Commit总计 | 40.209 | 48.378 |
| validate（父项） | 36.676 | 44.705 |
| 其中semantics | 12.413 | 15.654 |
| 其中AppHash | 24.180 | 28.910 |
| delta_encode | 0.222 | 0.314 |
| write | 0.262 | 0.299 |
| file_sync | 0.991 | 1.359 |
| journal_maintenance | 2.001 | 1.641 |

业务块打包增大使单块均值上升；四副本累计业务Commit为5629.264→4450.739ms。原checkpoint共8/4个（含空块）：encode均值24.038/26.854ms、write4.206/4.952ms、file_sync2.748/2.468ms，另外保留rename/directory_sync等全部子项。当前证据支持优先处理完整校验/状态哈希和客户端观察链路，而不是先改磁盘同步语义。

## 本地读者重放分层

以下为客户端内部累计秒；load包含decode，suffixReplay包含Finalize，feeAppend包含在nativeApply中。它们不是节点Commit或磁盘落盘时间：

| 阶段 | 客户端1 | 客户端2 |
|---|---:|---:|
| 读者load / decode | 10.539 / 9.520 | 9.116 / 8.325 |
| prefix privateValidate | 1.377 | 0.784 |
| suffixSetup | 1.052 | 0.795 |
| suffixReplay（父项） | 3.717 | 3.841 |
| 其中Finalize | 2.992 | 3.116 |
| 其中nativeDecodeVerified | 1.850 | 2.127 |
| 其中nativeApplyState | 0.076 | 0.123 |
| 其中nativeFeeEventAppend | 0.020 | 0.029 |
| 其中cloneExecutionState / sealState | 0.031 / 0.985 | 0.022 / 0.764 |
| suffix finalValidate | 0.679 | 0.666 |
| suffixEncode | 1.548 | 1.435 |
| 其中prepared JSON encode | 1.396 | 1.296 |
| certificatePublish | 0.368 | 0.337 |
| 其中nativeClone | 0.107 | 0.087 |

本地memoryCommit累计仅40143/46766ns，不代表durable Commit。suffix交易计时覆盖7327/7307笔，其余在fullReplay；全部8192笔缓存查找均无命中、实际验签8192次。手续费追加不是这份计时中的主要成本，但这不能单独证明完整历史复制、编码和校验都已消失。串行reader gate持有10.557/9.142秒；跨调用等待累计14.193/17.371秒，等待与执行存在重叠，不可加成总墙钟。下一步应针对已测出的状态哈希/编码与观察等待做隔离候选，保留完整验签、语义校验、历史字节和持久化。

## 原始证据与严格验收

原artifact12595630790/99474296字节；冻结reader严格恢复549个公开成员44128502字节，每成员CRC/SHA及manifest核验。最终恢复及独立再次审计均零网络；未重算整个ZIP摘要。各60秒范围读取到期原错误、缓存和中间proof全部保留，没有重派/重跑或放宽原限额。

fresh prebuild实际 `/proc`/statvfs：MemAvailable15526391808、freeDisk88843988992、RSS36773888、threads1、build/private0。两个case起始MemAvailable15620694016/15646904320、freeDisk88408481792/88283291648；完整原pair/case样本、ELF构建信息与SHA、client退出后2遍独立checker、原45秒active/60秒case/120秒pair限额、exited-MM检查和post-fsync双launcher-only closure均通过。launcher-only不等于整个进程组全空。采样RSS和逻辑保留字节不等于硬cgroup峰值或物理分配块。

证据索引：[原run验收索引](evidence/native-replay-timing-run40183256447-qualified-20261025.json)。所有大原始文件留在西数 `chain-performance-20261017/native-replay-timing-pair-run-40183256447/`。索引含精确路径/大小/SHA及版本化reader；独立verdict576473B/SHA `3b3e0a15125cda4f64606bdae6c5a884659c22e5fd8233d7f9e69a45175e6669`，qualified metrics30974B/SHA `931fbeb09fdf5830dcbcc841b1832f95730784f7df5b5f1a25c94f62b9574c47`。
