import {WALLETCONNECT_CHAIN,WALLETCONNECT_SESSION_METHODS,WALLETCONNECT_SESSION_EVENTS,parseWalletConnectPairingUri} from './walletconnect-protocol.js';

export const YNX_PAIR_PROJECT_ID='41857128a14a593ca4e4a7cb7c838d71';
const ORIGINS=new Set(['https://finance.ynxweb4.com','https://exchange.ynxweb4.com','https://quant.ynxweb4.com','https://wallet-auth.ynxweb4.com']);
const METHODS=new Set(['personal_sign','ynx_requestProductSessionV2','ynx_requestCentralBrowserSignIn']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const reason={code:6000,message:'User disconnected'};

// Official SignClient owns its encrypted pairing/session persistence. Product
// consumers receive a selected EIP-1193-shaped transport, never topics or keys
// copied into another origin and never a product identity/session credential.
export class WalletConnectDAppConnection{
  #origin;#methods;#factory;#client=null;#initializing=null;#session=null;#pending=null;#epoch=0;#listeners=new Map();#deadline;#now;#pairing=null;
  constructor({origin,methods,clientFactory,deadlineMs=30000,now=()=>Date.now()}={}){
    if(!ORIGINS.has(origin)||!Array.isArray(methods)||!methods.length||new Set(methods).size!==methods.length||methods.some(method=>!METHODS.has(method)||!WALLETCONNECT_SESSION_METHODS.includes(method)))fail('YNX_PAIR_CONFIGURATION_INVALID');
    if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>120000)fail('YNX_PAIR_CONFIGURATION_INVALID');
    this.#origin=origin;this.#methods=[...methods];this.#factory=clientFactory??(async options=>{const {default:SignClient}=await import('@walletconnect/sign-client');return SignClient.init(options);});this.#deadline=deadlineMs;this.#now=now;
  }
  on(event,listener){if(!this.#listeners.has(event))this.#listeners.set(event,new Set());this.#listeners.get(event).add(listener);}
  removeListener(event,listener){this.#listeners.get(event)?.delete(listener);}
  #emit(event,value){for(const listener of this.#listeners.get(event)??[])listener(value);}
  async #wait(work){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('YNX_PAIR_TIMEOUT'),{code:'YNX_PAIR_TIMEOUT'})),this.#deadline);})]);}finally{clearTimeout(timer);}}
  async initialize(){
    if(this.#client)return this.#client;
    // A caller deadline must not start a second Relay instance while the
    // original factory still owns the same SDK storage. Rejection is retryable.
    if(!this.#initializing){const task=Promise.resolve().then(()=>this.#factory({projectId:YNX_PAIR_PROJECT_ID,metadata:{name:'YNX browser connection',description:'Explicit YNX Wallet connection and separate request approval',url:this.#origin,icons:[]},logger:'silent',storageOptions:{database:`ynx-pair-${new URL(this.#origin).hostname}`}}));this.#initializing=task;task.catch(()=>{if(this.#initializing===task)this.#initializing=null;});}
    const client=await this.#wait(this.#initializing);
    if(this.#client)return this.#client;this.#client=client;
    const ended=({topic})=>{if(this.#session?.topic!==topic)return;this.#session=null;this.#epoch++;this.#emit('disconnect',{code:4900,message:'PAIR_SESSION_ENDED',reason:'permission-revoked'});};
    client.on('session_delete',ended);client.on('session_expire',ended);
    client.on('session_update',({topic,params})=>{if(this.#session?.topic!==topic)return;const next={...this.#session,namespaces:params.namespaces};try{this.#validate(next);this.#session=next;this.#epoch++;this.#emit('accountsChanged',this.#accounts(next));}catch{ended({topic});}});
    client.on('session_event',({topic,params})=>{if(this.#session?.topic!==topic)return;const event=params?.event;if(!event||!WALLETCONNECT_SESSION_EVENTS.includes(event.name))return;this.#epoch++;
      const account=this.#accounts(this.#session)[0];
      if(event.name==='chainChanged'){const sameChain=['0x1917',6423,'6423'].includes(event.data);if(!sameChain)this.#session=null;this.#emit('chainChanged',sameChain?'0x1917':event.data);}
      else{if(!Array.isArray(event.data)||event.data.length!==1||String(event.data[0]).toLowerCase()!==account.toLowerCase())this.#session=null;this.#emit('accountsChanged',event.data);}
    });
    return client;
  }
  #accounts(session){return session.namespaces.eip155.accounts.map(value=>value.split(':')[2]);}
  #validate(session){
    if(!session||!/^[0-9a-f]{64}$/.test(session.topic)||!Number.isSafeInteger(session.expiry)||session.expiry*1000<=this.#now())fail('YNX_PAIR_SESSION_EXPIRED');
    const peer=session.peer?.metadata?.url;let url;try{url=new URL(peer);}catch{fail('YNX_PAIR_PEER_INVALID');}
    if(url.origin!=='https://wallet.ynxweb4.com'||url.username||url.password)fail('YNX_PAIR_PEER_INVALID');
    const namespaces=session.namespaces;if(!namespaces||Object.keys(namespaces).join(',')!=='eip155')fail('YNX_PAIR_NAMESPACE_INVALID');
    const value=namespaces.eip155;
    if(!Array.isArray(value.accounts)||value.accounts.length!==1||!/^eip155:6423:0x[0-9a-fA-F]{40}$/.test(value.accounts[0])||!Array.isArray(value.methods)||this.#methods.some(method=>!value.methods.includes(method))||value.methods.some(method=>!WALLETCONNECT_SESSION_METHODS.includes(method)))fail('YNX_PAIR_NAMESPACE_INVALID');
    if(value.chains&&(!Array.isArray(value.chains)||value.chains.length!==1||value.chains[0]!==WALLETCONNECT_CHAIN))fail('YNX_PAIR_CHAIN_INVALID');
    return session;
  }
  async restore(){
    const epoch=this.#epoch,client=await this.initialize(),valid=[];
    if(epoch!==this.#epoch)fail('YNX_PAIR_CANCELLED');
    for(const session of client.session.getAll())try{valid.push(this.#validate(session));}catch{}
    // Multiple previously approved sessions require explicit user selection.
    if(valid.length>1)fail('YNX_PAIR_SESSION_SELECTION_REQUIRED');
    this.#session=valid[0]??null;return this.#session?this.provider():null;
  }
  connect({onURI}={}){
    if(this.#pending)return this.#pending;
    const epoch=this.#epoch;
    const task=(async()=>{const client=await this.initialize();if(epoch!==this.#epoch)fail('YNX_PAIR_CANCELLED');
      if(this.#session){this.#validate(this.#session);return this.provider();}
      const connecting=client.connect({requiredNamespaces:{eip155:{chains:[WALLETCONNECT_CHAIN],methods:this.#methods,events:[...WALLETCONNECT_SESSION_EVENTS]}}});
      connecting.then(connected=>{if(epoch===this.#epoch)return;try{const pairing=parseWalletConnectPairingUri(connected.uri,new Date(this.#now()));void this.#wait(client.core.pairing.disconnect({topic:pairing.topic})).catch(()=>this.#emit('cancelUnconfirmed',{reason:'transport-unavailable'}));Promise.resolve(connected.approval()).then(session=>this.#retire(client,session),()=>{});}catch{this.#emit('cancelUnconfirmed',{reason:'transport-unavailable'});}},()=>{});
      const {uri,approval}=await this.#wait(connecting);
      const pairing=parseWalletConnectPairingUri(uri,new Date(this.#now()));
      this.#pairing={topic:pairing.topic,epoch};
      if(epoch!==this.#epoch)fail('YNX_PAIR_CANCELLED');onURI?.(uri);
      const approving=approval();
      // A timed-out/cancelled proposal can still settle remotely. Never adopt
      // that late session; explicitly close it through the original SDK.
      approving.then(session=>{if(epoch!==this.#epoch)void this.#retire(client,session);},()=>{});
      const session=await this.#wait(approving);
      if(epoch!==this.#epoch)fail('YNX_PAIR_CANCELLED');try{this.#validate(session);}catch(error){await this.#retire(client,session);throw error;}this.#session=session;this.#pairing=null;
      this.#emit('connect',{chainId:'0x1917'});return this.provider();
    })().catch(async error=>{if(epoch===this.#epoch)this.#epoch++;await this.#cancelPairing(epoch);throw error;}).finally(()=>{if(this.#pending===task)this.#pending=null;});
    this.#pending=task;return task;
  }
  async #cancelPairing(epoch){const pairing=this.#pairing;if(!pairing||epoch!==undefined&&pairing.epoch!==epoch)return;this.#pairing=null;if(this.#client)try{await this.#wait(this.#client.core.pairing.disconnect({topic:pairing.topic}));}catch{this.#emit('cancelUnconfirmed',{reason:'transport-unavailable'});}}
  async #retire(client,session){if(!session||!/^[0-9a-f]{64}$/.test(session.topic)){this.#emit('cancelUnconfirmed',{reason:'invalid-session'});return;}try{await this.#wait(client.disconnect({topic:session.topic,reason}));}catch{this.#emit('cancelUnconfirmed',{reason:'transport-unavailable'});}}
  async cancel(){const epoch=this.#epoch++;this.#pending=null;await this.#cancelPairing(epoch);}
  async disconnect(){this.#epoch++;const session=this.#session;this.#session=null;await this.#cancelPairing();if(session)await this.#wait(this.#client.disconnect({topic:session.topic,reason}));this.#emit('disconnect',{code:4900,message:'PAIR_EXPLICIT_DISCONNECT',reason:'permission-revoked'});}
  provider(){const owner=this;return {isYNXWallet:true,isMetaMask:false,isYNXPair:true,providerInfo:{rdns:'com.ynx.wallet.pair'},on:(event,listener)=>owner.on(event,listener),removeListener:(event,listener)=>owner.removeListener(event,listener),request:input=>owner.request(input)};}
  async request({method,params=[]}){
    const session=this.#validate(this.#session),epoch=this.#epoch,account=this.#accounts(session)[0];
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [account];if(method==='eth_chainId')return '0x1917';
    if(!this.#methods.includes(method)||!session.namespaces.eip155.methods.includes(method))fail('YNX_PAIR_METHOD_NOT_APPROVED');
    const result=await this.#wait(this.#client.request({topic:session.topic,chainId:WALLETCONNECT_CHAIN,request:{method,params},expiry:Math.max(1,Math.min(30,session.expiry-Math.floor(this.#now()/1000)))}));
    if(this.#epoch!==epoch||this.#session!==session)fail('YNX_PAIR_CONTEXT_CHANGED');this.#validate(session);return result;
  }
}
