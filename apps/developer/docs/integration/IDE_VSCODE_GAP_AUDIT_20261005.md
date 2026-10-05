# YNX IDE 与 VSCode 的差距盘点

日期：2026-10-05。用户目标：保留 YNX 品牌与主题，采用 VSCode 的按钮位置、操作逻辑、扩展机制，并增加 Chain 与 AI。

## 当前原生候选补充（96779efe6）

新版位于 apps/developer/.ynx-developer-candidates/ynx-duplicate-project-native-96779efe6-20261005。源码 96779efe6c56183850c4ec4460af62ffea597002，tree 1ad4781ba4ca070ee08cb1d0454f544a9b152d2f；DMG SHA256 be4f0172e822c2bf627301aef95ec51938e621a078ad90e2ae51c99d632ac4e9。沿用同一封存 core tree，原生程序、启动器和本地监督器按新源码重建。

Mac 原生操作已恢复：7cbf 完整候选通过系统选择含空格的项目目录、新建真实文件、保存、关闭重开，以及终端 pwd/cat 回读。96779efe6 完整候选通过重复项目提示、原生 Open Folder 选择其他项目并进入正常编辑器；原文件与旧运行进程保留。15 项相关测试通过且无跳过。证据和精确源码交接保存在新候选目录。

以下 bf18 表格为旧版本证据；其中锁屏导致原生流程未验收的状态已由以上实测取代。正式服务、在线市场、真实 Chain/AI 和正式发布仍未验收。

## 最新验收状态（覆盖下方初始基线）

最新封存 macOS 候选的产品源码为 `bf18cf329f06db35d77ff09d29ec1ae462c89ddf`，源码 tree 为 `69bad806d7dd7e4db738f4c2424f806286ce9b84`，composed-core tree 为 `9a6f2177f1359bef41717ec9e74cf96b0b5acbf53fbdfd96af527cfc41c33c1d`。后续文档修改不代表这个安装包已重建。候选位于 `apps/developer/.ynx-developer-candidates/ynx-search-replace-native-bf18cf329-20261005`；DMG SHA256 为 `d557e62a6041f1c5333e21a25828f997cf80847777c6d452bfd5bdc35f6a97e2`。

| 要求 | 已取得的实际证据 | 仍缺少的验收 |
| --- | --- | --- |
| 文件与项目 | 最新包内组件 GUI：终端创建真实文件；重命名、修改、保存、关闭再打开通过；新建文件夹、复制粘贴、含已打开文件的文件夹重命名通过，磁盘内容与编辑器新路径一致。c984 包已验证错误 fragment 的提示和返回绑定项目后创建保存 | 锁屏下无法操作 Cocoa 的原生文件夹选择器；任意用户选定项目的原生完整流程仍待验证 |
| 成熟编辑 | bf18 多文件搜索替换、一次 Undo/Redo、Save All 和两份真实磁盘回读通过；新增 9 项回归通过。5ecd 本地修改审阅批准应用、回到源编辑器、撤销重做保存通过 | 不能由这些流程推断所有文件操作、所有语言或正式托管内核已通过 |
| 操作布局 | 组件 GUI 已验证四项 Run/Debug 菜单、实际任务选择器、终端入口；原生 51 个命令已接线 | Cocoa 菜单、真实 C++ 断点/步进/变量仍待验收 |
| 主题与语言 | c984 通过正常选择器逐一选择并渲染 14 个主题，截图与 actual-render.json 已保留；Klein 默认主题已展示。官方简体中文包识别、语言选择和重载已有组件证据 | 全部状态的视觉质量和全部自有文案覆盖尚未证明；不能声称零英文回退 |
| 扩展 | 内置面板实际显示 12 项；正常 Install VSIX 选择器可打开；已有本地 VSIX 安装、启停、卸载记录。用户 VSCode 清点为 63 个唯一扩展 ID | 在线市场搜索、下载、更新仍失败；版本范围匹配不证明兼容，63 项未整体迁移或执行 |
| Chain 与 AI | Counter.sol 模板创建保存和 solc 0.8.24 的真实 ABI/bytecode；项目/网络/Wallet 与 AI 分组入口；本地人工修改审阅通过 | 真实 Wallet 身份、余额、签名部署、在线模型与 AI 修改回读尚未接通；人工审阅不能算 AI |
| 权限隔离与正式服务 | 本地绑定项目、终端受控路径已有实际证据；共享接入契约仍见 IDE_NATIVE_SESSION_ENTRY_20261003.md | 两个正式用户、撤销/过期、容量及真实获准内核运行仍未验收；本机 /etc/ynx-developer/adapters 当前不存在 |
| 软件交付 | bf18 完整 app/DMG 已生成，包内组件真实运行 Node v26.7.0。安装器资源、原 Logo、挂载资产和 ad-hoc 签名检查通过 | Finder/Cocoa 安装体验、Developer ID、公证、正式发布、Windows/Linux 尚未完成；当前 bundled Node 的最低 macOS 为 27.0 |

精确包内文件操作证据位于该候选的 `USER_FLOW_CHECKPOINT_20261005.json` 和 `verification/rename-save-reopen.png`、`verification/folder-copy-rename.png`。主题证据位于保留的 c984 候选 `verification/themes/`，不改标为 bf18 新验收。源码构建交接位于 bf18 候选的 `SOURCE_BUILD_HANDOFF_20261005.md`。旧候选、用户原 63649 实例及原项目均保留。

正式共享服务和 A 发布范围仍暂停；network/package-egress/LXD 被停止的范围没有恢复，也没有通过代理或削弱隔离绕过。以下章节保留历史发现与修复过程，出现“待验证”的旧描述时以上表和明确标注版本的验收记录为准。

## 证据范围

用户提供当前 Mac 窗口截图：编辑器打开 hello.cpp，底部只有 Problems，编辑器右上无明显运行入口；macOS 原生菜单仅 File / Window。截图可以证明入口缺口，不能证明所有底层功能不存在。

用户随后提供同一隔离项目的扩展面板截图：搜索 chinese 与 chatgpt 均显示 `Error fetching extensions. fetch failed`。这是请求失败，而不是成功搜索后没有匹配项。当前 `desktop/local-workbench.mjs:74` 为整个本地工作台进程树设置 `(deny network*)`，只允许指定 loopback 监听/入站；扩展 registry 请求在后端执行，默认地址为 `https://open-vsx.org`。该隔离策略与在线市场功能冲突。原先被拒绝的网络/包出站范围尚未重新接通，因此此报告不声称在线市场已经修复，也不通过代理绕过原限制。

本次隔离项目实际打开封存候选的完整工作台组件，点击 Terminal → New Terminal，输入 node --version，返回 v26.7.0。候选源码 4298b6eba，Workbench 0.3.15；这次组件检查不等于用户安装的 Cocoa 窗口验收。该段为初始基线；新版构建与组件实测见文末。

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
4. **运行入口（新版组件 GUI 已验证，Cocoa 待验证）**：编辑器 Run/Debug 下拉连接实际调试及任务命令；左侧与底部缺失入口由真实视图贡献创建并激活，已有可见标签不重复。原生 51 个命令菜单与真实 CommandRegistry 连接。
5. **主题（源码已加入、GUI 待验证）**：14 个主题，包括克莱因蓝明暗、粉色明暗、红色明暗、Graphite、Snow、Arctic、Solarized 明暗、Midnight、Violet、Forest。编辑器、终端、主按钮、状态栏文字与背景的对比度均至少 4.5:1；视觉美观仍需真实界面逐项检查。
6. **语言包（组件内安装识别、切换及重载已验证）**：保留本机官方 MIT 简体中文包原始身份及资源，正常 host language-pack 注册机制；新增 YNX 自有工作区、运行入口及 Tools 文案翻译，原生菜单跟随 en/zh-cn。没有把自有少量词条声称完整语言包。
7. **Chain（组件内模板创建、保存与编译已验证）**：Tools 0.2.22 的项目/网络/Wallet 与 AI 分组、实际 Counter.sol 模板和编译入口；网络是已配置的测试网信息，明确未实时检查。Wallet、在线 AI、签名部署尚未接通，不显示虚假账号、余额或结果。

新增源代码回归已验证工作区停止时的异步监听清理，原生菜单消息及显示语言消息有严格 schema/origin/frame 检查。完整候选构建、语言重载、原生文件选择、所有主题及 Chain/AI 正常用户流程尚需继续验收。

## 集成检查补充

- 7f87da6e2 完整组件已通过正常语言选择器切换中文并重载；核心菜单、命令面板、YNX 树条目显示中文。已用正常颜色主题选择器切换 YNX Klein Light。全 14 个主题已注册，逐个视觉验收仍未完成。
- 同一组件正常创建 Counter.sol、Cmd+S 后回读磁盘 332 bytes；通过 YNX 编译命令生成真实 solc 0.8.24 的 ok=true、ABI/bytecode 输出。测试工程原有的预设语法错误先产生真实诊断，再经编辑器修正并保存后通过编译。
- 3ff34fb17 组件实际打开本地修改审阅 QuickPick，明确显示身份/AI 未连接，不再生成被阻止的 webview。capture/edit/diff/apply 的源代码回归通过，完整原生输入链路仍待验。
- 编辑器运行入口改用工作台原生 ContextMenuRenderer/MenuModelRegistry，移除被裁切的 inline popup 和 overflow 覆盖；四项动作正常显示，点击 Run Task 进入真实任务选择器。命令面板过滤 YNX 后，无绑定项的旧 aria/hover 提示已清理，Review Selected Text 的真实 CmdK CmdY 仍保留。
- 首个终端绕过 profile 的默认 login args 产生初始化文件拒绝提示；修复只改变 local 模式 Default scope 参数，显式用户设置仍优先，未改变 sandbox。
- 带原 Logo 的 ICNS、安装器封面和 DMG mounted-assets 检查通过；当前为 ad-hoc Testnet Preview，Developer ID、公证、正式安装发布尚未完成。电脑锁屏使 Cocoa 菜单/文件夹选择与 Finder GUI 检查暂停。
- 在线扩展搜索/下载、通用隔离 webview、Wallet 身份、真实模型与签名部署仍未完成。未绕过被停止的网络/package-egress 范围。

## 最新精确候选与审阅修复

- 864d8cfd45aa54e79ba4a2a870d1ea2213c32d94 的完整 macOS 候选已封存。DMG SHA256：068a36516fb1adf272ee06197f0e4222464376f466334fea2359b71f89d59b40；Core tree：855d92c1d57a6bc789001d4bc144d4e9669ca6704ad29d038d2c34753371fe49。所有代码、composed-core、Node 与 lock-helper 均直接取自该包，隔离项目启动、新建文本页、四项运行原生菜单、真实终端 node --version=v26.7.0 已通过组件 GUI。截图：[最终包内工作台](/private/tmp/ynx-exact-package-terminal-864d8cfd4-20261005.png)。该证据不替代锁屏中的 Cocoa/Finder 操作验收。
- 当前源码补充：本地改动审阅应用成功后回到原文件与原编辑器列，使后续 Save/Undo 针对真实源缓冲区；取消批准保持替换文档和源文件不变。回归使用真实临时磁盘文件与 VSCode API 边界 harness，不等于完整 GUI 输入链路验收。后续源码不混报为上述 864d8cfd4 候选内容。
- 原用户 63649 实例保留。线上扩展、统一 Wallet 身份、模型、签名部署、跨平台正式发布依然未完成；原被拒网络/包出站与共享所有权范围保持停止。

- 默认主题修复：FrontendConfigPreferenceContribution 先注册 defaultTheme、再注册 preferences；当前框架重复 override 的查找会取先注册项。改为唯一 defaultTheme=YNX Klein，移除重复的 workbench.colorTheme 默认项；用户显式主题偏好仍由原生 PreferenceService 优先处理。新 profile 视觉验证待完成，不能把默认值源码当作已展示证据。

## 跨文件搜索替换修复（2026-10-05）

在 c984 组件中发现：项目搜索的全部替换逐文件执行并保存，Undo 只恢复当前文件。新增 owned search-replace-transaction 适配器，将多文件搜索替换提交为同一个带 document version 的 MonacoWorkspace bulk edit，继承现有整体撤销逻辑。确认后校验搜索词、替换词与每个匹配的实际文本；异步加载期间的版本变化拒绝执行。失败保留搜索结果，保存仍是独立操作，不声称跨文件磁盘写入原子性。单文件和单个匹配仍使用框架路径。

新增回归 9 项通过；工作台 browser/node 构建零错误。新封存组件 core tree 9a6f2177f1359bef41717ec9e74cf96b0b5acbf53fbdfd96af527cfc41c33c1d，在隔离测试工程 Main.sol/Second.sol 用正常键盘输入 value→total；两份文件磁盘回读通过。一次 Edit→Undo 后 File→Save All，两份磁盘均恢复 value；一次 Redo 后 Save All，两份均恢复 total。该组件来自当前修复源码、保留的 5ecd Node/lock-helper，不是最新 Cocoa 安装器验收。原用户 63649 实例未修改。

## 原生项目选择修复（尚未重新封存完整包）

解锁后实际原生 File → Open Folder 面板选中目录，但 Open 和 New Folder 按钮禁用。独立应用标识副本、重新编译的产品源码和最小 Cocoa sheet 程序均复现；不是根据多版本并存就判定版本冲突。显式目录类型过滤没有解决，不纳入产品。最小程序改用 beginWithCompletionHandler 的独立异步面板后，Open 启用并实际返回带空格的测试项目路径。同步 runModal 实验出现回读超时，不作为产品方案或成功验收。

产品源码改用独立异步面板并保留强引用、防重复打开。进一步记录发现 Foundation 将原生选中的 /private/tmp 路径返回为 /tmp；旧严格函数还通过 stringByStandardizingPath 拒绝 /private/tmp 的真实规范路径，导致项目交接静默失败。现在仅可信原生选择器边界通过 realpath 得到实际目录；严格启动边界仍以 realpath 相等和 lstat 目录类型确认，不接受相对路径、别名、符号链接路径、点段或父目录段。原生明确选择符号链接时交接的是其真实目录，而非扩大文件权限。

新编译的目录边界回归与原生 origin/frame、异步恢复、私有存储回归共 6 项通过、0 跳过。恢复测试的旧源码切片误把后续 local-workbench 方法纳入启动方法，已改为只检查目标方法；实际阻塞恢复/存储保留测试继续通过。两处产品修复已编译，但完整项目切换 GUI 最后一次复验时 Mac 再次锁屏，因此新实例启动、创建保存和终端路径仍待验证；没有覆盖或重新标注原 bf18 完整 DMG。诊断资源保留在 ynx-native-picker-diagnostic-20261005，不是正式软件交付。

## 新版原生 Chain 工具实测补充

96779efe6 完整原生候选通过 YNX 工具面板打开、Counter.sol 模板保存、实际 solc 0.8.24 编译和 JSON 产物保存；磁盘产物含 Counter 的 2 个 ABI 条目、225 字节创建字节码。只读 YNX Testnet SDK 模板也已保存，没有发起 RPC 或签名。截图、源码和产物保存在该候选 verification/native-chain-compile.png 与 native-chain-acceptance.json 中。

错误合约测试曾出现 Local import discovery exceeded its time limit；不将失败诊断流程标为通过。同一封存解析器在独立进程与实际生产 sandbox 下都能在约 0.3 秒解析同一错误内容；当前源码的完整 local-capture 实际回归为 13 PASS、0 FAIL、0 SKIP。仍需解锁后的正常原生窗口复现来定位。工具再次报告 Mac 锁屏，故复验中断；自有无效测试文件已按精确内容守卫恢复磁盘，编辑器同步仍待验证。正式身份、AI、签名部署和 A 发布仍暂停或未验收。

## 同服务错误合约复验与编译取消修复

原生 96779efe6 所监督的同一 52251 服务，通过 IAB 正常代码输入、保存和命令面板编译错误合约，正确拒绝构建，并在 Problems 标记 Expected primary expression. 第 5 行第 28 列。正常 Undo/Save 后错误清除，重新编译保存的产物 hash 与先前原生成功产物一致。此项是同服务浏览器证据，不替代仍被锁屏阻挡的 Cocoa 超时复验。

当前 Tools 0.2.23 源码把源码收集纳入可取消的构建进度，收集前即拦住重复编译；取消和原 15 秒解析截止时间都可结束等待编辑器回复，终止解析 Worker，迟到回复不继续收集或生成产物。新增真实编译器测试阻塞依赖文件的编辑器回复，验证提前进度、拒绝重复构建、及时取消、迟到回复不生成产物以及随后正常编译。local-capture 14 PASS、language 1 PASS，无跳过。首个 language 测试因输入在 Library 缓存下不满足其 owned-candidate 路径约束而在开始前失败；改用同一字节的封存候选路径后通过，没有放宽断言。Tools 0.2.23 已封入 4141c5034 完整候选。精确包内服务在含 65 个依赖文件的隔离项目中，通过正常界面完成编译→取消（无产物）→重新编译→Save As；磁盘 PackageMain.build.json 为 ok=true、Main 合约并含字节码。新 Cocoa 窗口验收仍未完成，不能将浏览器证据替代原生超时根因复验。

该候选 DMG SHA256 为 47a7656729aa014c496267f711c7abda6a9bb6bc0057f62cc42324549bc25599，core tree 为 49888ebf459908cfe356c45eae29c5a192ad1e6e0a6881b8568f1ba6d27f3133。精确源码、平台要求、截图和真实产物记录在候选 SOURCE_BUILD_HANDOFF_20261005.md 与 USER_FLOW_CHECKPOINT_20261005.json。原生自动化返回锁屏/不可用状态不等于用户 Mac 实际锁屏；未要求用户再次提供资料。


## 解析截止时间故障路径实测（Tools 0.2.24 源码）

实际生产 15 秒截止时间测试让 Stalled.sol 的编辑器 openTextDocument 一直不回复。构建如期拒绝，错误明确指出 waiting for the editor to open Stalled.sol，活动构建归零、没有显示产物；迟到回复不恢复旧构建，随后正常重试成功并显示真实产物。新增诊断也区分解析器启动、源文件检查、编辑器读取、解析 import 和依赖解析阶段，仍只显示项目相对 source unit；时间、容量、路径和隔离限制未放宽。

本轮两文件回归首跑 15 PASS、1 FAIL：失败来自测试恢复 openTextDocument 后移除了产物计数器，并非截止时间失败。改用持续的 showTextDocument 计数后，该项以真实 15 秒等待复跑 1 PASS；最终 16 个唯一测试通过、无跳过，语法与 diff 检查通过。Tools 0.2.24 已封入 f49d141e5 完整候选；已有 4141c5034 包仍为 0.2.23，其内容和 pin 未修改。原生进程确认存活，但原生操作工具仍返回不可用，Cocoa 超时根因仍 NOT_VERIFIED；没有把这一反馈当作用户实际锁屏的证明。


新版核心 pin 重验通过，包内相关四个模块与提交源码逐字节相同。完整 App/DMG 生产器退出 0，DMG SHA256 373ee4bf6b365ff67e70b6f0eb665b7bf7a5c317a995a97ed055422c47d414db，core tree 0812fe34b00531c9e59fd994d30f5f565927b6c798fe68fe5984d9d5a06aae5a。精确封存模块使用包内 Node v26.7.0，真实等待 15012 ms 后明确拒绝编辑器读取 Stalled.sol；迟到回复后新的双文件 capture 和 verify 通过。该证据是包内模块/API harness，未混报为 Cocoa 窗口、身份或真实 AI 验收。完整交接位于候选 SOURCE_BUILD_HANDOFF_20261005.md。


f49d141e5 精确包内工作台正常用户流程：F12 从 Main.sol 调用跳转 Math.sol 定义；F2 answer→result 后 Save All，两份磁盘文件实际更新；新终端 pwd 为真实项目根、Node v26.7.0，cat 回读双方变更。重命名后的双文件项目真实编译并 Save As 为 RenamedMain.build.json，磁盘 ok=true、Main、含字节码，Problems 0。截图及输入错误纠正记录位于该候选 verification/navigation-rename-acceptance.json；这是包内浏览器 GUI 实测，不替代 Cocoa/Finder、统一身份或 AI 接入。


## 本地 C/C++ 语言服务缺口与接线

当前 f49d141e5 包中的 YNX C/C++ 0.1.0 仅取 YNX_CORE_WORKSPACE；本地监督器只提供 YNX_LOCAL_WORKSPACE 且未配置 Clangd，故不能把已有正式/受控 C++ 证据视作该本地包具备补全服务。新源码 YNX C/C++ 0.1.1 接受单一 local 模式、有效本地项目 ID 与规范绝对路径；拒绝混入 CORE_WORKSPACE/CORE_SESSION_ID。正式模式仍保留既有独立路径，真实 workspace root 校验继续执行。

本地监督器仅选择已有 root-owned、不可组/全局写入、父路径无符号链接的 /Library/Developer/CommandLineTools/usr/bin/clangd，校验版本与 SDK 规范目标。不调用 /usr/bin/clangd 安装 shim，不使用项目指定执行程序、不下载、不改 sandbox/network 策略、不注入正式会话。当前机器 Apple Clangd 21.0.0 在原生产 sandbox 内启动通过；9 项本地 runtime 回归通过、无跳过，涵盖替代程序拒绝、Git/外部目录及网络拒绝、目录隔离、实际 fd 锁。新增源码尚未封包，C++ 补全/定义/诊断正常 GUI 流程仍待验收；f49d141e5 包保持原有版本和 pin。
