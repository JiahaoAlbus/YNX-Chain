'use strict';

// These keys translate only YNX-owned controls. A separately admitted language
// pack supplies the host/editor translations; this contribution never claims
// to be a complete display language on its own.
const entries = [
  ['noTestRuns', 'No test runs yet. Run a test from Test Explorer to see results here.', '尚未运行测试。请在测试资源管理器中运行测试，在此查看结果。'],
  ['openFolder', 'Open Folder…', '打开文件夹…'],
  ['returnToProject', 'Return to Open Project', '返回已打开的项目'],
  ['workspaceMismatch', 'This window is connected to a different project folder. Use Open Folder to open another project; changing the URL does not change the writable project.', '此窗口连接到了不同的项目文件夹。请使用“打开文件夹”打开其他项目；更改网址不会改变可写入的项目。'],
  ['unavailableRuntime', 'Unavailable in this runtime', '此运行环境中不可用'],
  ['currentlyUnavailable', 'Currently unavailable', '当前不可用'],
  ['nativeViewUnavailable', 'Native view contribution is unavailable', '原生视图组件不可用'],
  ['unknownView', 'Unknown workbench view', '未知的工作台视图'],
  ['runAndDebug', 'Run and Debug…', '运行与调试…'],
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
