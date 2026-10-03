import type {HostedWalletAdapter as LegacyHostedWalletAdapter} from '../vendor/hosted-wallet-adapter-19d8a9a2.js';
type HostedWalletAdapter=Omit<LegacyHostedWalletAdapter,'revoke'> & {revoke():Promise<unknown>};
import {createHostedWalletAdapter,HOSTED_CARD_APPROVAL_METHOD,type HostedWalletAdapter as CardRPCAdapter} from '../vendor/hosted-wallet-adapter-card-9555.js';
import type {HostedCardApprovalReservation} from './hostedCardApproval';

const CHAIN_ID="0x1917";
const ACCOUNT=/^0x[0-9a-f]{40}$/i;
export type CardHostedState=Readonly<{status:"disconnected"|"connecting"|"connected"|"rejected"|"unavailable"|"wrong-chain";account:string|null;chainId:string|null;error:string|null}>;
export type CardHostedWalletController=(Readonly<{connect:()=>Promise<CardHostedState>;switchAccount:()=>Promise<CardHostedState>;disconnect:()=>Promise<CardHostedState>;getState:()=>CardHostedState;requestProductSessionV2:(authorizeURL:string)=>Promise<unknown>}>) & {reserveCardApplicationApproval():Promise<HostedCardApprovalReservation>};
type AdapterFactory=(input:{window:Window})=>HostedWalletAdapter;

function codeOf(error:unknown):string {
  if(error&&typeof error==="object"&&"code" in error){const code=(error as {code:unknown}).code;if(code===4001)return "USER_REJECTED";if(typeof code==="string"&&/^[A-Z][A-Z0-9_]{2,80}$/.test(code))return code;}
  return "HOSTED_CONNECTION_FAILED";
}

// Only the Wallet-owned adapter opens the popup or forwards signer requests.
// This Card controller admits an account solely after approval plus chain readback.
export function createCardHostedWalletController(input:{window:Window;onState?:(state:CardHostedState)=>void;adapterFactory?:AdapterFactory}):CardHostedWalletController {
  const factory=input.adapterFactory??createHostedWalletAdapter;
  let adapter:HostedWalletAdapter|null=null, generation=0, pending:Promise<CardHostedState>|null=null;
  let cancelPending:((state:CardHostedState)=>void)|null=null;
  let listeners:readonly [string,(...args:readonly unknown[])=>void][]=[];
  let state:CardHostedState=Object.freeze({status:"disconnected",account:null,chainId:null,error:null});
  const publish=(status:CardHostedState["status"],account:string|null=null,chainId:string|null=null,error:string|null=null):CardHostedState=>{
    state=Object.freeze({status,account,chainId,error});input.onState?.(state);return state;
  };
  const detach=(close=true)=>{
    const previous=adapter;for(const [event,listener] of listeners)previous?.removeListener(event,listener);
    listeners=[];adapter=null;
    if(previous&&close){try{void Promise.resolve(previous.disconnect()).catch(()=>{}).then(()=>previous.detach?.()).catch(()=>{});}catch{void previous.detach?.().catch(()=>{});}}
  };
  const cancel=(next:CardHostedState)=>{const finish=cancelPending;cancelPending=null;pending=null;finish?.(next);};
  const invalidate=(error:string)=>{
    generation++;detach();const next=publish(error==="WRONG_NETWORK"?"wrong-chain":"disconnected",null,null,error);cancel(next);
  };
  const subscribe=(selected:HostedWalletAdapter,token:number,announced:{account:string|null;interrupted:boolean})=>{
    const accountsChanged=(value:unknown)=>{
      if(token!==generation||adapter!==selected)return;
      const accounts=Array.isArray(value)?value:[];
      if(accounts.length!==1||typeof accounts[0]!=="string"||!ACCOUNT.test(accounts[0])){if(state.status==="connecting")announced.interrupted=true;else invalidate("HOSTED_ACCOUNT_CHANGED");return;}
      const account=accounts[0].toLowerCase();
      if(state.status==="connecting")announced.account=account;
      else if(state.status==="connected"&&state.account!==account)invalidate("HOSTED_ACCOUNT_CHANGED");
    };
    const chainChanged=(value:unknown)=>{if(token===generation&&adapter===selected&&value!==CHAIN_ID)invalidate("WRONG_NETWORK");};
    const disconnected=()=>{if(token===generation&&adapter===selected){if(state.status==="connecting")announced.interrupted=true;else invalidate("HOSTED_DISCONNECTED");}};
    listeners=[["accountsChanged",accountsChanged],["chainChanged",chainChanged],["disconnect",disconnected]];
    for(const [event,listener] of listeners)selected.on(event,listener);
  };
  const connect=():Promise<CardHostedState>=>{
    if(pending)return pending;
    const token=++generation;detach();publish("connecting");
    const announced={account:null as string|null,interrupted:false};let selected:HostedWalletAdapter,approval:Promise<readonly string[]>;
    try{
      selected=factory({window:input.window});adapter=selected;subscribe(selected,token,announced);
      // No awaited discovery or state preflight may precede this call.
      approval=selected.connect();
    }catch(error){detach();return Promise.resolve(publish("unavailable",null,null,codeOf(error)));}
    let finishPending!:(state:CardHostedState)=>void;
    const cancelled=new Promise<CardHostedState>(resolve=>{finishPending=resolve;cancelPending=resolve;});
    const watchdog=setTimeout(()=>{if(token===generation&&adapter===selected)invalidate("HOSTED_REQUEST_EXPIRED_OR_RELOADED");},125_000);
    const outcome=Promise.resolve(approval).then(async accounts=>{
      if(token!==generation||adapter!==selected)return state;
      if(announced.interrupted)throw Object.assign(new Error("HOSTED_CONNECTION_INTERRUPTED"),{code:"HOSTED_CONNECTION_INTERRUPTED"});
      const account=Array.isArray(accounts)&&accounts.length===1&&typeof accounts[0]==="string"?accounts[0].toLowerCase():null;
      if(!account||!ACCOUNT.test(account)||announced.account&&announced.account!==account)throw Object.assign(new Error("HOSTED_ACCOUNT_INVALID"),{code:"HOSTED_ACCOUNT_INVALID"});
      const chainId=await selected.request({method:"eth_chainId"});
      if(token!==generation||adapter!==selected)return state;
      if(chainId!==CHAIN_ID)throw Object.assign(new Error("WRONG_NETWORK"),{code:"WRONG_NETWORK"});
      return publish("connected",account,CHAIN_ID);
    }).catch(error=>{
      if(token!==generation||adapter!==selected)return state;
      const code=codeOf(error);detach();return publish(code==="USER_REJECTED"?"rejected":code==="WRONG_NETWORK"?"wrong-chain":"unavailable",null,null,code);
    });
    const work=Promise.race([outcome,cancelled]).finally(()=>{clearTimeout(watchdog);if(pending===work)pending=null;if(cancelPending===finishPending)cancelPending=null;});
    pending=work;return work;
  };
  const disconnect=():Promise<CardHostedState>=>{
    generation++;detach();const next=publish("disconnected");cancel(next);return Promise.resolve(next);
  };
  const switchAccount=():Promise<CardHostedState>=>{
    generation++;detach();cancel(publish("disconnected"));
    return connect(); // Opens the new official popup in the same click stack.
  };
  const requestProductSessionV2=async(authorizeURL:string):Promise<unknown>=>{
    const selected=adapter,token=generation,account=state.account;
    if(!selected||state.status!=="connected"||!account||state.chainId!==CHAIN_ID)throw Object.assign(Error("CARD_WEB_PRIVATE_TRANSPORT_UNAVAILABLE"),{code:"CARD_WEB_PRIVATE_TRANSPORT_UNAVAILABLE"});
    let route:URL;try{route=new URL(authorizeURL)}catch{throw Object.assign(Error("CARD_WALLET_ROUTE_INVALID"),{code:"CARD_WALLET_ROUTE_INVALID"})}
    if(authorizeURL.length>16384||route.protocol!=="ynxwallet:"||route.hostname!=="authorize"||route.username||route.password||route.hash||route.searchParams.size!==1||route.searchParams.getAll("request").length!==1||!route.searchParams.get("request"))throw Object.assign(Error("CARD_WALLET_ROUTE_INVALID"),{code:"CARD_WALLET_ROUTE_INVALID"});
    // This is the existing Wallet-owned private method, never a browser navigation.
    const result=await selected.request({method:"ynx_requestProductSessionV2",params:[authorizeURL]});
    if(token!==generation||adapter!==selected||state.status!=="connected"||state.account!==account||state.chainId!==CHAIN_ID)throw Object.assign(Error("CARD_WEB_PRIVATE_CONTEXT_CHANGED"),{code:"CARD_WEB_PRIVATE_CONTEXT_CHANGED"});
    return result;
  };
  return Object.freeze({
    reserveCardApplicationApproval():Promise<HostedCardApprovalReservation>{
      const selected=adapter as CardRPCAdapter|null,epoch=generation;
      if(!selected?.connected||!selected.account||selected.supportsCardApplicationApproval!==true)throw Error('CARD_WEB_APPLICATION_APPROVAL_TRANSPORT_UNAVAILABLE');
      const account=selected.account;
      const assertCurrent=()=>{if(adapter!==selected||generation!==epoch||!selected.connected||selected.account!==account||selected.supportsCardApplicationApproval!==true||selected.selection?.chainId!=='0x1917')throw Error('CARD_HOSTED_APPROVAL_CONTEXT_CHANGED')};
      // This call is synchronous in the user's gesture, before challenge I/O.
      const reservation=selected.reserve();
      return reservation.then(()=>{assertCurrent();return Object.freeze({account,assertCurrent,request:async(url:string)=>{
        assertCurrent();const parsed=new URL(url);
        if(url.length>24000||parsed.protocol!=='ynxwallet:'||parsed.hostname!=='card-application-approval'||parsed.pathname||parsed.username||parsed.password||parsed.hash||parsed.searchParams.getAll('request').length!==1||!parsed.searchParams.get('request')||Array.from(parsed.searchParams.keys()).some(key=>key!=='request'))throw Error('CARD_APPLICATION_APPROVAL_REQUEST_INVALID');
        const result=await selected.request({method:HOSTED_CARD_APPROVAL_METHOD,params:[url]});assertCurrent();return result;
      }})});
    },connect,switchAccount,disconnect,getState:()=>state,requestProductSessionV2});
}
