'use strict';
const entries = [
  ['title', 'Keyboard Shortcuts', '键盘快捷方式'], ['caption', 'YNX Keyboard Shortcuts', 'YNX 键盘快捷方式'],
  ['openJson', 'Open JSON', '打开 JSON'], ['refresh', 'Refresh', '刷新'],
  ['search', 'Search commands or shortcuts', '搜索命令或快捷方式'], ['sourceAria', 'Shortcut source', '快捷方式来源'],
  ['sourceAll', 'All', '全部'], ['sourceUser', 'User', '用户'], ['sourceDefault', 'Default', '默认'],
  ['sourceWorkspace', 'Workspace', '工作区'], ['sourceUnassigned', 'Unassigned', '未分配'],
  ['targetAria', 'Save shortcuts in', '快捷方式保存位置'], ['targetLabel', 'Save shortcuts in ', '快捷方式保存位置 '],
  ['thisProject', 'This project', '此项目'], ['userSettings', 'User settings', '用户设置'],
  ['tableAria', 'Keyboard shortcuts', '键盘快捷方式'], ['command', 'Command', '命令'], ['shortcut', 'Shortcut', '快捷方式'],
  ['when', 'When', '生效条件'], ['source', 'Source', '来源'], ['actions', 'Actions', '操作'],
  ['previous', 'Previous', '上一页'], ['next', 'Next', '下一页'],
  ['openProject', 'Open a single local project to edit its shortcuts.', '请打开一个本地项目以编辑其快捷方式。'],
  ['loadFailed', 'Shortcuts could not be loaded', '无法加载快捷方式'], ['context', 'Context: {0}', '上下文：{0}'],
  ['edit', 'Edit', '编辑'], ['add', 'Add', '添加'], ['remove', 'Remove', '移除'], ['reset', 'Reset', '重置'],
  ['count', '{0} shortcuts · Page {1} of {2}', '{0} 个快捷方式 · 第 {1} 页，共 {2} 页'],
  ['saving', 'Saving keyboard shortcuts…', '正在保存键盘快捷方式…'], ['saved', 'Keyboard shortcuts saved.', '键盘快捷方式已保存。'],
  ['addTitle', 'Add Shortcut', '添加快捷方式'], ['editTitle', 'Edit Shortcut', '编辑快捷方式'],
  ['keyExample', 'For example cmd+k cmd+y', '例如 cmd+k cmd+y'],
  ['whenExample', 'Optional condition, for example editorTextFocus', '可选生效条件，例如 editorTextFocus'],
  ['record', 'Record keys', '录制按键'], ['recording', 'Recording…', '正在录制…'],
  ['conflicts', 'Also used by: {0}. Check the When conditions before saving.', '以下命令也使用此快捷方式：{0}。保存前请检查生效条件。'],
  ['cancel', 'Cancel', '取消'], ['save', 'Save', '保存'], ['enterKey', 'Enter a shortcut.', '请输入快捷方式。'],
  ['preferences', 'Preferences', '首选项'], ['openCommand', 'Open Keyboard Shortcuts', '打开键盘快捷方式'],
];
const EN_DEFAULTS = Object.freeze(Object.fromEntries(entries.map(([key, english]) => [key, english])));
const TRANSLATIONS = Object.freeze(Object.fromEntries(entries.map(([key, , chinese]) => [`ynx/keyboardShortcuts/${key}`, chinese])));
function registerKeyboardShortcutsLocalizations(provider) {
  const { LazyLocalization } = require('@theia/core/lib/node/i18n/localization-provider');
  return provider.addLocalizations(LazyLocalization.fromLocalization({ languageId: 'zh-cn', languageName: 'Chinese (Simplified)',
    localizedLanguageName: '简体中文', languagePack: false, translations: TRANSLATIONS }));
}
module.exports = { EN_DEFAULTS, TRANSLATIONS, registerKeyboardShortcutsLocalizations };
