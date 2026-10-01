import {createHostedWalletAdapter,WalletConnectDAppConnection,QRCode,toYNXAddress} from './vendor/ynx-wallet-transports-b38f74d3b.mjs';
// Consumer only. Handshakes, grants, expiry, approval and Relay ownership remain
// in the immutable official adapters; a remembered selection is never authority.
export function createSocialWalletTransports({window:browserWindow,hostedFactory=createHostedWalletAdapter,pairFactory=options=>new WalletConnectDAppConnection(options),qr=uri=>QRCode.toDataURL(uri,{width:240,margin:2,color:{dark:'#002FA7',light:'#FFFFFF'}})}={}){
 let hosted,pair,provider,kind,generation=0,pending=null,notify=()=>{};
 const emit=state=>notify(Object.freeze(state));
 function hostedAdapter(){if(!hosted){hosted=hostedFactory({window:browserWindow});hosted.on('disconnect',event=>{if(kind!=='hosted')return;const retained=['HOSTED_POPUP_CLOSED','HOSTED_REQUEST_EXPIRED_OR_RELOADED'].includes(event?.code);if(!retained){provider=null;generation++}emit({status:retained?'transport-unavailable':'disconnected',code:event?.code});});}return hosted;}
 function pairAdapter(){if(!pair){pair=pairFactory({origin:browserWindow.location.origin,methods:['ynx_requestProductSessionV2']});pair.on('stage',event=>{if(kind==='mobile'&&pending)emit({status:'opening',stage:event.stage})});pair.on('cancelUnconfirmed',()=>emit({status:'cancel-unconfirmed'}));}return pair;}
 async function connect(selected,onState=()=>{}){
  if(pending)throw Object.assign(new Error('REQUEST_PENDING'),{code:'REQUEST_PENDING'});
  notify=onState;kind=selected;const epoch=++generation;let task;
  if(selected==='hosted'){const adapter=hostedAdapter();task=adapter.connect().then(()=>adapter);}
  else if(selected==='mobile')task=pairAdapter().connect({onURI:uri=>{if(epoch!==generation)return;const deeplink='ynxwallet://wc?uri='+encodeURIComponent(uri);emit({status:'pairing',deeplink});void qr(uri).then(qrDataURL=>{if(epoch===generation)emit({status:'pairing',deeplink,qrDataURL})},()=>{if(epoch===generation)emit({status:'failed',code:'PAIR_QR_UNAVAILABLE'})})}});
  else throw new Error('INVALID_WALLET_KIND');
  const operation=Promise.resolve(task);pending=operation;emit({status:'opening'});
  try{const next=await operation;if(epoch!==generation)throw new Error('SUPERSEDED');provider=next;emit({status:'connected'});return next;}
  catch(error){if(epoch===generation)emit({status:'failed',code:error.code??error.message});throw error;}
  finally{if(pending===operation)pending=null;}
 }
 async function cancel(){++generation;const selected=kind,previousHosted=hosted;pending=null;provider=null;if(selected==='hosted')hosted=null;emit({status:'cancelled'});if(selected==='mobile')await pair?.cancel();else if(selected==='hosted')previousHosted?.suspend();}
 function restore(selected){kind=selected;if(selected==='hosted'){const adapter=hostedAdapter();return adapter.selection?{selectionPending:true}:null}return selected==='mobile'?pairAdapter().restore().then(value=>{provider=value;return value}):null;}
 function reserve(){if(kind==='hosted')return hostedAdapter().reserve();return Promise.resolve();}
 async function request(route){const selected=provider,epoch=generation;if(!selected)throw new Error('WALLET_NOT_CONNECTED');const response=await selected.request({method:'ynx_requestProductSessionV2',params:[route]});if(epoch!==generation||provider!==selected)throw new Error('SOCIAL_CONTEXT_CHANGED');return response;}
 async function disconnect(){++generation;pending=null;provider=null;if(kind==='mobile')await pair?.disconnect();else if(kind==='hosted')await hosted?.disconnect();}
 function suspend(){++generation;pending=null;provider=null;hosted?.suspend();if(kind==='mobile')void pair?.cancel();}
 return Object.freeze({connect,cancel,restore,reserve,request,disconnect,suspend,get busy(){return !!pending},get provider(){return provider},get kind(){return kind},get revision(){return generation},accountMatches:(account,evm)=>{try{return account===evm||account===toYNXAddress(evm)}catch{return false}}});
}
