'use strict';

// These keys translate only YNX-owned controls. A separately admitted language
// pack supplies the host/editor translations; this contribution never claims
// to be a complete display language on its own.
const entries = [
  ['deployServiceMissing', 'The project deployment service is not connected yet. Local file editing remains available.', '项目部署服务尚未接通。本地文件编辑不受影响。'],
  ['deployServiceRetry', 'The project service connection is unavailable. Retry the read or open project Wallet to check it.', '项目服务连接暂不可用。可重试读取，或打开项目钱包检查连接。'],
  ['deployWalletVerification', 'The local Wallet connection could not be verified. Check Wallet setup before reconnecting. Local development remains available.', '本地钱包连接无法验证。请检查钱包配置后重新连接。本地开发不受影响。'],
  ['deployCancellingHint', 'The current request is being cancelled.', '正在取消当前请求。'],
  ['deployNoPending', 'There is no pending request to cancel.', '当前没有待处理请求可取消。'],
  ['deployAlreadyPrepared', 'This signing request is already recorded. Continue with its separate broadcast review or query its original result.', '这次签名请求已有记录。请继续独立广播审阅，或查询原结果，不要重复签名。'],
  ['deployMaterialsFirst', 'Choose the contract, matching compiler files and constructor value, then review them.', '请先选择合约、匹配的编译文件和构造参数，再完成审阅。'],
  ['deployCallReviewFirst', 'Complete and review the contract call before requesting signing.', '请先填写并审阅合约调用，再请求签名。'],
  ['deploySignatureFirst', 'Complete the separate Wallet signing review before requesting broadcast.', '请先在钱包中完成独立签名审阅，再请求广播。'],
  ['deployNoResult', 'There is no result to copy yet.', '当前还没有可复制的结果。'],
  ['deployPickerUnavailable', 'The system file window could not be opened. Retry choosing the file; existing requests are preserved.', '系统文件窗口暂时无法打开。请重试选择文件；已有请求均保留。'],

  ['deployMaterialsStep', '1 · Contract and materials', '1 · 合约与材料'],
  ['deployPreviewStep', '2 · Review current inputs', '2 · 审阅当前输入'],
  ['deployWalletStep', '3 · Wallet approval', '3 · 钱包批准'],
  ['deployHistoryStep', '4 · Original requests and recovery', '4 · 原请求与恢复'],
  ['deployResultDetails', 'Original result details', '原始结果详情'],
  ['deployCopyDetails', 'Copy result details', '复制结果详情'],
  ['deployCopyFallback', 'Select the result details and use Copy from the Edit menu.', '请选择结果详情，再使用编辑菜单中的“复制”。'],
  ['deployBusyHint', 'A project request is pending. Cancel it before starting another.', '当前项目请求正在处理中；请先取消，再开始其他请求。'],
  ['deployReviewHint', 'Review current inputs first. Signing remains disabled until that review succeeds.', '请先审阅当前输入；审阅通过后才能请求签名。'],
  ['deploySignHint', 'Approve signing in Wallet. This does not submit a transaction.', '请在钱包中批准签名；此步骤不会提交交易。'],
  ['deployBroadcastHint', 'Signing preparation is saved. Broadcasting needs its own Wallet approval.', '签名准备已保存；广播仍需在钱包中独立批准。'],

  ['runTsFile', 'Run TypeScript File', '运行 TypeScript 文件'],
  ['debugTsFile', 'Debug TypeScript File', '调试 TypeScript 文件'],
  ['cancelTsBuild', 'Cancel TypeScript Build', '取消 TypeScript 编译'],
  ['ecosystemTitle', 'YNX Ecosystem', 'YNX 生态'],
  ['ecosystemProjectHint', 'Develop contracts, connect a project network and revisit transaction results.', '开发合约、连接项目网络，并查询交易结果。'],
  ['ynx.workbench.ecosystem', 'YNX Ecosystem', 'YNX 生态'],
  ['ecosystemContracts', 'Contract development', '合约开发'],
  ['ecosystemOpenContracts', 'Open project contracts', '打开项目合约'],
  ['ecosystemNetwork', 'Network and account', '网络与账户'],
  ['ecosystemOpenNetwork', 'Project network', '项目网络'],
  ['ecosystemOpenWallet', 'Wallet connection', '钱包连接'],
  ['ecosystemResults', 'Transactions and results', '交易与结果'],
  ['ecosystemOpenResults', 'Saved chain results', '已保存的链上结果'],
  ['ecosystemReview', 'Project changes', '项目变更'],
  ['ecosystemOpenReview', 'Review local changes', '审阅本地变更'],
  ['ecosystemAuthority', 'Connections and approvals are managed in their own views. Opening this sidebar grants no access.', '连接与批准在各自视图中管理，打开侧栏不会授予权限。'],
  ['noTestRuns', 'No test runs yet. Run a test from Test Explorer to see results here.', '尚未运行测试。请在测试资源管理器中运行测试，在此查看结果。'],
  ['openFile', 'Open File…', '打开文件…'],
  ['nativeWorkspaceScope', 'This workspace must contain only the current project root. Open other folders in separate windows; multi-root isolation is not yet supported.', '此工作区只能包含当前项目根目录。请在独立窗口中打开其他文件夹；多根目录隔离尚未支持。'],
  ['nativeWorkspaceTooLarge', 'Choose a workspace file smaller than 2 MiB.', '请选择小于 2 MiB 的工作区文件。'],
  ['nativeSelectedFileMissing', 'The selected file is no longer available.', '所选文件已不可用。'],
  ['nativeOpenFailed', 'The selected file could not be opened.', '无法打开所选文件。'],
  ['nativeInitialOpenFailed', 'The selected file could not be opened. Your project was preserved.', '无法打开所选文件，现有项目已保留。'],
  ['openFolder', 'Open Folder…', '打开文件夹…'],
  ['returnToProject', 'Return to Open Project', '返回已打开的项目'],
  ['workspaceMismatch', 'This window is connected to a different project folder. Use Open Folder to open another project; changing the URL does not change the writable project.', '此窗口连接到了不同的项目文件夹。请使用“打开文件夹”打开其他项目；更改网址不会改变可写入的项目。'],
  ['unavailableRuntime', 'Unavailable in this runtime', '此运行环境中不可用'],
  ['currentlyUnavailable', 'Currently unavailable', '当前不可用'],
  ['nativeViewUnavailable', 'Native view contribution is unavailable', '原生视图组件不可用'],
  ['unknownView', 'Unknown workbench view', '未知的工作台视图'],
  ['runAndDebug', 'Run and Debug…', '运行与调试…'],
  ['runGoProject', 'Run Go Project', '运行 Go 项目'],
  ['cancelGoTask', 'Cancel Go Task', '取消 Go 任务'],
  ['runJsFile', 'Run JavaScript File', '运行 JavaScript 文件'],
  ['runPythonFile', 'Run Python File', '运行 Python 文件'],
  ['debugPythonFile', 'Debug Python File', '调试 Python 文件'],
  ['debugJsFile', 'Debug JavaScript File', '调试 JavaScript 文件'],
  ['runCppFile', 'Run C/C++ File', '运行 C/C++ 文件'],
  ['debugCppFile', 'Debug C/C++ File', '调试 C/C++ 文件'],
  ['runWithoutDebugging', 'Run Without Debugging', '无需调试直接运行'],
  ['runBuildTask', 'Run Build Task…', '运行生成任务…'],
  ['runTask', 'Run Task…', '运行任务…'],
  ['runToolbar', 'Run and Debug', '运行与调试'],
  ['runActionsAria', 'Run and Debug actions', '运行与调试操作'],
  ['workbenchViewsAria', 'Workbench views', '工作台视图'],
  ['panelViewsAria', 'Panel views', '面板视图'],
  ['viewExplorer', 'Explorer', '资源管理器'],
  ['viewSearch', 'Search', '搜索'],
  ['viewScm', 'Source Control', '源代码管理'],
  ['viewDebug', 'Run and Debug', '运行与调试'],
  ['viewExtensions', 'Extensions', '扩展'],
  ['viewProblems', 'Problems', '问题'],
  ['viewOutput', 'Output', '输出'],
  ['viewConsole', 'Debug Console', '调试控制台'],
  ['viewTerminal', 'Terminal', '终端'],
];
entries.push(...[["deployReferenceRequired","Enter a valid saved request reference before reading or querying its result.","读取或查询结果前，请填写有效的已保存请求编号。"],["contractOperation","Contract operation","合约操作"],["contractOperationdeploy","Deploy supported contract","部署受支持的合约"],["contractOperationexecute","Call deployed contract","调用已部署合约"],["executeFieldtarget","Deployed contract address","已部署合约地址"],["executeFieldsourceHash","Registered source hash","已登记的源码哈希"],["executeFielddeployedBytecodeHash","Deployed bytecode hash","已部署字节码哈希"],["executeFieldcompilerConfigHash","Compiler configuration hash","编译配置哈希"],["executeFieldexpectedStorageCommitment","Expected storage commitment","预期存储承诺"],["executeFieldcalldata","Encoded function call","已编码的函数调用"],["executeReview","Review contract call","审阅合约调用"],["contractReviewRequired","Review the current materials or contract call before requesting Wallet approval.","请求钱包批准前，请先审阅当前材料或合约调用。"],["executeInvalidCall","Review the supported contract, registered hashes, current storage commitment and encoded call. No transaction was automatically retried.","请核对受支持的合约、已登记哈希、当前存储承诺和已编码调用。本次没有自动重试交易。"],["deployButtoncancel","Cancel pending request","取消待处理请求"],["deployTitle","Review testnet deployment","审阅测试网部署"],["deployRecent","Saved project requests","已保存的项目请求"],["deployInvalidMaterial","Choose matching compiler files for one of the two supported contracts and an explicit uint64 constructor value.","请选择当前支持的两种合约之一及匹配的编译文件，并明确填写 uint64 构造参数。"],["deployReviewAgain","Project or compiler files changed. Review the actual materials again.","项目或编译文件已变化，请重新审阅真实材料。"],["deployConnectFirst","Connect this project in Wallet before requesting signing.","请先连接当前项目钱包，再请求签名审阅。"],["deployOriginalQueryRequired","An original request must be queried. Do not sign or broadcast it again.","请查询已有原请求，不要重新签名或广播。"],["deployButtonreferences","Find saved project requests","查找已保存的项目请求"],["deployNote","Supports the two admitted YNX Testnet contracts. Review real compiler files, then approve signing and broadcast separately in Wallet.","支持当前获准的两种 YNX 测试网合约；先审阅真实编译材料，再由钱包分别批准签名和广播。"],["deployChooseName","Select an admitted contract","选择获准合约"],["deployName","Contract","合约"],["deployFieldsourceURI","Solidity source","Solidity 源码"],["deployFieldartifactURI","Compiler artifact JSON","编译产物 JSON"],["deployFieldbuildInfoURI","Compiler build-info JSON","编译 build-info JSON"],["deployFieldconstructorArg","Constructor value","构造参数"],["deployFieldreferenceId","Saved request reference","已保存的请求引用"],["deployButtonsourceURI","Choose source…","选择源码…"],["deployButtonartifactURI","Choose artifact…","选择编译产物…"],["deployButtonbuildInfoURI","Choose build-info…","选择 build-info…"],["deployButtonreview","Review compiler materials","审阅编译材料"],["deployButtonconnect","Open project Wallet","打开项目钱包"],["deployButtonprepare","Request signing review","请求签名审阅"],["deployButtonbroadcast","Request separate broadcast review","请求独立广播审阅"],["deployButtonread","Read saved reference","读取已保存引用"],["deployButtonquery","Query original Wallet result","查询原钱包结果"],["deployReviewed","Materials reviewed locally. Nothing has been signed or broadcast.","已在本地审阅材料，尚未签名或广播。"],["deployPrepared","Wallet preparation returned. Broadcast requires another explicit Wallet review.","钱包准备请求已返回，广播仍须另一次明确的钱包审阅。"],["deployQueryOnly","Inspect the original result. This view does not infer chain confirmation or retry an UNKNOWN operation.","请核对原结果；本视图不会推定链上确认，也不会重发结果不明的操作。"],["deployLegacyUnavailable","Earlier request records are retained but unavailable under this project scope. Do not recreate an UNKNOWN request; check the original Wallet result.","旧请求记录仍保留，但当前项目权限无法查看。请核对钱包中的原结果，不要重新创建结果不明的请求。"],["deployWriterUncertain","Retained request writes are incomplete. Check the original Wallet result before preparing again.","保留的请求写入尚未完成。请先核对钱包中的原结果，再决定后续操作。"],["deployUnavailable","Deployment service or materials are unavailable. Existing requests were preserved.","部署服务或材料尚不可用，已有请求均保留。"]]);
const EN_DEFAULTS = Object.freeze(Object.fromEntries(entries.map(([name, english]) => [`ynx/workbench/${name}`, english])));
const TRANSLATIONS = Object.freeze(Object.fromEntries(entries.map(([name, , chinese]) => [`ynx/workbench/${name}`, chinese])));
function registerYnxLocalizations(provider) {
  // LocalizationProvider accepts LazyLocalization, rather than raw translations.
  // Use its actual adapter so loadLocalization/getAvailableLanguages retain the
  // normal Theia lifecycle and the returned disposable unregisters our keys.
  const { LazyLocalization } = require('@theia/core/lib/node/i18n/localization-provider');
  return provider.addLocalizations(LazyLocalization.fromLocalization({
    languageId: 'zh-cn', languageName: 'Chinese (Simplified)', localizedLanguageName: '简体中文',
    languagePack: false, translations: TRANSLATIONS,
  }));
}
module.exports = { registerYnxLocalizations, EN_DEFAULTS, TRANSLATIONS };
