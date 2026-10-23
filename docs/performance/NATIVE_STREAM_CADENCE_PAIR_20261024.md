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
