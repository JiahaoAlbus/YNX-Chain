import {runCurrentContactAction} from './contactActionGuard';
export type NativeMomentReaction='like'|'love'|'insight'|'support';
export type NativeMomentAction=
 |{kind:'follow';subject:string;active:boolean}
 |{kind:'reaction';subject:string;reaction:NativeMomentReaction;active:boolean}
 |{kind:'delete';subject:string};
type Intent={action:NativeMomentAction;idempotencyKey:string};
function snapshot(value:NativeMomentAction):NativeMomentAction{
 if(!value||typeof value.subject!=='string'||!value.subject||value.subject.length>256)throw new Error('Original moment action requires review');
 if(value.kind==='delete')return {kind:value.kind,subject:value.subject};
 if(typeof value.active!=='boolean')throw new Error('Original moment action requires review');
 if(value.kind==='follow')return {kind:value.kind,subject:value.subject,active:value.active};
 if(value.kind==='reaction'&&['like','love','insight','support'].includes(value.reaction))return {kind:value.kind,subject:value.subject,reaction:value.reaction,active:value.active};
 throw new Error('Original moment action requires review');
}
// Same-window recovery only. This ledger is not a server receipt or durable
// native restart carrier. Following has no contact-request/acceptance behavior.
export class NativeMomentActions{
 private intents=new Map<string,Intent>();private busy=new Set<string>();
 constructor(private nonce:()=>Promise<string>){}
 async run(account:string,input:NativeMomentAction,current:()=>boolean,send:(action:NativeMomentAction,key:string)=>Promise<unknown>,timeoutMs=30000):Promise<boolean>{
  if(!/^ynx1[0-9a-z]{38}$/.test(account))throw new Error('Original Social account is required');
  const action=snapshot(input),slot=JSON.stringify([account,action.kind,action.subject]);
  if(this.busy.has(slot))throw new Error('This original moment action is already pending');
  this.busy.add(slot);
  try{return await runCurrentContactAction(current,async signal=>{
   const active=()=>current()&&!signal.aborted;
   let intent=this.intents.get(slot);
   if(intent&&JSON.stringify(intent.action)!==JSON.stringify(action))throw new Error('Retry the original pending action before changing it');
   if(!intent){const nonce=await this.nonce();if(!active())throw new Error('Original action was cancelled before sending');if(!/^[a-f0-9]{32}$/.test(nonce))throw new Error('Original action identity is unavailable');intent={action,idempotencyKey:`native-${action.kind}-${nonce}`};this.intents.set(slot,intent)}
   if(!active())throw new Error('Original action was cancelled before sending');
   await send({...intent.action},intent.idempotencyKey);
   if(!active())throw new Error('Original action delivery is unconfirmed; retry identity retained');
   this.intents.delete(slot);
  },timeoutMs)}finally{this.busy.delete(slot)}
 }
}
