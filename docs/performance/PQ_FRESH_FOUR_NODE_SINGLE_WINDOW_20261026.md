# 首个 fresh PQ 四节点同条件窗口准备

**PREPARING，尚不可执行；没有Root新once grant。** [精确计划](evidence/pq-fresh-four-node-single-window-plan-20261026.json)已固定业务数量、对照、硬上限、阶段口径、输出与清理。缺原Protocol fresh profile/真实隔离材料及预编译实物时不能标READY，更不能私启动。

同一Linux VM、同Node/client/verifier二进制和资源配置，两独立fresh测试epoch分别跑before/after。每臂四真实正常Node、16个PQ发送者和1个接收者，正常Faucet/prepared source实生成每发送者1000测试YNXT，真实正常开户登记后nonce1；每发送者仅一笔amount1/fee1/nonce2 N1双签转账，共16笔，目标发压2/s、最多4提交inflight、1个offline verifier。每臂预期每发送者998/nonce2、接收者增16、收费16。注册、Faucet、引导和负例都不计业务。两臂32笔只是首个正确性/测量基线，不能冒1000TPS。

不回滚或复制HRS来重放第二臂。两臂新身份/epoch不同，业务角色、金额、nonce、起始余额、消息大小/算法和Node配置相同；不要求签名字节或AppHash相同。正常身份与签名/批准由原工具实际生成，客户端不造Root、allowlist、余额或审批。不需要公网旧资产或restore才能做此隔离基线。

客户端CODE70e7e4509/tree19b9fafcf固定：after默认复用已验证index；before仅加 `-pq-readback-index-baseline`，相同binary执行原额外GET解析，校验/消息/签名/RPC保持一致。新增当前提交到首个完整committed RPC观察，POST可先出现，GET仍作为原reconciliation；只读恢复不伪造原offer时钟，冲突H/index失败。三个focused race PASS2.523s。

沿原 `scripts/loadtest/pq-paired-linux-window.py` 的Linux资源、kernel PID身份和清理守卫，提议保持105s active+15s cleanup/120s total、1GiB owned RSS、16进程/320线程、512MiB private、1MiB日志、200ms采样及原磁盘/内存保留。原retained-history opt-in workload包含legacy/contract迁移，不能冒fresh PQ profile。Protocol须在原normal四Node harness提供新fresh入口和冻结source pins；本线程own client/driver/测量拼接。每臂45s硬预算；超限/首因即停，不自动扩限、不开始第二臂。

节点阶段必须原调用真实FinalizeBlock与Commit，并立即抓取原CommitTiming样本；晚些轮询Latest可能被空块覆盖，不能补造样本。提交→实际节点入块、节点durable Commit、首个committed RPC观察、独立H/H+1证明验证完成分别输出；后者是可验证完成上界，不能拿第三副本durable或Data字段冒最早BFT形成。P50/95/99同时给样本数、缺失/失败/积压与资源；小样本不作目标资格。

正常CI增加Go1.26.10 Linux client独立预编译与SOURCE/可执行SHA实物供货，全部原门通过才上传，不在active窗口编译。原source测试job仍Go1.25，metadata明确区分，不冒Go1.26全测试。Root须拿实际CI/manifest/pins后才可批准一次窗口。Node/gateway/verifier原同源安全后继仍由Protocol供给。

输出原intent/offer、四节点阶段、独立证明原件、队列/资源、同条件对比、actual owned cleanup。错误时保留keys/账户/HRS/数据库/UNKNOWN，停止原Node并只终止身份匹配的owned进程，实证端口/锁/slot归还。公网服务、旧链与其他产品均不触碰。
