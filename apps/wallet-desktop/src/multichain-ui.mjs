import {setWalletCopy} from './wallet-locale.mjs';
import {EVM_NETWORK_PRESETS} from './multichain-evm-presets.mjs';

const formatted=(value,decimals)=>{if(!decimals)return value;const text=value.padStart(decimals+1,'0'),fraction=text.slice(-decimals).replace(/0+$/,'');return text.slice(0,-decimals)+(fraction?'.'+fraction:'')};
const unresolvedStates=new Set(['prepared','signing-unknown','signed','unknown','submitted']);
const terminalStates=new Set(['included','reverted','cancelled','local-cancelled-before-broadcast']);
/** All RPC strings use textContent. No keys, DApp grants or YNX selector changes. */
export function createMultichainUI({document,api,getContext,copy=setWalletCopy}){
  const node=id=>document.querySelector('#'+id),sheet=node('multichain-sheet'),root=node('multichain-content'),reviewSheet=node('multichain-review');
  let generation=0,readRevision=0,reading=false,busy=false,cancelling=false,snapshot=null,review=null,openContext=null;
  let historyReady=false,unresolved=false,pendingOriginal=null;
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
  const originalStatus=document.createElement('p');originalStatus.setAttribute('role','status');originalStatus.hidden=true;root.append(originalStatus);
  const refreshButton=button('Refresh',root,()=>refresh());
  const editButton=button('Edit network',root,()=>{const n=snapshot?.networks.find(n=>n.id===networks.value);if(n){name.value=n.name;rpc.value=n.rpcUrl;chain.value=n.chainId;symbol.value=n.symbol;genesis.value=n.genesis;networkDetails.open=true}});
  const removeButton=button('Remove network',root,()=>{if(!snapshot?.selected)return;return run(()=>api.multichainRemove(networks.value),refresh)});
  const networkDetails=document.createElement('details');root.append(networkDetails);text('summary','Add or edit EVM network',networkDetails);
  text('p','Use a network template',networkDetails);
  text('p','Templates fill the form only. Verify and save before using the network.',networkDetails);
  const templates=document.createElement('div');networkDetails.append(templates);
  for(const preset of EVM_NETWORK_PRESETS){const control=data('button',preset.name,templates);control.type='button';controls.add(control);control.addEventListener('click',()=>{if(busy||reading)return;name.value=preset.name;rpc.value=preset.rpcUrl;chain.value=preset.chainId;symbol.value=preset.symbol;genesis.value=preset.genesis;networkDetails.open=true})}
  const networkForm=document.createElement('form');networkDetails.append(networkForm);
  const name=field('Network name',networkForm),rpc=field('HTTPS RPC',networkForm),chain=field('Chain ID',networkForm),symbol=field('Native symbol',networkForm),genesis=field('Genesis block hash',networkForm);
  button('Verify and save network',networkForm,()=>{if(!networkForm.reportValidity())return;return run(()=>api.multichainNetwork({name:name.value,rpcUrl:rpc.value,chainId:chain.value,symbol:symbol.value,genesis:genesis.value.toLowerCase(),decimals:18}),async()=>{networkDetails.open=false;await refresh()})});networkForm.addEventListener('submit',e=>e.preventDefault());
  const assets=document.createElement('div');root.append(assets);
  const tokenDetails=document.createElement('details');root.append(tokenDetails);text('summary','Import ERC-20 token',tokenDetails);
  const tokenForm=document.createElement('form');tokenDetails.append(tokenForm);
  const tokenAddress=field('Token contract',tokenForm),tokenName=field('Token name',tokenForm),tokenSymbol=field('Token symbol',tokenForm),tokenDecimals=field('Token decimals',tokenForm,'number');tokenDecimals.min='0';tokenDecimals.max='255';tokenDecimals.step='1';
  for(const input of [tokenName,tokenSymbol,tokenDecimals])input.required=false;
  text('p','Optional metadata can be entered if the contract does not provide it. Never guess token decimals.',tokenForm);
  const importTokenButton=button('Import ERC-20 token',tokenForm,()=>{if(!snapshot?.selected||!tokenForm.reportValidity())return;return run(()=>api.multichainToken({address:tokenAddress.value,decimals:tokenDecimals.value===''?undefined:Number(tokenDecimals.value),symbol:tokenSymbol.value||undefined,name:tokenName.value||undefined}),async()=>{tokenForm.reset();tokenDetails.open=false;await refresh()})});tokenForm.addEventListener('submit',e=>e.preventDefault());
  const sendForm=document.createElement('form');root.append(sendForm);text('h3','Send on selected network',sendForm);
  const assetSelect=select(sendForm),to=field('Recipient',sendForm),amount=field('Amount',sendForm);
  const prepareButton=button('Review transfer',sendForm,()=>{if(!snapshot?.selected||!historyReady||unresolved||!sendForm.reportValidity()||getContext().locked)return;return run(()=>api.multichainPrepare({asset:assetSelect.value,to:to.value,amount:amount.value}),value=>{review=value;renderReview(value);reviewSheet.showModal()})});sendForm.addEventListener('submit',e=>e.preventDefault());
  const history=document.createElement('div');root.append(history);text('p','Block inclusion reported by RPC is not consensus finality. Unknown transactions are checked, never automatically resent.',root);
  const reviewFacts=node('multichain-review-facts'),reviewStatus=node('multichain-review-status');
  const confirm=node('multichain-confirm'),cancel=node('multichain-cancel');
  function securityKey(){const c=getContext();return [c.account,c.revision,c.locked].join(':')}
  function current(ticket,context){return ticket===generation&&sheet.open&&securityKey()===context}
  function setBusy(value){busy=value;for(const control of controls){if(control.isConnected===false)controls.delete(control);else control.disabled=value||reading}const selected=!!snapshot?.selected;for(const control of [editButton,removeButton,importTokenButton,tokenAddress,tokenName,tokenSymbol,tokenDecimals,assetSelect,to,amount])control.disabled=value||reading||!selected;tokenDetails.hidden=!selected;sendForm.hidden=!selected;prepareButton.disabled=value||reading||getContext().locked||!selected||!historyReady||unresolved;confirm.disabled=value||reading||getContext().locked||!historyReady||unresolved||!review||review.approved||review.expiresAt<=Date.now();cancel.disabled=cancelling||!!(busy&&review?.cannotCancel);copy(cancel,review?.approved&&!busy?'Close':'Cancel');originalStatus.hidden=!selected||historyReady&&!unresolved;if(!originalStatus.hidden)copy(originalStatus,!historyReady?'Original transaction records could not be verified. Refresh before preparing another transfer.':'An original transaction is unresolved. Keep its progress and check the original result before creating another transfer.')}
  function retireReads(){readRevision++;reading=false}
  async function interruptedReview(){if(!review?.approved)return;pendingOriginal={id:review.id,networkId:snapshot?.selected};historyReady=false;unresolved=true;clearReview();await refresh()}
  async function run(action,success){if(busy)return;retireReads();const ticket=generation,context=securityKey();setBusy(true);try{const result=await action();if(!current(ticket,context))return;if(!result.ok){if(result.error.code==='MULTICHAIN_CANCELLED')copy(status,'Transaction status: {state}',{state:'cancelled-before-broadcast'});else copy(status,'Network request failed: {code}',{code:result.error.code});if(result.error.code==='MULTICHAIN_RECORDED_OUTCOME_UNKNOWN')await interruptedReview();return}await success?.(result.value)}catch{if(current(ticket,context)){copy(status,'Network request failed: {code}',{code:'IPC_UNAVAILABLE'});await interruptedReview()}}finally{if(current(ticket,context))setBusy(false)}}
  function facts(parent,entries){parent.replaceChildren();for(const [label,value]of entries){text('dt',label,parent);data('dd',value,parent)}}
  function renderReview(value){copy(reviewStatus,'Review the exact network, recipient, amount and maximum fee.');facts(reviewFacts,[['Network name',value.network.name],['Chain ID',value.network.chainId],['Genesis block hash',value.network.genesis],['HTTPS RPC',value.network.rpcUrl],['EVM receiving address',value.account],['Recipient',value.to],['Token contract',value.asset],['Amount',formatted(value.amount,value.decimals)+' '+value.symbol],['Maximum fee',formatted(value.fee,18)+' '+value.network.symbol],['Nonce',value.transaction.nonce],['Gas limit',value.transaction.gasLimit],['Gas price',value.transaction.gasPrice],['Transaction data',value.transaction.data]]);setBusy(busy)}
  function clearReview(){review=null;if(reviewSheet.open)reviewSheet.close();reviewFacts.replaceChildren();setBusy(busy)}
  function discardReview(){const id=review?.id;clearReview();if(id)void Promise.resolve(api.multichainCancel(id)).catch(()=>{})}
  async function cancelReview(event){event?.preventDefault?.();if(cancelling)return;if(!review||review.approved&&!busy){clearReview();return}const id=review.id,ticket=generation,context=securityKey();cancelling=true;setBusy(busy);try{const result=await api.multichainCancel(id);if(!current(ticket,context)||review?.id!==id)return;if(result.ok&&result.value.cancelled){clearReview();copy(status,'Transaction status: {state}',{state:result.value.reason??'cancelled'})}else{if(result.value?.reason==='submit-started')review.cannotCancel=true;copy(reviewStatus,'Network request failed: {code}',{code:result.error?.code??result.value?.reason??'RECORD_NEEDS_RESOLUTION'})}}catch{if(current(ticket,context))copy(reviewStatus,'Network request failed: {code}',{code:'IPC_UNAVAILABLE'})}finally{if(current(ticket,context)){cancelling=false;setBusy(busy)}}}
  cancel.addEventListener('click',cancelReview);reviewSheet.addEventListener('cancel',cancelReview);
  confirm.addEventListener('click',()=>{if(!review||review.approved||review.expiresAt<=Date.now()||getContext().locked||busy||reading||!historyReady||unresolved)return;const id=review.id;review.approved=true;return run(()=>api.multichainSend(id),async value=>{if(unresolvedStates.has(value.state))pendingOriginal={id,networkId:snapshot?.selected};clearReview();copy(status,'Transaction status: {state}',{state:value.state});await refresh()})});
  for(const input of [to,amount,assetSelect])input.addEventListener('input',discardReview);
  networks.addEventListener('change',()=>{discardReview();retireReads();assets.replaceChildren();assetSelect.replaceChildren();history.replaceChildren();networkFacts.replaceChildren();return run(()=>api.multichainSelect(networks.value),refresh)});
  async function refresh(){
    const read=++readRevision,ticket=generation,context=securityKey(),account=getContext().account?.toLowerCase();const owns=()=>read===readRevision&&current(ticket,context);reading=true;historyReady=false;setBusy(busy);
    try{
      const result=await api.multichainSnapshot();if(!owns())return;if(!result.ok){copy(status,'Network request failed: {code}',{code:result.error.code});return}
      const frame=result.value;if(frame.account!==account||!Number.isSafeInteger(frame.revision))throw Error('Snapshot association');const network=frame.networks.find(n=>n.id===frame.selected);let balances,records;
      if(frame.selected){if(!network)throw Error('Network association');balances=await api.multichainBalances();if(!owns())return;records=await api.multichainHistory();if(!owns())return;for(const response of [balances,records])if(response.ok&&(response.value.account!==frame.account||response.value.networkId!==frame.selected||response.value.configRevision!==frame.revision))throw Error('Read association');if(records.ok&&records.value.records.some(r=>r.account!==frame.account||r.network.id!==frame.selected))throw Error('History association')}
      // Publish only this coherent read owner, never a partial old snapshot.
      if(!owns())return;const sameHistory=snapshot?.account===frame.account&&snapshot?.selected===frame.selected&&snapshot?.revision===frame.revision;snapshot=frame;receive.value=frame.account;networks.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';copy(placeholder,'Select or add an EVM network.');networks.append(placeholder);for(const n of frame.networks){const option=data('option',n.name,networks);option.value=n.id}networks.value=frame.selected??'';assets.replaceChildren();assetSelect.replaceChildren();if(!sameHistory)history.replaceChildren();networkFacts.replaceChildren();
      if(pendingOriginal?.networkId!==frame.selected)pendingOriginal=null;
      if(records?.ok){
        if(records.value.records.some(r=>!unresolvedStates.has(r.state)&&!terminalStates.has(r.state)))throw Error('Unknown original state');
        const original=pendingOriginal&&records.value.records.find(r=>r.id===pendingOriginal.id);
        if(original&&terminalStates.has(original.state))pendingOriginal=null;
        historyReady=true;unresolved=Boolean(pendingOriginal)||records.value.records.some(r=>unresolvedStates.has(r.state));
      }
      if(!network){copy(status,'Select or add an EVM network.');networkDetails.open=frame.networks.length===0;return}facts(networkFacts,[['Chain ID',network.chainId],['Genesis block hash',network.genesis],['HTTPS RPC',network.rpcUrl]]);
      if(balances.ok){for(const asset of balances.value.assets){const row=document.createElement('div');row.className='asset-row';assets.append(row);data('span',asset.symbol,row);data('span',asset.display??'—',row);if(asset.error)data('span',asset.error,row);const option=data('option',asset.symbol,assetSelect);option.value=asset.address;if(asset.address!=='native')button('Remove token',row,()=>run(()=>api.multichainRemoveToken({networkId:network.id,address:asset.address}),refresh))}}else copy(status,'Network request failed: {code}',{code:balances.error.code});
      if(records.ok){history.replaceChildren();for(const record of records.value.records){const row=document.createElement('section');row.className='multichain-record';history.append(row);copy(text('p','Transaction status: {state}',row),'Transaction status: {state}',{state:record.state});if(record.state==='signing-unknown')text('p','Signing result unknown. Preserve the original record. Do not sign or send a replacement.',row);data('p',record.to,row);data('p',record.amount+' base units',row);if(record.hash)data('p',record.hash,row);button('Check original transaction',row,()=>run(()=>api.multichainCheck(record.id),refresh))}}else copy(status,'Network request failed: {code}',{code:records.error.code});
    }catch{if(owns())copy(status,'Network request failed: {code}',{code:'MULTICHAIN_STALE_READ'})}finally{if(owns()){reading=false;setBusy(busy)}}
  }
  function invalidate(){generation++;retireReads();openContext=securityKey();busy=false;cancelling=false;historyReady=false;unresolved=false;pendingOriginal=null;discardReview();snapshot=null;receive.value='';assets.replaceChildren();history.replaceChildren();networkFacts.replaceChildren();to.value='';amount.value='';setBusy(false)}
  node('open-multichain').addEventListener('click',()=>{invalidate();sheet.showModal();openContext=securityKey();void refresh().catch(()=>copy(status,'Network request failed: {code}',{code:'IPC_UNAVAILABLE'}))});
  node('multichain-close').addEventListener('click',()=>sheet.close());sheet.addEventListener('close',invalidate);sheet.addEventListener('cancel',invalidate);
  const timer=setInterval(()=>{if(review&&!review.approved&&review.expiresAt<=Date.now())discardReview()},1000);timer.unref?.();
  return {refresh,invalidate,render(){if(openContext!==securityKey()){invalidate();if(sheet.open)void refresh().catch(()=>{})}setBusy(busy)},dispose(){clearInterval(timer);invalidate()}};
}
