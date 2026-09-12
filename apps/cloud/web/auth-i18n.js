export const authMessages = {
  en: {
    eyebrow: 'WALLET CONNECTION', title: 'Connect a Wallet',
    description: 'Use YNX Wallet for your YNX identity. MetaMask supports a separate basic connection to YNX Testnet (0x1917). Private Cloud files require a separately verified session; a connected address does not grant access.',
    ynx: 'Connect YNX Wallet', metamask: 'Connect MetaMask (basic)', download: 'Download YNX Wallet', install: 'Install MetaMask', close: 'Close', cancel: 'Cancel and continue browsing', export: 'Export my data',
    ready: 'Choose a wallet. Private Cloud service is currently unavailable.', waiting: 'Review the request in the selected wallet. Closing this dialog does not cancel a request already shown in the wallet.',
    connected: 'Standard Wallet connected on 0x1917. Private Cloud files remain unavailable. No local or canned session was created.',
    privateUnavailable: 'Private Cloud service is unavailable. An existing standard wallet connection remains valid.',
    guest: 'Sign in to access private files. Public previews remain available.',
    cancelled: 'Cloud connection cancelled. No further wallet steps will start. Dismiss any pending request in your wallet.',
    missingYNX: 'YNX Wallet is unavailable. Install or open it, then retry. Cloud will not request another wallet.',
    missingMetaMask: 'MetaMask is unavailable. Install or open it, then retry. Cloud will not request YNX Wallet instead.',
    rejected: 'Wallet request rejected. No new Cloud session was created.',
    unsupported: 'The selected wallet does not support this action. No other wallet was requested.',
    failed: 'The selected wallet could not connect to YNX Testnet. Retry when ready; Cloud will not switch wallets.',
  },
  'zh-CN': {
    eyebrow: '钱包连接', title: '连接钱包',
    description: '使用 YNX Wallet 获取 YNX 身份。MetaMask 提供独立的 YNX 测试网（0x1917）基础连接。私有云盘文件需要另行验证的会话，连接地址不代表获得文件权限。',
    ynx: '连接 YNX Wallet', metamask: '连接 MetaMask（基础功能）', download: '下载 YNX Wallet', install: '安装 MetaMask', close: '关闭', cancel: '取消并继续浏览', export: '导出我的数据',
    ready: '请选择钱包。私有云盘服务目前不可用。', waiting: '请在所选钱包中复核请求。关闭此弹窗不会取消钱包中已经显示的请求。',
    connected: '已连接 YNX 测试网（0x1917）。私有云盘文件仍不可用，未创建本地或模拟会话。',
    privateUnavailable: '私有云盘服务不可用，已有的标准钱包连接保持有效。',
    guest: '登录后才能访问私有文件，公开预览仍可浏览。',
    cancelled: '已取消云盘连接，不会继续发起钱包操作。请在钱包中关闭尚未处理的请求。',
    missingYNX: '未找到 YNX Wallet。请安装或打开后重试，云盘不会改为请求其他钱包。',
    missingMetaMask: '未找到 MetaMask。请安装或打开后重试，云盘不会改为请求 YNX Wallet。',
    rejected: '已拒绝钱包请求，未创建新的云盘会话。',
    unsupported: '所选钱包不支持此操作，未向其他钱包发起请求。',
    failed: '所选钱包未能连接 YNX 测试网。准备好后可重试，云盘不会切换到其他钱包。',
  },
  'zh-TW': {
    eyebrow: '錢包連線', title: '連接錢包',
    description: '使用 YNX Wallet 取得 YNX 身分。MetaMask 提供獨立的 YNX 測試網（0x1917）基本連線。私人雲端檔案需要另外驗證的工作階段，連接地址不代表取得檔案權限。',
    ynx: '連接 YNX Wallet', metamask: '連接 MetaMask（基本功能）', download: '下載 YNX Wallet', install: '安裝 MetaMask', close: '關閉', cancel: '取消並繼續瀏覽', export: '匯出我的資料',
    ready: '請選擇錢包。私人雲端服務目前無法使用。', waiting: '請在所選錢包中檢查請求。關閉此視窗不會取消錢包中已顯示的請求。',
    connected: '已連接 YNX 測試網（0x1917）。私人雲端檔案仍無法使用，未建立本機或模擬工作階段。',
    privateUnavailable: '私人雲端服務無法使用，既有的標準錢包連線維持有效。',
    guest: '登入後才能存取私人檔案，公開預覽仍可瀏覽。',
    cancelled: '已取消雲端連線，不會繼續發起錢包操作。請在錢包中關閉尚未處理的請求。',
    missingYNX: '找不到 YNX Wallet。請安裝或開啟後重試，雲端不會改為請求其他錢包。',
    missingMetaMask: '找不到 MetaMask。請安裝或開啟後重試，雲端不會改為請求 YNX Wallet。',
    rejected: '已拒絕錢包請求，未建立新的雲端工作階段。',
    unsupported: '所選錢包不支援此操作，未向其他錢包發起請求。',
    failed: '所選錢包未能連接 YNX 測試網。準備好後可重試，雲端不會切換至其他錢包。',
  },
};
export function authT(locale, key) { return (authMessages[locale] ?? authMessages.en)[key]; }
export function applyAuthLocale(locale, root = document) {
  for (const node of root.querySelectorAll('[data-auth-copy]')) node.textContent = authT(locale, node.dataset.authCopy);
  for (const node of root.querySelectorAll('[data-auth-label]')) node.setAttribute('aria-label', authT(locale, node.dataset.authLabel));
}
