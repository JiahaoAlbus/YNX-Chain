# run40195409369：原失败与真实前组耗时

本次同VM编码器对照失败，after未启动，`nativePairQualified=false`。首因是父进程接收独立worker结果的裁剪namespace缺少常量依赖；最小修复已在SOURCE `ff71a33a0dea1f987aaed4b962aaa09a8bc66659`，普通CI40196736416 SUCCESS，没有重派压测。

原before的9个诊断成员已逐成员CRC/SHA恢复；worker实际完成2遍完整检查，报告8192有效业务/最终观察、0终端业务错误，有限窗口290.068TPS、actual offer308.595/s。原入口仍因接收失败而unqualified。原现场prebuild容量、全窗资源守卫、四个ELF实际SHA/bytes/buildInfo及case/pair终态receiptSHA、post-fsync双launcher-only闭合已独立验证，owned slot已归还。275原公开成员/21,672,163字节已完整CRC/SHA恢复，零网络缓存复核通过；全8192逐笔与四副本节点时钟join已完成。原qualifiedfalse和after未启动均保持。

真实before reader累计8.868秒；prepared normalize117.50ms、JSON encode1262.42ms、public copy29.20ms；suffix nativeDecodeVerified1817.01ms、feeAppend19.435ms。包含关系不重复相加。每副本34个业务区块/8192交易，四副本业务Commit平均40.27ms，validate36.32ms（appHash23.61ms、semantics12.62ms），delta encode0.236ms、write0.271ms、fsync0.946ms；checkpoint独立样本encode24.89ms/write7.46ms/fsync3.02ms，不能和普通区块均值或分位直接相加。

原worker全8192观察的offer→有效入块P50/P95/P99上界1190/1678/1977ms，offer→client final上界1406/1937/2149ms。独立全8192节点join已补齐：offer→端点Finalize P50/P95/P99上界986/1451/1686ms，offer→端点durable Commit1035/1511/1741ms，durable Commit→client final386/552/765ms；最大校准包络误差16,583ns。仍不是最早按投票权BFT quorum形成时刻。无after、无编码器网络收益、无持续1000TPS声明。

后续新协议优先：消费canonical YNX-BATCH/v0.1双PQ AND与原正常Whole/证明入口，不以旧资产兼容/迁移为源码前置，不再循环classic8192。旧归档仅必要收尾，已缓存区间不重复下载。证据：[失败与分层耗时](evidence/prepared-json-run40195409369-failed-20261025.json)、[修复CI](evidence/prepared-json-worker-bridge-source-ci-20261025.json)。
