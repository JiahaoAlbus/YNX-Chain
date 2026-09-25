import {createHostedWalletAdapter, type HostedWalletAdapter} from "../vendor/hosted-wallet-adapter-19d8a9a2.js";

const CHAIN_ID="0x1917";
const ACCOUNT=/^0x[0-9a-f]{40}$/i;
export type CardHostedState=Readonly<{status:"disconnected"|"connecting"|"connected"|"rejected"|"unavailable"|"wrong-chain";account:string|null;chainId:string|null;error:string|null}>;
export type CardHostedWalletController=Readonly<{connect:()=>Promise<CardHostedState>;switchAccount:()=>Promise<CardHostedState>;disconnect:()=>Promise<CardHostedState>;getState:()=>CardHostedState}>;
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
    const cancelled=new Promise<CardHostedState>(resolve=>{cancelPending=resolve;});
    const watchdog=setTimeout(()=>invalidate("HOSTED_REQUEST_EXPIRED_OR_RELOADED"),125_000);
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
    const work=Promise.race([outcome,cancelled]).finally(()=>{clearTimeout(watchdog);if(pending===work)pending=null;if(cancelPending)cancelPending=null;});
    pending=work;return work;
  };
  const disconnect=():Promise<CardHostedState>=>{
    generation++;detach();const next=publish("disconnected");cancel(next);return Promise.resolve(next);
  };
  const switchAccount=():Promise<CardHostedState>=>{
    generation++;detach();cancel(publish("disconnected"));
    return connect(); // Opens the new official popup in the same click stack.
  };
  return Object.freeze({connect,switchAccount,disconnect,getState:()=>state});
}
