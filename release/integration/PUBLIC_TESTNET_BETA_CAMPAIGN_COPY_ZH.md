# YNX 公共测试网开放测试文案包

状态日期：2026-08-02  
适用范围：公共测试网、官网、Explorer、Faucet、Developer 与 Trust Center Testnet Preview  
发布边界：测试网，不是主网；测试资产无市场价值；不宣称交易所上币、跨链桥正式上线、生产签名或第三方合作。

## 一、官网 / 社群正式长文案

### YNX 公共测试网开放测试：一起验证真实流量下的性能、稳定性与生态体验

YNX 公共测试网现已面向开发者、节点爱好者和早期用户开放测试。

这不是一次只看演示页面的活动。我们希望通过真实、可追踪、可复现的测试行为，持续观察 YNX Chain 在多人同时在线、连续转账、合约调用、RPC 查询、区块索引、Explorer 搜索和生态应用使用过程中的稳定性。

本轮测试重点包括：

- 公共测试网连续出块、交易确认和数据持久化；
- 多用户同时转账、批量交易和账户查询；
- REST RPC 与 EVM JSON-RPC 的可用性、延迟和错误恢复；
- Explorer 的区块、交易、地址、排行榜和实时数据更新；
- Faucet 的测试币领取与限流体验；
- Developer Testnet Preview 的项目、API Studio、编译与 Wallet-only 部署审查流程；
- Trust Center Testnet Preview 的证据、申诉、透明度和备份恢复流程；
- 官网 DApp 目录、文档、使用手册与下载中心的可发现性。

#### 公开入口

- 官网：https://www.ynxweb4.com
- DApp 目录：https://www.ynxweb4.com/dapp
- 测试版下载：https://www.ynxweb4.com/dapp/download
- 使用手册：https://www.ynxweb4.com/manual
- 开发文档：https://www.ynxweb4.com/docs
- 区块浏览器：https://explorer.ynxweb4.com
- Faucet 服务状态：https://faucet.ynxweb4.com/health
- REST RPC 状态：https://rpc.ynxweb4.com/status
- EVM JSON-RPC：https://evm.ynxweb4.com
- Chain ID：`6423`（十六进制 `0x1917`）
- 原生测试资产：`YNXT`

#### 建议测试任务

1. 按下方 API 示例领取少量测试 YNXT，并记录领取时间和返回结果。
2. 向两个或更多测试地址分别发起转账，记录交易哈希、金额、手续费和确认区块。
3. 在 Explorer 中分别搜索交易哈希、区块高度、`ynx1` 地址和 EVM 兼容地址。
4. 连续刷新或订阅实时区块，观察高度是否持续增长、索引是否追平。
5. 使用标准 EVM 工具读取 Chain ID、区块高度、余额、交易收据和日志。
6. 下载 Developer 或 Trust Center 的 Testnet Preview，核对文件大小和 SHA-256 后再运行。
7. 在桌面与手机浏览器中测试中文/英文、键盘操作、窄屏布局、深色模式和失败提示。
8. 遇到问题时保留时间、入口、操作步骤、交易哈希、区块高度和截图，再提交反馈。

#### 安全与测试边界

- YNXT 当前是测试网原生资产，不是稳定币，不代表任何现实货币价值。
- 测试网可能升级、暂停或重置；请勿将测试资产用于投资、交易或场外买卖。
- 不要导入主网钱包、真实资产钱包或生产私钥；建议使用专门创建的测试账户。
- 当前下载均为明确标注的 Testnet Preview；未签名、临时签名或测试签名不等于生产发行。
- 本轮不宣称跨链桥正式开放，也不建议向任何未验证桥地址发送真实资产。
- 请勿进行 DDoS、漏洞利用、数据破坏、绕过限流或未经授权的高并发攻击。
- 自动化压测必须使用公开测试账户、遵守限流，并提前说明来源 IP、并发量、持续时间和测试目的。
- 如发现安全问题，请先私下提交可复现报告，不要公开泄露密钥、个人数据或可被立即利用的细节。

目前未公布代币、现金或空投奖励。任何未来激励规则只以 YNX 官方域名发布的正式说明为准，谨防冒充和诈骗。

我们希望收到的不只是“能不能打开”，而是有证据的真实反馈：什么时间、什么操作、什么结果、是否可复现，以及 Explorer/RPC/应用界面分别显示了什么。

欢迎你加入 YNX 公共测试网，一起把链和生态推到更真实的流量环境中。

#### Faucet API 示例

Faucet 当前提供后端 API，根路径不是领取页面。请把示例地址替换成专门创建的测试网地址：

```bash
curl -fsS -X POST https://faucet.ynxweb4.com/request \
  -H 'content-type: application/json' \
  -d '{"address":"你的测试网地址"}'
```

当前服务状态公布的默认额度为每次 `100 YNXT`，并按 IP 与地址执行 `1 次/小时`限流；以请求时 `/health` 返回的实时配置为准。

## 二、社交媒体短文案

YNX 公共测试网现已开放真实流量与稳定性测试。

你可以领取测试 YNXT、发起转账、查询区块与交易、调用 EVM RPC、体验 Explorer，并下载 Developer / Trust Center Testnet Preview。

入口：
官网 https://www.ynxweb4.com  
Explorer https://explorer.ynxweb4.com  
Faucet 状态 https://faucet.ynxweb4.com/health  
DApp 与下载 https://www.ynxweb4.com/dapp/download

Chain ID：6423 / 0x1917  
原生测试资产：YNXT

测试网可能升级或重置，YNXT 无现实货币价值。请使用专门的测试账户，不要导入真实资产钱包或生产私钥。未经授权请勿进行高并发攻击；发现问题请提交时间、步骤、交易哈希、区块高度与截图。

#YNXChain #YNXT #Testnet #Web4 #Blockchain

## 三、开发者招募文案

### 面向开发者：用真实调用帮助验证 YNX Testnet

我们正在招募开发者对 YNX 公共测试网进行可复现测试，重点观察：

- EVM JSON-RPC 兼容调用；
- 连续交易、Nonce、回执与事件日志；
- 多账户并发读写；
- RPC 延迟、超时、重试与恢复；
- Explorer 索引一致性；
- 页面与 SDK 在失败状态下是否如实降级。

网络参数：

```text
Network Name: YNX Testnet
Chain ID: 6423
Hex Chain ID: 0x1917
Native Asset: YNXT
REST RPC: https://rpc.ynxweb4.com
EVM JSON-RPC: https://evm.ynxweb4.com
Explorer: https://explorer.ynxweb4.com
Faucet API: https://faucet.ynxweb4.com/request
Faucet Health: https://faucet.ynxweb4.com/health
```

请优先从低频、小额、可追踪测试开始。需要自动化并发测试时，请记录客户端版本、请求类型、并发量、持续时间、成功率、P50/P95/P99 延迟和错误分类。不要把单一客户端或单一地区的结果描述成全网结论。

## 四、问题反馈模板

```text
标题：[模块] 一句话描述问题

测试时间（含时区）：
入口 / URL：
设备与系统：
浏览器 / 客户端版本：
网络地区：
YNX Chain ID：6423

操作步骤：
1.
2.
3.

预期结果：
实际结果：
是否可稳定复现：

交易哈希（如有）：
区块高度（如有）：
测试地址（请勿提交私钥）：
HTTP / RPC 状态码：
错误信息：
截图或录屏：

是否涉及安全风险：是 / 否
是否包含个人数据或密钥：必须为否
```

## 五、集中稳定性测试公告模板

> 将方括号字段替换为已确认信息后再发布；没有确认的信息不得猜测。

```text
YNX Testnet 集中稳定性测试

时间：[YYYY-MM-DD HH:mm–HH:mm，时区]
目标：[并发在线人数 / 请求量 / 交易量]
重点：[转账 / RPC 读取 / Explorer / Faucet / DApp]
允许的自动化速率：[每客户端每秒请求数]
禁止行为：DDoS、破坏性测试、绕过限流、真实资产或生产密钥
状态页：[已确认的状态页 URL]
反馈入口：[已确认的反馈 URL / 邮箱]
激励规则：[无，或已发布的正式规则 URL]

测试结束后将公开：成功率、P50/P95/P99 延迟、错误分类、峰值并发、恢复时间和已知限制。未采集到的数据不会被推断或包装成成绩。
```
