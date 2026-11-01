// Production Receive presentation only. No signer, wallet state or authority.
const mounted=new WeakMap();
const copy=(doc,en,zh)=>doc.documentElement?.lang?.startsWith('zh')?zh:en;
export function readReceivePresentation(document=globalThis.document){
 const panel=document?.getElementById?.('receive-sheet');
 return panel?.dataset?.receiveState?{ready:panel.dataset.receiveState==='ready',format:panel.dataset.receiveFormat??'ynx'}:{ready:true,format:'ynx'};
}
export function mountDesktopReceiveDesign({canvas,onRetry,onCompatibility,onNative}){
 const doc=canvas?.ownerDocument,panel=canvas?.closest?.('#receive-sheet');
 if(!doc||!panel)return {state(){},format(){}};
 if(mounted.has(panel))return mounted.get(panel);
 panel.classList.add('receive-design');
 const node=(tag,className,text)=>{const n=doc.createElement(tag);if(className)n.className=className;if(text)n.textContent=text;return n;};
 const slot=node('div','receive-code-slot'),placeholder=node('div','receive-code-placeholder'),progress=node('progress'),message=node('span');
 progress.setAttribute('aria-label',copy(doc,'Loading receiving address','正在获取收款地址'));placeholder.append(progress,message);slot.append(placeholder);canvas.before(slot);slot.append(canvas);
 const network=node('p','receive-network-label','YNXT · '+copy(doc,'YNX Testnet','YNX 测试网'));slot.before(network);
 const retry=node('button','receive-retry',copy(doc,'Reload receiving address','重新加载地址'));retry.type='button';retry.addEventListener('click',onRetry);slot.after(retry);
 const warning=node('p','receive-network-warning',copy(doc,'Receive only assets on YNX Testnet. Check the network before sending.','仅接收 YNX 测试网资产；发送前请核对网络。'));
 const address=doc.getElementById('receive-address'),link=doc.getElementById('copy-receiving-link'),copyAddress=doc.getElementById('copy-address');
 const actions=node('div','receive-actions');if(copyAddress&&link){link.before(actions);actions.append(copyAddress,link);copyAddress.classList.add('primary');link.classList.remove('primary');link.textContent=copy(doc,'Copy receiving link','复制收款链接');actions.before(warning);}
 const details=doc.getElementById('receive-compatibility'),compat=node('button','receive-compatibility-select',copy(doc,'Use EVM compatibility format','使用 EVM 兼容格式'));
 compat.type='button';compat.addEventListener('click',onCompatibility);details?.append(compat);
 const native=node('button','receive-retry',copy(doc,'Return to YNX address (default)','返回 YNX 原生地址（默认）'));native.type='button';native.hidden=true;native.addEventListener('click',onNative);actions.after(native);
 const badge=node('p','receive-compatibility-label',copy(doc,'EVM compatibility · explicitly selected','EVM 兼容模式 · 用户手动开启'));badge.hidden=true;network.before(badge);
 const handle={
  state(state,account=''){
   panel.dataset.receiveState=state;panel.setAttribute('aria-busy',String(state==='loading'));
   placeholder.hidden=state==='ready';progress.hidden=state!=='loading';retry.hidden=state!=='unavailable';
   message.textContent=state==='loading'?copy(doc,'Loading receiving address…','正在获取收款地址…'):copy(doc,'Receiving code unavailable','暂无可用二维码');
   for(const button of [copyAddress,link,compat])if(button)button.disabled=state!=='ready';
   if(address)address.value=state==='ready'?account:'';
   if(state!=='ready'){const evm=doc.getElementById('receive-evm-address');if(evm)evm.value='';}
  },
  format(format){panel.dataset.receiveFormat=format;badge.hidden=format!=='evm';native.hidden=format!=='evm';if(details)details.hidden=format==='evm';network.textContent='YNXT · '+copy(doc,'YNX Testnet','YNX 测试网')+(format==='evm'?' · EVM':'');if(link)link.textContent=format==='evm'?copy(doc,'Copy EVM address','复制 EVM 地址'):copy(doc,'Copy receiving link','复制收款链接');},
 };
 mounted.set(panel,handle);return handle;
}

export function receiveDesignCopy(document,key){
 const messages={compatibilityReady:['EVM compatibility address on YNX Testnet. Check the network before sending.','YNX 测试网 EVM 兼容地址；发送前请核对网络。'],compatibilityUnavailable:['The EVM compatibility address cannot be confirmed. Return to your YNX address.','无法确认 EVM 兼容地址，请返回 YNX 原生地址。'],compatibilityCopied:['EVM compatibility address copied. Check YNX Testnet before sending.','EVM 兼容地址已复制，请在发送前核对 YNX 测试网。']};
 return messages[key]?.[document?.documentElement?.lang?.startsWith('zh')?1:0]??key;
}
