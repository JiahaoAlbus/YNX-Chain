# 同 case 预算内的短命完整 verifier

已实现并接入显式native-stream8路径，离线原始证据和局部反例已验证；真实四节点的aggregate RSS仍未验证。本次没有新节点、RPC、提交或网络窗口。此前run40068452896和40070727578保持原RSS失败，grant已消费。

父进程确认client退出码0后，才用原spawn/wait启动同源码Python verifier（-B不写源码bytecode）。子进程执行原validate_native_stream_report和observer phases两遍，保留原case及pair完整读回语义；两遍均在同一case的原active45秒内，之后才允许清理、回执fsync和case资格。源码没有增加GC、GOGC或预算，verifier不执行节点或发送交易。

四节点ABCI/Comet共8个进程，加launcher与client或verifier，仍最多10个同时owned进程；verifier经过原100ms wait/tick和原native_sample/aggregate RSS1GiB/thread320/private256MiB/log守卫。client与verifier不并发。spawn记录共11个角色包含已退出的fixture、client和verifier；原长期子进程9的含义保持。没有把verifier放到测量域或case之外，也没有在后台豁免资源。

子进程先后流式哈希原报告、plan、manifest、initial及全部intent/terminal成员，核对文件类型、身份、长度、目录清单和SHA。两次完整checker之后这些原字节与身份必须完全相同。输出为新0600 O_EXCL结果，经fsync后给出唯一终态与结果SHA。失败/partial/UNKNOWN/非零保持失败，无重试或Parent fallback；原checker首因及全部原磁盘证据保留。

父进程不再持有完整7MB报告；它验证实际child PID/parent PID、同源SHA、唯一complete终态、checker次数、case/模式、结果SHA及所有当前公开文件原SHA与身份。post-fsync再次检查，才可资格通过，后侧还须原全部before/cleanup门。完整证明实际在child中执行，compact结果仅用于传输。独立archive reader仍重新执行原完整stream checker，增加worker结果/日志allowlist，并在归档重定位时核对原内容而不伪造原inode。

28项协议/生命周期/资源门反例通过：client仍活着/非零/UNKNOWN不启动verifier；verifier非零/UNKNOWN不重试，原checker错误传回、RSS/时间错误优先保留；半截结果、终态缺失/重复身份、模式/SHA/原成员变更均失败；缺少选中完整worker时post-fsync不通过。10任务仍受原RSS/thread/private门，11个同时任务拒绝。89项既有Supply测试和23项公开archive测试通过。HTTP诊断已传递显式tip选择，原完整8192 HTTP结果除consumer身份外精确重现。

实际子进程读取此前已完整独立核验的原run40064083012前侧8192笔公开证据两遍，完整对象和父进程传输核对通过。这是重复读同8192条原证据，不是16384笔新业务。macOS arm64/Python3.13.3本地阶段，单位ms：

| 阶段 | 实测 |
|---|---:|
| 原公开成员前置哈希 | 50.769 |
| 报告捕获与严格解码 | 27.106 |
| 第一次完整checker | 470.513 |
| 第二次完整checker | 484.296 |
| 原公开成员后置哈希 | 17.253 |
| verifier结果写入及fsync | 9.945 |

本地child最大RSS74072064B；父进程传输组件traced peak1623497B。它们不是同刻的Linux aggregate，不能相加或证明1GiB修复，更不能转换成业务TPS。`nativeVerifierPhasesNs`及结果fsync耗时也会进入原post-fsync终态日志；它们不是链Commit/fsync耗时。

[机器证据](evidence/native-stream-verifier-process-local-20261024.json)绑定全部源码SHA、实际child/结果/终态、原8192数据资格及原始测试输出。原始目录为artifacts/chain-performance-20261017/native-stream-small-source/native-verifier-original8192-case，旧中间产物按prototype保留。

后续将源码/13个frozen readers/原CI及精确角色预算提交Root，再申请新鲜压力等级1的一次同条件四节点窗口。此前失败窗口不重跑，实际入块/最终确认P50/P95/P99、供给/积压/阶段耗时和aggregate资源继续分开报告。持续1000有效final/s×600秒仍未达。
