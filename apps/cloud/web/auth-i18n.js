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
const privateCopy={
 en:{requestFailed:'This action could not be completed. Check your connection and retry.',writeUnconfirmed:'The change is not confirmed. Retry the same change on this page, or refresh to check your files before making another change.',ready:'Choose YNX Wallet to approve access to your Cloud files.',description:'Approve reading, creating and updating your Cloud files. A basic MetaMask connection does not grant file access.',waiting:'Review Cloud file access in the selected wallet. You can cancel or choose another wallet.',filesConnected:'Cloud file access approved. Every file request is checked by the service.',expired:'Cloud file access expired or was revoked. Sign in to approve access again.',revocationPending:'Signed out locally. Confirmation needs a connection; retry Sign out before a new approval.',transportUnavailable:'This connection method is not available for Cloud yet. Choose the installed YNX browser extension.',failed:'Cloud sign-in could not be completed. Check your connection and retry, or choose another wallet.',privateUnavailable:'A basic wallet connection does not grant access to Cloud files.',cancelled:'Cloud sign-in cancelled. A late approval will not reconnect this page.',hosted:'Web Wallet',mobile:'Mobile Wallet',retry:'Retry',back:'Choose another wallet',disconnect:'Sign out of Cloud',details:'Connection details',actionUnavailable:'This action needs a permission that is not yet available. Your files are unchanged.'},
 'zh-CN':{requestFailed:'暂未完成此操作，请检查网络后重试。',writeUnconfirmed:'尚未确认修改结果。可在本页重试同一修改，或先刷新查看文件再进行其他修改。',ready:'选择 YNX Wallet，批准访问本人的云盘文件。',description:'批准读取、创建和更新本人的云盘文件。MetaMask 基础连接不授予文件访问权限。',waiting:'请在所选钱包中复核云盘文件权限。可以取消或返回选择其他钱包。',filesConnected:'已批准云盘文件权限，每次请求都会由服务端重新验证。',expired:'云盘权限已过期或被撤销，请登录并重新批准。',revocationPending:'已在本页退出。退出确认仍需网络连接，请先重试“退出云盘”。',transportUnavailable:'云盘暂不支持这种连接方式，请选择已安装的 YNX 浏览器扩展。',failed:'暂未完成云盘登录，请检查网络后重试或换一种钱包连接。',privateUnavailable:'基础钱包连接不授予云盘文件权限。',cancelled:'已取消云盘登录，迟到的批准不会重新连接此页面。',hosted:'Web Wallet 网页钱包',mobile:'手机钱包',retry:'重试',back:'返回选择钱包',disconnect:'退出云盘',details:'连接详情',actionUnavailable:'此操作所需权限暂不可用，原文件未改变。'},
 'zh-TW':{requestFailed:'尚未完成此操作，請檢查網路後重試。',writeUnconfirmed:'尚未確認修改結果。可在本頁重試同一修改，或先重新整理查看檔案再進行其他修改。',ready:'選擇 YNX Wallet，批准存取本人的雲端檔案。',description:'批准讀取、建立和更新本人的雲端檔案。MetaMask 基本連線不授予檔案權限。',waiting:'請在所選錢包中檢查檔案權限，可以取消或返回選擇其他錢包。',filesConnected:'已批准雲端檔案權限，每次請求都會重新驗證。',expired:'雲端權限已過期或撤銷，請登入並重新批准。',revocationPending:'已在本頁登出。確認仍需網路，請先重試「登出雲端」。',transportUnavailable:'雲端暫不支援此連線方式，請選擇已安裝的 YNX 擴充功能。',failed:'尚未完成登入，請檢查網路後重試或選擇其他錢包。',privateUnavailable:'基本錢包連線不授予雲端檔案權限。',cancelled:'已取消雲端登入，遲到的批准不會重新連接此頁。',hosted:'Web Wallet 網頁錢包',mobile:'手機錢包',retry:'重試',back:'返回選擇錢包',disconnect:'登出雲端',details:'連線詳情',actionUnavailable:'此操作所需權限暫不可用，原檔案未變更。'}
};
for(const [locale,copy] of Object.entries(privateCopy))Object.assign(authMessages[locale],copy);
export function authT(locale, key) { return (authMessages[locale] ?? authMessages.en)[key]; }
export function applyAuthLocale(locale, root = document) {
  for (const node of root.querySelectorAll('[data-auth-copy]')) node.textContent = authT(locale, node.dataset.authCopy);
  for (const node of root.querySelectorAll('[data-auth-label]')) node.setAttribute('aria-label', authT(locale, node.dataset.authLabel));
}
