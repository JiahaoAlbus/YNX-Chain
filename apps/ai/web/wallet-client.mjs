import {StandardWalletConnection,discoverWalletProviders} from './vendor/standard-wallet-browser.mjs';
const choiceKey='ynx-ai-wallet-choice',disconnectKey='ynx-ai-wallet-disconnected';
const names={'ynx-wallet':'YNX Wallet',metamask:'MetaMask'};
const rejected=error=>[4001,5000,5001,5002,5003].includes(Number(error?.code))||error?.code==='USER_REJECTED';
export class AIWalletClient {
 constructor({scope=globalThis,storage=scope.sessionStorage,onChange=()=>{},onInvalidated=()=>{},onPair=()=>{},waitMs=160,loadSDK=()=>import('./vendor/wallet-connection-ai039-shared1a8.mjs')}={}){
  Object.assign(this,{scope,storage,onChange,onInvalidated,onPair,waitMs,loadSDK,version:0,readVersion:0,connection:null,provider:null,unsubscribe:null,discovery:null,sdk:null,pair:null,hosted:null});
  this.state={status:'disconnected',kind:null,account:null,chainId:null,privateSession:false};
 }
 publish(update){this.state={...this.state,...update,privateSession:false};this.onChange(this.state,this.discovery)}
 release(){this.unsubscribe?.();this.unsubscribe=null;this.connection?.disconnect();this.connection=null;this.provider=null}
 prepareTransports(){if(!this.preparing)this.preparing=this.loadSDK().then(sdk=>this.sdk=sdk).catch(error=>{this.preparing=null;throw error});return this.preparing}
 async scan(){const result=await discoverWalletProviders(this.scope,this.waitMs);this.discovery=result;this.onChange(this.state,result);return result}
 identityChanged(previous,next){if(previous?.account&&next.account&&(previous.account.toLowerCase()!==next.account.toLowerCase()||previous.kind!==next.kind))this.onInvalidated({reason:'account-changed',previousAccount:previous.account,account:next.account})}
 attach(candidate){
  const Connection=this.sdk?.StandardWalletConnection??StandardWalletConnection;
  const connection=new Connection({provider:candidate.provider,origin:this.scope.location.origin,metadata:{name:'YNX AI',url:this.scope.location.origin}});
  this.connection=connection;this.provider=candidate.provider;
  this.unsubscribe=connection.subscribe(({event,value})=>{
   if(this.revoking===connection)return;
   if(event==='disconnect'){
    if(value?.reason==='permission-revoked'){this.onInvalidated({reason:'permissions-revoked'});this.disconnect('Wallet account access ended. Remote AI revocation is separate.');return}
    this.publish({status:'transport-unavailable',message:'Wallet connection interrupted. Your AI session has not been revoked. Restore or retry when the wallet is available.'});return;
   }
   if(event==='accountsChanged'){
    if(Array.isArray(value)&&value.length===0){this.onInvalidated({reason:'account-unavailable'});this.publish({status:'disconnected',account:null,chainId:null,message:'Wallet account access is unavailable. Unlock or reconnect; AI revocation is not confirmed.'});return}
    if(Array.isArray(value)&&value[0]&&this.state.account&&value[0].toLowerCase()!==this.state.account.toLowerCase())this.onInvalidated({reason:'account-changed',previousAccount:this.state.account,account:value[0]});
   }
   if(event==='accountsChanged'||event==='chainChanged')void this.refresh(connection,this.version);
  });
  return connection;
 }
 candidate(kind){return this.discovery?.candidates.filter(item=>item.kind===kind)??[]}
 async connect(kind){
  if(!names[kind])throw new Error('Choose YNX Wallet or MetaMask.');
  const previous=this.state,version=++this.version;
  if(this.pairAttempt){this.pairAttempt=null;void this.pair?.cancel().catch(()=>{})}this.release();this.publish({status:'connecting',kind,account:null,chainId:null,message:'Review the account connection in '+names[kind]+'.'});
  try{
   await this.scan();if(version!==this.version)return;
   const candidates=this.candidate(kind);
   if(candidates.length!==1)throw new Error(candidates.length?'Multiple providers match this wallet. Resolve the ambiguity and retry.':'This wallet extension is not available here. Choose YNX Wallet on Web or connect a phone; MetaMask must be selected separately.');
   const connection=this.attach(candidates[0]);
   const result=await connection.connect();if(version!==this.version)return;
   const next={kind,account:result.selectedAccount,chainId:result.selectedChain};this.identityChanged(previous,next);
   this.storage.setItem(choiceKey,kind);this.storage.removeItem(disconnectKey);
   this.publish({...next,status:next.chainId==='0x1917'?'connected':'wrong-network',message:'Wallet connected. AI private access requires separate approval.'});
  }catch(error){if(version===this.version){this.release();this.publish({status:'unavailable',account:null,chainId:null,errorReason:rejected(error)?'rejected':'unavailable',message:rejected(error)?'Connection declined. Your AI access has not been revoked. Choose a wallet and retry.':error.message})}}
 }
 async restore(){
  const version=++this.version,previous=this.state;this.release();
  const kind=this.storage.getItem(choiceKey);
  if(this.storage.getItem(disconnectKey)==='1'){this.publish({status:'disconnected',kind:null,account:null,chainId:null});return}
  if(kind==='ynx-pair'){
   try{await this.prepareTransports();if(version!==this.version)return;const provider=await this.pairClient().restore();if(version!==this.version)return;if(!provider){this.publish({status:'disconnected',kind:'ynx-wallet',account:null,chainId:null,message:'No active phone connection. Connect your phone explicitly.'});return}await this.refresh(this.attach({provider}),version);}
   catch(error){if(version===this.version)this.publish({status:'transport-unavailable',message:'Phone connection could not be restored. Retry without creating a new account.'});}return;
  }
  if(kind==='ynx-hosted'){
   try{await this.prepareTransports();if(version!==this.version)return;const adapter=this.hosted=this.sdk.createHostedWalletAdapter({window:this.scope}),hint=adapter.selection;
    if(hint?.account&&hint.chainId==='0x1917')this.publish({status:'selection-pending',kind:'ynx-wallet',account:hint.account,chainId:hint.chainId,message:'Your Web Wallet selection is saved. Reopen Web Wallet to resume its connection; AI restore is separate.'});
    else this.publish({status:'disconnected',kind:null,account:null,chainId:null});
   }catch{if(version===this.version)this.publish({status:'transport-unavailable',message:'Web Wallet recovery is unavailable. Retry when online.'});}return;
  }
  await this.scan();if(version!==this.version)return;
  if(!names[kind]){this.publish({status:'disconnected',kind:null,account:null,chainId:null});return}
  const candidates=this.candidate(kind);
  if(candidates.length!==1){this.publish({status:'unavailable',kind,account:null,chainId:null,message:'The selected wallet extension is unavailable. Your AI session has not been revoked.'});return}
  this.publish({kind,status:'checking',account:previous.account,chainId:previous.chainId});await this.refresh(this.attach(candidates[0]),version);
 }
 async refresh(connection,version){
  const read=++this.readVersion,previous=this.state;
  try{
   const restored=await connection.restore();if(version!==this.version||read!==this.readVersion)return;
   if(!restored){this.publish({status:'disconnected',account:null,chainId:null,message:'Account access is unavailable. Choose a wallet explicitly to reconnect.'});return}
   const next={kind:this.state.kind,account:restored.selectedAccount,chainId:restored.selectedChain};this.identityChanged(previous,next);
   this.publish({...next,status:next.chainId==='0x1917'?'connected':'wrong-network',message:'Existing wallet account read without requesting new permission.'});
  }catch(error){if(version===this.version&&read===this.readVersion)this.publish({status:'transport-unavailable',message:error.message})}
 }
 async connectHosted(){
  if(!this.sdk){this.publish({status:'unavailable',message:'Preparing Web Wallet. Retry in a moment.'});void this.prepareTransports().catch(()=>{});return}
  const previous=this.state,version=++this.version;this.release();
  const provider=this.hosted??=this.sdk.createHostedWalletAdapter({window:this.scope});
  const connection=this.attach({provider});
  // No await before the account request: the official adapter reserves its
  // popup from the real user click, rather than opening it after a proof await.
  const request=connection.connect();this.publish({status:'connecting',kind:'ynx-wallet',account:null,chainId:null,message:'Review account access in YNX Wallet on Web.'});
  try{const result=await request;if(version!==this.version)return;const next={kind:'ynx-wallet',account:result.selectedAccount,chainId:result.selectedChain};this.identityChanged(previous,next);this.storage.setItem(choiceKey,'ynx-hosted');this.storage.removeItem(disconnectKey);this.publish({...next,status:next.chainId==='0x1917'?'connected':'wrong-network',message:'Web Wallet connected. AI private permission is separate.'});}
  catch(error){if(version===this.version){this.release();this.publish({status:'unavailable',account:null,chainId:null,message:rejected(error)?'Web Wallet request declined. Retry when ready.':'Web Wallet connection did not complete. Reopen it to retry.'});}}
 }
 pairClient(){
  if(!this.pair){this.pair=new this.sdk.WalletConnectDAppConnection({origin:this.scope.location.origin,methods:['ynx_requestProductSessionV2']});
   this.pair.on('stage',event=>{if(this.pairAttempt)this.onPair({status:'opening',stage:event.stage})});
   this.pair.on('cancelUnconfirmed',event=>{if(event.current!==false){this.pairCancellationUnconfirmed=true;this.onPair({status:'cancel-unconfirmed',message:'Cancellation is not confirmed remotely. No connection is claimed.'})}});
  }return this.pair;
 }
 async connectPair(){
  if(this.pairAttempt)return;
  const previous=this.state,version=++this.version;this.release();this.pairAttempt=version;this.pairCancellationUnconfirmed=false;
  this.publish({status:'connecting',kind:'ynx-wallet',account:null,chainId:null,message:'Preparing the phone connection.'});
  try{await this.prepareTransports();if(version!==this.version)return;
   const provider=await this.pairClient().connect({onURI:uri=>{if(version!==this.version)return;const deeplink='ynxwallet://wc?uri='+encodeURIComponent(uri);this.onPair({status:'pairing',deeplink});this.sdk.toDataURL(uri,{width:224,margin:2}).then(qrDataURL=>{if(version===this.version)this.onPair({status:'pairing',deeplink,qrDataURL});}).catch(()=>{if(version===this.version)this.onPair({status:'pairing',deeplink,message:'QR unavailable. Open this request on your phone.'});});}});
   if(version!==this.version)return;
   const result=await this.attach({provider}).restore();if(version!==this.version)return;
   const next={kind:'ynx-wallet',account:result.selectedAccount,chainId:result.selectedChain};this.identityChanged(previous,next);
   this.storage.setItem(choiceKey,'ynx-pair');this.storage.removeItem(disconnectKey);this.onPair({status:'connected'});this.publish({...next,status:'connected',message:'Phone connected. AI private permission is separate.'});
  }catch(error){if(version===this.version){this.release();this.onPair({status:rejected(error)?'rejected':'failed',message:rejected(error)?'Phone connection declined.':'Phone connection is unavailable. Retry when online or choose Web Wallet.'});this.publish({status:'unavailable',account:null,chainId:null,message:'Phone connection did not complete. Retry or choose Web Wallet.'});}}
  finally{if(this.pairAttempt===version)this.pairAttempt=null}
 }
 async cancelPair(){const version=++this.version;this.pairAttempt=null;this.pairCancellationUnconfirmed=false;this.release();this.onPair({status:'cancelling'});this.publish({status:'disconnected',account:null,chainId:null,message:'Phone connection cancelled here. AI access has not been revoked.'});try{await this.pair?.cancel();if(version===this.version)this.onPair({status:this.pairCancellationUnconfirmed?'cancel-unconfirmed':'cancelled'})}catch{if(version===this.version)this.onPair({status:'cancel-unconfirmed',message:'Remote cancellation is not confirmed.'})}}
 async switchNetwork(){const connection=this.connection,version=this.version;if(!connection)return;try{await connection.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1917'}]});if(version===this.version)await this.refresh(connection,version)}catch(error){if(version===this.version)this.publish({message:error.code===4902?'Add YNX Testnet in your wallet, then retry.':error.code===4001?'Network switch declined. Your wallet choice has been kept.':error.message})}}
 async revoke(){
  const connection=this.connection;if(!connection||this.revoking)return;
  const version=++this.version;this.revoking=connection;
  try{const result=this.hosted&&this.provider===this.hosted?await this.hosted.revoke():this.provider?.isYNXPair?(await this.pair.disconnect(),{status:'revoked',permissionRevoked:true}):await connection.revoke();if(version!==this.version)return;
   const confirmed=result.permissionRevoked===true||result.revoked===true;this.release();this.storage.setItem(disconnectKey,'1');if(confirmed)this.onInvalidated({reason:'permissions-revoked'});
   this.publish({status:confirmed?'permissions-revoked':'disconnected',account:null,chainId:null,message:confirmed?'Wallet access revocation confirmed. Remote AI-session revocation is separate.':'Wallet revocation is not confirmed. Check wallet settings or retry.'});
  }catch{if(version===this.version)this.publish({message:'Wallet revocation is not confirmed. Retry when available.'})}finally{if(this.revoking===connection)this.revoking=null}
 }
 disconnect(message='Disconnected on this page. Wallet permissions and remote AI sessions are not revoked by this action.'){
  ++this.version;++this.readVersion;if(this.pairAttempt)void this.pair?.cancel().catch(()=>{});this.pairAttempt=null;this.release();this.hosted?.suspend?.();this.storage.setItem(disconnectKey,'1');this.publish({status:'disconnected',account:null,chainId:null,message});
 }
 dispose(){++this.version;++this.readVersion;this.pairAttempt=null;this.release();this.hosted?.suspend?.();void this.pair?.cancel().catch(()=>{})}
 privateProviderAvailable(){return (this.state.status==='connected'||this.state.status==='transport-unavailable'&&this.provider===this.hosted)&&this.state.kind==='ynx-wallet'&&this.state.chainId==='0x1917'&&!!this.provider}
 privateSubjectMatches(account){if(['wrong-network','connecting'].includes(this.state.status))return false;if(!this.state.account||!['connected','transport-unavailable','selection-pending'].includes(this.state.status))return true;try{return this.sdk?.toEVMAddress(account).toLowerCase()===this.state.account.toLowerCase()}catch{return false}}
 reservePrivateRequest(){if(this.privateProviderAvailable()&&this.provider===this.hosted)return this.hosted.reserve();return Promise.resolve()}
 async requestProductSessionV2(url){
  if(!this.privateProviderAvailable()||typeof url!=='string'||url.length>16384)throw new Error('AI_PRIVATE_TRANSPORT_UNAVAILABLE');
  const provider=this.provider,version=this.version,account=this.state.account;
  const result=await provider.request({method:'ynx_requestProductSessionV2',params:[url]});
  if(version!==this.version||provider!==this.provider||account!==this.state.account||!this.privateProviderAvailable())throw new Error('AI_WALLET_CONTEXT_CHANGED');
  if(result?.version!==2||typeof result.returnUrl!=='string'||result.returnUrl.length>16384||Object.keys(result).sort().join(',')!=='returnUrl,version')throw new Error('AI_PRIVATE_RETURN_INVALID');return result;
 }
}
