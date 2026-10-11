import {setWalletCopy} from './wallet-locale.mjs';

const formatted=(value,decimals)=>{if(!decimals)return value;const text=value.padStart(decimals+1,'0'),fraction=text.slice(-decimals).replace(/0+$/,'');return text.slice(0,-decimals)+(fraction?'.'+fraction:'')};
/** All RPC strings use textContent. No keys, DApp grants or YNX selector changes. */
export function createMultichainUI({document,api,getContext,copy=setWalletCopy}){
  const node=id=>document.querySelector('#'+id),sheet=node('multichain-sheet'),root=node('multichain-content'),reviewSheet=node('multichain-review');
  let generation=0,busy=false,snapshot=null,review=null,openContext=null;
  const controls=new Set();
  const text=(tag,key,parent)=>{const element=document.createElement(tag);copy(element,key);parent.append(element);return element};
  const data=(tag,value,parent)=>{const element=document.createElement(tag);element.textContent=String(value);element.dir='ltr';parent.append(element);return element};
  const button=(key,parent,action)=>{const element=text('button',key,parent);element.type='button';element.addEventListener('click',action);controls.add(element);return element};
  const field=(key,parent,type='text')=>{const label=document.createElement('label');text('span',key,label);const input=document.createElement('input');input.type=type;input.autocomplete='off';input.spellcheck=false;input.dir='ltr';input.required=true;input.maxLength=2048;label.append(input);parent.append(label);controls.add(input);return input};
  const select=parent=>{const element=document.createElement('select');parent.append(element);controls.add(element);return element};
  const networks=select(root),networkFacts=document.createElement('dl');root.append(networkFacts);
  text('p','Other networks do not change YNX app permissions. Verify RPC and token details independently.',root);
  const receiveLabel=text('label','EVM receiving address',root);receiveLabel.setAttribute('for','multichain-receive-address');const receive=document.createElement('input');receive.setAttribute('id','multichain-receive-address');receive.readOnly=true;receive.dir='ltr';root.append(receive);
  const status=text('p','Select or add an EVM network.',root);status.setAttribute('role','status');
  const refreshButton=button('Refresh',root,()=>refresh());
  button('Edit network',root,()=>{const n=snapshot?.networks.find(n=>n.id===networks.value);if(n){name.value=n.name;rpc.value=n.rpcUrl;chain.value=n.chainId;symbol.value=n.symbol;genesis.value=n.genesis;networkDetails.open=true}});
  button('Remove network',root,()=>run(()=>api.multichainRemove(networks.value),refresh));
  const networkDetails=document.createElement('details');root.append(networkDetails);text('summary','Add or edit EVM network',networkDetails);
  const networkForm=document.createElement('form');networkDetails.append(networkForm);
  const name=field('Network name',networkForm),rpc=field('HTTPS RPC',networkForm),chain=field('Chain ID',networkForm),symbol=field('Native symbol',networkForm),genesis=field('Genesis block hash',networkForm);
  button('Verify and save network',networkForm,()=>{if(!networkForm.reportValidity())return;return run(()=>api.multichainNetwork({name:name.value,rpcUrl:rpc.value,chainId:chain.value,symbol:symbol.value,genesis:genesis.value.toLowerCase(),decimals:18}),async()=>{networkDetails.open=false;await refresh()})});networkForm.addEventListener('submit',e=>e.preventDefault());
  const assets=document.createElement('div');root.append(assets);
  const tokenDetails=document.createElement('details');root.append(tokenDetails);text('summary','Import ERC-20 token',tokenDetails);
  const tokenForm=document.createElement('form');tokenDetails.append(tokenForm);
  const tokenAddress=field('Token contract',tokenForm),tokenName=field('Token name',tokenForm),tokenSymbol=field('Token symbol',tokenForm),tokenDecimals=field('Token decimals',tokenForm,'number');tokenDecimals.min='0';tokenDecimals.max='255';tokenDecimals.step='1';
  for(const input of [tokenName,tokenSymbol,tokenDecimals])input.required=false;
  text('p','Optional metadata can be entered if the contract does not provide it. Never guess token decimals.',tokenForm);
  button('Import ERC-20 token',tokenForm,()=>{if(!tokenForm.reportValidity())return;return run(()=>api.multichainToken({address:tokenAddress.value,decimals:tokenDecimals.value===''?undefined:Number(tokenDecimals.value),symbol:tokenSymbol.value||undefined,name:tokenName.value||undefined}),async()=>{tokenForm.reset();tokenDetails.open=false;await refresh()})});tokenForm.addEventListener('submit',e=>e.preventDefault());
  const sendForm=document.createElement('form');root.append(sendForm);text('h3','Send on selected network',sendForm);
  const assetSelect=select(sendForm),to=field('Recipient',sendForm),amount=field('Amount',sendForm);
  const prepareButton=button('Review transfer',sendForm,()=>{if(!sendForm.reportValidity()||getContext().locked)return;return run(()=>api.multichainPrepare({asset:assetSelect.value,to:to.value,amount:amount.value}),value=>{review=value;renderReview(value);reviewSheet.showModal()})});sendForm.addEventListener('submit',e=>e.preventDefault());
  const history=document.createElement('div');root.append(history);text('p','Block inclusion reported by RPC is not consensus finality. Unknown transactions are checked, never automatically resent.',root);
  const reviewFacts=node('multichain-review-facts'),reviewStatus=node('multichain-review-status');
  const confirm=node('multichain-confirm'),cancel=node('multichain-cancel');
  function securityKey(){const c=getContext();return [c.account,c.revision,c.locked].join(':')}
  function current(ticket,context){return ticket===generation&&sheet.open&&securityKey()===context}
  function setBusy(value){busy=value;for(const control of controls){if(control.isConnected===false)controls.delete(control);else control.disabled=value}prepareButton.disabled=value||getContext().locked||!snapshot?.selected;confirm.disabled=value||getContext().locked||!review||review.expiresAt<=Date.now()}
  async function run(action,success){if(busy)return;const ticket=generation,context=securityKey();setBusy(true);try{const result=await action();if(!current(ticket,context))return;if(!result.ok){copy(status,'Network request failed: {code}',{code:result.error.code});return}await success?.(result.value)}catch{if(current(ticket,context))copy(status,'Network request failed: {code}',{code:'IPC_UNAVAILABLE'})}finally{if(current(ticket,context))setBusy(false)}}
  function facts(parent,entries){parent.replaceChildren();for(const [label,value]of entries){text('dt',label,parent);data('dd',value,parent)}}
  function renderReview(value){copy(reviewStatus,'Review the exact network, recipient, amount and maximum fee.');facts(reviewFacts,[['Network name',value.network.name],['Chain ID',value.network.chainId],['Genesis block hash',value.network.genesis],['HTTPS RPC',value.network.rpcUrl],['EVM receiving address',value.account],['Recipient',value.to],['Token contract',value.asset],['Amount',formatted(value.amount,value.decimals)+' '+value.symbol],['Maximum fee',formatted(value.fee,18)+' '+value.network.symbol],['Nonce',value.transaction.nonce],['Gas limit',value.transaction.gasLimit],['Gas price',value.transaction.gasPrice],['Transaction data',value.transaction.data]]);setBusy(busy)}
  function cancelReview(){const id=review?.id;review=null;if(reviewSheet.open)reviewSheet.close();reviewFacts.replaceChildren();if(id)void api.multichainCancel(id);setBusy(busy)}
  cancel.addEventListener('click',cancelReview);reviewSheet.addEventListener('cancel',cancelReview);
  confirm.addEventListener('click',()=>{if(!review||review.expiresAt<=Date.now()||getContext().locked)return;const id=review.id;return run(()=>api.multichainSend(id),async value=>{review=null;reviewSheet.close();reviewFacts.replaceChildren();copy(status,'Transaction status: {state}',{state:value.state});await refresh()})});
  for(const input of [to,amount,assetSelect])input.addEventListener('input',cancelReview);
  networks.addEventListener('change',()=>{cancelReview();return run(()=>api.multichainSelect(networks.value),refresh)});
  async function refresh(){
    const ticket=generation,context=securityKey();const result=await api.multichainSnapshot();if(!current(ticket,context))return;if(!result.ok){copy(status,'Network request failed: {code}',{code:result.error.code});return}
    snapshot=result.value;receive.value=snapshot.account;networks.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';copy(placeholder,'Select or add an EVM network.');networks.append(placeholder);for(const n of snapshot.networks){const option=data('option',n.name,networks);option.value=n.id}networks.value=snapshot.selected??'';
    assets.replaceChildren();assetSelect.replaceChildren();history.replaceChildren();networkFacts.replaceChildren();if(!snapshot.selected){setBusy(busy);return}
    const network=snapshot.networks.find(n=>n.id===snapshot.selected);facts(networkFacts,[['Chain ID',network.chainId],['Genesis block hash',network.genesis],['HTTPS RPC',network.rpcUrl]]);
    const balances=await api.multichainBalances();if(!current(ticket,context))return;
    if(balances.ok){for(const asset of balances.value.assets){const row=document.createElement('div');row.className='asset-row';assets.append(row);data('span',asset.symbol,row);data('span',asset.display??'—',row);if(asset.error)data('span',asset.error,row);const option=data('option',asset.symbol,assetSelect);option.value=asset.address;if(asset.address!=='native')button('Remove token',row,()=>run(()=>api.multichainRemoveToken({networkId:network.id,address:asset.address}),refresh))}}else copy(status,'Network request failed: {code}',{code:balances.error.code});
    const records=await api.multichainHistory();if(!current(ticket,context))return;if(records.ok){for(const record of records.value){const row=document.createElement('section');row.className='multichain-record';history.append(row);copy(text('p','Transaction status: {state}',row),'Transaction status: {state}',{state:record.state});data('p',record.to,row);data('p',record.amount+' base units',row);if(record.hash)data('p',record.hash,row);button('Check original transaction',row,()=>run(()=>api.multichainCheck(record.id),refresh))}}else copy(status,'Network request failed: {code}',{code:records.error.code});setBusy(busy);
  }
  function invalidate(){generation++;openContext=securityKey();busy=false;cancelReview();snapshot=null;receive.value='';assets.replaceChildren();history.replaceChildren();networkFacts.replaceChildren();to.value='';amount.value='';setBusy(false)}
  node('open-multichain').addEventListener('click',()=>{invalidate();sheet.showModal();openContext=securityKey();void refresh().catch(()=>copy(status,'Network request failed: {code}',{code:'IPC_UNAVAILABLE'}))});
  node('multichain-close').addEventListener('click',()=>sheet.close());sheet.addEventListener('close',invalidate);sheet.addEventListener('cancel',invalidate);
  const timer=setInterval(()=>{if(review&&review.expiresAt<=Date.now())cancelReview()},1000);timer.unref?.();
  return {refresh,invalidate,render(){if(openContext!==securityKey()){invalidate();if(sheet.open)void refresh().catch(()=>{})}setBusy(busy)},dispose(){clearInterval(timer);invalidate()}};
}
