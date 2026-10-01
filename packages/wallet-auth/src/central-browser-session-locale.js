// UI-only language. Never add it to consent, redirect validation or PKCE state.
export const CENTRAL_UI_LANGUAGES=Object.freeze({en:'English','zh-CN':'简体中文','zh-Hant':'繁體中文'});
export function centralUILanguage(value){
  for(const part of String(value??'').split(',')){
    const tag=part.split(';')[0].trim().toLowerCase();
    if(/^zh(?:-(?:hant|tw|hk|mo))$/u.test(tag))return 'zh-Hant';
    if(/^zh(?:-(?:hans|cn|sg))?$/u.test(tag))return 'zh-CN';
    if(/^en(?:-[a-z]+)?$/u.test(tag))return 'en';
  }
  return 'en';
}
const rows=[
 ['YNX · Sign in','YNX · 登录','YNX · 登入'],
 ['Sign in with YNX Wallet','使用 YNX Wallet 登录','使用 YNX Wallet 登入'],
 ['Allow browser sign-in for registered YNX products. Private product permissions require separate approval.','确认后可登录已关联的 YNX 产品。访问私人服务仍需另行批准。','確認後可登入已關聯的 YNX 產品。存取私人服務仍需另行批准。'],
 ['Choose a wallet to continue.','选择钱包以继续。','選擇錢包以繼續。'],
 ['Continue with YNX Wallet','继续并在钱包中批准登录','繼續並在錢包中批准登入'],
 ['Cancel','取消','取消'],['Get YNX Wallet','获取 YNX Wallet','取得 YNX Wallet'],
 ['Return to product and retry','返回产品并重试','返回產品並重試'],
 ['Return to product without using this approval','返回产品，不使用本次批准','返回產品，不使用本次批准'],
 ['Connect mobile YNX Wallet','连接手机 YNX Wallet','連接手機 YNX Wallet'],
 ['Scan with YNX Wallet to approve this browser connection. Browser sign-in remains a separate approval.','使用 YNX Wallet 扫码批准连接，随后另行确认登录。','使用 YNX Wallet 掃碼批准連接，隨後另行確認登入。'],
 ['Temporary YNX Wallet connection QR code','临时钱包连接二维码','臨時錢包連接二維碼'],
 ['Open YNX Wallet','打开 YNX Wallet','開啟 YNX Wallet'],
 ['Connect YNX Wallet Web','打开 YNX Wallet 网页版','開啟 YNX Wallet 網頁版'],
 ['Finish or cancel your current request before opening another connection.','请先完成或取消当前请求，再选择其他钱包。','請先完成或取消目前請求，再選擇其他錢包。'],
 ['This sign-in request has expired. Return to your product and start a new request.','本次登录请求已过期。请返回产品重新登录。','本次登入請求已過期。請返回產品重新登入。'],
 ['Opening YNX Wallet Web. Connection permission and browser sign-in are separate approvals.','正在打开钱包网页版。请先连接，再单独确认登录。','正在開啟錢包網頁版。請先連接，再單獨確認登入。'],
 ['YNX Wallet Web connected. Continue to review browser sign-in.','钱包网页版已连接。请继续，在钱包中确认登录。','錢包網頁版已連接。請繼續，在錢包中確認登入。'],
 ['Wallet Web connection timed out. Return to your product and retry; no browser sign-in was granted.','连接钱包超时，尚未登录。请返回产品重试。','連接錢包逾時，尚未登入。請返回產品重試。'],
 ['Connection was declined. No browser sign-in was granted.','你已拒绝连接，尚未登录。','你已拒絕連接，尚未登入。'],
 ['Opening a mobile Wallet connection. No sign-in signature has been requested.','正在连接手机钱包，尚未请求登录批准。','正在連接手機錢包，尚未請求登入批准。'],
 ['The connection service could not be reached. Check your network, then retry or choose another wallet. No browser sign-in was granted.','暂时无法连接服务。请检查网络后重试，或选择其他钱包。尚未登录。','暫時無法連接服務。請檢查網路後重試，或選擇其他錢包。尚未登入。'],
 ['The previous network attempt is still finishing. Choose another wallet, or retry after it ends.','上一次网络连接仍在结束中。可选择其他钱包，或稍后重试。','上一次網路連線仍在結束中。可選擇其他錢包，或稍後重試。'],
 ['QR rendering is unavailable. Cancel and retry the connection.','无法显示二维码。请取消并重新连接。','無法顯示二維碼。請取消並重新連接。'],
 ['Scan this temporary QR in YNX Wallet and approve the connection.','请在 YNX Wallet 扫描此临时二维码并批准连接。','請在 YNX Wallet 掃描此臨時二維碼並批准連接。'],
 ['Mobile Wallet connected. Continue to review browser sign-in on the same Wallet session.','手机钱包已连接。请继续，在同一钱包中确认登录。','手機錢包已連接。請繼續，在同一錢包中確認登入。'],
 ['Choose YNX Wallet','选择 YNX Wallet','選擇 YNX Wallet'],
 ['Installed YNX Wallet is unavailable. Install/unlock it or explicitly choose Wallet Web or mobile Wallet.','尚未找到可用的钱包扩展。可安装并解锁扩展，或选择下方手机钱包、钱包网页版。','尚未找到可用的錢包擴充功能。可安裝並解鎖，或選擇下方手機錢包、錢包網頁版。'],
 ['Finish or cancel the current request before switching wallets.','请先完成或取消当前请求，再切换钱包。','請先完成或取消目前請求，再切換錢包。'],
 ['Connection is separate from browser sign-in approval.','连接钱包后，仍需单独批准登录。','連接錢包後，仍需單獨批准登入。'],
 ['Your request is already open in YNX Wallet.','请在已打开的 YNX Wallet 中处理当前请求。','請在已開啟的 YNX Wallet 中處理目前請求。'],
 ['Opening YNX Wallet. Unlock and review browser sign-in.','请打开并解锁 YNX Wallet，查看并确认登录请求。','請開啟並解鎖 YNX Wallet，查看並確認登入請求。'],
 ['Sign-in approved. Returning to your product.','登录已批准，正在返回产品。','登入已批准，正在返回產品。'],
 ['Sign-in was declined. Your existing product permissions are unchanged.','你已拒绝登录，已有产品权限保持不变。','你已拒絕登入，已有產品權限保持不變。'],
 ['Cancelling this sign-in request…','正在取消本次登录请求…','正在取消本次登入請求…'],
 ['This sign-in transaction has expired. Remote cancellation is not confirmed. Return to your product and explicitly start a new request; this page will not use any late approval.','请求已过期，尚未确认服务器取消。请返回产品重新登录；此页面不会使用迟到的批准。','請求已過期，尚未確認伺服器取消。請返回產品重新登入；此頁面不會使用遲到的批准。'],
 ['Cancellation is not confirmed. Retry cancellation or return without using this approval; no late approval will be used on this page.','尚未确认取消。可重试取消或直接返回产品；此页面不会使用迟到的批准。','尚未確認取消。可重試取消或直接返回產品；此頁面不會使用遲到的批准。'],
 ['YNX · Browser session','YNX · 登录状态','YNX · 登入狀態'],['YNX browser session','YNX 登录状态','YNX 登入狀態'],
 ['Checking your server session…','正在检查登录状态…','正在檢查登入狀態…'],
 ['Signing out here ends browser identity access across all linked YNX products. It does not revoke unrelated Wallet connection permissions.','在此退出会结束所有关联 YNX 产品的登录状态。钱包连接权限需在钱包中另行撤销。','在此登出會結束所有關聯 YNX 產品的登入狀態。錢包連接權限需在錢包中另行撤銷。'],
 ['Sign out of all YNX products','退出所有 YNX 产品','登出所有 YNX 產品'],['You are signed out.','你已退出登录。','你已登出。'],
 ['Session status is unavailable. Retry checking before signing out.','暂时无法确认登录状态。请重试检查后再退出。','暫時無法確認登入狀態。請重試檢查後再登出。'],
 ['Signed out of all YNX products.','已退出所有 YNX 产品。','已登出所有 YNX 產品。'],
 ['Global sign-out is not confirmed. Retry; no successful revocation is assumed.','尚未确认全部退出。请重试；不能视为已撤销登录。','尚未確認全部登出。請重試；不能視為已撤銷登入。'],
 ['Requesting site','请求站点','請求網站'],['Language','语言','語言'],
 ['Wallet or service is unavailable. Retry or cancel; no sign-in was granted.','钱包或服务暂不可用，尚未登录。请重试或取消。','錢包或服務暫不可用，尚未登入。請重試或取消。']
];
export function centralUIText(value,language){
  const row=rows.find(row=>row.includes(value));
  if(row)return row[language==='zh-CN'?1:language==='zh-Hant'?2:0];
  if(language!=='en'&&/^(?:Wallet Web connection did not finish|Mobile connection did not finish|Sign-in could not finish) /u.test(value))return centralUIText('Wallet or service is unavailable. Retry or cancel; no sign-in was granted.',language);
  return value;
}
export function centralUIPage(body,language){
  const lang=centralUILanguage(language);
  return rows.reduce((html,row)=>html.replaceAll(`>${row[0]}<`,`>${centralUIText(row[0],lang)}<`),body).replace('<html lang="en">',`<html lang="${lang}">`);
}
