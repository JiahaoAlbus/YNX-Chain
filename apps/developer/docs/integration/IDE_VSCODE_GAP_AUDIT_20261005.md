# YNX IDE 与 VSCode 的差距盘点

日期：2026-10-05。用户目标：保留 YNX 品牌与主题，采用 VSCode 的按钮位置、操作逻辑、扩展机制，并增加 Chain 与 AI。

## 证据范围

用户提供当前 Mac 窗口截图：编辑器打开 hello.cpp，底部只有 Problems，编辑器右上无明显运行入口；macOS 原生菜单仅 File / Window。截图可以证明入口缺口，不能证明所有底层功能不存在。

用户随后提供同一隔离项目的扩展面板截图：搜索 chinese 与 chatgpt 均显示 `Error fetching extensions. fetch failed`。这是请求失败，而不是成功搜索后没有匹配项。当前 `desktop/local-workbench.mjs:74` 为整个本地工作台进程树设置 `(deny network*)`，只允许指定 loopback 监听/入站；扩展 registry 请求在后端执行，默认地址为 `https://open-vsx.org`。该隔离策略与在线市场功能冲突。原先被拒绝的网络/包出站范围尚未重新接通，因此此报告不声称在线市场已经修复，也不通过代理绕过原限制。

本次隔离项目实际打开封存候选的完整工作台组件，点击 Terminal → New Terminal，输入 node --version，返回 v26.7.0。候选源码 4298b6eba，Workbench 0.3.15；这次组件检查不等于用户安装的 Cocoa 窗口验收。后续源码 0.3.17 仍有未构建的变更。

以下历史记录均重新读取并核对来源，属于已有功能验证记录，不作为本次界面体验截图。

## 功能差距

| 项目 | 当前状态 | 必须补齐的实际差距 |
| --- | --- | --- |
| 基础按钮布局 | 已有 Explorer、Search、Git、Debug、Extensions 基础模块 | 用户窗口入口不清楚；固定常用位置，保证首次打开及恢复布局可发现 |
| 原生菜单 | App、File、Window | Edit、Selection、View、Go、Run、Terminal、Help 与真实工作台命令联动 |
| 编辑器运行按钮 | 有任务及调试命令 | 右上运行/调试入口、配置选择、缺少环境时明确提示 |
| 终端 | 本次组件实际执行 Node 成功 | 固定底部入口、新建/分屏/切换；最新 Cocoa 窗口重新验收 |
| 输出与调试控制台 | 有 upstream 模块 | 默认布局只看到 Problems；补齐固定入口及实际输出跳转 |
| 编译和任务 | 受控 C++ 项目已有真实构建、运行、GCC 错误定位记录 | 不同项目/语言的默认任务、工具链检测、缺失提示；不是所有语言一键运行已完成 |
| JavaScript 调试 | 有断点/步进/变量/继续的组件记录 | 新版原生窗口完整复验，明确配置入口 |
| C++ 调试 | LLDB 注册与初始化存在 | debugserver task_for_pid 阻塞；实际断点、步进、变量尚未通过 |
| Git | 初始化、暂存、提交、工作区 diff 有实际记录 | 远端认证、拉取、推送及新原生版本验收未完成 |
| 扩展安装 | 本地 VSIX 安装、禁用、启用、卸载有实际记录 | 在线搜索、下载、更新未通过；兼容性需逐扩展验证 |
| 扩展数量 | 封版包含 11 个插件目录 | 用户 VSCode 的 63 个扩展不能视为已迁移；需要分类导入和兼容说明 |
| 编程语言支持 | JS/TS、JSON、Solidity、部分 C++ | Python/Rust/Go/Java 等需真正安装并验证语言服务和调试器 |
| 界面语言包 | 已存在框架本地化服务 | 安装语言包→配置显示语言→重载→全界面转换尚未验收；自有文案和原生菜单需要覆盖 |
| 编辑能力 | Monaco 基础编辑；跨文件编辑/撤销有验证 | 新增片段、文件操作与保存一致性仍在源代码集成，不能算已交付 |
| Chain 工作区 | 本地 Solidity 编译、诊断、只读 starter | 当前仅少量工具命令；项目模板、网络、账户、部署、交易与浏览器串联缺失 |
| Wallet 身份 | 有生态连接设计与外部工具入口 | 本地正常用户链路未验收；缺少 core session 时外部工具命令无法使用 |
| AI | 审查选择及外部入口 | IDE 内真实对话、修改预览、批准应用、结果回读未完整接通 |
| 测试与远程开发 | 有底层任务/插件基础 | 测试发现与运行、容器、SSH、WSL 等不能列为完成 |
| 软件交付 | 有 Mac 候选与安装包接线 | 新版完整包、签名、公证、正常安装和用户验收未完成；Windows/Linux 未完成 |

## 本轮布局实施顺序

1. 对齐左侧基础活动栏和底部 Problems / Output / Debug Console / Terminal 的发现性。
2. 编辑器右上运行/调试下拉，接实际任务和调试配置，不用虚假运行结果。
3. 原生 macOS 菜单连接真实工作台命令。
4. 扩展面板与语言包安装/切换完整流程。
5. Chain 和 AI 成为自己的工作区入口，并验证实际业务链路。

VSCode 的任务与调试同样依赖项目配置、编译器和对应扩展，布局对齐后仍需完成这些配套能力。参考：[Tasks](https://code.visualstudio.com/docs/debugtest/tasks)、[Debugging](https://code.visualstudio.com/docs/debugtest/debugging)、[Terminal](https://code.visualstudio.com/docs/terminal/basics)。

结论：终端、Git、任务和本地扩展机制已经存在；可发现性、完整运行环境、在线扩展、多语言、Chain/AI 以及正式软件交付仍有明确缺口。当前不能称为 VSCode 同等成熟体验。

## 本次实际操作与新增源代码

1. **终端（组件内正常）**：Terminal → New Terminal → `node --version` 返回 `v26.7.0`。截图：[终端](/private/tmp/ynx-terminal-gap-audit-20261005.jpg)。未把组件检查换算成新原生软件验收。
2. **文件创建保存（绑定目录内正常）**：File → New File → 输入 `ynx-file-create-proof.txt` → Create File → 输入文本 → Cmd+S。真实磁盘回读为 `YNX create-save disk proof`，26 bytes。截图：[创建与保存](/private/tmp/ynx-file-create-save-proof-20261005.jpg)。
3. **切换项目（旧版本体验不合格）**：用户把 fragment 改为 `/Users/huangjiahao` 后无法创建，返回受信 launcher 已绑定的临时项目后正常。新增本地上下文 RPC、错误项目提示、返回已打开项目按钮及原生 Open Folder OS 选择器接线；原生选择后启动新的实际工作区实例，不以更改 fragment 获得文件权限。
4. **运行入口（源码已接线、GUI 待验证）**：编辑器 Run/Debug 下拉连接实际调试及任务命令；左侧与底部缺失入口由真实视图贡献创建并激活，已有可见标签不重复。原生 51 个命令菜单与真实 CommandRegistry 连接。
5. **主题（源码已加入、GUI 待验证）**：14 个主题，包括克莱因蓝明暗、粉色明暗、红色明暗、Graphite、Snow、Arctic、Solarized 明暗、Midnight、Violet、Forest。编辑器、终端、主按钮、状态栏文字与背景的对比度均至少 4.5:1；视觉美观仍需真实界面逐项检查。
6. **语言包（离线资源已集成 producer、GUI 待验证）**：保留本机官方 MIT 简体中文包原始身份及资源，正常 host language-pack 注册机制；新增 YNX 自有工作区、运行入口及 Tools 文案翻译，原生菜单跟随 en/zh-cn。没有把自有少量词条声称完整语言包。
7. **Chain（源码已加入、GUI 待验证）**：Tools 0.2.22 的项目/网络/Wallet 与 AI 分组、实际 Counter.sol 模板和编译入口；网络是已配置的测试网信息，明确未实时检查。Wallet、在线 AI、签名部署尚未接通，不显示虚假账号、余额或结果。

新增源代码回归已验证工作区停止时的异步监听清理，原生菜单消息及显示语言消息有严格 schema/origin/frame 检查。完整候选构建、语言重载、原生文件选择、所有主题及 Chain/AI 正常用户流程尚需继续验收。
