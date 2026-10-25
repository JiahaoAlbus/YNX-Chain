# 首个 fresh PQ 四节点同条件窗口准备

**PREPARING，尚不可执行；没有Root新once grant。** [精确计划](evidence/pq-fresh-four-node-single-window-plan-20261026.json)已固定业务数量、对照、硬上限、阶段口径、输出与清理。精确客户端实物现已交付；fresh leaf已提交，原controller successor正在实现，正常测试/其余三ELF/新冻结及Root资源grant尚缺，不能标READY或私启动。

同一Linux VM、同Node/client/verifier二进制和资源配置，两独立fresh测试epoch分别跑before/after。每臂四真实正常Node、16个PQ发送者和1个接收者，正常Faucet/prepared source实生成每发送者1000测试YNXT，真实正常开户登记后nonce1；每发送者仅一笔amount1/fee1/nonce2 N1双签转账，共16笔，目标发压2/s、最多4提交inflight、1个offline verifier。每臂预期每发送者998/nonce2、接收者增16、收费16。注册、Faucet、引导和负例都不计业务。两臂32笔只是首个正确性/测量基线，不能冒1000TPS。

不回滚或复制HRS来重放第二臂。两臂新身份/epoch不同，业务角色、金额、nonce、起始余额、消息大小/算法和Node配置相同；不要求签名字节或AppHash相同。正常身份与签名/批准由原工具实际生成，客户端不造Root、allowlist、余额或审批。不需要公网旧资产或restore才能做此隔离基线。

客户端CODE70e7e4509/tree19b9fafcf固定：after默认复用已验证index；before仅加 `-pq-readback-index-baseline`，相同binary执行原额外GET解析，校验/消息/签名/RPC保持一致。新增当前提交到首个完整committed RPC观察，POST可先出现，GET仍作为原reconciliation；只读恢复不伪造原offer时钟，冲突H/index失败。三个focused race PASS2.523s。

沿原 `scripts/loadtest/pq-paired-linux-window.py` 的Linux资源、kernel PID身份和清理守卫，提议保持105s active+15s cleanup/120s total、1GiB owned RSS、16进程/320线程、512MiB private、1MiB日志、200ms采样及原磁盘/内存保留。RSS/线程/磁盘沿原200ms采样守卫，并非硬cgroup限额。原retained-history opt-in workload包含legacy/contract迁移，不能冒fresh PQ profile。Protocol须在原normal四Node harness提供新fresh入口和冻结source pins；性能线程own固定client与测量/对比消费者；原网络controller及其profile CODE由Protocol原owner负责，Root只负责资源排程。每臂45s硬预算；超限/首因即停，不自动扩限、不开始第二臂。

节点阶段必须原调用真实FinalizeBlock与Commit，并立即抓取原CommitTiming样本；晚些轮询Latest可能被空块覆盖，不能补造样本。主控offer定义为原签名操作的单调时钟dispatch，客户端启动/准备排队单列；不得改称精确socket write。子client的HTTP提交→首RPC指标仅在本进程有效，不跨进程硬减时间戳。提交→实际节点入块、节点durable Commit、首个committed RPC观察、独立H/H+1证明验证完成分别输出；后者是可验证完成上界，不能拿第三副本durable或Data字段冒最早BFT形成。P50/95/99同时给样本数、缺失/失败/积压与资源；小样本不作目标资格。

正常CI增加Go1.26.10 Linux client独立预编译与SOURCE/可执行SHA实物供货，全部原门通过才上传，不在active窗口编译。原source测试job仍Go1.25，metadata明确区分，不冒Go1.26全测试。Root须拿实际CI/manifest/pins后才可批准一次窗口。Node/gateway/verifier原同源安全后继仍由Protocol供给。

输出原intent/offer、四节点阶段、独立证明原件、队列/资源、同条件对比、actual owned cleanup。错误时保留keys/账户/HRS/数据库/UNKNOWN，停止原Node并只终止身份匹配的owned进程，实证端口/锁/slot归还。公网服务、旧链与其他产品均不触碰。


## 最新实际归属与供货

原controller实际路径：
`/Users/huangjiahao/.codex/worktrees/ynx-pq-perf-integration/YNX Chain/scripts/loadtest/pq-paired-linux-window.py`。
原owner为Protocol线程 `01a14abb-5066-7db0-8814-e08c0d4b35a8`，已提交基线来自
`1eea5564122df29a13febd7ad266f31f21f8f03e`，74088B/SHA256
`7a4abc7291caee244240f5a6e2b2ae4912c467750fae19c557a23e1ddc1c7af3`。
其原入口 `--consensus-signed-business` 对应 `consensus-signed-business-v1`，
保留client3f5b和原initial/Member/partial三case。性能worktree中的旧runner副本
仅是历史守卫参考，不能当当前controller，也不由Root亲写产品CODE。

Protocol fresh leaf已提交 `5aebd8362414265f4894b818b6033a910d651cab`，
原CI40221463286在途；四项DATA与其余三ELF尚未取得供应资格。
交接时Protocol已实际在原controller写 `consensus-fresh-paired-business-v1`、
互斥fresh opt-in、三leaf source pins和精确70e7/整tree4866校验；这是在途dirty，
不能冒新冻结。旧controller和旧once不得热混；由原owner完成新分支、manifest、
唯一fresh RUN/summary/PASS、guard和轻测后重新冻结，Root再按压力等级1排窗口。

固定70e7客户端的真实CI、ELF和独立核验见
[正常供货证据](evidence/pq-client70e7-ci40220335526-readback.json)。
消费者现可直接 `--stdout` 读原日志及原guard，无需手工改写成功凭据；
前后阶段差值、样本与缺项规则见
[接入合同](PQ_FRESH_PHASE_READBACK_CONTRACT_20261026.md)。
本更新只纠正实际归属和已存在实物，不构成资源grant、四节点PASS或TPS结果。


## 2f36 原 fresh profile 正常供应已出现

原owner已提交 `2f36f5e7acd433c565f7ae366954a3fa0e763b14`，controller和tests clean。
新controller SHA256
`433efda1d668204d160fc4b6cac1ad5b27cb87ae4d77c4af7121fde01147f9ef`，
入口 `--consensus-fresh-paired-business`，profile
`consensus-fresh-paired-business-v1`。上文74088B/7a4abc是保留的旧三case
基线，不是本次fresh controller；旧once不复用。

[原normal40223021096](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/40223021096)
已completed SUCCESS，head精确2f36。fresh artifact实际存在：ID12611050415，
81,040,562B，ZIP SHA256
`cc7f620cccf885ef329ae0a0cbe7f9af290bccce7308e69c0198ff387df7c70e`。
[原终态/API元数据记录](evidence/pq-fresh-profile2f36-normal-supply-metadata-20261026.json)
仅证明正常CI和供应记录；性能线程未重复下载，也未声称已核其SOURCE/manifest/四ELF。
这些读取仍由Protocol原供应owner完成，防止多线程重复下载或混用旧包。

下一完整段是原包一次核验、normal caller relocation与闭合prepared/run contract，
然后Root实测压力等级1并排原新once，两arm共32有效业务与真实四节点phase输出。
原调用没有执行之前，不把artifact、parser DATA、4DATA或完整CI当成Node结果。
当前计划仍executionAuthorized:false/rootGrant:null，未提高任何资源上限。
