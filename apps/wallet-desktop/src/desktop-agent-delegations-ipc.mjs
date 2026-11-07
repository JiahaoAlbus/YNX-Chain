import {types} from 'node:util';
// Normal Main composition only. Renderer input is local intent/reference DATA;
// this layer cannot mint an Auth request, Source, grant, nonce or approval.
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(value,keys)=>{if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('AGENT_VIEW_INPUT_INVALID');const ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!Object.hasOwn(ds[k]??{},'value')||!ds[k].enumerable)||Reflect.ownKeys(ds).some(k=>!keys.includes(k)))fail('AGENT_VIEW_INPUT_INVALID');return Object.fromEntries(keys.map(k=>[k,ds[k].value]));};
const string=value=>{if(typeof value!=='string'||!value||value.length>512||/[\u0000-\u001f]/.test(value))fail('AGENT_VIEW_INPUT_INVALID');return value;};
export function createDesktopAgentDelegationsService({controller}){
 let closing=false,closeFlight=null,cancelFlight=null,cleanupDebt=false,firstCleanupCause=null,firstOperationCause=null;const active=new Set();
 function track(work){const p=Promise.resolve(work);active.add(p);void p.then(()=>active.delete(p),()=>active.delete(p));return p;}
 function call(method,value){if(closing)fail('AGENT_VIEW_CLOSED');if(cleanupDebt)fail('AGENT_CLEANUP_REQUIRED');let result;try{result=method==='readProjection'?controller.readProjection():controller[method](value);}catch(error){firstOperationCause??={cause:error};return Promise.reject(error);}const selected=Promise.resolve(result).catch(cause=>{firstOperationCause??={cause};throw cause;});return track(selected);}
 function cancelView(){if(cancelFlight)return cancelFlight;let resolve,reject;cancelFlight=new Promise((yes,no)=>{resolve=yes;reject=no;});const selected=cancelFlight;
  let result;try{result=controller.cancelView();}catch(cause){result=Promise.reject(cause);}
  void Promise.resolve(result).then(clean=>{if(clean!==true)fail('AGENT_CLEANUP_UNCONFIRMED');cleanupDebt=false;if(cancelFlight===selected)cancelFlight=null;resolve(true);}).catch(cause=>{cleanupDebt=true;firstCleanupCause??={cause};if(cancelFlight===selected)cancelFlight=null;reject(cause);});void selected.catch(()=>{});return selected;
 }
 function assertSafeToClose(){if(active.size||cancelFlight||cleanupDebt)fail('AGENT_CLEANUP_PENDING');}
 return Object.freeze({readProjection:()=>call('readProjection'),reviewDraft:draft=>call('reviewDraft',draft),reviewAction:ref=>call('reviewAction',ref),recoverOperation:id=>call('recoverOperation',id),cancelView,
  close(){if(closeFlight)return closeFlight;closing=true;closeFlight=(async()=>{let failed=false,cause;try{await cancelView();}catch(error){failed=true;cause=error;}while(active.size)await Promise.allSettled([...active]);try{const closed=await controller.close();if(closed!==true)fail('AGENT_CLEANUP_UNCONFIRMED');}catch(error){cleanupDebt=true;firstCleanupCause??={cause:error};if(!failed){failed=true;cause=error;}}if(failed)throw cause;assertSafeToClose();})();const selected=closeFlight;void selected.catch(()=>{if(closeFlight===selected)closeFlight=null;});return selected;},assertSafeToClose,
  // Main diagnostics only; never serialized or exposed to renderer.
  readOperationCause:()=>firstOperationCause?{present:true,cause:firstOperationCause.cause}:{present:false},
  readCleanupCause:()=>firstCleanupCause?{present:true,cause:firstCleanupCause.cause}:{present:false}
 });
}
export function installDesktopAgentDelegationsIPC({handleWalletIPC,safeIPC,service}){
 const action=(name,arity,parse,method)=>handleWalletIPC(name,(_event,...args)=>safeIPC(async()=>{try{if(args.length!==arity)fail('AGENT_VIEW_ARGUMENTS_INVALID');return await service[method](arity?parse(args[0]):undefined);}catch(cause){const code=typeof cause?.code==='string'&&/^[A-Z0-9_]{1,128}$/.test(cause.code)?cause.code:'AGENT_MANAGEMENT_REQUEST_FAILED';throw Object.assign(Error('Original Agent management request is unconfirmed. Preserve original records.'),{code});}}));
 action('wallet:agent-delegations-read',0,null,'readProjection');
 action('wallet:agent-delegations-draft',1,value=>{const out=exact(value,['agent','purpose','scope','budget','unit','period','expiresAt']);for(const v of Object.values(out))string(v);return Object.freeze(out);},'reviewDraft');
 action('wallet:agent-delegations-action',1,value=>{const out=exact(value,['rowId','action']);string(out.rowId);if(!['pause','revoke'].includes(out.action))fail('AGENT_VIEW_INPUT_INVALID');return Object.freeze(out);},'reviewAction');
 action('wallet:agent-delegations-recover',1,string,'recoverOperation');
 action('wallet:agent-delegations-cancel',0,null,'cancelView');
}
