# Social 专项完整暂停报告

日期：2026-10-04，Asia/Shanghai。唯一总控：接续测试网生态审计工作。
本报告响应总控转达的真人“全部线程停下并完整汇报”指令。

## 1. 总结与原完整目标

专项未完成，不是全量上线，也不是新加密内核已经可用。
本线程 goal 已通过实际工具设置 PAUSED。不开新开发批、测试、构建、
发行或网络尝试；保持既有线上网站、节点、RPC、索引和必要服务不动。

原完整 Social v2 的 C01-C07/V01-V17 与新密码研发全目标不缩减：
稳定公开身份；用户名/个人码/邀请链接找人；资料确认与申请接受拒绝；
好友与关注分离；默认端到端加密私聊、群聊、附件、受限瞬间；隐私与
设备生命周期；两个真实节点互通、迁移和身份延续；6423/0x1917 最小
设备密钥登记及撤销；可关闭、不上传、无云回退的三类本地安全过滤；
正确原 Logo、多语言、完整任务式 UI 和承诺平台正式安装包；真实
A/B/C 正常 UI 三轮及实际 dot MONSTER 验证。

新方案目标还包括官方 libsignal PQXDH/Triple Ratchet/SPQR、Matrix
实际传输、逐设备群分发、XChaCha20-Poly1305 附件、Argon2id 备份、
版本化 CryptoEngine/LegacyReader、原子持久 ratchet/inbox/outbox/replay、
可信设备与回滚锚点、UNKNOWN 恢复、旧历史兼容、多平台真实冷恢复。
当前 activationApproved=false / activated=false，MONSTER NOT_RUN。

## 2. 准确源码、所有权和 dirty

实际 owner checkout：
/Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001
branch：codex/social-wallet-chooser-20261001

暂停时实际 git 读取：
- HEAD 5fcfd21ab432447782c24a009ba3321247520eb0
- tree d5dc0e1ba33b1d266f840b1db6043d4acab70175
- parent 31261088035b72dc93d80754e4f6567d4d3b4487
- 上述 HEAD 的普通、非 force push 已成功。

最新 committed 工程实现为 native-only VeilSignedDeviceGrantVerifier，
接原 VeilDeviceGrantVerifier：固定已登记发行者 SPKI/pin、实际 JCA
签名验证、完整设备绑定、原生一次性挑战、签名撤销代次和审阅类型、
短期租约、严格帧预算、过期/重放/时钟回滚拒绝。没有默认发行者、
自动登记、网络路由或激活。P-256 仅是该新的设备授权响应认证格式，
不是 libsignal/Chain 的新算法，也不是已通过生产协议审查的声明。

最新四个本人新增但尚未提交、尚未编译/运行的源码文件已保留原地：
- apps/social/crypto-engine/java/com/ynx/social/matrix/VeilAttachmentNative.java
- apps/social/crypto-engine/java/com/ynx/social/matrix/VeilAttachmentOutbox.java
- apps/social/crypto-engine/sodium/veil_attachment_jni.c
- apps/social/scripts/veil-libsignal-qa/VeilAttachmentJniCheck.java

这四个文件仅完成第一轮写入，绝不算通过编译、JNI 加载或业务接通。
本次暂停后不修复、不测试、不提交这些文件。恢复时须先正常审查与
实际编译测试，包括帧边界、锁内存、异常清理、事务回滚及密钥生命周期。

另外存在继承的未跟踪 evidence/model-cache/stage-path、开发 APK/gz、
public-chooser-direct 和旧 e9bf deploy-root。没有删除、暂存、覆盖或
归入本次新实现。暂停时没有 tracked modification；新增四文件及本
检查点报告使工作树仍不 clean。无需清理来制造 clean。

## 3. 已有工程成果及实际检查

这些是有证据的工程进展，不代表完整产品验收：

| 范围 | 实际结果 | 限制 |
| --- | --- | --- |
| 网页小官网、显式进入应用、EN/ZH、同 tab、等比原品牌 | d2 候选实际桌面/移动访客界面与历史往返；console 记录为空 | 本地独立构建，不是公网已更新 |
| 冷中文私聊界面修复 | fda，92 相关检查；实际冷启动与切换语言 | 不翻译用户房间名/消息/草稿；不是授权后聊天验收 |
| 联系人到聊天准备边界 | 20 联系人 + 88 控制器检查 | 受控输入，不是三个真人正常完整 UI 旅程 |
| Social 后端 matching c5 输入 | 原 Go1.25.13 offline 构建 exit0；纯公开身份检查 | 未运行部署的真实 backend |
| 好友与瞬间 Go 边界 | contacts 11 top + 18 sub / moments 4 top + 10 sub，race exit0 | 不代表公网业务、当前 actor/权限生产接线 |
| 原生 Social ID、类型与 locale/退出恢复 | 原 owned 源码批次及对应类型/有限检查 | 非安装后真实帐号冷恢复 |
| libsignal JNI/Inbox/Outbox/持久边界 | 实际 SDK0.104.0、strict 原文编码、不可变重试、replay/UNKNOWN、1059 边界断言等 | QA 身份/内存 authority 不冒真实设备来源 |
| 当前完整 Java/Kotlin/Matrix 源组合 | fresh 原生/Java/管线分阶段编译和 jar | 非 Android SQLite/Keystore/真机安装 |
| native 签名设备授权新实现 | 29 实际签名断言 + 原未改 13 authority/budget 检查，exit0 | 临时 QA issuer，不是生产发行者登记 |
| 本地内容过滤 | 既有 worker/许可检查、默认关闭和缺引擎 fail closed 的 owned 实现 | 正式模型/真实安装设备/三类实际覆盖仍未验收 |

默认测试入口曾实际 477/477 与类型检查通过；旧失败与修正断言语义均
保留。此次暂停没有重跑原绿测，没有把这些累计数量说成本轮新检查。

## 4. 准确构建包与证据路径

所有相对路径均以本报告第 2 节 owner checkout 为根。

1. 最新 Web 产品源码 fda7a4e4a06ea17bc5f4e7bee2a78a75a1d293dc，
   tree ec7aeaf9e5ea394d85a55a6c9bd04ab9ea5a25ae。
   apps/social/evidence/release-candidates/social-web-fda7a4e4a-20261004/
   site.tar.gz：3572067 B，SHA256
   eb74f5bc83f8a3f55eca8dffd054f7a0a2e0c3e89acb49a73fe2dcae3656ae11。
   manifest 28 regular outputs，HANDOFF 已补齐并 push312610880；字节
   没改。实际本地 Node26.7.0 构建；正式 Node24 构建 NOT_VERIFIED。
2. 最新签名授权组合：
   apps/social/evidence/veil-signed-device-admission-20261004/
   dormant-signed-admission-composition.jar：149250 B，SHA256
   fdb7732a9b93edf9f222be03316bb67bcf1be42a2109e25f44678b7a8f791e91。
   4 current native Kotlin + 全部 current Java bridge + 4 Matrix Kotlin
   编译。首轮 internal 跨阶段编译失败完整保留；原同模块 friend 编译
   修正后 exit0，没有放宽 production visibility 或跳过检查。
3. 前代 fresh 全源组合：
   apps/social/evidence/veil-current-source-composition-20261004/
   dormant-current-source-composition.jar：163495 B，SHA256
   ec185b41d6368adf2e4b2f0032f90316c680ba7a59981558196194e25d622eda。
4. 后端匹配构建：apps/social/evidence/backend-c5-matching-build-20261004/
   实际 ynx-sociald 二进制 28467666 B，SHA256
   22266ad0aa2689f9746fc917e705f4720e3bc89712527a1a4d0f6f804c3c6e37；
   gzip 14460200 B，SHA256
   b25e716da11fee3d69df778c52a262b7b3c234b3b1204f5be4bbb722035d479d。
   Social source3a578dc5 + 原 c5 完整 matching Go 输入；没有部署执行。
5. JNI/SDK/lib 证据与实际错误各保留在原 evidence，不替换为新版本：
   libsodium1.0.22 官方签名源码/本地 static library、备份 JNI、原
   bounded secretstream 组件、原 Envelope/JNI/cleanup 报告。
   最新四个附件接线文件当前没有新二进制、没有执行结果、没有 SHA
   冻结交付。不能用旧原语测试当这四文件通过。

## 5. 正式发布、下载、安装和本人业务

- 正式 Social 新 Web 发布：未完成，未收到 successor 发布终态。
- 最后已知正式 Social deployment：dpl_684PnXZhxfmoJGyfvy7no5Epyv46，
  https://ynx-social-5fhmscelh-jiahaoalbus-projects.vercel.app。
  这是历史最后已知身份，不是本次 fresh current/rollback 证明。
- canonical https://social.ynxweb4.com/ 最后实际匿名读取仍旧 UI；
  17029 B index，SHA256
  f81fa34f5a71b95a01ef389c2a6adef5795023ab0f724847866f44dcba1b2045。
  本次暂停没有重新公网读取，不能声称目前线上始终不变。
- 正式新版下载、安装、升级、各平台签名/公证：未验证完成。
  继承的开发 APK 不是正式相容安装证据；不能覆盖旧版本/code34。
- 本人真实批准/拒绝、私有帐号/设备业务、聊天发送/群聊/附件/瞬间、
  冷暖恢复、切号退出、两个节点/真实 Relay/6423：未通过完整验收。
- 真 MONSTER 调用与验收：NOT_RUN。没有用同名智能体或普通自动化冒充。

用户最新指出“网站侧边栏 Logo 仍变形”：已准确列为未闭合问题。
已有 local 产品页 header/chooser 等比 Logo 观察，不证明当前公网或
Host 侧栏图标已修复。未确认实际故障是在产品 favicon 还是共享 Host
容器；暂停下不做新的定位/修改。Root/A 协调共享 Host，Social 原
owner 负责自身页面和资产；不以不同页面 local PASS 洗掉用户发现。

## 6. 未完成工作、责任人与所需真人动作

Social owner 的 owned 实现仍须继续补齐完整 CryptoEngine/LegacyReader
运行接入、逐设备群与附件/受限瞬间、真实 UI 到业务通道、旧历史兼容、
本地 AI 正式模型和完整跨平台用户旅程。它们不是“全部源码已完成”。
新附件 JNI/原事务 outbox 是刚写入的第一轮代码，须正式验证和继续接线。

原真实 Native/共享原子与身份源，由唯一 A/原 Native 与 Social 接口
协调完成：IndependentVerifier.verify、NativeRoutes.review、
CheckpointProtector.load/advance、authenticated enrolled Keystore alias、
current device/namespace、独立 durable generation、实际受信 issuer
登记和 directory caller、Node/Go 同原效应协议与正式 pipeline factory。
这是内部实现欠账，不是要真人提供 API、私钥、普通开发许可或假 pin。
新签名验证器不能替代上述尚缺来源，也不构成生产 admission 批准。

发布/Host/共享 Auth/SSO/SDK/register/main 的唯一写执行人仍 A；Root
负责准确交接与协调。新网页包只是在这条流水线待实际发布，不能
因包已提交就称 UI 已上线。共享 Host Logo 需要在原 Host scope 修复。

真人操作仅在将来实际需要其即时钱包批准、签名/交易、正常 OS/PIN
解锁或最终体验接受时由本人执行；当前没有一项要求真人输入私钥、
助记词、PIN、token 或代我们实现内部接线。暂停期间不触发这些请求。

## 7. 最近回合做了什么、为何停

前一批实际新增签名授权验证器与测试，组合编译、普通 commit/push
成功到5fcfd21ab，精确事实已发 Root。没有称新内核全量可用。

真人再次要求直接开发新的，本批实际只读原附件 C/header、旧备份
JNI 和原 exact sodium 元数据；确认附件只有原语而无 JNI 接线。
随后一次 patch 写入 JNI VAF2 有界帧、native Java bridge、原 native
transaction 中逐块准备/密钥/manifest 与不可变重试 outbox，以及新
JNI QA。用户 Logo 追问与总控真人暂停指令到达时，patch 已成功返回，
尚未启动任何附件测试、编译或安装。这四份代码因暂停而原样保留。

本次只做 git 元数据/dirty 快照、已有 artifact SHA 文本读取、goal
PAUSED 和这份可读报告，不把记录状态算新产品开发进展。

## 8. 暂停与句柄终态

- 本线程 goal：实际 PAUSED，完整目标保留，未 mark complete。
- 本轮没有启动子智能体；前代本人 Newton/Harvey 已关闭，不恢复。
- 本人 Kotlin check/compile session36182：exit0；组合首轮36306：exit1；
  修正41656：exit0；commit/push11014：exit0。没有待轮询 live 命令。
- 本人先前 UI server21685/31696/69138 已终止；测试 tab29/30/28 已关闭，
  原 viewport override 已恢复。没有本人持有的设备/发布窗口。
- 不 kill 别人进程、不抢共享 Native 锁/OS UI，不停止正常线上服务。
- 没有未明本人发行终态；其他 Host/UNKNOWN71756/75291 等状态不归本
  owner 擅自清理或恢复。原帐号、keys、DB、历史、outbox/UNKNOWN 保留。
- 本报告与四新增源均原地可读，暂停后不 commit/push 或自动续跑。

收到真人新的明确继续指令前保持暂停。
