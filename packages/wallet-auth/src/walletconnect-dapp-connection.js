import {WALLETCONNECT_CHAIN,WALLETCONNECT_SESSION_METHODS,WALLETCONNECT_SESSION_EVENTS,parseWalletConnectPairingUri} from './walletconnect-protocol.js';

export const YNX_PAIR_PROJECT_ID='41857128a14a593ca4e4a7cb7c838d71';
const ORIGINS=new Set(['https://finance.ynxweb4.com','https://exchange.ynxweb4.com','https://quant.ynxweb4.com','https://wallet-auth.ynxweb4.com','https://social.ynxweb4.com']);
const METHODS=new Set(['personal_sign','ynx_requestProductSessionV2','ynx_requestCentralBrowserSignIn']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const reason={code:6000,message:'User disconnected'};
// Preserve the historical SDK database and empty storage prefix. A module
// singleton prevents retries from constructing another SDK over that store.
// The locked SDK's global slot/count are additional fail-closed checks, never
// permission to close a Core supplied by another consumer or factory.
const clients=new Map(),records=new WeakMap();
async function officialClient(options,owner){
  let record=clients.get(options.storageOptions.database);
  if(!record){
    record={owners:new Set(),leases:new Set(),client:null,core:null,count:null,candidate:false,paused:false,promise:null};
    record.promise=(async()=>{
      const [{default:SignClient},{Core,RELAYER_EVENTS}]=await Promise.all([import('@walletconnect/sign-client'),import('@walletconnect/core')]);
      const before=globalThis._walletConnectCore_,count=globalThis._walletConnectCore__count;
      const core=new Core(options);record.core=core;record.count=globalThis._walletConnectCore__count;
      record.candidate=before===undefined&&(count===undefined||count===0)&&globalThis._walletConnectCore_===core&&record.count===1&&core.customStoragePrefix==='';
      const client=await SignClient.init({...options,core});record.client=client;records.set(client,record);
      core.relayer.on(RELAYER_EVENTS.connect,()=>{const flight=record.pauseFlight;if(record.paused&&flight&&exclusive(record,flight))void core.relayer.transportClose().catch(()=>{});});
      return client;
    })();
    clients.set(options.storageOptions.database,record);
    record.promise.catch(()=>{if(clients.get(options.storageOptions.database)===record)clients.delete(options.storageOptions.database);});
  }
  record.owners.add(owner);return record.promise;
}
function exclusive(record,flight){
  try{
    if(!record?.candidate||record.externallyExposed||record.owners.size!==1||record.leases.size!==1||!record.leases.has(flight)||!flight.idle()||globalThis._walletConnectCore_!==record.core||globalThis._walletConnectCore__count!==record.count)return false;
    const client=record.client;if(client.core!==record.core||client.session.getAll().length)return false;
    const proposals=client.proposal.getAll(),pairings=corePairings(client);
    // A proposal created by this sole controlled connect lease may exist
    // before connect returns its URI. Historical/extra proposals are shared.
    if(flight.historical||proposals.length>1||pairings.length>1)return false;
    if(proposals.length){const proposal=proposals[0];if(proposal.proposer?.metadata?.url!==flight.origin||pairings.some(pairing=>pairing.topic!==proposal.pairingTopic||pairing.active))return false;flight.topic=proposal.pairingTopic;}
    else if(pairings.some(pairing=>pairing.active||pairing.topic!==flight.topic))return false;
    return typeof record.core.relayer.transportClose==='function';
  }catch{return false;}
}
const corePairings=client=>client.core.pairing.pairings.getAll();

// Official SignClient owns its encrypted pairing/session persistence. Product
// consumers receive a selected EIP-1193-shaped transport, never topics or keys
// copied into another origin and never a product identity/session credential.
export class WalletConnectDAppConnection{
  #origin;#methods;#factory;#client=null;#initializing=null;#session=null;#pending=null;#epoch=0;#attempt=0;#listeners=new Map();#deadline;#now;#pairing=null;#flight=null;#draining=null;#restoring=0;
  constructor({origin,methods,clientFactory,deadlineMs=30000,now=()=>Date.now()}={}){
    if(!ORIGINS.has(origin)||!Array.isArray(methods)||!methods.length||new Set(methods).size!==methods.length||methods.some(method=>!METHODS.has(method)||!WALLETCONNECT_SESSION_METHODS.includes(method)||(origin==='https://social.ynxweb4.com'&&method!=='ynx_requestProductSessionV2')))fail('YNX_PAIR_CONFIGURATION_INVALID');
    if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>120000)fail('YNX_PAIR_CONFIGURATION_INVALID');
    this.#origin=origin;this.#methods=[...methods];this.#factory=clientFactory??(options=>officialClient(options,this));this.#deadline=deadlineMs;this.#now=now;
  }
  on(event,listener){if(!this.#listeners.has(event))this.#listeners.set(event,new Set());this.#listeners.get(event).add(listener);}
  removeListener(event,listener){this.#listeners.get(event)?.delete(listener);}
  #emit(event,value){for(const listener of this.#listeners.get(event)??[])listener(value);}
  #unconfirmed(reason,attempt){this.#emit('cancelUnconfirmed',{reason,attempt,current:attempt===this.#attempt});}
  async #wait(work,{stage='request',flight,deadline=this.#deadline}={}){let timer;const code=`YNX_PAIR_${stage.toUpperCase()}_TIMEOUT`;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(code),{code,stage})),deadline);}),...(flight?[flight.cancelled]:[])]);}finally{clearTimeout(timer);}}
  async initialize(flight){
    if(this.#client){if(!flight&&!this.#restoring){const record=records.get(this.#client);if(record)record.externallyExposed=true;}return this.#client;}
    // A caller deadline must not start a second Relay instance while the
    // original factory still owns the same SDK storage. Rejection is retryable.
    if(!this.#initializing){const task=Promise.resolve().then(()=>this.#factory({projectId:YNX_PAIR_PROJECT_ID,metadata:{name:'YNX browser connection',description:'Explicit YNX Wallet connection and separate request approval',url:this.#origin,icons:[]},logger:'silent',storageOptions:{database:`ynx-pair-${new URL(this.#origin).hostname}`}}));this.#initializing=task;task.catch(()=>{if(this.#initializing===task)this.#initializing=null;});}
    if(flight)this.#initializing.then(client=>{if(flight.terminated&&!this.#flight)void this.#pause(client,flight);},()=>{});
    const client=await this.#wait(this.#initializing,{stage:'initialization',flight});
    if(!flight&&!this.#restoring){const record=records.get(client);if(record)record.externallyExposed=true;}
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
    this.#restoring++;try{const epoch=this.#epoch,client=await this.initialize(),valid=[];
    if(epoch!==this.#epoch)fail('YNX_PAIR_CANCELLED');
    for(const session of client.session.getAll())try{valid.push(this.#validate(session));}catch{}
    // Multiple previously approved sessions require explicit user selection.
    if(valid.length>1)fail('YNX_PAIR_SESSION_SELECTION_REQUIRED');
    this.#session=valid[0]??null;return this.#session?this.provider():null;
    }finally{this.#restoring--;}
  }
  connect({onURI}={}){
    if(this.#pending)return this.#pending;
    if(this.#draining)return Promise.reject(Object.assign(new Error('YNX_PAIR_TRANSPORT_DRAINING'),{code:'YNX_PAIR_TRANSPORT_DRAINING',stage:'relay'}));
    const epoch=this.#epoch,attempt=++this.#attempt;
    const flight={attempt,origin:this.#origin,stage:'initialization',cancelled:null,cancel:null,terminated:false,idle:()=>this.#restoring===0&&(!this.#flight||this.#flight===flight)};flight.cancelled=new Promise((_,reject)=>{flight.cancel=()=>reject(Object.assign(new Error('YNX_PAIR_CANCELLED'),{code:'YNX_PAIR_CANCELLED',stage:flight.stage}));});flight.cancelled.catch(()=>{});this.#flight=flight;
    const stage=value=>{flight.stage=value;if(epoch===this.#epoch)this.#emit('stage',{stage:value,attempt});};
    const task=(async()=>{stage('initialization');const client=await this.initialize(flight);if(epoch!==this.#epoch)fail('YNX_PAIR_CANCELLED');
      if(this.#session){this.#validate(this.#session);return this.provider();}
      const record=records.get(client);if(record){if(record.pauseFlight)record.leases.delete(record.pauseFlight);record.paused=false;record.pauseFlight=null;record.leases.add(flight);flight.record=record;try{flight.historical=client.session.getAll().length>0||client.proposal.getAll().length>0||corePairings(client).length>0;}catch{flight.historical=true;}}
      stage('relay');const connecting=client.connect({requiredNamespaces:{eip155:{chains:[WALLETCONNECT_CHAIN],methods:this.#methods,events:[...WALLETCONNECT_SESSION_EVENTS]}}});
      const draining={work:connecting,flight};this.#draining=draining;
      connecting.then(()=>{if(this.#draining===draining)this.#draining=null;if(flight.terminated&&!record?.paused)record?.leases.delete(flight);},()=>{if(this.#draining===draining)this.#draining=null;if(flight.terminated&&!record?.paused)record?.leases.delete(flight);});
      connecting.then(connected=>{if(epoch===this.#epoch)return;try{const pairing=parseWalletConnectPairingUri(connected.uri,new Date(this.#now()));void this.#wait(client.core.pairing.disconnect({topic:pairing.topic}),{stage:'cleanup',deadline:Math.min(this.#deadline,1500)}).catch(()=>this.#unconfirmed('transport-unavailable',attempt));Promise.resolve(connected.approval()).then(session=>this.#retire(client,session,attempt),()=>{});}catch{this.#unconfirmed('transport-unavailable',attempt);}},()=>{});
      const {uri,approval}=await this.#wait(connecting,{stage:'relay',flight});
      const pairing=parseWalletConnectPairingUri(uri,new Date(this.#now()));
      if(epoch!==this.#epoch)fail('YNX_PAIR_CANCELLED');
      flight.topic=pairing.topic;this.#pairing={topic:pairing.topic,epoch,attempt};stage('approval');onURI?.(uri);
      const approving=approval();
      // A timed-out/cancelled proposal can still settle remotely. Never adopt
      // that late session; explicitly close it through the original SDK.
      approving.then(session=>{if(epoch!==this.#epoch)void this.#retire(client,session,attempt);},()=>{});
      const session=await this.#wait(approving,{stage:'approval',flight});
      if(epoch!==this.#epoch)fail('YNX_PAIR_CANCELLED');try{this.#validate(session);}catch(error){await this.#retire(client,session,attempt);throw error;}this.#session=session;this.#pairing=null;
      this.#emit('connect',{chainId:'0x1917'});return this.provider();
    })().catch(async error=>{flight.terminated=true;if(epoch===this.#epoch)this.#epoch++;await this.#cancelPairing(epoch);if(this.#client)await this.#pause(this.#client,flight);if(!String(error?.code??'').startsWith('YNX_PAIR_')){const code=[4001,5000,5001,5002,5003].includes(Number(error?.code))||error?.code==='USER_REJECTED'?'USER_REJECTED':`YNX_PAIR_${flight.stage.toUpperCase()}_UNAVAILABLE`;throw Object.assign(new Error(code),{code,stage:flight.stage});}throw error;}).finally(()=>{if(this.#pending===task)this.#pending=null;if(this.#flight===flight)this.#flight=null;if(this.#draining?.flight!==flight&&!flight.record?.paused)flight.record?.leases.delete(flight);});
    this.#pending=task;return task;
  }
  async #pause(client,flight){
    const record=records.get(client);if(record){flight.record??=record;if(!record.leases.size)record.leases.add(flight);}
    if(!exclusive(record,flight)){if(this.#draining?.flight!==flight)record?.leases.delete(flight);this.#emit('transportCleanup',{attempt:flight.attempt,current:flight.attempt===this.#attempt,status:'shared-preserved',inFlight:this.#draining?.flight===flight});return;}
    record.paused=true;record.pauseFlight=flight;
    try{await this.#wait(record.core.relayer.transportClose(),{stage:'cleanup',deadline:Math.min(this.#deadline,1500)});this.#emit('transportCleanup',{attempt:flight.attempt,current:flight.attempt===this.#attempt,status:'transport-paused',inFlight:this.#draining?.flight===flight});}
    catch{this.#unconfirmed('transport-unavailable',flight.attempt);}
  }
  async #cancelPairing(epoch){const pairing=this.#pairing;if(!pairing||epoch!==undefined&&pairing.epoch!==epoch)return;this.#pairing=null;if(this.#client)try{await this.#wait(this.#client.core.pairing.disconnect({topic:pairing.topic}),{stage:'cleanup',deadline:Math.min(this.#deadline,1500)});}catch{this.#unconfirmed('transport-unavailable',pairing.attempt);}}
  async #retire(client,session,attempt){if(!session||!/^[0-9a-f]{64}$/.test(session.topic)){this.#unconfirmed('invalid-session',attempt);return;}try{await this.#wait(client.disconnect({topic:session.topic,reason}),{stage:'cleanup',deadline:Math.min(this.#deadline,1500)});}catch{this.#unconfirmed('transport-unavailable',attempt);}}
  async cancel(){const epoch=this.#epoch++;this.#flight?.cancel();this.#pending=null;await this.#cancelPairing(epoch);}
  async disconnect(){this.#epoch++;const session=this.#session;this.#session=null;await this.#cancelPairing();if(session)await this.#wait(this.#client.disconnect({topic:session.topic,reason}));this.#emit('disconnect',{code:4900,message:'PAIR_EXPLICIT_DISCONNECT',reason:'permission-revoked'});}
  provider(){const owner=this;return {isYNXWallet:true,isMetaMask:false,isYNXPair:true,providerInfo:{rdns:'com.ynx.wallet.pair'},on:(event,listener)=>owner.on(event,listener),removeListener:(event,listener)=>owner.removeListener(event,listener),request:input=>owner.request(input)};}
  async request({method,params=[]}){
    const session=this.#validate(this.#session),epoch=this.#epoch,account=this.#accounts(session)[0];
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [account];if(method==='eth_chainId')return '0x1917';
    if(!this.#methods.includes(method)||!session.namespaces.eip155.methods.includes(method))fail('YNX_PAIR_METHOD_NOT_APPROVED');
    // SignClient 2.23.10 validates transport expiry in [300,604800] seconds.
    // This transport envelope does not extend the YNX signed challenge or
    // session lifetime: local bounded wait and the post-return epoch/session
    // validation below remain authoritative, as does Wallet/server expiry.
    const result=await this.#wait(this.#client.request({topic:session.topic,chainId:WALLETCONNECT_CHAIN,request:{method,params},expiry:300}));
    if(this.#epoch!==epoch||this.#session!==session)fail('YNX_PAIR_CONTEXT_CHANGED');this.#validate(session);return result;
  }
}
