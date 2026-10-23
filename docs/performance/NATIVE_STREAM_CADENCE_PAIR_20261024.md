# 8192 笔发送节拍成对对照

状态：已实现，源码轻测验证中；尚未执行网络对照，尚无吞吐收益结论。原8192笔实测保持不变：实际offer310.342/s，有效业务最终提交296.633/s。新方案只比较发送节拍，不能拿不同硬件或不同源码的历史数字当A/B。

## 原入口与固定输入

原 `.github/workflows/chain-core.yml` 手动入口增加 `linux_supply_pacing=paired-native-stream-cadence`。其余必须为 `run_linux_supply=true`、`linux_supply_transport=grpc`、`linux_supply_profile=supply-native-stream-2048x4`、`measure_observer_phases=true`、`prefix_durable_replay=false`。新网络执行仍由Root在新鲜pressure1窗口单独排程；本次没有dispatch。

只编译一次四个ELF，同一Linux amd64 VM内按 relative → bounded-cadence 顺序串行运行，各8192笔实际签名业务、2048临时账户、4轮nonce。每侧沿原签名、费用、执行、四节点共识、持久化和完整终端流验证。仅节拍不同，账户与隔离数据库各自新建。每侧启动前及结束后绑定boot ID、PID namespace、host；四ELF的SHA与字节数及原回执编译信息必须一致。

每侧45秒active+15秒cleanup/60秒总预算；两侧连同回执fsync及独立进程清理扫描共120秒。每侧RSS1GiB、线程320、总进程10/子进程9、private256MiB、业务store32MiB及reader64MiB沿原stream guard；两侧保留文件及回执合计512MiB、日志合计2MiB、build1GiB。启动前剩余不足60.5秒不启动下一侧。没有提高原默认profile预算。

首侧UNKNOWN、失败、业务证据不全、身份/二进制变化或进程未清理均禁止启动第二侧。最终回执写入并fsync后另采资源、执行两次原生进程扫描；资源失败仍尝试独立扫描，失败保留首因，不能报qualified。

## 读回与指标

原 `native-stream-artifact.py --mode network-pair` 从同一原artifact按范围恢复两侧白名单，独立记录segment位图，排除临时私钥。两侧原回执SHA、顺序、模式、源码、ELF、VM及runtime路径必须与pair回执一致，再各自调用原8192行完整验证器；并校验原客户端文件SHA。沿原512MiB archive、8MiB index、单成员16MiB、总选中96MiB、128MiB range cache及每次60秒恢复上限，无完整ZIP重下或清缓存。

分别保留actual offer/submit、有效入块/final、P50/P95/P99延迟区间、queue、drop/catchup、客户端供给/编码/签名/落盘及原四节点阶段耗时。finiteJointImprovementObserved仅在final速率升高、入块与final的P95/P99上界均不恶化、final P95上界不超过3秒时成立；退化结果照录。完整读回仍不代替原CI终态、fsync、资源与独立清理证明。所有源码/recipe/读回结果持续标记 sustainedTPSQualified=false；两侧8192笔不构成连续10分钟1000TPS验收。

## 首次真实成对尝试：40034580462

冻结6d653b638、原一次Root grant于2026-10-23T22:35:18Z正常dispatch，唯一run40034580462在22:43:16Z失败终止。relative客户端达到固定30秒期限，第二侧按原规则没有启动。该失败不构成A/B，也不与旧AMD9V45硬件结果比较；本次硬件AMD EPYC7763、4 logical CPU。

原首侧回执的失败partial报告：8192计划输入、6533 offered、6525 submitted、6517 accepted、6312业务入块及final、UNKNOWN8、timedOut205、未提交1667；约222.45 actual offer/s。完整终端业务读回尚未通过，不能把这些自报partial计成成功资格。供给pacingWait26.326秒，其中wakeLateness20.028秒，completionSupplyWait0；原采样RSS峰953520128B，未触1GiB守卫。首侧34.275秒，pair34.600秒；末端双proc扫描同launcher39035/startTicks45502且owned仅[39035]，原workflow已退出。清理成功与业务失败分开记录。

原pair终态postFsyncSample=null另有源码缺口：PairBudget.observe实际采样、enforce并保存了记录，但没有return。已补真实RED与返回值修复，成功终态额外拒绝缺失post-fsync样本；未改本次冻结回执或失败首因。下一差量把已声明streamBudget.timeoutMs由30000改40000，原命令与原计划读回同源绑定，两侧一致；原45秒活动/15秒清理/60秒单侧/120秒成对守卫不变。这只让固定8192输入使用既有活动预算，不能从期限延长推导性能收益，仍须新Root窗口实测。

同一原artifact12537260325、37414933B的范围恢复保留了原60秒超时、FileExistsError及partial文件。读回工具增加原始解压前缀逐字节验证后追加的续读，完整原成员SHA/CRC匹配后才原子发布；坏前缀、symlink和超界拒绝且保留。沿原ETag/缓存身份/范围与每次60秒上限，不重下完整ZIP，不清缓存，不重发native任务。
