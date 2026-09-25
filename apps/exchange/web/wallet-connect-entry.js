import {StandardWalletConnection,discoverWalletProviders,WALLET_PROVIDER_KIND} from './vendor/standard-wallet-browser-c97f85e9.mjs';
import {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_CHAIN_ID,STANDARD_WALLET_RPC_PROBE_TRANSPORT} from './node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js';
import {METAMASK_EVM_CHAIN} from '../../../packages/wallet-auth/src/metamask-evm-adapter.js';
import {createHostedWalletAdapter} from './vendor/hosted-wallet-adapter-19d8a9a2.js';

export const SDK_SOURCE='c97f85e9ae4d4580b99860c51738e6040ca9ca18';
export const PROVIDER_PREFERENCE_KEY='ynx.exchange.standard-provider.v1';
const downloads=Object.freeze({ynxWallet:'https://www.ynxweb4.com/dapp/download',metaMask:'https://metamask.io/download/'});
const validKind=kind=>Object.values(WALLET_PROVIDER_KIND).includes(kind);
const errorCode=error=>({4001:'USER_REJECTED',4100:'WALLET_NOT_AUTHORIZED',4200:'METHOD_UNSUPPORTED',4900:'PROVIDER_UNAVAILABLE',4901:'WRONG_NETWORK',4902:'WRONG_NETWORK'})[error?.code]||'WALLET_CONNECT_FAILED';

// Product presentation/origin/chain adapter. Discovery, account validation,
// event fences, silent restore and revocation belong to the exact shared SDK.
export function createExchangeWallet({scope=globalThis,onState=()=>{},createHostedAdapter=createHostedWalletAdapter}={}) {
  let state=createStandardWalletConnectState(),connection=null,unsubscribe=null,selectedKind=null,transport=null,hosted=null,hostedListeners=[],generation=0,inFlight=null;
  const transition=event=>{state=reduceStandardWalletConnectState(state,event);onState(Object.freeze({...state,transport}));return state};
  const result=(status=state.status,detail)=>Object.freeze({status,detail,account:state.account,chainId:state.chainId,providerKind:state.providerKind,transport,connectionState:state,downloads});
  const remember=kind=>{try{if(kind)scope.localStorage?.setItem(PROVIDER_PREFERENCE_KEY,kind);else scope.localStorage?.removeItem(PROVIDER_PREFERENCE_KEY)}catch{}};
  const remembered=()=>{try{const kind=scope.localStorage?.getItem(PROVIDER_PREFERENCE_KEY);return validKind(kind)?kind:null}catch{return null}};
  const detach=()=>{unsubscribe?.();unsubscribe=null;connection?.disconnect();connection=null;selectedKind=null};
  const detachHosted=()=>{const previous=hosted;for(const [event,listener] of hostedListeners)previous?.removeListener(event,listener);hostedListeners=[];hosted=null;try{Promise.resolve(previous?.disconnect()).catch(()=>{})}catch{}};
  const assertCurrent=token=>{if(token!==generation)throw Object.assign(new Error('Wallet operation was superseded.'),{code:4100})};
  const publish=()=>{
    const session=connection?.current;
    if(!session){transition({type:'PROVIDER_DISCONNECT'});return result('not-restored')}
    transition({type:'RESTORE',providerKind:selectedKind,accounts:[session.selectedAccount],chainId:session.selectedChain});
    return result(state.status==='connected'?'standard-connected':'wrong-chain');
  };
  async function select(kind,token){
    if(!validKind(kind))throw new TypeError('Select YNX Wallet or MetaMask.');
    const discovery=await discoverWalletProviders(scope,160);assertCurrent(token);
    const candidate=kind===WALLET_PROVIDER_KIND.METAMASK?discovery.metamask:discovery.ynx;
    if(!candidate)return result('unsupported',discovery.ambiguities.includes(kind)?'PROVIDER_DISCOVERY_AMBIGUOUS':kind===WALLET_PROVIDER_KIND.METAMASK?'METAMASK_NOT_INJECTED':'YNX_WALLET_NOT_INJECTED');
    detachHosted();detach();transport='injected';selectedKind=kind;
    const origin=scope.location?.origin;
    connection=new StandardWalletConnection({provider:candidate.provider,origin,metadata:{name:'YNX Exchange',url:origin}});
    unsubscribe=connection.subscribe(()=>publish());return null;
  }
  function connect(kind=WALLET_PROVIDER_KIND.YNX){
    if(inFlight?.kind===kind)return inFlight.promise;
    const operation={kind,promise:null};operation.promise=performConnect(kind).finally(()=>{if(inFlight===operation)inFlight=null});inFlight=operation;return operation.promise;
  }
  // Explicit Hosted choice is a distinct Wallet-owned standard connection.
  // The adapter opens its approval UI synchronously inside this click; never
  // await provider discovery or an RPC probe before opening the popup.
  function connectHosted(){
    if(inFlight?.kind==='hosted')return inFlight.promise;
    const token=++generation;detach();detachHosted();remember(null);transport='hosted-wallet-web';selectedKind=WALLET_PROVIDER_KIND.YNX;
    transition({type:'BEGIN',pendingIntent:(scope.crypto??globalThis.crypto).randomUUID().replaceAll('-','')});
    transition({type:'PROVIDER_SELECTED',providerKind:WALLET_PROVIDER_KIND.YNX});
    let selected,pending;
    try{
      selected=createHostedAdapter({window:scope});hosted=selected;
      const abortPending=()=>{if(token!==generation||selected!==hosted||state.status==='connected')return;generation++;inFlight=null;detachHosted();transition({type:'DISCONNECT'})};
      const accountsChanged=accounts=>{
        if(token!==generation||selected!==hosted)return;
        if(state.status!=='connected'){if(!Array.isArray(accounts)||accounts.length===0)abortPending();return;}
        if(!Array.isArray(accounts)||accounts.length!==1||accounts[0]?.toLowerCase()!==state.account)disconnect();
      };
      const chainChanged=chain=>{if(token===generation&&selected===hosted&&chain!==STANDARD_WALLET_CHAIN_ID){if(state.status==='connected')disconnect();else abortPending()}};
      const disconnected=()=>{if(token===generation&&selected===hosted){if(state.status==='connected')disconnect();else abortPending()}};
      hostedListeners=[['accountsChanged',accountsChanged],['chainChanged',chainChanged],['disconnect',disconnected]];
      for(const [event,listener] of hostedListeners)selected.on(event,listener);
      pending=selected.connect();
    }catch(error){detachHosted();transition({type:'FAIL',code:'HOSTED_WALLET_UNAVAILABLE'});return Promise.resolve(result('unsupported',error?.code||'HOSTED_WALLET_UNAVAILABLE'))}
    const operation={kind:'hosted',promise:null};
    operation.promise=Promise.resolve(pending).then(async accounts=>{
      assertCurrent(token);
      if(!Array.isArray(accounts)||accounts.length!==1||!/^0x[0-9a-f]{40}$/u.test(accounts[0]))throw Object.assign(new Error('Invalid Hosted account'),{code:'HOSTED_ACCOUNT_INVALID'});
      const chain=await selected.request({method:'eth_chainId'});assertCurrent(token);
      if(selected.connected!==true||selected.account!==accounts[0])throw Object.assign(new Error('Hosted approval was no longer active'),{code:'HOSTED_APPROVAL_LOST'});
      transition({type:'ACCOUNT_APPROVED',account:accounts[0]});
      transition({type:'CHAIN_CONFIRMED',chainId:chain});
      if(state.status!=='connected')return result('wrong-chain');
      return result('standard-connected');
    }).catch(error=>{if(token!==generation)return result('superseded');detachHosted();transition({type:'FAIL',code:typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{2,63}$/u.test(error.code)?error.code:'HOSTED_CONNECT_FAILED'});return result('unsupported',error?.code||'HOSTED_CONNECT_FAILED')}).finally(()=>{if(inFlight===operation)inFlight=null});
    inFlight=operation;return operation.promise;
  }
  async function performConnect(kind){
    if(state.status==='connected'&&kind===selectedKind&&transport==='injected')return result('standard-connected');
    const token=++generation;
    try{
      const missing=await select(kind,token);if(missing)return missing;
      transition({type:'BEGIN',pendingIntent:crypto.randomUUID().replaceAll('-','')});transition({type:'PROVIDER_SELECTED',providerKind:kind});
      const current=connection;
      try{await current.request({method:'wallet_switchEthereumChain',params:[{chainId:STANDARD_WALLET_CHAIN_ID}]})}catch(error){
        assertCurrent(token);if(error.code!==4902)throw error;
        await current.request({method:'wallet_addEthereumChain',params:[METAMASK_EVM_CHAIN]});
        assertCurrent(token);await current.request({method:'wallet_switchEthereumChain',params:[{chainId:STANDARD_WALLET_CHAIN_ID}]});
      }
      assertCurrent(token);const chain=await current.request({method:'eth_chainId'});assertCurrent(token);
      if(chain!==STANDARD_WALLET_CHAIN_ID){transition({type:'FAIL',code:'WRONG_NETWORK'});return result('wrong-chain')}
      await current.connect();assertCurrent(token);const outcome=publish();if(outcome.status==='standard-connected')remember(kind);return outcome;
    }catch(error){if(token===generation)transition({type:'FAIL',code:errorCode(error)});throw error}
  }
  async function restore(){
    const kind=remembered();if(!kind)return result('not-restored');
    const token=++generation;
    try{const missing=await select(kind,token);if(missing)return missing;await connection.restore();assertCurrent(token);return publish()}
    catch(error){if(token===generation)transition({type:'FAIL',code:errorCode(error)});return result('not-restored',errorCode(error))}
  }
  function disconnect(){++generation;inFlight=null;remember(null);detach();detachHosted();transport=null;return transition({type:'DISCONNECT'})}
  async function revoke(){
    if(transport==='hosted-wallet-web')return Object.freeze({status:'unsupported',permissionRevoked:false,locallyDisconnected:false});
    if(!connection)return Object.freeze({status:'not-connected',permissionRevoked:false,locallyDisconnected:true});
    const token=generation,outcome=await connection.revoke();
    if(token!==generation)return Object.freeze({...outcome,status:'superseded',permissionRevoked:false});
    if(outcome.permissionRevoked)disconnect();return outcome;
  }
  function reportAcceptedRpcProbe(status,code){return transition({type:status==='ready'?'RPC_PROBE_READY':'RPC_PROBE_DEGRADED',probeTransport:STANDARD_WALLET_RPC_PROBE_TRANSPORT,...(status==='ready'?{}:{code:errorCode({code})})})}
  return Object.freeze({connect,connectYNX:()=>connect(WALLET_PROVIDER_KIND.YNX),connectHosted,connectMetaMask:()=>connect(WALLET_PROVIDER_KIND.METAMASK),restore,disconnect,revoke,reportAcceptedRpcProbe,state:()=>state,downloads});
}
if(typeof window!=='undefined')window.YNXExchangeWebWallet=createExchangeWallet({scope:window,onState:detail=>window.dispatchEvent(new CustomEvent('ynx-exchange-standard-wallet-state',{detail}))});
