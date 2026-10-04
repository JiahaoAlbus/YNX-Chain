
// UI-only locale and navigation. The mature controllers own every authorization
// flag, account, device, draft and user-content node. No UI route grants access.
export const localeKey = 'ynx.social.ui.locale.v1';
export function deviceLocale(storage) {
  try { return /^zh(?:-|$)/i.test(storage?.getItem(localeKey) ?? '') ? 'zh-CN' : 'en'; }
  catch { return 'en'; }
}
const pairs = [
['Home','首页'],['Messages','私信'],['Contacts','联系人'],['Create','创建'],['Settings','设置'],['Language','语言'],['Primary','主导航'],['YNX Social home','YNX Social 首页'],['Connect wallet','连接钱包'],['Your circle','你的圈子'],['Create a moment','创建动态'],['A little space for your people.','为你在意的人留一点空间。'],["You're browsing as a guest. No moments are loaded, and no private access has been granted.",'你正在以访客身份浏览。尚未加载动态，也未授予任何私有访问权限。'],['Review sign-in and permissions','查看登录与授权'],['No profile, signature or transaction is created by browsing.','浏览不会创建资料、签名或交易。'],['Share with intention.','分享，由你决定。'],['Creating a moment needs your Social identity, chat connection and publishing permission. Review the audience before publishing.','创建动态需要 Social 身份、聊天连接与发布授权。发布前请检查可见范围。'],['The encrypted composer appears here when the existing permission checks allow it.','通过现有权限检查后，加密动态编辑器会显示在这里。'],['Private by design','隐私，从设计开始'],['Your people. Your choice.','你的人际关系，由你决定。'],['Private moments stay with their approved audience. A follow or a wallet connection never grants access.','私密动态仅对已授权的受众开放。关注或连接钱包不会授予访问权限。'],['Privacy settings','隐私设置'],['Get the YNX apps','获取 YNX 应用'],['Testnet preview. Availability depends on verified platform releases.','测试网预览。各平台可用性以已验证的发布为准。'],['Checking Social service…','正在检查 Social 服务…'],['Your space','你的空间'],['Your private workspace','你的私密空间'],['Sign in, then review access to your profile, contacts and encrypted chat.','登录后，检查资料、联系人与加密聊天的访问授权。'],['Text size','文字大小'],['Sign in with YNX identity','使用 YNX 身份登录'],['Private workspace is locked. Guest access makes no authorization request.','私密空间已锁定。访客浏览不会发起授权请求。'],['Profile and chat permissions','资料与聊天权限'],['Review each permission in Wallet. A wallet connection alone does not unlock private content.','请在钱包中逐项检查授权。仅连接钱包不会解锁私有内容。'],['Allow my Social profile, contacts and chat','授权 Social 资料、联系人与聊天'],['Continue my workspace','继续我的空间'],['Sign out of private workspace','退出私密空间'],['Protect existing browser chat device','保护现有浏览器聊天设备'],['Open chat permission request in YNX Wallet','在 YNX 钱包中打开聊天授权请求'],['Your profile','你的资料'],['Handle','用户名'],['Display name','显示名称'],['Bio','简介'],['Your username','你的用户名'],['Your display name','你的显示名称'],['A little about you','介绍一下自己'],['Save profile','保存资料'],['My personal discovery code','我的个人发现码'],['My invitations','我的邀请'],['People I invite','我的邀请'],['Sharing an invitation does not automatically add contacts or followers.','分享邀请不会自动添加联系人或关注关系。'],['Invitation details','邀请详情'],['Read your original links, or explicitly create a one-day invitation. A retry keeps the original request identity across tabs and browser restarts.','读取原有链接，或主动创建一天有效的邀请。重试会在标签页与浏览器重启之间保留原始请求标识。'],['Read my invitations','读取我的邀请'],['Create or retry my invitation','创建或重试邀请'],['Discovery privacy','发现隐私'],['Who can find me','谁能找到我'],['No address book is uploaded by these controls. Contact requests always need acceptance.','这些设置不会上传通讯录。联系人申请始终需要对方接受。'],['Read my current privacy settings','读取当前隐私设置'],['Find me by username','允许通过用户名找到我'],['Allow profile recommendations','允许推荐我的资料'],['Allow separately opt-in contact matching','允许单独选择加入的联系人匹配'],['Contact requests from','允许谁发来申请'],['Everyone','所有人'],['Existing contacts','已有联系人'],['Nobody','任何人都不允许'],['Save discovery privacy','保存发现隐私'],['Contacts and requests','联系人与申请'],['Find a person, review their profile, then send a request. They must accept before you become contacts.','查找并查看对方资料，再发送申请。对方接受后才会成为联系人。'],['Find by','查找方式'],['Username','用户名'],['QR content','二维码内容'],['Invitation link','邀请链接'],['Username, QR content or invitation','用户名、二维码内容或邀请'],['Username or invitation link','用户名或邀请链接'],['Preview person','查看资料'],['Scan QR with camera','用相机扫描二维码'],['Your contacts','你的联系人'],['Contact requests','联系人申请'],['Earlier encrypted history','早期加密历史'],['Your original history and pending ciphertext are retained. Old history is not relabeled as Matrix encryption.','原有历史与待处理密文均已保留。早期历史不会被重新标记为 Matrix 加密。'],["Existing contact's handle",'已有联系人的用户名'],['Open conversation','打开对话'],['Refresh contacts and history','刷新联系人与历史'],['Choose an earlier conversation','选择早期对话'],['Encrypted message','加密消息'],['Send encrypted message','发送加密消息'],['Retry retained encrypted message','重试已保留的加密消息'],['Connected wallet','已连接的钱包'],['Wallet details','钱包详情'],['Standard connection only. A private Social Product Session has not been created.','仅建立了标准钱包连接。尚未创建 Social 私有会话。'],['Switch to YNX Testnet','切换到 YNX 测试网'],['Switch account','切换账户'],['Revoke permission','撤销授权'],['Disconnect','断开连接'],['Private Social identity','Social 私有身份'],['Identity, wallet connection and chat permissions are separate choices.','身份、钱包连接和聊天权限需要分别选择。'],['No confirmed private identity link.','尚未确认私有身份关联。'],['Private identity has not been checked. Guest browsing sends no private authorization request.','尚未检查私有身份。访客浏览不会发送私有授权请求。'],['Sign in to Social','登录 Social'],['Continue identity sign-in','继续身份登录'],['Revoke private session','撤销私有会话'],['Open YNX Wallet','打开 YNX 钱包'],['Install or update YNX Wallet','安装或更新 YNX 钱包'],['Installation alone does not prove the browser can open the Wallet link.','仅安装应用不能证明浏览器可以打开钱包链接。'],['Private chat','私密聊天'],['Moments','动态'],['Your private conversations','你的私密对话'],['Choose a conversation, compare devices, then share messages and files.','选择对话、核对设备，然后分享消息和文件。'],['Locked','已锁定'],['Private chat is locked. Your messages and devices are retained.','私密聊天已锁定。消息与设备数据均已保留。'],['Open private chat','打开私密聊天'],['Lock chat','锁定聊天'],['Review sign-in and chat permissions','检查登录与聊天授权'],['Conversations and invitations','对话与邀请'],['Conversations','对话'],['Start a conversation','开始对话'],['Choose a person whose contact request has been accepted. No wallet address is needed.','选择双方已接受申请的联系人，无需输入钱包地址。'],['Refresh accepted contacts','刷新好友列表'],['Accepted contact','已接受的联系人'],['Choose a contact','选择联系人'],['No accepted contacts yet','暂无已接受的联系人'],['Start encrypted conversation','开始加密对话'],['Back','返回'],['Back to conversations','返回对话列表'],['Conversation devices and security','对话设备与安全'],['Security','安全'],['Your conversations','你的对话'],['Your message','你的消息'],['Write a message','写下消息'],['Add an encrypted file','添加加密文件'],['Send message','发送消息'],['Device checks','设备验证'],['My devices','我的设备'],['Connection details','连接详情'],['Diagnostic code','诊断代码'],['Account and device permissions are checked with the sign-in service. Conversations use the existing Matrix encrypted transport and Rust crypto storage. Availability is checked when you connect.','登录服务负责检查账户与设备权限。对话使用现有 Matrix 加密传输和 Rust 密码存储，连接时检查可用性。'],['Standard wallet connection','标准钱包连接'],['Choose a wallet','选择钱包'],['Close','关闭'],['Select the wallet you intend to use. YNX Social will not silently substitute another provider.','请选择你要使用的钱包。YNX Social 不会静默替换为其他提供方。'],['Scan a code or open the app on this phone','扫码或在此手机上打开应用'],['Open Wallet securely in a new window','在新窗口中安全打开钱包'],['Use your installed YNX Wallet extension','使用已安装的 YNX 钱包扩展'],['Connect your MetaMask account','连接你的 MetaMask 账户'],['Connect','连接'],['Choose another wallet','选择其他钱包'],['Retry connection','重试连接'],['Cancel connection','取消连接'],['Scan this connection code with YNX Wallet','使用 YNX 钱包扫描此连接码'],['No account request is sent until you choose a wallet.','选择钱包前不会发送账户请求。'],['Install wallet','安装钱包'],['Retry wallet detection','重试检测钱包'],['Browse as a guest, or sign in to use your private Social workspace.','以访客身份浏览，或登录使用 Social 私密空间。'],['Connecting a wallet does not grant access to contacts or messages. Approve Social separately below.','连接钱包不会授予联系人或消息访问权限。请单独批准 Social 授权。'],['Opening the secure wallet connection…','正在打开安全钱包连接…'],['Choose a wallet to continue.','请选择钱包以继续。'],['Connection request was rejected. No Social session was created.','连接请求已被拒绝。未创建 Social 会话。'],['Wallet connection failed. No account or Social session was saved.','钱包连接失败。未保存账户或 Social 会话。'],['Scan with YNX Wallet, or open it on this phone. Review the connection in Wallet.','用 YNX 钱包扫码，或在此手机上打开钱包。请在钱包中检查连接。'],['Connection cancelled. Network cleanup is not yet confirmed.','连接已取消。网络清理尚未确认。'],['Wallet disconnected locally. Wallet permissions were not revoked.','已在本地断开钱包连接。钱包权限尚未撤销。'],['Restricted Moments','受限动态'],['Encrypted moments','加密动态'],['Refresh encrypted moments','刷新加密动态'],['New restricted posts use encrypted Matrix rooms. Existing legacy posts are not retroactively encrypted.','新的受限动态使用加密 Matrix 房间。已有早期动态不会被追溯加密。'],['Restricted Moment draft','受限动态草稿'],['Your post','你的动态'],['Audience','可见范围'],['Restricted Moment audience','受限动态可见范围'],['Friends','好友'],['Group','群组'],['Selected people','指定的人'],['Only my verified devices','仅我的已验证设备'],['Existing group','已有群组'],['Accepted friends','已接受的好友'],['Review publishing permissions','检查发布权限'],['Review audience','检查可见范围'],['Publish reviewed encrypted Moment','发布已审核的加密动态'],['Encrypted attachment (optional, up to 25 MB)','加密附件（可选，最大 25 MB）'],['Restricted Moment attachment','受限动态附件'],['Save protected draft','保存受保护的草稿'],['Restore protected draft','恢复受保护的草稿'],['Verify original publication without resending','核验原始发布，不重新发送'],['Verify original pending comment','核验原始待确认评论'],['Encrypted comment','加密评论'],['Publish encrypted comment','发布加密评论'],['Chat appearance and background','聊天外观与背景'],['Chat appearance','聊天外观'],['Conversation background','对话背景'],['Cancel','取消'],['Done','完成'],['Hide progress','收起进度'],['Remove device access','移除设备访问权限'],['Accept invitation','接受邀请'],['Compare device using SAS','使用 SAS 核对设备'],['Download encrypted attachment','下载加密附件'],['Accept request','接受申请'],['Reject','拒绝'],['Both displays match','两端显示一致'],['Do not match','显示不一致'],['Start SAS comparison','开始 SAS 核对'],['Permission needed','需要授权'],['Connecting','正在连接'],['Waiting for you','等待确认'],['Connected','已连接'],['Check devices','请核对设备'],['Ready to send','可以发送'],['Connection interrupted','连接中断'],['Removing device','正在移除设备'],['Action needs attention','请检查操作'],['Sign in and review your chat permissions to continue.','请登录并检查聊天授权，然后继续。'],['Checking your sign-in. Your encrypted history is retained.','正在检查登录状态，原有加密历史已保留。'],['Continue sign-in when you are ready. You can cancel without changing your device.','准备好后再继续登录。取消不会更改设备。'],['Chat is connected. Choose a conversation to continue.','聊天已连接，请选择对话。'],['Compare devices before sending. Your draft is retained.','发送前请核对设备，草稿已保留。'],['Devices checked. You can send to this conversation.','设备检查通过，可以向此对话发送消息。'],['Connection interrupted. Retry explicitly and check devices before sending. Your history and draft are retained.','连接中断。请重新连接并检查设备后再发送，历史与草稿已保留。'],['Chat could not complete this action. Please try again. Your encrypted history is retained.','本次操作未能完成，请重试。原有加密历史已保留。'],['No conversations are displayed. Open private chat to load your approved conversations.','尚未显示对话。请打开私密聊天以加载已授权的对话。'],['Choose an approved conversation to start.','选择已授权的对话，开始聊天。'],['Private connection is active. Use the encrypted feed below to load moments shared with you.','私密连接已启用。使用下方加密内容流加载与你共享的动态。'],['Private connection needs attention. Previously encrypted data is retained.','私密连接需要检查。原有加密数据已保留。'],['Create a moment after reviewing your permissions.','检查授权后创建动态。'],['No private content is unlocked by changing language.','切换语言不会解锁私有内容。']
];
pairs.push(...[["Features","功能"],["Privacy","隐私"],["Download","下载"],["Open web app","打开网页版"],["Explore as guest","以访客体验"],["About Social","关于 Social / 官网"],["YNX Social · Testnet","YNX Social · 测试网"],["Close conversations.","让对话更亲近。"],["Clear control.","让掌控更清晰。"],["Explore YNX Social without an account. Connect a standard EVM wallet only when you are ready to link a profile or approve a private session.","无需账户即可探索 YNX Social。准备关联资料或批准私有会话时，再连接标准 EVM 钱包。"],["Guest access never creates a profile, wallet approval, Product Session, signature, or transaction.","访客浏览不会创建资料、钱包授权、产品会话、签名或交易。"],["Product preview","产品示意"],["Private","私密"],["Illustration only · no real account or feed","仅为示意 · 非真实账户或动态"],["A calm place for people, projects and conversations you choose.","为你选择的人、项目与对话，留一个安静的空间。"],["Guest preview","访客预览"],["See the product before you connect.","连接前，先体验产品。"],["Public information remains readable while identity, contacts, messages and private actions stay locked.","公开介绍可直接浏览；身份、联系人、消息与私有操作仍保持锁定。"],["Share thoughtful updates with the audiences you explicitly approve.","与你明确授权的受众分享动态。"],["Encrypted chat","加密聊天"],["Device-bound conversation keys, verified recovery states and explicit device rotation.","设备绑定的对话密钥、可核验的恢复状态与明确的设备轮换。"],["People you choose","你选择的人"],["Discover by handle, invite or QR without exposing a wallet address as a public identity.","通过用户名、邀请或二维码发现彼此，无需将钱包地址作为公开身份。"],["Privacy boundary","隐私边界"],["Your wallet is a key, not your public profile.","钱包是钥匙，不是你的公开资料。"],["Standard wallet connection stays available if private YNX services are degraded.","YNX 私有服务降级时，标准钱包连接仍保持可用。"],["No recovery phrase or private key is requested or received.","不会请求或接收助记词、私钥。"],["Private Social access requires a separate, explicit Product Session approval.","Social 私有访问需要单独、明确的产品会话授权。"],["Rejected or failed approval creates no local or canned session.","拒绝或失败的授权不会创建本地或预设会话。"],["Get the app","获取应用"],["Continue on mobile.","在手机上继续。"],["Use the same approved YNX identity. Existing messages remain bound to the devices for which they were encrypted.","使用同一已授权的 YNX 身份。已有消息仍绑定到加密时指定的设备。"],["Download YNX apps","下载 YNX 应用"],["Android Testnet preview · other platforms require verified releases","Android 测试网预览 · 其他平台需经验证的发布"]]);
pairs.push(['Locked. Draft recovery is local to this open workspace; no plaintext was stored on the server.','已锁定。草稿恢复仅限当前打开的空间；服务器未保存明文。'],['Publishing details','发布详情'],['Chat theme system','聊天主题：跟随系统'],['Chat theme light','聊天主题：浅色'],['Chat theme dark','聊天主题：深色'],['System','跟随系统'],['Light','浅色'],['Dark','深色'],['Confirm background','确认背景'],['Use global default','使用全局默认'],['Choose image from this device','从此设备选择图片'],['Choose local background image','选择本地背景图片'],['Cancel background changes','取消背景更改'],['Background preview','背景预览'],['Images stay on this device. Social does not upload your background or share its original file path.','图片保留在本设备。Social 不会上传背景或分享原始文件路径。'],['Preview only. Your conversations are unchanged.','仅为预览。对话不会改变。'],['Readable text on every background.','让每种背景上的文字都清晰可读。'],['Reset to global default','恢复全局默认'],['Reset global background and theme','重置全局背景与主题'],['Local appearance storage is unavailable. Try opening settings again.','本地外观存储不可用。请尝试重新打开设置。']);
pairs.push(['Help','帮助'],['Help and privacy','帮助与隐私'],['Start at your own pace.','按自己的节奏开始。'],['Browse as a guest first. To use private features, enter the web app and review sign-in and permissions in Settings. Never share a recovery phrase or private key.','可以先以访客身份浏览。使用私有功能时，请进入网页版，在设置中检查登录与授权。切勿分享助记词或私钥。'],['Official app downloads','官方应用下载'],['Loading Social…','正在加载 Social…'],['The app could not load. Retry when your connection is available. No new private approval was made by this UI.','应用未能加载。网络恢复后可重试。此界面没有创建新的私有授权。'],['Retry loading app','重试加载应用']);
const translations = new Map(pairs);
const originals = new Map(pairs.map(([en,zh])=>[zh,en]));
export function translateUI(value,locale) {
  const source=originals.get(value)??value;
  return locale==='zh-CN'?(translations.get(source)??source):source;
}
export const routeTable = new Map([
 ['#social-moments','moments'],['#matrix-social-workspace','chats'],['#conversations','chats'],
 ['#people-panel','contacts'],['#profile-form','settings'],['#social-workspace','settings'],['#create','moments']
]);
export function pageForHash(hash) { return routeTable.get(hash)??(hash&&!hash.startsWith('#landing-')?'chats':'landing'); }
export function pageForLocation(location) {
 if(/^\/(?:people|invite)\//.test(location.pathname))return 'contacts';
 if(location.pathname!=='/')return 'chats';
 return pageForHash(location.hash);
}
export function mountProductShell(doc=globalThis.document,win=globalThis.window) {
 if(!doc||!win)return;
 const nav=doc.querySelector('.topbar nav'),chat=doc.getElementById('matrix-social-workspace');
 const localeSelect=doc.getElementById('social-locale');
 const storage=()=>{try{return win.localStorage}catch{return undefined}};let locale=deviceLocale(storage());
 const skip='[data-messages],#message-list,.chat-room,.chat-room-preview,[data-room-title],#conversation-list,#conversation-title,#workspace-account,#connected-account,#profile-share-panel input,#invitation-list input,textarea,input,script,style';
 const dynamic='#wallet-switch-network,[data-chat-copy],[data-connection-label],[data-status],#workspace-status,#private-auth-status,#wallet-status,#connected-wallet-status,.chat-appearance-entry,.chat-appearance-dialog button,.chat-appearance-dialog h2,.chat-appearance-dialog p,.chat-appearance-dialog label,.chat-appearance-notice,[data-verification] button,[data-devices] button,[data-ui-feed] button';
 const attributes=['aria-label','placeholder','title','alt'];
 function translateNode(element) {
  // Only marked UI text or known controller chrome is eligible. Arbitrary room
  // names, contact options, decrypted bodies, posts and draft values are not.
  if(!element.matches('[data-ui],'+dynamic))return;
  for(const attr of attributes){const value=element.getAttribute(attr);if(value){const next=translateUI(value,locale);if(next!==value)element.setAttribute(attr,next)}}
  if(element.matches('textarea,input')||element.closest(skip))return;
  for(const node of element.childNodes){if(node.nodeType!==3)continue;const raw=node.nodeValue,trim=raw.trim(),next=translateUI(trim,locale);if(next!==trim)node.nodeValue=raw.replace(trim,next)}
 }
 function localize() {
  doc.documentElement.lang=locale;
  if(localeSelect)localeSelect.value=locale;
  for(const element of doc.querySelectorAll('[data-ui],'+dynamic))translateNode(element);
  // Matrix's existing createChatCopy reads document.lang on every call.
  // Refresh existing labels without replacing their nodes or event listeners.
  for(const option of doc.querySelectorAll('[name=matrixPeer] option[value=""]')){
   const next=translateUI(option.textContent,locale);if(next!==option.textContent)option.textContent=next;
  }
 }
 let applicationLoading=null,applicationLoaded=false;
 async function loadApplication(){
  if(applicationLoaded||applicationLoading)return applicationLoading;
  const status=doc.getElementById('social-runtime-status'),retry=doc.getElementById('social-runtime-retry');
  if(status){status.textContent=translateUI('Loading Social…',locale);status.hidden=false}if(retry)retry.hidden=true;
  applicationLoading=(async()=>{
   try{
    await import('./app.js');
    if(pageForLocation(win.location)==='landing')return;
    await import('./private-session-ui.js');
    if(pageForLocation(win.location)==='landing')return;
    await import('/matrix-session-ui.js');
    applicationLoaded=true;if(status)status.hidden=true;refreshPresentation();localize();
   }catch{
    if(status){status.textContent=translateUI('The app could not load. Retry when your connection is available. No new private approval was made by this UI.',locale);status.hidden=false}
    if(retry)retry.hidden=false;
   }finally{applicationLoading=null}
  })();return applicationLoading;
 }
 doc.getElementById('social-runtime-retry')?.addEventListener('click',()=>void loadApplication());
 function select(hash,scroll=true) {
  const route=pageForLocation({pathname:win.location.pathname,hash});doc.body.dataset.socialPage=route;
  if(route!=='landing')void loadApplication();
  const brand=doc.querySelector('.brand');if(brand)brand.setAttribute('href',route==='landing'?'/':'#social-moments');doc.body.dataset.socialCreating=String(hash==='#create');
  const publishing=doc.querySelector('.moment-composer-details');if(publishing)publishing.open=hash==='#create';
  for(const link of nav?.querySelectorAll('a')??[]){
   const active=route==='landing'?false:hash==='#create'?link.hash==='#create':link.hash!=='#create'&&pageForHash(link.hash)===route;
   link.setAttribute('aria-current',active?'page':'false');
  }
  if(route==='settings'||route==='contacts'){
   const title=doc.getElementById('workspace-title');title.textContent=translateUI(route==='contacts'?'Contacts and requests':'Your private workspace',locale);
  }
  if(scroll)win.scrollTo({top:0,behavior:'instant'});
  if(hash==='#create')win.requestAnimationFrame(()=>{
   doc.getElementById('create')?.scrollIntoView({block:'start'});
   const composer=doc.querySelector('#social-moments>section textarea:not(:disabled)');
   if(composer)composer.focus({preventScroll:true});else doc.getElementById('create')?.focus({preventScroll:true});
  });
 }
 doc.addEventListener('click',event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const link=event.target.closest?.('a');if(!link)return;
  const url=new URL(link.href,win.location.href);
  if(url.origin!==win.location.origin||url.pathname!=='/'||(!routeTable.has(url.hash)&&url.hash!==''&&!url.hash.startsWith('#landing-')))return;
  event.preventDefault();win.history.pushState({...win.history.state},'',url.pathname+url.hash);select(url.hash);
  if(url.hash.startsWith('#landing-'))win.requestAnimationFrame(()=>doc.getElementById(url.hash.slice(1))?.scrollIntoView({block:'start'}));
 });
 win.addEventListener('hashchange',()=>select(win.location.hash));
 win.addEventListener('popstate',()=>select(win.location.hash,false));
 localeSelect?.addEventListener('change',()=>{
  locale=localeSelect.value==='zh-CN'?'zh-CN':'en';
  try{win.localStorage.setItem(localeKey,locale)}catch{/* Active view still changes. */}
  localize();select(win.location.hash,false);
 });
 win.addEventListener('storage',event=>{if(event.key===localeKey){locale=deviceLocale(storage());localize();select(win.location.hash,false)}});
 let scale='1';try{scale=win.localStorage.getItem('ynx.social.ui.text-scale.v1')??'1'}catch{}
 if(!['0.9','1','1.15','1.3'].includes(scale))scale='1';
 doc.documentElement.style.fontSize=String(Number(scale)*16)+'px';
 for(const input of doc.querySelectorAll('[name=socialTextScale]')){
  input.checked=input.value===scale;input.addEventListener('change',()=>{
   doc.documentElement.style.fontSize=String(Number(input.value)*16)+'px';
   try{win.localStorage.setItem('ynx.social.ui.text-scale.v1',input.value)}catch{}
  });
 }
 const roomEmpty=doc.createElement('p');roomEmpty.className='room-empty';roomEmpty.dataset.ui='';
 roomEmpty.textContent='No conversations are displayed. Open private chat to load your approved conversations.';
 doc.querySelector('[data-room-list]')?.after(roomEmpty);
 const messageEmpty=doc.createElement('p');messageEmpty.className='message-empty';messageEmpty.dataset.ui='';
 messageEmpty.textContent='Choose an approved conversation to start.';doc.querySelector('[data-messages]')?.before(messageEmpty);
 const guestNote=doc.querySelector('.home-empty>p');
 function refreshPresentation(){
  roomEmpty.hidden=Boolean(doc.querySelector('[data-room-list] .chat-room'));
  messageEmpty.hidden=chat?.dataset.chatPane==='conversation'||Boolean(doc.querySelector('[data-messages] li'));
  const phase=chat?.dataset.chatPhase??'locked';
  const text=['connected','ready','verifying'].includes(phase)?'Private connection is active. Use the encrypted feed below to load moments shared with you.':['offline','error'].includes(phase)?'Private connection needs attention. Previously encrypted data is retained.':"You're browsing as a guest. No moments are loaded, and no private access has been granted.";
  const next=translateUI(text,locale);if(guestNote&&guestNote.textContent!==next)guestNote.textContent=next;
  // Keep every composer field and handler; its disclosure is presentation only.
  for(const section of doc.querySelectorAll('#social-moments>section')){
   const form=section.querySelector('form');if(!form||section.hasAttribute('data-ui-composer'))continue;
   section.dataset.uiComposer='';
   const details=doc.createElement('details'),summary=doc.createElement('summary');
   details.className='moment-composer-details';summary.dataset.ui='';summary.textContent='Publishing details';
   details.open=win.location.hash==='#create';details.append(summary,form);section.append(details);
  }
  // Feed is appended by the existing controller after private verification.
  // Mark only its controls, never its decrypted articles, for UI localization.
  for(const section of chat?.querySelectorAll(':scope>section:not([id]):not(.chat-device-section)')??[]){
   if(['Encrypted moments','加密动态'].includes(section.querySelector('h2')?.textContent)){
    section.dataset.uiFeed='';const heading=section.querySelector('h2');heading.dataset.ui='';
   }
  }
  for(const element of doc.querySelectorAll('#social-moments>section h2,#social-moments>section>p,#social-moments>section form>label,#social-moments>section form>button,#social-moments>section form select[aria-label="Restricted Moment audience"] option,#social-moments>section form select[aria-label="受限动态可见范围"] option,#social-moments>section form textarea,#social-moments>section form select,#social-moments>section form input'))element.dataset.ui='';
 }
 let scheduled=false;
 const observer=new win.MutationObserver(()=>{
  if(scheduled)return;scheduled=true;win.queueMicrotask(()=>{scheduled=false;observer.disconnect();refreshPresentation();localize();observe()});
 });
 function observe(){observer.observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-chat-phase','data-chat-pane']})}
 doc.getElementById('connect-wallet')?.addEventListener('click',()=>{const panel=doc.getElementById('connected-panel');if(panel&&!panel.hidden)panel.querySelector('details').open=true});
 refreshPresentation();localize();select(win.location.hash,false);observe();
 return {disconnect:()=>observer.disconnect()};
}
if(typeof document!=='undefined')mountProductShell();
