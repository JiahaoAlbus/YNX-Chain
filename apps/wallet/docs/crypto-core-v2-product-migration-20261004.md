# Wallet 密码核心 v2：产品迁移接口与平台缺口

完整继承真人任务书649行：`/Users/huangjiahao/Downloads/YNX_Chain_Social_Crypto_Core_Rebuild_v2_ZH.txt`，SHA256 `ccafae671b2d325abd0e2bd2bfa403289a0b84f7dfc768345d41d39daa5385e8`。本页是产品接线需求，不是新的密码协议、RPC/签名字节合同或生产激活授权。

基线：本批继承05b09275；App仍c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f；owned仅apps/wallet与apps/wallet-desktop。当前资金链配置仍EVM6423/0x1917、原生ynx_6423-1、YNXT；本地配置不是实际链策略/激活证据。现有源码/依赖清单检索未发现ML-DSA、四状态或混合CryptoProvider实现。本次新能力：**NOT_IMPLEMENTED / NOT_ACTIVATED**；不得把无PQ字段推断为已核验LEGACY，更不能标后量子安全。

| 现状与缺口 | 选定边界/依赖 | Wallet产品迁移要求与风险 |
| --- | --- | --- |
| 现有经典资金签名；无真实混合策略读回 | 唯一A批准的CryptoProvider、Chain/Auth/SDK规范字节和策略证据；不在UI自造ML-DSA实现 | 分开显示LEGACY、PQ_REGISTERED、HYBRID_ENFORCED、RECOVERY_PENDING以及无法验证状态。必须绑定原账户、网络/创世承诺、策略/公钥版本、生效高度、证据新鲜度；这些是消费需求，不是已登记线格式 |
| 旧权限/账户审阅、nonce及未知交易outbox必须保留 | 同一原地址、原确认历史；资金secp256k1 **AND** 独立ML-DSA-87，由共识策略决定 | 登记、启用、换钥、恢复分别审阅完整动作和结果；只有真实链证据才更新状态。不开自动登记/绑定/启用，不复用旧批准，不由RPC配置/墙钟/模板H_TX或H_CONS激活；缺一份签名拒绝受保护操作 |
| Native v3资金密钥采用OS认证存储，尚无PQ独立仓 | Android现有cipher-bound Keystore生物认证；iOSKeychain current-set与this-device-only；算法由成熟共享实现供给 | PQ资金密钥与旧资金密钥独立生成/记录/授权，不能塞进公开metadata、旧v3经典密钥槽或统一默认导出。不能声称PQ运算都在StrongBox/SecureEnclave；同一进程双算法不等于独立设备因子。保留既有旧账号与恢复材料 |
| Desktop现有密码包装仓，未实现PQ备份格式 | 现有PBKDF2/AES-GCM仓保留；新自持备份格式/资源预算由批准合同固定，不静默替换旧格式 | 新PQ备份须独立用途/格式、完整身份与公钥校验、受认证读回和防回滚；错误口令、缺PQ材料、发布失败均保留原文件。旧助记词不能移除HYBRID策略；只能按预先登记且审查通过的恢复规则推进 |
| iOS刚完成源码Pods兼容，首次无签QA暴露Keychain授权缺失；Android模拟器未验证真实生物持钥 | 同RN主App，平台生命周期分别验收 | 继续普通iOS调试签名/安装/存储启动检查，不点重置；Android保留现有强生物保护。真机认证、失效/后台/锁屏/并发签名/旧设备与恢复逐平台实测，模拟器不冒领硬件证明 |
| macOS/Windows/Linux实际密钥环境不相同；Web另有owner | 桌面现有私有文件/本地密码保护；Web由对应owner适配批准边界 | 不把macOS测试当Windows ACL/三系统安装验收；不把NativeExpoWeb当独立WalletWeb。浏览器发布方可替换代码的信任边界明确披露，不默认接收最高安全密钥 |
| Social、验证者与资金密钥用途必须隔离 | Social CryptoEngine与validator签名器由原owner负责；A唯一共享接口 | Wallet身份登录不授予Social历史解密；不将Social/validator/PQ会话/附件/发布密钥装进资金vault或资金备份，不复用恢复材料，不把钱包双签等同Social握手或混合共识 |
| 旧外部钱包、permit/订单/allowance/委托/桥未覆盖 | Chain执行层与原服务owner逐入口核验C04/C06 | 对HYBRID_ENFORCED准确区分只读兼容和受保护写入限制；不能让旧单签旁路，不擅自撤allowance或搬资产。现存合约残余风险单列，不能虚称全生态后量子化 |

实施顺序：先保持现有整合Wallet收转/Pay/扫码/余额/账号/备份主旅程，并完成本批权限存储与iOS正常启动；内部向A闭合策略读回、独立密钥句柄/备份、规范动作/双签、登记恢复与审阅结果合同。合同到位后按原地址做受控产品接线和隔离正反向实测，覆盖C02/C03/C05/C07/C08、X01/X02/X04及相关C06残余入口；不向用户索要私钥/API来替代内部协作。

所有交付分别报告implemented、integrated、migrationVerified、endToEndVerified、securityReviewed、activationApproved、activated、independentOperationVerified、userAccepted。本页和本批943/715工程绿灯不使任何新密码能力已实现/已激活。独审、真实链回放/生产高度/运营者协调与正式制品由对应owner推进；不得清库、重建genesis、恢复快照冒充原网、后台恢复单签或未经用户授权移动资产。

## 同代 Social 源码消费核验（后继事实，不改变上方历史基线）

精确 Social source `55283c5339532d90f808c800fc416a32db44faba` / tree `2bf807194dc5e783a51fbb96149eca34171b164e`。原负责人报告 `apps/social/evidence/veil-current-source-composition-20261004/REPORT.txt` SHA256 `0ff37fbbe5b6c86f857fc647b5e0173260ae239881c0ab18cb059e3bd224e491` 已全文读取；本 Wallet owner 另以 Git blob 重算 3 Kotlin authority/store/transaction、13 Java crypto、4 Kotlin Matrix 共 **20 个当前源码文件**，与报告 `inputs.sha256` 全部一致，命令 exit0。未加载 SDK、旧 adapter/model jar 或新 jar，未重跑 Social 的编译/合成测试，未执行 Android SQLite/Keystore。报告所述 libsignal 0.104.0/Matrix 26.09.28 组合可编译是 Social 工程证据，不是 Wallet 安装或授权证据。

这批真实 ABI **不是 Wallet 资金策略或双签 ABI**：

| 当前源码边界 | Wallet 消费判断 |
| --- | --- |
| `VeilDeviceBinding(owner, device, socialIdentityFingerprint, keyAlias)`；alias 必须为 `ynx.social.veil.v2.*`；grant 来自原生 `VeilDeviceGrantVerifier`，最多 120 秒 lease | 是 Social 设备解密授权。不能用 Wallet account/SSO/当前进程 epoch 拼出 grant，不能把资金 vault alias 改名充作已登记 Social key |
| `VeilNativeStore` 使用已登记的 AES-256、要求用户认证的 Android Keystore key，并按 Social tuple 绑定 SQLite/AAD；外部 `VeilCheckpointProtector` 缺失即拒绝 | 应在 Social 独立持钥与数据库边界消费。Wallet 旧 secp256k1/PBKDF2 备份不提供这些材料或防回滚证明；Keystore 不自动等于独立单调锚 |
| `VeilContextAuthority.IndependentVerifier` 复核已批准设备、路由、generation、epoch 和 SDK/JNI 来源；在原 transaction commit 内再检查 | 真 producer/current/route/source 来自 A 的准确实现，不能以字段相等、回调存在或新可编译 jar 代替；Wallet 登录不授予 Social 历史解密权 |
| `VeilBackupNative.seal/openForStaging` 是 package-private JNI Social ratchet snapshot codec，要求 libsodium 1.0.22 与独立 context；没有 Expo export 或实际 restore effect | 不是 Wallet v3资金备份格式，也不提供 ML-DSA 资金 key handle。不能导入资金默认导出文件，不能为接线公开私密 snapshot 或把恢复当设备授权 |

新 `dormant-current-source-composition.jar` 的 SHA256 `ec185b41d6368adf2e4b2f0032f90316c680ba7a59981558196194e25d622eda` 及 163495 字节仅引用原报告；含四个 synthetic QA 入口，**不得作为 Wallet production dependency 或安装包**。没有把这批 Social 源码复制进 Wallet、修改 App/启动资产、添加依赖或修改旧资金密钥/备份。

Wallet 下一可实施输入仍须是 Chain/Auth 的真实账户策略证据、原账户/网络绑定的独立资金 PQ key handle 与备份格式、同一完整动作的规范双签字节、登记/启用/换钥/恢复的真实 nonce 与结果接口。上述是尚缺输入清单，不是 Wallet 自创协议；由 A 冻结后只在 Wallet owned 消费层接入，保留原地址/经典材料/UNKNOWN。Social 已新增可编译同代源码不再记为“只有旧 model jar”，但不能因此将 Wallet crypto-core 的 implemented/integrated/activated 改为 true。
