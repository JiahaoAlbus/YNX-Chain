# 新SOURCE四节点原始计时：40186554841

2026-10-25，SOURCE `f2ffa01ba006a8a2aba3ca3a9f09b04311857731` / CODE `e7beff99ac8b4e19efa83e5d6a5f4198182cdf9e`。唯一Root条件grant105129（8501B/SHA11adfb02f24119e61f5aaaabff159642e5c009af3caf995bdb7fb15314e0910e）在原deadline内仅派发一次；run40186554841/attempt1 SUCCESS，原watch29412 exit0。完整独立验收`nativePairQualified=true`、`slotReturned=true`；持续1000笔有效业务交易/秒×600秒仍未达到，没有默认双核晋升或新的重测授权。

## 同新源码、同VM结果

四个新ELF一次构建、两个case前SHA/bytes/buildinfo一致；节点GOMAXPROCS1/原hash，diagnostictrue、prepared、current-input reuse8、grouped-cadence4、8提交者/4观察者、2048发送者×4轮。唯一变量为客户端GOMAXPROCS1→2。本次两case共同包含公钥解析复用修复；没有跨VM前后比较，因此不能从本次pair推断该修复的网络因果收益。本机完整Verify减少7.90%仍仅[函数级证据](NATIVE_VERIFICATION_KEY_REUSE_20261025.md)。

两case各8192笔有效入块并最终确认，业务UNKNOWN、超时、CheckTx拒绝、执行失败、观察失败均0；重复诊断error facts53600/43537保留，不能当成失败交易数。

实际有限窗口指标

| 阶段 | 客户端1 | 客户端2 |
|---|---:|---:|
| 实际offer（笔/秒） | 300.638 | 434.668 |
| 有效入块/最终确认（笔/秒） | 281.273 | 409.181 |
| 客户端窗口（秒） | 29.125 | 20.020 |
| 每节点业务块数 | 35 | 23 |
| 平均每业务块交易数 | 234.057 | 356.174 |
| 每秒桶末待final最大值 | 1000 | 1034 |
| 结束待final | 0 | 0 |

有限窗口final速率增加45.47%，实际offer增加44.58%；有效入块尾延迟改善，但客户端final P95/P99恶化，原`finiteJointImprovementObserved=false`。测量没有把offer打到1000，不能视为链的容量上限。case39377/30148ms、pair70339ms包括checker/清理，不能作为业务TPS分母。

逐笔8192样本，P50/P95/P99上界（毫秒）：

| 阶段 | 客户端1 | 客户端2 |
|---|---:|---:|
| offer→核实有效入块 | 1249 / 1753 / 1930 | 1208 / 1626 / 1770 |
| offer→客户端final | 1474 / 1978 / 2096 | 1530 / 2030 / 2183 |
| offer→对应节点Finalize返回 | 1005 / 1529 / 1646 | 1019 / 1425 / 1560 |
| offer→对应节点durable Commit返回 | 1052 / 1593 / 1702 | 1079 / 1487 / 1634 |
| 节点Commit→客户端final观察 | 393 / 699 / 709 | 449 / 708 / 780 |
| offer→首个副本durable Commit | 1010 / 1541 / 1656 | 1002 / 1421 / 1582 |
| offer→第三副本durable Commit | 1061 / 1596 / 1706 | 1083 / 1495 / 1637 |
| offer→全部副本durable Commit | 1093 / 1623 / 1747 | 1111 / 1516 / 1655 |
| 副本Commit完成时刻离散 | 77 / 141 / 197 | 116 / 174 / 182 |

时钟校准最大误差界89295/27050ns。Finalize返回是执行完成，不是提案到达；第三个副本不是按投票权BFT quorum形成时刻。最早BFT形成瞬间仍未直接测量。不能把不同分布的分位数相减来推导阶段耗时。

## 节点真实Commit分层

仅业务块，每副本每业务块平均毫秒；共140/92个副本样本，不是4倍业务TPS：

| 阶段 | 客户端1 | 客户端2 |
|---|---:|---:|
| commit | 41.752 | 46.118 |
| validate | 37.694 | 41.779 |
| semantics | 12.620 | 13.971 |
| app_hash | 24.976 | 27.717 |
| delta_encode | 0.247 | 0.526 |
| write | 0.269 | 0.365 |
| file_sync | 1.477 | 1.385 |
| prepare_file | 0.049 | 0.093 |
| close_file | 0.008 | 0.008 |
| journal_maintenance | 1.997 | 1.950 |

semantics/AppHash已包含在validate中，validate又在Commit中。业务块打包从平均234.06→356.17笔，单块均值不能脱离块大小判断；四副本业务Commit累计5845.225→4242.893ms。checkpoint原8/4个样本（含空块）全部保留：encode均值23.215/32.918ms、write4.193/5.465、file_sync3.564/2.254；after encode P95/P99均67.441ms，未删除长尾。完整子项与原每节点日志在索引中。校验/状态哈希仍明显大于delta编码和写入/fsync，继续保留原持久化语义。

## 客户端本地读者分层

累计秒，父子重叠，不能与节点耗时混用：

| 阶段 | 客户端1 | 客户端2 |
|---|---:|---:|
| reader load | 10.116 | 8.576 |
| reader decode | 9.094 | 7.868 |
| 外层gate hold | 10.133 | 8.606 |
| 跨调用gate wait累计 | 11.558 | 15.459 |
| privateValidate | 1.010 | 0.794 |
| suffixSetup | 1.036 | 0.813 |
| suffixReplay | 3.582 | 3.411 |
| suffix Finalize | 2.752 | 2.805 |
| nativeDecodeVerified | 1.674 | 1.839 |
| nativeApplyState | 0.091 | 0.106 |
| 其中feeEventAppend | 0.036 | 0.027 |
| cloneExecutionState | 0.026 | 0.032 |
| sealState | 0.914 | 0.761 |
| suffix finalValidate | 0.776 | 0.529 |
| suffixEncode | 1.687 | 1.318 |
| 其中prepared JSON encode | 1.530 | 1.215 |
| certificatePublish | 0.432 | 0.260 |

load含decode，suffixReplay含Finalize，feeAppend含在nativeApply中；最大gate等待494.335/546.377ms、最大持有535.020/620.548ms。memoryCommit仅本地重放累计38761/39633ns，绝不是磁盘持久化。suffix交易计时覆盖7315/7400笔，其余在fullReplay；完整8192个新输入的replay facts均capacity4096/4MiB、lookups8192/hits0/成功验签8192。0命中不是扩大缓存就能解决的重复历史失效，生命周期见函数修复文档。手续费追加只占0.036/0.027秒；不能据此推断历史复制、封装、完整校验和编码的成本已经消失。

按本次已验收数据，后续优先隔离验证读者状态哈希/JSON编码与外层gate/观察链路；不靠跳验签、取消nonce/完整校验或改fsync制造吞吐。没有把跨调用wait、CPU、父子计时重复相加为总墙钟。

## 资源、原产物与终态

实际fresh prebuild MemAvailable15520690176、freeDisk88829120512、RSS36769792、threads1、build/private0。两case起始MemAvailable15595950080/15629938688、disk88393601024/88267100160；构建目录119804524B。原全部采样、case45秒active+15秒cleanup/总60秒、pair120秒、RSS1GiB/线程320/owned进程10/private256MiB/pair512MiB/log/build/disk/memory限额均通过。采样合计RSS峰值993984512/996827136字节、线程65/66；它们不是硬cgroup峰值或物理分配块。

client退出后2遍独立完整checker均在原45秒内完成，原post-fsync双launcher-only closure通过；launcher-only不等于整个进程组完全空。未重试、重派或放宽守卫。

原artifact12596835427/99376894B，549个公开成员43983924B逐成员CRC/SHA/manifest恢复并再次NoNetwork完整审计。最终ZIP范围内容读取为0B/0HTTP request；原metadata身份获取另保留，未重算整个ZIP摘要。每次60秒范围读取到期原错及缓存全部保存，只续缺失范围。旧run未重读、下载或重跑。

原文件都在西数 `chain-performance-20261017/native-key-reuse-replay-pair-run-40186554841/`。完整原CI842287B/SHA `872d43e6363ef8174f306d2791f96f6f035e04b31c285d758962361a374aa84b`；verdict576499B/SHA `5882f835d02b731991d9bac8d159c05e7062f68c64c2bf425eb35e89d9c0f3d9`；metrics30992B/SHA `16e27d022c0397a5a60cca3d54d792d29fb7666ca8bb2df8abe5cb7c961269ad`。精确路径、大小/SHA、原grant/once指令/slot及版本化消费者见[原始证据索引](evidence/native-key-reuse-replay-run40186554841-qualified-20261025.json)。
