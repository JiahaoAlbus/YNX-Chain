import type { WalletLocale } from "./i18n";
const EN = {
  previousFailure: "If an earlier save failed, restore with the original offline recovery key. Creating a new Wallet creates a different account. Existing keys are never discovered or recovered automatically.", restorePrevious: "Restore previous Wallet identity",
  protectTitle: "Protect your Wallet", enrollTitle: "Set up strong biometrics first",
  enrollBody: "This Wallet protects account keys with strong system biometrics. Set up a strong fingerprint or Face ID in system settings, then return here and tap Continue. A device passcode alone cannot protect this Wallet's keys.",
  unsupportedTitle: "This device cannot protect Wallet keys",
  unsupportedBody: "Strong biometric hardware is required to create or import accounts in this version. Use a compatible device. Wallet will not save an unprotected key.",
  preserved: "No new account or recovery key has been created. Existing accounts and their protection remain unchanged. Returning from settings never creates an account automatically.",
  settings: "Open security settings", continue: "Check protection and continue",
  settingsUnavailable: "Open your device's Settings, then Security or Face ID / fingerprint settings. Return to Wallet and tap Continue after setup.",
  changed: "System biometric protection changed. Your account was not saved. Close this backup view and check protection again before creating an account.",
  backupTitle: "Back up before saving", backupBody: "Write this recovery key offline. Never share it with support, AI or a website. Clipboard export is disabled. YNX cannot recover it. This view closes after 60 seconds or when Wallet enters the background.",
  backupConfirm: "Type BACKED UP to confirm", save: "Confirm backup and save",
};
const ZH: typeof EN = {
  previousFailure: "若此前保存失败，请使用原离线恢复密钥恢复。创建新钱包会生成不同账户。钱包不会自动发现或恢复已有密钥。", restorePrevious: "恢复以前的钱包身份",
  protectTitle: "保护你的钱包", enrollTitle: "请先设置强生物识别",
  enrollBody: "此版本使用系统强生物识别保护账户密钥。请在系统设置中添加强指纹或 Face ID，然后返回钱包并点击继续。仅有设备密码无法保护此钱包的密钥。",
  unsupportedTitle: "此设备无法保护钱包密钥", unsupportedBody: "此版本创建或导入账户需要强生物识别硬件。请使用兼容设备。钱包不会保存未受保护的密钥。",
  preserved: "尚未创建新账户或恢复密钥。已有账户及其保护保持不变。从系统设置返回不会自动创建账户。",
  settings: "打开安全设置", continue: "检查保护并继续", settingsUnavailable: "请打开设备设置，进入安全或 Face ID / 指纹设置。设置完成后返回钱包并点击继续。",
  changed: "系统生物识别保护已更改，账户尚未保存。请关闭此备份页面，再次检查保护后创建账户。",
  backupTitle: "保存前先备份", backupBody: "请将此恢复密钥离线抄写保存，不要提供给客服、AI 或网站。已禁用剪贴板导出，YNX 无法找回密钥。此页面将在 60 秒后或钱包进入后台时关闭。",
  backupConfirm: "输入 BACKED UP 确认已备份", save: "确认备份并保存",
};
export function setupCopy(locale: WalletLocale, key: keyof typeof EN): string { return (locale.startsWith("zh") ? ZH : EN)[key]; }
