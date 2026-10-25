# 原 verifier 完整 SHA 校验的流式优化

已实现及针对性轻测验证，未部署、未新跑四节点，不代表有效业务 TPS 或确认延迟达标。

上一轮本机准备阶段265ms、结果及文件复核98ms。原代码在调用前后各用 ReadAll 读取整个约35MB的 verifier，仅为计算SHA，造成重复大分配。现在只对这两处可执行文件校验改用32KiB缓冲流式SHA；context仍保留原有界读取和原始字节。两次完整SHA都保留，没有缓存授权、跳过后验或改变原 verifier。保留独立pin、canonical绝对路径/无symlink、普通可执行文件/不可group-other写、原inode/size/mtime和128MiB上限，并检查打开文件与路径的身份及mode一致。

同一原 verifier、同一外部SHA、本机Apple M4、GOMAXPROCS=1/GOMEMLIMIT=160MiB，三组各3次微基准：

| 每次完整 SHA 校验 | 原 ReadAll | 流式 |
|---|---:|---:|
| 中位耗时 | 23.939ms | 12.973ms |
| 分配字节 | 201,107,288 | 36,802 |
| 分配次数 | 80 | 41 |

校验微基准耗时下降约45.8%，分配字节下降约99.98%。这仅是同文件已缓存微基准，每种实现共9次测量；不能换算链上TPS。

改后实际生产execute只读路径使用原真实签名/单进程Comet证明夹具，通过原程序验算，错目标/执行证明篡改仍拒绝，0POST。总验算单次观察由624ms变为497ms（准备199ms、进程273ms、落盘3ms、结果复核22ms）；这些单次总值不是严格成对性能结论，因果结论限定上述校验微基准。`actualOfferToFinalityMeasured` 与 `sustainedTPSQualified` 仍false。

三个针对性race测试PASS4.209s，额外覆盖错pin、超限、相对路径、缺pin、symlink、无执行权限、group-other写和改字节拒绝。原CI既存PQ正则自动包含新负例，不另增不必要绿组。

[原始样本、命令及SHA](evidence/pq-executable-stream-pin-20261025.json)。下一步跟进原正常CI和实际隔离节点trust供货，在Root新窗口做四节点原业务负载；节点编码、落盘、入块与最终确认仍须分别实测。
