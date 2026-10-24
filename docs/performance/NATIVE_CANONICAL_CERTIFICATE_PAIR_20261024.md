# 规范化证书构造：待排程的同条件四节点对比

新模式 `native-canonical-certificate` 接入原配对控制器、正常workflow及原分段证据读取器。当前仅完成源码和轻测，未启动节点、未取得新的网络结果。1000有效final/s持续600秒、以及3,000–5,000目标均未达。

两侧使用同一源码、同一次四ELF构建、同一Linux VM与启动器；每侧独立全新临时夹具，2048发送账户×4轮=8192笔真实签名业务输入。两侧均为bounded-cadence、配置offer1000/s、8提交者/4观察者、GOMAXPROCS1、输入复用开启和原suffix初始化。唯一开关为 `-native-canonical-certificate`：对照不传，候选显式传入。保留完整验签、执行、手续费、nonce、持久化与共识资格门。

候选对象需重新编码并逐字节等于原规范载荷才接受，否则回到严格JSON。生产选择、durable plan、顶层报告、实际backend及子项尝试/接受/回退计数必须一致；单有配置true或命中计数不能证明吞吐收益。完整8192原流及最新槽位、原资源/关闭证据、同源/同ELF/同机身份分别校验，归档恢复再次绑定两侧选择和receipt摘要。第一侧失败、UNKNOWN、未清理或证据不全时不启动第二侧。

预算沿用原小历史配对：客户端40秒；每侧45秒active+15秒cleanup，总计不超过60秒；整个配对120秒，包含最终fsync后的采样与两次空进程扫描。每侧采样RSS上限1GiB、owned进程10、线程320、私有文件256MiB；两侧保留总量512MiB、日志2MiB、构建产物1GiB。编译在pair前，由原整个CI job20分钟上限约束，原流程没有编译期独立超时或连续RSS硬上限。不得为失败自动扩预算或补跑。

只读准备命令（不构建或启动节点）：

```sh
python3 -B scripts/loadtest/supply-linux-window.py --prepare-pair --pair-kind native-canonical-certificate --observer-phases --transport grpc --profile supply-native-stream-2048x4
```

原workflow显式输入为 `run_linux_supply=true`、`linux_supply_transport=grpc`、`linux_supply_profile=supply-native-stream-2048x4`、`linux_supply_pacing=paired-native-canonical-certificate`、`measure_observer_phases=true`、`prefix_durable_replay=false`。正常push CI完成源码资格，不执行该输入。实际单次dispatch须在Root确认的新鲜pressure1资源窗口内，绑定具体源码/CI/预算，运行器仍通过其原生Linux新鲜内存与磁盘前置检查，不能用Mac压力状态替代。

验收报告需要分别给出提交、接收、有效入块、有效final速率，错误/UNKNOWN/积压，P50/P95/P99，以及节点Finalize/持久化Commit返回和客户端最终确认观察的关联。保留certificatePublish和新增复制/编码比较、严格JSON回退、摘要封装等阶段真实耗时，父子计时不得重复相加。节点返回时间不冒充最早quorum形成时刻，有限8192笔结果不冒充持续600秒达标。

本轮针对性证据保存在owner的 `artifacts/chain-performance-20261017/native-stream-small-source/`：`native-canonical-pair-controller-final.raw` 12项PASS0.317s，`native-canonical-pair-supply-all.raw` 89项PASS14.915s，`native-canonical-pair-artifact.raw` 21项PASS1.292s；native workflow shell语法及两侧命令单轴差异也已验证。控制器模拟失败/资源/归档分支不算网络实测，真实102笔应用/客户端夹具证据另见 [发布阶段与客户端记录](NATIVE_CERTIFICATE_PUBLISH_PHASES_20261024.md)。

## 原once运行及归档选择器修复

Root随后签发具体once grant，冻结HEAD4e4d26a71205866765b57b000c5adf1b6361342a通过原CI40054594269。唯一实际Hosted dispatch于02:42:15.248706Z开始，原run40055278746/job120756796984 completed SUCCESS；原两侧native post-fsync终态qualified=true、firstCause=null，耗时32.616/32.836秒，pair67.755秒。原pair receipt SHA256为ee0c14ccb5129104c685ff02aea81feb79e1c027cea4bfd0bb0365102d3d443c。两侧及pair原双scan均只有同launcher39029/startTicks59139，原节点已清理。完整交易/性能结论仍须后续独立归档读回，不能仅凭workflow或native终态宣称优化收益。

第一次使用冻结归档读取器时，实际只选择到配对总receipt，随后FileNotFoundError：`Selection`遗漏新native-certificate-json/native-certificate-canonical两个case标签，原中央目录中的两侧成员被跳过。保留原recovery-01、capture和range cache，复现RED后补两个标签及对应选择槽位；22项归档回归PASS1.173s。没有重跑网络、改业务资格或扩大ZIP选择范围到其他私有文件。

原11个冻结reader、原request/plan/grant与4e tag均保持。为同一原artifact12545396925（98,359,737B）另存posthoc-reader-v2，只允许上述两行选择器差量，original SHA256 3b2eb0e4e939910f1db3d400c452a74f76d48e12aa4c440c427f2d19781be06f，fixed SHA256 9cd29341f584fbe86e19c0b2c5a4a9540ba7bf31ec34706d81775fc03f52a715。差量断言与scope manifest保存在owner run目录，继续按原60秒有界range/cache恢复同一artifact；没有whole ZIP下载或静默替换原读回失败。
