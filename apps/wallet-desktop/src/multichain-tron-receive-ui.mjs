import {setWalletCopy} from './wallet-locale.mjs';
// Renderer stays dependency-free; checksum validation is performed in the
// protected main-process producer, never by loading Node packages into UI.
function own(object,key){const d=object&&typeof object==='object'&&Object.getOwnPropertyDescriptor(object,key);if(!d||!Object.hasOwn(d,'value'))throw Error('TRON_RECEIVE_INVALID');return d.value;}
function publicTronAddress(value){if(typeof value!=='string'||!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value))throw Error('TRON_RECEIVE_INVALID');return value;}
function receiveNetwork(snapshot,network){const revision=own(snapshot,'revision'),networks=own(snapshot,'networks');if(!Number.isSafeInteger(revision)||revision<0||!Array.isArray(networks))throw Error('TRON_RECEIVE_INVALID');const n=networks.find(n=>own(n,'family')==='tron'&&own(n,'network')===network);if(!n||!['mainnet','shasta','nile'].includes(network))throw Error('TRON_RECEIVE_INVALID');const genesis=own(n,'genesis'),rpcUrl=own(n,'rpcUrl');if(typeof genesis!=='string'||!/^[a-f0-9]{64}$/.test(genesis)||/^0+$/.test(genesis)||typeof rpcUrl!=='string'||!rpcUrl.startsWith('https://'))throw Error('TRON_RECEIVE_INVALID');return {configRevision:revision,genesis,rpcUrl};}

export function drawTronReceiveCode(canvas, code, expected) {
  for (const key of ['family','network','vaultAccount','address','revision','configRevision','genesis','rpcUrl']) if (own(code,key) !== expected[key]) throw Error('TRON_RECEIVE_INVALID');
  if (own(code,'payload') !== publicTronAddress(expected.address) || own(code,'path') !== "m/44'/195'/0'/0/0") throw Error('TRON_RECEIVE_INVALID');
  const size = own(code,'size'), source = own(code,'modules');
  if (!Number.isInteger(size) || size < 21 || size > 177 || (size-21)%4 || !Array.isArray(source) || source.length !== size*size) throw Error('TRON_RECEIVE_INVALID');
  const modules = Array.from({length:size*size}, (_,i) => {const value=own(source,String(i));if(value!==0&&value!==1)throw Error('TRON_RECEIVE_INVALID');return value;});
  const side=(size+8)*6; canvas.width=canvas.height=side;
  const context=canvas.getContext('2d');if(!context)throw Error('TRON_RECEIVE_INVALID');
  context.fillStyle='#FFFFFF';context.fillRect(0,0,side,side);context.fillStyle='#002FA7';
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(modules[y*size+x])context.fillRect((x+4)*6,(y+4)*6,6,6);
}
export function createTronReceiveCodeUI({document,parent,api,getContext,getSelection,isOpen,draw=drawTronReceiveCode}) {
  const canvas=document.createElement('canvas'),status=document.createElement('p'),label=document.createElement('p'),download=document.createElement('button');
  canvas.id='tron-receive-code';status.id='tron-receive-status';label.id='tron-receive-network';download.id='tron-receive-download';download.type='button';
  canvas.setAttribute('aria-label','Receiving address');status.setAttribute('role','status');setWalletCopy(download,'Download receiving PNG');parent.append(canvas,label,status,download);
  let epoch=0,rendered=null;
  function invalidate(){epoch++;rendered=null;canvas.hidden=true;canvas.width=canvas.height=1;download.disabled=true;download.hidden=getSelection().family!=='tron';status.textContent=label.textContent='';}
  function live(expected,token){const c=getContext(),s=getSelection();return token===epoch&&isOpen()&&!c.locked&&!c.authenticating&&c.account===expected.vaultAccount&&c.revision===expected.revision&&s.family==='tron'&&s.network===expected.network;}
  async function sameNetwork(expected,token){const reply=await api.familyNetworks();return live(expected,token)&&own(reply,'ok')===true&&JSON.stringify(receiveNetwork(own(reply,'value'),expected.network))===JSON.stringify({configRevision:expected.configRevision,genesis:expected.genesis,rpcUrl:expected.rpcUrl});}
  async function refresh(identity){invalidate();if(!api.familyTronReceiveCode||identity.family!=='tron')return;
    const token=epoch,c={...getContext()},expected={family:'tron',network:identity.network,vaultAccount:identity.vaultAccount,address:identity.address,revision:c.revision};
    if(!live(expected,token))return;setWalletCopy(status,'Preparing your receiving code…');
    try{const snapshot=await api.familyNetworks();if(!live(expected,token))return;if(own(snapshot,'ok')!==true)throw Error();Object.assign(expected,receiveNetwork(own(snapshot,'value'),expected.network));
      const reply=await api.familyTronReceiveCode({family:expected.family,network:expected.network,vaultAccount:expected.vaultAccount,address:expected.address,revision:expected.revision});
      if(!live(expected,token))return;if(own(reply,'ok')!==true)throw Error();draw(canvas,own(reply,'value'),expected);
      if(!live(expected,token)||!await sameNetwork(expected,token)){if(token===epoch)invalidate();return;}
      rendered={expected,token};canvas.hidden=false;download.disabled=false;label.textContent=`TRON · ${expected.network} · ${expected.genesis}`;setWalletCopy(status,'A receiving address does not verify the network or balance. Never send assets on another network.');
    }catch{if(live(expected,token)){canvas.hidden=true;download.disabled=true;setWalletCopy(status,'The receiving code is unavailable. Reopen Receive to try again.');}}
  }
  async function exportPNG(){const original=rendered;if(!original||!live(original.expected,original.token))return;
    try{if(!await sameNetwork(original.expected,original.token)){if(original.token===epoch)invalidate();return;}const data=canvas.toDataURL('image/png');
      if(!live(original.expected,original.token)||rendered!==original)return;
      if(typeof data!=='string'||data.length>8*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))throw Error();
      if(!await sameNetwork(original.expected,original.token)){if(original.token===epoch)invalidate();return;}
      if(rendered!==original||!live(original.expected,original.token))return;
      const anchor=document.createElement('a');anchor.href=data;anchor.download=`TRON-${original.expected.network}-receive-${publicTronAddress(original.expected.address)}.png`;
      document.body.append(anchor);try{anchor.click();}finally{anchor.remove();}
      if(live(original.expected,original.token))setWalletCopy(status,'Receiving PNG download started. It contains only your public receiving information.');
    }catch{if(live(original.expected,original.token))setWalletCopy(status,'Receiving PNG download could not start. Reopen Receive and try again.');}
  }
  download.addEventListener('click',exportPNG);invalidate();return {invalidate,refresh,exportPNG};
}
