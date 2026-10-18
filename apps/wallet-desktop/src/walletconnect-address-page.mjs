import {createAddressConnectionConsumer,ADDRESS_CONNECTION_ORIGIN} from './walletconnect-address-consumer.mjs';

/** Normal first-party browser view. No automatic connection or restoration. */
export function mountWalletAddressConnectionPage({document:doc,origin,createConnection,encodeQR}){
 const find=id=>{const node=doc.getElementById(id);if(!node)throw Error('WALLET_CONNECTION_PAGE_INVALID');return node;};
 const connect=find('connect'),cancel=find('cancel'),disconnect=find('disconnect'),check=find('check-original'),originalResult=find('original-result'),status=find('status'),address=find('address'),code=find('diagnostic'),region=find('pairing'),image=find('pairing-qr'),open=find('open-wallet');
 let qrEpoch=0;
 const clearURI=()=>{qrEpoch++;region.hidden=true;image.removeAttribute('src');open.removeAttribute('href');};
 const labels={idle:'Connect to share one YNX Testnet address. / 连接后仅共享一个测试网地址。',initialization:'Starting connection… / 正在启动连接…',relay:'Connecting to Relay… / 正在连接 Relay…',approval:'Review the address permission in YNX Wallet. / 请在钱包中审核地址连接权限。',connected:'Address connected. No sign-in, signature or payment was approved. / 地址已连接，未授权登录、签名或付款。',cancelling:'Cancelling the original request… / 正在取消原请求…',cancelled:'Cancelled. Nothing was signed or sent. / 已取消，未签名或转账。',disconnecting:'Disconnecting the original session… / 正在断开原会话…',disconnected:'Disconnected. / 已断开连接。',changed:'Account, chain or permission changed. Review the connection again. / 账户、链或权限已变化，请重新检查连接。',failed:'Connection unavailable; no address approval is assumed. / 连接未完成，不视为已获地址许可。','cleanup-unconfirmed':'Remote cleanup is unconfirmed. No automatic retry; preserve this page and Wallet data. / 远端清理结果未知，不会自动重试，请保留此页面与钱包数据。'};
 function renderOriginal(original){
  check.disabled=original.attempt===0;
  if(original.attempt===0){originalResult.textContent='No request has started. / 尚未发起请求。';return;}
  const outcomes={'not-started':'not started / 未开始',pending:'awaiting original result / 等待原结果',fulfilled:'returned / 已返回',rejected:'rejected / 已拒绝'};
  const protocol=original.protocol;
  const sdk=protocol.availability==='available'?` · SDK initialization / SDK初始化：${outcomes[protocol.value.initialization]} · SDK original work / SDK原工作：${protocol.value.inFlight?'still pending / 仍在途':'locally settled / 本地已结束'}${protocol.value.firstCause.present?' · SDK original failure retained / SDK原始失败已保留':''}${protocol.value.firstCause.code?' ('+protocol.value.firstCause.code+')':''}`:protocol.availability==='not-supplied'?' · This SDK has no read-only observation API. / 此SDK版本未提供只读观察接口。':protocol.availability==='not-started'?'':' · SDK read-only observation unavailable. / SDK只读观察不可用。';
  const witness=original.cleanupWitness==='approved-session-local-disconnect'?' · Original approved session disconnected locally; a new connection is allowed. / 原已批准会话已在本地断开，可发起新连接。':original.cleanupWitness==='cancelled-before-sdk-selection'?' · Cancelled before any SDK call; no protocol action began. / SDK调用前已取消，未启动协议操作。':'';
  originalResult.textContent=`Original connection / 原连接：${outcomes[original.connect]}${original.connectCode?' ('+original.connectCode+')':''} · Original cleanup / 原清理：${outcomes[original.cleanup]}${original.cleanupCode?' ('+original.cleanupCode+')':''}${sdk}${witness}${original.reconnectBlocked?' · Original attempt retained; another connection is blocked. / 原尝试保留，暂不允许再次连接。':''} · Remote cleanup is not independently confirmed. Checking never retries or disconnects. / 远端清理尚未独立确认，查看不会重试或断开连接。`;
 }
 function render(state){
  const busy=['initialization','relay','approval','cancelling','disconnecting'].includes(state.phase);
  connect.disabled=busy||state.pendingOriginal||state.phase==='connected'||state.cleanupUnconfirmed||state.reconnectBlocked;
  cancel.disabled=!['initialization','relay','approval'].includes(state.phase)||state.cleanupUnconfirmed;
  disconnect.disabled=busy||['idle','disconnected','cancelled'].includes(state.phase)||state.cleanupUnconfirmed;
  status.textContent=labels[state.phase]??labels.failed;address.textContent=state.account??'';
  code.textContent=state.code??'';
  renderOriginal(state.original);
  connect.setAttribute('aria-busy',String(busy));
 }
 const controller=createAddressConnectionConsumer({origin,createConnection,onState:render,clearURI,onURI:uri=>{
  // The original SDK has already validated its own protocol-generated URI.
  // Never retain it in status, diagnostics, logs, storage or query parameters.
  const token=++qrEpoch;Promise.resolve().then(()=>encodeQR(uri)).then(data=>{
   if(token!==qrEpoch||controller.snapshot().phase!=='approval')return;
   if(typeof data!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)||data.length>1048576)throw Error('QR_UNAVAILABLE');
   image.setAttribute('src',data);open.setAttribute('href',`ynxwallet://wc?uri=${encodeURIComponent(uri)}`);region.hidden=false;
  }).catch(()=>{if(token===qrEpoch)void controller.cancel();});
 }});
 connect.addEventListener('click',()=>{if(!connect.disabled)void controller.connect();});
 cancel.addEventListener('click',()=>{if(!cancel.disabled)void controller.cancel();});
 disconnect.addEventListener('click',()=>{if(!disconnect.disabled)void controller.disconnect();});
 check.addEventListener('click',()=>{if(!check.disabled)renderOriginal(controller.checkOriginal());});
 clearURI();render(controller.snapshot());
 return controller;
}
export {ADDRESS_CONNECTION_ORIGIN};
