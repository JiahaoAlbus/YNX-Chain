# 账户授权入口审计 R1

2026-10-18，生产工作树 `ynx-pq-public-upgrade/YNX Chain`；开始读取时 HEAD `04b17066a46095e31394e6920cc5e38abfe3fa0f`。范围是 Core API 及其 Pay/AI/App Gateway 身份传递，不把测试网公开入口、可选服务密钥或已有 session 自动算成账户 PQ 授权。未请求生产服务、未使用真实账户/秘密、未运行 Go 编译或测试。第 1–5 节记录修复前基线，后文列出本 owner 已实现的有限修复；触发序列是隔离 QA 的源码反例，尚无运行 RED/PASS 证据。

## 结论

Core 转账与已知 stake/DEX/resource/contract spend 的账户政策门不作为重复发现。本轮发现的独立问题是：Pay 网关跨商户对象引用、AI/Trust/治理的角色字符串可写成权威状态、App Gateway 在账户 PQ 激活后仍可用旧 secp 凭据新建和使用用户 session。服务密钥证明调用服务，不证明正文所称的账户/商户/审批者。

Core `/pay/*`、`/ai/*`、`/trust/*`、`/governance/*` 的网关 key 为空时没有认证；即使 `IsPublicNet=true` 也不经过 `unsignedDevnetRoute`。配置非空时会检查对应服务 header，但仍不校验每个对象的用户账户政策。只读 replica 和 mutation freeze 可阻断写入，但不是运行中的 authoritative producer 的账户授权。

修复前基线 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `internal/api/server.go` | `8983e07c9a3b25dbe46a4787b1f65431884b3fd79ac202913be7fdf55b566eb8` |
| `internal/paygateway/gateway.go` | `732caadcfc4b8af2bcf07a3f571c619b0ca20e62f374db70f5a5a852fac636bb` |
| `internal/paygateway/server.go` | `1b6fb305459f31755e8a1ae7f1c8b7bc4fb8b331cfb18fb0666402fe097c2ab7` |
| `internal/appgateway/session.go` | `beb270553078812ec72dd315e421e557e98bb6abf63383ca57b550a0822a81b9` |
| `internal/appgateway/server.go` | `0753b116494b79f0959b0bdad8c8604a89f6802d798c8846ad244f0410020c2d` |

## 1. Pay：持有效商户 M key 可改商户 N 的 intent 派生记录

路径：`paygateway.Server.handleProxy → authorize → PrepareBody → Service.Proxy(authoritative) → Core payRoute → handleRefund/handleInvoice → CreateRefundWithIdempotency/CreateInvoiceWithIdempotency`。

`PrepareBody` 仅在 `/pay/intents` 校验或填写 cfg.MerchantID；`/pay/refunds`、`/pay/invoices` 只检查存在 idempotencyKey。Core 按 intentId 查现存对象，没有比较请求服务对应的商户。Core 上游密钥由网关自己注入，攻击条件只需要商户 M 的有效 Pay API key和已知 N 的 intentId。

隔离 QA 触发：建立两个真实记录 I_M/I_N，Merchant 不同且 N 的 intent amount=7；对 M 的网关发：

```http
POST /pay/refunds
X-YNX-Pay-Key: <M 的本地测试 API key>
Content-Type: application/json

{"intentId":"<I_N>","amount":7,"reason":"qa cross merchant","idempotencyKey":"qa-cross-refund"}
```

修复前 Core 创建 `status=recorded` 的 N 退款；它在下一次 `CreateRefundWithIdempotency` 的累计中占满额度，N 后续退款记录被拒。相同方式 `POST /pay/invoices` 引用 I_N 能创建 N 的 invoice。`merchant` 正文即使填写 M 也不能自证归属。`/pay/webhook-signatures` 同样按 intentId，Core 接受服务提供的 signingKey，不应让 M 为 N 的意图制造 webhook 记录。

这能证明跨商户业务记录与额度改变；尚不能证明转出 N 的资金。`SettleInvoice`、`CompleteRefund` 仍要求已存在且方向、金额、fee、时间正确的真实已入块转账，不应删除这些校验或把任意 transactionHash 判成功。

最小修复：authoritative POST 转发前，网关用同一固定上游和服务凭据 GET 原 intent/invoice，要求原件 ID 与请求 ID 一致、原件 Merchant 等于 cfg.MerchantID，失败/非200/坏JSON/错误ID一律不发写请求。金额与 DTO 保持现状，不根据正文 merchant 认证；BFT 现有签名者/商户约束继续由原路径执行。Core 内仍需单独的用户/PQ action 权威边界。

## 2. AI：无账户签名可令敏感 proposal 变成 approved/executable

Core `aiRoute` 仅可选服务 key；外层 `aigateway.handleProxy` 只有 `X-YNX-AI-Key`/Bearer API key，authoritative Proxy 原样转正文并注入上游 key。它不把 key 绑定 requester/approver，也不查询 AccountPolicy。

隔离 QA 选择已合法激活 PQ 的账户 A，用普通服务 API key 或 Core 正确服务 key，依次发送：

| 请求 | 正文 |
| --- | --- |
| `POST /ai/permissions` | `{"sessionId":"qa-auth","requester":"<A>","scope":"transfer","purpose":"qa","expiryHours":1}` |
| `POST /ai/actions` | `{"sessionId":"qa-auth","requester":"<A>","scope":"transfer","actionType":"transfer","description":"qa move value","expiryHours":1}` |
| `POST /ai/actions/<返回proposalID>/approve` | `{"approver":"<A>","permissionId":"<返回permissionID>"}` |

`RequestAIPermission` 只保存 map；`ApproveAIAction` 只核非空 approver、grant 的 session/requester/scope/expiry，随后设 `ApprovedBy=A, Status=approved, Executable=true`。没有 VerifyMember/RequireLegacy/账户nonce，也没有确认 approver 控制 A。`POST .../reject` 同样可只给 approver 字符串改状态。注意 `Executable` 是元数据；本轮没有证明有下游自动转账，因此不称已资金盗取。

最小账户接口应明确 owner，不以 requester/approver 任意字符串代替经过钱包证明的 actor。完整 action 签名应绑定 action type、目标 ID、业务 payload、network、账户 nonce/revision、适用高度；旧服务 token可以作为附加传输认证，不能代替它。

## 3. Core Trust / Governance：身份字符串或对象 ID 足以改权威记录

Core `trustRoute` 的服务 key既可为空，也不携用户身份。独立 `internal/governance` 的 CanonicalAuthenticator/角色约束不是这些 Core handler 的调用链，不能凭同仓库存在这套认证就宣称 Core 已使用。

可执行 QA 序列（全部需通过实际已配置的服务层，或明确以未配置 key 的本地 public 配置复现）：

- `POST /governance/requests` 以 `requester=<已激活PQ的A>`、`subject=<A>`、`action=review`、`assetType=address`、`scope=single`、`description=qa review` 创建记录；代码仅检查字符串/分类规则，没有 A 的证明。
- `POST /governance/requests/<ID>/review` 无需用户身份正文，handler直接调用 `ReviewGovernanceRequest(ID)`，改 classification/status/reviewedAt/transparency。`.../reject` 只要 reason 即可改拒绝状态。
- `POST /trust/appeals` 用已存在且 subject匹配的 requestId，以及 `appellant=<A>, claimant=<A>, reason=qa` 创建申诉；`.../<appealID>/resolve` 给 `reviewer=<任意字符串>, decision=ACCEPTED, resolutionReason=qa` 即改决定并追加 correction label/transparency。没有 reviewer 账户证明/角色授权/PQ门。

涉及 actor：GovernanceRequest.Requester、TrustAppeal.Appellant/Claimant、决议输入 Reviewer。Subject/被标记 Address 是受影响对象，**不能**为了补 PQ 直接要求 Subject 签名：第三方正常提交 advisory label 的权限主体应是已认证 issuer，而源 RiskLabelInput 甚至没有独立 canonical issuer 字段。

`POST /trust/labels` 仅校验业务标签约束；`POST /trust/evidence` 仅 Subject 即持久化证据包；`POST /trust/tracking-reviews` 仅正文 Requester 等字段创建记录。它们不直接冻结或转移资金，但不能因此视为身份授权已安全。需明确发行人/申请人/审查者的真实身份与角色，保留 advisory-only、证据和申诉约束。

## 4. App Gateway：旧 secp 凭据在 active PQ 后仍可取得账户 session

实际可达路由：`POST /app/session/challenges` 与 `POST /app/session/challenges/{id}/verify`。`VerifyChallenge` 验 secp256k1-SHA256-low-S + Ed25519 设备证明，未调用链上政策。用户可自己新建设备 key；旧 secp 控制者对 fresh challenge 签名后即可取得目标账户 session，链上已激活双 PQ不影响流程。`AuthenticateSession` 只核 token hash、device、binding、expiry/status，没有激活后的重新检查。

QA触发：先合法登记并激活 A 的双 PQ；保留 A 的旧测试 secp key，生成全新测试 Ed25519设备；用允许的 origin/native binding创建 challenge，以旧 secp与新设备key签回返回的准确 signBytes，再 verify。应拒绝签发，基线代码会创建 session。先在 legacy时获取 session、之后激活 PQ，再用原 token/device调用受保护入口，也是同一缺口。

受保护路由例如 `/app/pay/invoices/<ID>/settle`，网关把 payer强制绑定 session.Account；其他 chat/square/social入口也使用该 session。这证明服务账户身份可继续由旧 key控制；Pay settle仍要求真实已提交转账，不能把此 session本身当作链上扣款能力。

最小修复边界：给旧 challenge创建/verify与已有用户 session使用加可信实时政策判断；未知、未配置、查询失败、owner/network不匹配不得当legacy。现 Config无node registry URL，不能从 WalletURL猜接链地址，也不能用客户端返回的 `legacy=true`。需要连接真实 Core `GET /accounts/{canonical}/authorization` 或由Wallet/Auth owner提供等价可信接口。canonical Wallet `/v1/wallet/*`代理、Pay/AI内部服务API key与节点replication身份不是这类旧secp用户session，不应盲目套同一门。

Trust Product的 `/api/auth/challenges` 和 verify已明确返回410，canonical session另走Wallet服务；不能把 appgateway发现泛化成该产品已接受旧challenge。独立Governance authenticator有真实session/角色或HMAC method/path/body/account/device/session/timestamp/nonce/role检查，本轮没有证明无这些凭据可绕过；它们尚无账户PQ政策接线是下一接口边界，不能直接报成无认证资金入口。

## 5. Faucet、内部服务与其他入口的核对结果

| 入口 | 实际门与可确认结论 |
| --- | --- |
| Core `/faucet`、`/faucet/requests` | testnet/mainnet强制64hex独立服务token；未配置503、错误401。给activePQ收款账户入账不等于以它身份出账，未发现此处绕过其PQ。非正式slug允许的开放测试模式不得称为身份安全证明。 |
| Faucet BFT模式 | 使用真实服务secp账户签普通transfer；若服务账户自身转为PQ，应由执行层拒旧签，不能给service signer自动豁免。未读取服务私钥/线上配置。 |
| `/internal/replication/snapshot` | 只读GET，replicationKey为空或错误均401；本轮未发现HTTP任意写snapshot入口。真实导入在链复制执行层另验。 |
| `/validators/{address}/heartbeat`、`/peers/observe`、`/peer-sync` | 直接HandleFunc，没有节点认证；heartbeat可用已存在validator地址+`{"ready":true,"status":"ready"}` 改PeerReady/观测数据，不能将这种记录当新Comet签名证据。属于节点运维身份缺口，与用户PQ账户不是同一门。 |
| `/transactions/broadcast`、两种`eth_sendRawTransaction` | 验经典包后汇入SubmitSignedTransfer及其账户policy；本轮未找到独立绕过。 |
| `/transactions/pq/broadcast`、authorization/migrate | octet-stream有界wire，迁移route owner和intent owner绑定，链内验policy/nonce/proof；非转账PQ action目前由另一owner开发。 |
| `/transfer`、staking、IDE deploy/execute、`eth_sendTransaction` | public禁unsigned；本地仍经过已有chain账户门；不重复列已知修复。 |
| `/ide/verify`、compile/call | verify改公开合约验证资料，compile/call不等于账户支出；本轮不把“无需deployer签名验证公开源码”直接报告成PQ资金绕过。 |
| BFT gateway Pay/AI/Trust/IDE | 入口验经典SignedApplicationAction并广播；正在改写的consensus政策是最终权威。Gateway提前验classic不等于最终commit可绕policy，也不能代表支持新PQ动作。需在其owner完成后针对冻结源码复核。 |

## 修复与验证记录

已获独占授权修改 `internal/paygateway/**` 的跨商户对象绑定、`internal/appgateway/**` 的旧secp用户session政策门，以及本文；其余chain/API/AI/Trust/Governance保持只读。本轮创建失败用例源码后再做最小实现；Go编译/真实RED/PASS执行等待统一资源窗口，任何源码推理都不记录为运行通过。

### 已实现的 Pay 边界

- authoritative 模式的 `POST /pay/invoices` 和 `/pay/refunds`，从固定 Core origin 读取原 intent；`POST /pay/invoices/{id}/settle` 读取原 invoice。核对原件 ID 和非空 Merchant，必须等于服务配置的 MerchantID。
- 原件读取使用现有服务上游凭据，3 秒期限、64 KiB 响应上限、禁止所有重定向、仅接受单个 JSON 对象。跨商户/不存在/缺 Merchant 返回 403；读取失败或不可信格式返回 502；均不转发写请求。不能用正文 merchant 自证。
- 未修改业务 DTO、资金转账匹配检查和 BFT action 权威路径。本次授权限定发票/退款；**webhook-signatures 的跨商户引用和只读数据过滤仍是独立待处理项**。Core Pay 账户 PQ action 与 merchant→canonical owner 映射仍归 chain/API owner。
- 回归源码用真实 Devnet 创建两个商户及 intent/invoice，断言拒绝不会增加 Core 事件、不会消费他人退款额度；还覆盖正确商户正向、缺商户/错误 ID/非 200/坏 JSON/尾随 JSON 以及正文 merchant 自证失败。

### 已实现的旧 App Session 边界

`CreateChallenge`、`VerifyChallenge`、`AuthenticateSession` 每次查询固定 Core；没有缓存 legacy 决定。服务启动可以不配置 registry，但旧用户会话始终 503 fail closed。保留旧签署文档、secp DER + device Ed25519、binding、token hash、scope/route 和持久化生命周期；**没有新增 PQ session 签署格式，也不把本服务的旧 AppSession 升格为 canonical Product Session v2/v3**。

配置通过 `cmd/ynx-app-gatewayd/main.go` 直接接线：

| 环境变量 | 精确含义 |
| --- | --- |
| `YNX_APP_GATEWAY_ACCOUNT_POLICY_URL` | operator 明确配置的 Core origin。HTTPS 或 loopback HTTP；无 path/query/fragment/userinfo。无默认值，不从 WalletURL 推断。 |
| `YNX_APP_GATEWAY_ACCOUNT_POLICY_NETWORK_ID` | 固定的原始 genesis 32 字节，以 64 个小写 hex 字符表达，不带 `0x`。无默认值，不接受从首次查询自动建立信任。 |
| `YNX_APP_GATEWAY_CHAIN_ID` | 沿用现有 native chain ID（int64）；和上述同 origin 的只读 `POST /evm`、固定 `eth_chainId` 结果核对。 |

两次 HTTP 读取共享 3 秒 deadline，不跟任何 redirect。RPC 响应上限 4 KiB，policy 响应上限 1 MiB。RPC method/body/path 固定且只读，不接收用户 URL/RPC 参数。Policy 只读 `GET /accounts/{canonicalOwner}/authorization`。

政策响应须满足 `policyView=next_execution`、`source=authoritative_producer`、`recordsView=includes_pending`、owner/network exact match、显式 enabled=true、已知 policy version、非缺失的完整 records array。所有高度/revision/nonce 为规范十进制字符串，经 ParseUint 64 位核验；公钥为精确长度的小写 hex。用 `ynxauth.State.Validate` 检查完整历史连续性、激活和 nonce，再以 executionHeight 的 `PolicyAt` 重算 activeRevision/algorithmVersion，不能只用 enabled 或只看 committed tip。已安装但未到 enableAt，以及初次迁移尚未到 activeFrom，仍可在一致的真实 legacy policy 下使用旧签名。任意未知、缺字段、版本/网络/owner/历史/摘要不一致均不签发或复用 session。

active PQ 返回 403、`code=pq_session_required`；未知策略返回 503、`code=account_policy_unavailable`。两者均携 `pqSessionSupported=false` 和 `flow=legacy-app-session-v1`。health 添加 policy 配置状态与旧流程模式，不宣称 policy 可达、共识最终性或 PQ session 支持。签发/使用时在策略网络等待后再次检查过期时间。

策略拒绝不会消费 pending challenge、生成 session 或改已有 session 状态。匹配旧 token/device/origin 的 holder 仍可执行撤销自己的会话；这是清理操作，不再为受保护业务放行。Canonical Wallet `/v1/wallet/*` 纯代理不经过这个旧流程门，内部服务 key 也不被转换为用户身份。新的 canonical PQ session 必须由原 Wallet/Auth 供方提供独立合法 purpose/domain/challenge 合同。

信任和运行边界：固定 Core 是 operator 信任的实时政策来源；返回的 producer tip 不是轻客户端或 BFT finality proof。本补丁不能保证查询后到下游执行之间无跨服务高度变化；资产/业务最终执行仍须由 chain/对应业务层按执行高度再次核权。registry 不可达时旧会话停止使用，部署前必须配置并确保两条只读路由可达；不以可用性为由恢复 classic fallback。

### 验证状态与交接

先落盘的回归源码 SHA-256（实现前，未执行）：Pay `ade0cbdbaa763dc2185c2004744d4d0e721089c369471e2dc295cda9781456d4`；App `0762c4b45db5268d8a339f7c24e4a96e44f9ee4b5b5aad6dd47c1b8da31deac8`。这些哈希仅证明保存了反例测试源码，**不证明真实 RED 已运行**；后续补充了 transport、真实 Core 正向、fresh test keys 和边界用例。

原 App 正向 helper 明确创建 localhost 真实 Core API、安装未来高度 policy、固定其 genesis hash，生产没有 test fallback。负向 registry 的公开字节样本仅测试拒绝门和结构一致性，不做 PQ 迁移、不授予 canonical/PQ 账户资格。新增私钥只在本地测试内随机生成，不打印。现有 secp/device 签署协议未改变。

已做 gofmt 语法解析与 `git diff --check`；**未进行 Go 编译、测试、服务启动或部署**。父任务将冻结源码后交隔离 CI 完整执行 `./internal/appgateway ./internal/paygateway`，并检查 cmd 配置编译。首轮隔离 CI `39055064993` 固定 `1d0930338`，不包含本次未冻结补丁，不可将其结果套用到本补丁。完整运行 RED/PASS、真实 Core 已激活 PQ 登记接线、部署配置/可达性、canonical Auth v3 和保留的 Core AI/Trust/governance 身份权限闭包均须分别验收。
