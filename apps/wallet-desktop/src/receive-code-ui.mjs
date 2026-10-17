/** Render a local module matrix without changing the document's image/script CSP. */
import {setWalletCopy} from "./wallet-locale.mjs";
// IPC produces public data fields. Snapshot them before touching the canvas;
// neither sparse arrays nor accessor properties are a complete module matrix.
function ownValue(object, key) {
  if (!object || typeof object !== "object") throw new Error("Invalid receiving code");
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Invalid receiving code");
  return descriptor.value;
}
export function drawReceiveCode(canvas, code, expectedAccount) {
  const size = ownValue(code, "size"), source = ownValue(code, "modules");
  if (typeof expectedAccount !== "string" || !expectedAccount || ownValue(code, "account") !== expectedAccount ||
      ownValue(code, "chainId") !== "ynx_6423-1" || ownValue(code, "asset") !== "YNXT" ||
      ownValue(code, "uri") !== `ynx:${expectedAccount}?chainId=ynx_6423-1&asset=YNXT` ||
      !Number.isInteger(size) || size < 21 || size > 177 || (size - 21) % 4 !== 0 ||
      !Array.isArray(source) || source.length !== size ** 2) {
    throw new Error("Invalid receiving code");
  }
  paintReceiveModules(canvas,size,source);
}
function paintReceiveModules(canvas,size,source){
  if(!Number.isInteger(size)||size<21||size>177||(size-21)%4!==0||!Array.isArray(source)||source.length!==size**2)throw Error('Invalid receiving code');
  const modules = new Uint8Array(size ** 2);
  for (let index = 0; index < modules.length; index++) {
    const value = ownValue(source, String(index));
    if (value !== 0 && value !== 1) throw new Error("Invalid receiving code");
    modules[index] = value;
  }
  const quiet = 4, scale = 6, side = (size + quiet * 2) * scale;
  canvas.width = canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Receiving code cannot be displayed");
  context.fillStyle = "#FFFFFF"; context.fillRect(0, 0, side, side);
  context.fillStyle = "#002FA7";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (modules[y * size + x]) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  }
}

export function drawEVMReceiveCode(canvas,code,expected){
  for(const key of ['family','account','revision','networkId','configRevision','chainId','genesis','rpcUrl'])if(ownValue(code,key)!==expected[key])throw Error('EVM_RECEIVE_INVALID');
  if(expected.family!=='evm'||!/^0x[a-f0-9]{40}$/.test(expected.account)||ownValue(code,'payload')!==expected.account||ownValue(code,'networkVerified')!==false)throw Error('EVM_RECEIVE_INVALID');
  paintReceiveModules(canvas,ownValue(code,'size'),ownValue(code,'modules'));
}
export function drawBitcoinReceiveCode(canvas,code,expected){
  for(const key of ['family','network','vaultAccount','address','revision','configRevision','rpcUrl','genesis'])if(ownValue(code,key)!==expected[key])throw Error('BTC_RECEIVE_INVALID');
  const path=`m/84'/${expected.network==='mainnet'?0:1}'/0'/0/0`;
  if(expected.family!=='bitcoin'||!['mainnet','testnet3','testnet4','signet'].includes(expected.network)||!/^((bc)|(tb))1q[a-z0-9]+$/.test(expected.address)||!expected.address.startsWith(expected.network==='mainnet'?'bc1q':'tb1q')||ownValue(code,'path')!==path||ownValue(code,'payload')!==`bitcoin:${expected.address}`||ownValue(code,'networkVerified')!==false)throw Error('BTC_RECEIVE_INVALID');
  paintReceiveModules(canvas,ownValue(code,'size'),ownValue(code,'modules'));
}
export function createBitcoinReceiveCodeUI({document,parent,api,getContext,getSelection,isOpen,draw=drawBitcoinReceiveCode}){
  const canvas=document.createElement('canvas'),status=document.createElement('p'),label=document.createElement('p'),download=document.createElement('button');
  canvas.id='bitcoin-receive-code';status.id='bitcoin-receive-status';label.id='bitcoin-receive-network';download.id='bitcoin-receive-download';download.type='button';canvas.setAttribute('aria-label','Receiving address');status.setAttribute('role','status');setWalletCopy(download,'Download receiving PNG');parent.append(canvas,label,status,download);
  let epoch=0,rendered=null;
  function invalidate(){epoch++;rendered=null;canvas.hidden=true;canvas.width=canvas.height=1;download.disabled=true;download.hidden=getSelection().family!=='bitcoin';status.textContent=label.textContent='';}
  function live(expected,token){const c=getContext(),s=getSelection();return token===epoch&&isOpen()&&!c.locked&&!c.authenticating&&c.account===expected.vaultAccount&&c.revision===expected.revision&&s.family==='bitcoin'&&s.network===expected.network;}
  function configuration(snapshot,network){const revision=ownValue(snapshot,'revision'),rows=ownValue(snapshot,'networks');if(!Number.isSafeInteger(revision)||revision<0||!Array.isArray(rows))throw Error('BTC_RECEIVE_INVALID');const row=rows.find(n=>ownValue(n,'family')==='bitcoin'&&ownValue(n,'network')===network);if(!row||ownValue(row,'genesis')!==null)throw Error('BTC_RECEIVE_INVALID');const rpcUrl=ownValue(row,'rpcUrl');if(typeof rpcUrl!=='string'||!rpcUrl.startsWith('https://'))throw Error('BTC_RECEIVE_INVALID');return {configRevision:revision,rpcUrl,genesis:null};}
  async function sameNetwork(expected,token){const reply=await api.familyNetworks();return live(expected,token)&&ownValue(reply,'ok')===true&&JSON.stringify(configuration(ownValue(reply,'value'),expected.network))===JSON.stringify({configRevision:expected.configRevision,rpcUrl:expected.rpcUrl,genesis:null});}
  async function refresh(identity){invalidate();if(identity.family!=='bitcoin'||!api.receiveCode||!api.familyNetworks)return;const token=epoch,c={...getContext()},expected={family:'bitcoin',network:identity.network,vaultAccount:identity.vaultAccount,address:identity.address,revision:c.revision};if(!live(expected,token))return;setWalletCopy(status,'Preparing your receiving code…');
    try{const snapshot=await api.familyNetworks();if(!live(expected,token))return;if(ownValue(snapshot,'ok')!==true)throw Error();Object.assign(expected,configuration(ownValue(snapshot,'value'),expected.network));
      const reply=await api.receiveCode({family:'bitcoin',network:expected.network,vaultAccount:expected.vaultAccount,address:expected.address,revision:expected.revision});if(!live(expected,token))return;if(ownValue(reply,'ok')!==true)throw Error();draw(canvas,ownValue(reply,'value'),expected);
      if(!live(expected,token)||!await sameNetwork(expected,token)){if(token===epoch)invalidate();return}rendered={expected,token};canvas.hidden=false;download.disabled=false;label.textContent=`BTC · ${expected.network}`;setWalletCopy(status,'A receiving address does not verify the network or balance. Never send assets on another network.');
    }catch{if(live(expected,token)){canvas.hidden=true;download.disabled=true;setWalletCopy(status,'The receiving code is unavailable. Reopen Receive to try again.')}}
  }
  async function exportPNG(){const original=rendered;if(!original||!live(original.expected,original.token))return;
    try{if(!await sameNetwork(original.expected,original.token)){if(original.token===epoch)invalidate();return}const data=canvas.toDataURL('image/png');if(!live(original.expected,original.token)||rendered!==original)return;
      if(typeof data!=='string'||data.length>8*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)||!/^[a-z0-9]+$/.test(original.expected.address))throw Error();
      if(!await sameNetwork(original.expected,original.token)){if(original.token===epoch)invalidate();return}if(rendered!==original||!live(original.expected,original.token))return;
      const anchor=document.createElement('a');anchor.href=data;anchor.download=`BTC-${original.expected.network}-receive-${original.expected.address}.png`;document.body.append(anchor);try{anchor.click()}finally{anchor.remove()}if(live(original.expected,original.token))setWalletCopy(status,'Receiving PNG download started. It contains only your public receiving information.');
    }catch{if(live(original.expected,original.token))setWalletCopy(status,'Receiving PNG download could not start. Reopen Receive and try again.')}
  }
  download.addEventListener('click',exportPNG);invalidate();return {invalidate,refresh,exportPNG};
}

export function createReceiveCodeUI({ canvas, status, requestCode, draw = drawReceiveCode, exportButton, getContext, savePNG }) {
  let revision = 0, rendered = null;
  function clear() {
    revision++;
    rendered = null;
    if (exportButton) exportButton.disabled = true;
    canvas.hidden = true;
    canvas.width = canvas.height = 1;
    status.textContent = "";
  }
  async function refresh(account) {
    clear();
    if (!account) return;
    const current = revision;
    setWalletCopy(status,"Preparing your receiving code…");
    try {
      const result = await requestCode(account);
      if (current !== revision) return;
      if (ownValue(result, "ok") !== true) throw new Error("Receiving account unavailable");
      const value = ownValue(result, "value");
      if (current !== revision) return;
      draw(canvas, value, account);
      // Rendering or a supplied adapter may invalidate Receive synchronously.
      // A retired request cannot make the canvas visible or publish success.
      if (current !== revision) return;
      canvas.hidden = false;
      const context = getContext?.();
      rendered = {revision:current,account,keyRevision:context?.keyRevision};
      if (exportButton) exportButton.disabled = !(context?.open===true&&context.account===account&&typeof savePNG==="function");
      setWalletCopy(status,"Scan with a Wallet that supports YNX Testnet.");
    } catch {
      if (current !== revision) return;
      canvas.hidden = true;
      setWalletCopy(status,"The receiving code is unavailable. Reopen Receive to try again.");
    }
  }
  function exportPNG() {
    const before=rendered;
    const live=()=>{const context=getContext?.();return before&&rendered===before&&before.revision===revision&&!canvas.hidden&&context?.open===true&&context.account===before.account&&context.keyRevision===before.keyRevision};
    if (!live() || typeof savePNG !== "function") return;
    try {
      const dataURL=canvas.toDataURL("image/png");
      if (!live() || typeof dataURL!=="string" || dataURL.length>8*1024*1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataURL) || !/^ynx1[a-z0-9]+$/.test(before.account)) return;
      savePNG(dataURL,`YNX-Testnet-receive-${before.account}.png`);
      if(live())setWalletCopy(status,"Receiving PNG download started. It contains only your public receiving information.");
    } catch { if(live())setWalletCopy(status,"Receiving PNG download could not start. Reopen Receive and try again."); }
  }
  return { clear, refresh, exportPNG };
}
