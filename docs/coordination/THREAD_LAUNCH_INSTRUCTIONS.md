# Codex Parallel Task Launch Instructions

## Launch rule

Start six product tasks in the first wave. Six is enough to gain real parallelism
without making integration, emulators, ports, dependency installs and Git review
unbounded. Start the next wave when the first branches have a tested handoff or
when the main integration task asks for it.

For every task:

1. Create a new Codex task for `/Users/huangjiahao/Desktop/YNX Chain`.
2. Select an isolated worktree. Do not let two tasks edit the same checkout.
3. Paste exactly one launcher below as the new task's `/goal`.
4. Let the task work until it has committed and pushed its named branch.
5. When it reports `子目标已完成，请让总控线程核验 ...`, send the branch and
   commit back to the main integration task. Do not merge it yourself.

The main integration task remains open and does chain/runtime/security/deployment
work plus review. Do not create another task with the role of “master”.

## First wave

### Task A: Wallet authentication

```text
/goal
你是 YNX Wallet 与 Sign in with YNX Wallet 独立产品实现线程。先读取 /Users/huangjiahao/Desktop/YNX Chain/docs/coordination/PARALLEL_ECOSYSTEM_OBJECTIVES.md 的 Shared foundation、Every product task must、Task 1，再读取 docs/ecosystem/PRODUCT_ARCHITECTURE.md。严格执行 Task 1，使用独立 worktree 和分支 codex/ecosystem-wallet-auth。不要修改长期目标、docs/acceptance、根 Makefile 或中央 Gateway policy；需要总控改的内容写入 docs/handoffs/wallet-auth.md。必须实现真实代码、测试、跨 App 安全边界和 Android emulator 证据，提交并 push。没有完成不得说完成；完成后只向用户报告：子目标已完成，请让总控线程核验 codex/ecosystem-wallet-auth <commit>。
```

### Task B: Social

```text
/goal
你是 YNX Social 独立产品实现线程。先读取 /Users/huangjiahao/Desktop/YNX Chain/docs/coordination/PARALLEL_ECOSYSTEM_OBJECTIVES.md 的 Shared foundation、Every product task must、Task 2，再读取 docs/ecosystem/PRODUCT_ARCHITECTURE.md。严格执行 Task 2，使用独立 worktree 和分支 codex/ecosystem-social。Social 必须是单独 App，好友发现使用 @handle、联系人、邀请或 QR，禁止要求用户输入钱包地址；禁止恢复 mixed super App。不要修改长期目标、docs/acceptance、根 Makefile 或中央 Gateway policy；集成请求写入 docs/handoffs/social.md。实现真实持久化闭环、测试和 Android/iOS 构建，提交并 push。完成后报告：子目标已完成，请让总控线程核验 codex/ecosystem-social <commit>。
```

### Task C: Pay

```text
/goal
你是 YNX Pay 与 Merchant Console 独立产品实现线程。先读取 /Users/huangjiahao/Desktop/YNX Chain/docs/coordination/PARALLEL_ECOSYSTEM_OBJECTIVES.md 的 Shared foundation、Every product task must、Task 3，再读取 docs/ecosystem/PRODUCT_ARCHITECTURE.md。严格执行 Task 3，使用独立 worktree 和分支 codex/ecosystem-pay。必须以真实已提交 YNXT 交易证据决定 paid 状态，完成消费者付款和商户收款、回调、对账、退款/争议闭环，禁止假支付和假商户数据。不要修改长期目标、docs/acceptance、根 Makefile 或中央 Gateway policy；集成请求写 docs/handoffs/pay.md。完成代码、测试、smoke、构建、commit 和 push 后报告：子目标已完成，请让总控线程核验 codex/ecosystem-pay <commit>。
```

### Task D: Explorer and Monitor

```text
/goal
你是 YNX Explorer 与 YNX Monitor 两个独立产品实现线程。先读取 /Users/huangjiahao/Desktop/YNX Chain/docs/coordination/PARALLEL_ECOSYSTEM_OBJECTIVES.md 的 Shared foundation、Every product task must、Task 7，并读取 docs/ecosystem/PRODUCT_ARCHITECTURE.md。严格执行 Task 7，使用独立 worktree 和分支 codex/ecosystem-explorer-monitor。Explorer 只能使用真实 RPC/Indexer/ynx-explorerd 数据，实时 SSE 和降级必须可测；Monitor 必须有鉴权、节点/验证人/告警/事故/回滚闭环。禁止假 TPS、交易、价格、验证人和在线率。不要改长期目标、docs/acceptance、根 Makefile 或中央 Gateway policy；集成请求写 docs/handoffs/explorer-monitor.md。完成 Playwright、响应式截图、测试、commit 和 push 后报告：子目标已完成，请让总控线程核验 codex/ecosystem-explorer-monitor <commit>。
```

### Task E: Developer IDE

```text
/goal
你是 YNX Developer 独立 IDE 产品实现线程。先读取 /Users/huangjiahao/Desktop/YNX Chain/docs/coordination/PARALLEL_ECOSYSTEM_OBJECTIVES.md 的 Shared foundation、Every product task must、Task 6，并读取 docs/ecosystem/PRODUCT_ARCHITECTURE.md。严格执行 Task 6，使用独立 worktree 和分支 codex/ecosystem-developer。完成项目、编辑、编译、测试、Wallet 签名部署审核、收据/日志、源码验证和文档闭环；不得扩大 bounded EVM opcode 覆盖，不得伪造部署成功或声称任意 EVM 兼容。不要改长期目标、docs/acceptance、根 Makefile 或中央 Gateway policy；集成请求写 docs/handoffs/developer.md。完成 Web 测试和真实桌面打包证据边界、commit 和 push 后报告：子目标已完成，请让总控线程核验 codex/ecosystem-developer <commit>。
```

### Task F: AI

```text
/goal
你是 YNX AI 独立产品实现线程。先读取 /Users/huangjiahao/Desktop/YNX Chain/docs/coordination/PARALLEL_ECOSYSTEM_OBJECTIVES.md 的 Shared foundation、Every product task must、Task 8，并读取 docs/ecosystem/PRODUCT_ARCHITECTURE.md。严格执行 Task 8，使用独立 worktree 和分支 codex/ecosystem-ai。完成会话、流式生成、取消/重试、模型与 provider 状态、工具和链操作审批、用量成本、隐私、审计和申诉闭环；provider 无额度时必须诚实显示失败，禁止用 canned answer 冒充真实生成。不要改长期目标、docs/acceptance、根 Makefile 或中央 Gateway policy；集成请求写 docs/handoffs/ai.md。完成代码、测试、smoke、构建、commit 和 push 后报告：子目标已完成，请让总控线程核验 codex/ecosystem-ai <commit>。
```

## Second wave

After the first wave reaches handoff, start these from the matching numbered
sections in `PARALLEL_ECOSYSTEM_OBJECTIVES.md` using the same shared rules:

| Product task | Section | Branch |
| --- | --- | --- |
| Exchange | Task 4 | `codex/ecosystem-exchange` |
| Shop | Task 5 | `codex/ecosystem-shop` |
| Trust Center + Resource Market | Task 9 | `codex/ecosystem-trust-resource` |
| Music | Task 10 | `codex/ecosystem-music` |
| Video + Creator Studio | Task 11 | `codex/ecosystem-video` |
| Cloud + Docs | Task 12 | `codex/ecosystem-cloud-docs` |
| Browser + Search | Task 13 | `codex/ecosystem-browser-search` |
| Finance | Task 14 | `codex/ecosystem-finance` |
| Mail + Calendar | Task 15 | `codex/ecosystem-mail-calendar` |

Use this launcher and replace the three placeholders:

```text
/goal
你是 <PRODUCT> 独立产品实现线程。先读取 /Users/huangjiahao/Desktop/YNX Chain/docs/coordination/PARALLEL_ECOSYSTEM_OBJECTIVES.md 的 Shared foundation、Every product task must、<TASK SECTION>，并读取 docs/ecosystem/PRODUCT_ARCHITECTURE.md。严格执行该 Task，使用独立 worktree 和分支 <BRANCH>。不要修改长期目标、docs/acceptance、根 Makefile 或中央 Gateway policy；所有总控集成请求写入该 Task 指定的 docs/handoffs 文件。必须实现真实持久化代码、完整主流程、失败/恢复/安全边界、测试、smoke 和适用平台构建；禁止空功能外壳、合成公共数据和无证据上线声明。完成 commit 和 push 后报告：子目标已完成，请让总控线程核验 <BRANCH> <commit>。
```
