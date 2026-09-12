import {StandardWalletConnection,discoverWalletProviders} from './vendor/standard-wallet-browser.mjs';

const choiceKey='ynx-ai-wallet-choice',disconnectKey='ynx-ai-wallet-disconnected';
const names={'ynx-wallet':'YNX Wallet',metamask:'MetaMask'};
export class AIWalletClient {
 constructor({scope=globalThis,storage=scope.sessionStorage,onChange=()=>{},onInvalidated=()=>{},waitMs=160}){
  Object.assign(this,{scope,storage,onChange,onInvalidated,waitMs,version:0,readVersion:0,connection:null,unsubscribe:null,discovery:null});
  this.state={status:'disconnected',kind:null,account:null,chainId:null,privateSession:false};
 }
 publish(update){this.state={...this.state,...update,privateSession:false};this.onChange(this.state,this.discovery)}
 release(){this.unsubscribe?.();this.unsubscribe=null;this.connection?.disconnect();this.connection=null}
 async scan(){const result=await discoverWalletProviders(this.scope,this.waitMs);this.discovery=result;this.onChange(this.state,result);return result}
 attach(candidate){
  const connection=new StandardWalletConnection({provider:candidate.provider,origin:this.scope.location.origin,metadata:{name:'YNX AI',url:this.scope.location.origin}});
  this.connection=connection;
  this.unsubscribe=connection.subscribe(({event})=>{
   if(this.revoking===connection)return;
   if(event==='disconnect'){this.disconnect('The wallet disconnected. Provider permissions have not been revoked by this page.');return}
   if(event==='accountsChanged'||event==='chainChanged'){
    this.onInvalidated();
    void this.refresh(connection,this.version);
   }
  });
  return connection;
 }
 candidate(kind){return this.discovery?.candidates.filter(item=>item.kind===kind)??[]}
 async connect(kind){
  if(!names[kind])throw new Error('Choose YNX Wallet or MetaMask.');
  const version=++this.version;
  this.release();this.onInvalidated();
  this.publish({status:'connecting',kind,account:null,chainId:null,message:'Review the account connection in '+names[kind]+'.'});
  try{
   await this.scan();if(version!==this.version)return;
   const candidates=this.candidate(kind);
   if(candidates.length!==1)throw new Error(candidates.length?'Multiple providers match this wallet. Resolve the ambiguity and retry.':'This wallet is not available. Open or install it, then refresh wallets.');
   const connection=this.attach(candidates[0]);
   const result=await connection.connect();if(version!==this.version)return;
   this.storage.setItem(choiceKey,kind);this.storage.removeItem(disconnectKey);
   this.publish({status:result.selectedChain==='0x1917'?'connected':'wrong-network',account:result.selectedAccount,chainId:result.selectedChain,message:'Standard wallet connection only. AI private access is separate.'});
  }catch(error){if(version===this.version){this.release();this.publish({status:'unavailable',account:null,chainId:null,message:error.code===4001?'Connection declined. You can choose either wallet and retry.':error.message})}}
 }
 async restore(){
  const version=++this.version;this.release();
  await this.scan();if(version!==this.version)return;
  const kind=this.storage.getItem(choiceKey);
  if(this.storage.getItem(disconnectKey)==='1'||!names[kind]){this.publish({status:'disconnected',kind:null,account:null,chainId:null});return}
  const candidates=this.candidate(kind);
  if(candidates.length!==1){this.publish({status:'unavailable',kind,account:null,chainId:null,message:'The previously selected wallet is unavailable or ambiguous. Choose a wallet explicitly.'});return}
  try{this.publish({kind,status:'checking',account:null,chainId:null});await this.refresh(this.attach(candidates[0]),version)}
  catch(error){if(version===this.version){this.release();this.publish({status:'unavailable',message:error.message})}}
 }
 async refresh(connection,version){
  const read=++this.readVersion;
  try{
   const restored=await connection.restore();
   if(version!==this.version||read!==this.readVersion)return;
   if(!restored){this.disconnect('Account access is unavailable. Choose a wallet explicitly to reconnect.');return}
   this.publish({status:restored.selectedChain==='0x1917'?'connected':'wrong-network',account:restored.selectedAccount,chainId:restored.selectedChain,message:'Existing account access read without requesting new permission. AI private access is separate.'});
  }catch(error){if(version===this.version&&read===this.readVersion){this.onInvalidated();this.publish({status:'unavailable',account:null,chainId:null,message:error.message})}}
 }
 async switchNetwork(){
  const connection=this.connection,version=this.version;if(!connection)return;
  try{await connection.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1917'}]});if(version===this.version)await this.refresh(connection,version)}
  catch(error){if(version===this.version)this.publish({message:error.code===4902?'Add YNX Testnet in your wallet, then retry the network switch.':error.code===4001?'Network switch declined. Your wallet choice has been kept.':error.message})}
 }
 async revoke(){
  const connection=this.connection;
  if(!connection||this.revoking)return;
  const version=++this.version;++this.readVersion;
  this.revoking=connection;this.onInvalidated();
  this.storage.setItem(disconnectKey,'1');
  this.publish({status:'revoking',account:null,chainId:null,message:'Review permission revocation in your selected wallet. AI private-session revocation is separate.'});
  try{
   const result=await connection.revoke();
   if(version!==this.version||connection!==this.connection)return;
   const messages={
    revoked:'The wallet acknowledged revocation and returned no permitted accounts.',
    unsupported:'This wallet does not support permission revocation. Remove this site in wallet settings.',
    rejected:'Permission revocation was declined. Remove this site in wallet settings or reconnect and retry.',
    failed:'Wallet permission revocation was not confirmed. Check this site in wallet settings.',
    superseded:'The wallet changed during revocation. No permission-revocation confirmation is claimed.',
   };
   this.release();
   const confirmed=result.status==='revoked'&&result.permissionRevoked===true;
   this.publish({status:confirmed?'permissions-revoked':'disconnected',account:null,chainId:null,message:(confirmed?messages.revoked:messages[result.status==='revoked'?'failed':result.status]||messages.failed)+' This page is disconnected; remote AI private sessions are not revoked by this action.'});
  }catch(error){
   if(version===this.version){this.release();this.publish({status:'disconnected',account:null,chainId:null,message:'Disconnected locally. Wallet permission revocation was not confirmed: '+error.message})}
  }finally{if(this.revoking===connection)this.revoking=null}
 }
 disconnect(message='Disconnected on this page. Wallet permissions and remote AI sessions are not revoked by this action.'){
  ++this.version;++this.readVersion;this.release();this.storage.setItem(disconnectKey,'1');this.onInvalidated();
  this.publish({status:'disconnected',account:null,chainId:null,message});
 }
 dispose(){++this.version;++this.readVersion;this.release()}
}
