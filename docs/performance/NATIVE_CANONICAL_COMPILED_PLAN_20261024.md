# 规范化证书的只读字段访问计划：本机组件测量

当前四节点 suffix 初始化配对40060919778的原回执显示吞吐小升、尾延迟变差，完整公开流独立读回仍在进行；未启用任何实验候选。本源码优化独立于冻结ea2dc6b80：只影响已有默认关闭的canonical证书路径，不改变原严格JSON路径或suffix选择。

原证书规范化为每个账户和手续费字段反复查询reflect类型计划。新实现先按原schema/codec/tag规则编译只读字段访问图，通过sync.OnceValue仅保留一个CommittedState类型图；不保留账户、状态或载荷。UTF-8、时间JSON规范化、omitempty、命名标量的自定义codec拒绝、空slice对子类型检查的延迟语义均保留。结果仍由原完整Validate和重新编码逐字节比较约束，未接受时仍走原严格JSON回退。原反射实现保留为组件测量及差分参考。

## 同一载荷、交替顺序的实际测量

真实32笔签名、执行、Commit后的不可变载荷25763B，SHA256为72f4acdbafe3029dc85a423a187722b23299b868256acdbaafc56730d15f7a03。每条路径7轮×32次，交替顺序，校验放在计时外；Apple M4/arm64、Go1.25.7、GOMAXPROCS1/GOGC100/GOMEMLIMIT off，非race、非独占主机。

|范围|对照累计ms|候选累计ms|变化|
|---|---:|---:|---:|
|同载荷原反射规范化复制→预编译计划复制|8.156793|2.642582|-67.60%|
|完整发布：严格JSON→编译计划，含原编码比较|38.617874|28.455292|-26.32%|

第二行对照是严格JSON完整发布，不能把它说成“旧canonical→新canonical”的同载荷全路径对比。早期跨进程样本观察到发布34.72→27.60ms，原raw均保留；最终结论以上述同载荷范围为准，不挑最快样本。

整个进程分配计数包围同样的224次发布：严格JSON29793856B/74592次分配，候选20066120B/26720次；观测GC6→4。该计数不是峰值RSS或GC全部CPU。该独立新进程第一次候选调用包含类型图启动与第一次复制：0.316667ms、135416B/1192次分配；暖循环不含启动，不把启动成本藏入网络收益。

## 验证与限制

原严格JSON等价/特殊时间与UTF-8/未来schema拒绝、真实签名重放和原严格JSON回退组race PASS1.723s；新增空省略字段/空slice与自定义codec差分、8调用者独立副本并发测试通过。实际客户端102笔签名、执行、Commit、重开、nonce34及公开流读回race PASS5.117s，quorum仍是unit gates，不是四节点BFT验收。consensus/client vet通过。测试名称由原CI的TestBlockJournalCertificate步骤及NativeStreaming步骤匹配，不另起压测。

原简单标量旁路实验复制耗时基本不变、不同发布计时方向不一致，已保留补丁与原始结果并仅恢复该实验文件，没有保留那项修改。

[完整原始计数、载荷身份与raw摘要](evidence/native-canonical-compiled-plan-local32-20261024.json)。本源码未部署，未证明网络TPS或尾延迟改善，不提升默认开关。下一步完成新源码原CI，先收齐当前suffix配对的完整证据，再按实际结果决定下一单轴网络验证，不复用旧grant。

```sh
GOMAXPROCS=1 go test -race ./internal/consensus -run '^TestBlockJournalCertificateCanonical' -count=1 -timeout=30s -v
YNX_MEASURE_CANONICAL_NATIVE=1 GOMAXPROCS=1 GOGC=100 GOMEMLIMIT=off go test ./internal/consensus -run '^TestBlockJournalCertificateCanonicalNativeMatchedMeasurement$' -count=1 -timeout=30s -v
```
