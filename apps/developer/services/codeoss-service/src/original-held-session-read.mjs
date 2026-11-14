import {loadBundledIdentitySDK} from '../../../desktop/identity-sdk-loader.mjs';
import {types} from 'node:util';
const fail=code=>Object.assign(new Error(code),{code});
const field=(value,name)=>{
 if(types.isProxy(value)||!value||!['object','function'].includes(typeof value))return undefined;
 const d=Object.getOwnPropertyDescriptor(value,name);return d&&Object.hasOwn(d,'value')?d.value:undefined;
};
function captureRead(input){
 if(types.isProxy(input)||!input||Reflect.ownKeys(input).sort().join('|')!=='body|method|path|requiredScopes')throw fail('IDE_HELD_READ_REQUEST_INVALID');
 const method=field(input,'method'),path=field(input,'path'),body=field(input,'body'),scopes=field(input,'requiredScopes');
 if(method!=='GET'||body!==''||typeof path!=='string'||types.isProxy(scopes)||!Array.isArray(scopes)||scopes.length>8)throw fail('IDE_HELD_READ_REQUEST_INVALID');
 const captured=[];
 for(let i=0;i<scopes.length;i++){const scope=field(scopes,String(i));if(typeof scope!=='string')throw fail('IDE_HELD_READ_REQUEST_INVALID');captured.push(scope);}
 return Object.freeze({method,path,body,requiredScopes:Object.freeze(captured)});
}

// IDE backend custody only. The production loader is the sole fixed Node
// export. No request, renderer or project supplies an SDK/provider/namespace.
// Constructor seams are PUBLIC unit controls, never Root/Source qualification.
export function createOriginalIDEHeldRead({originalSDK,loadSDK=()=>loadBundledIdentitySDK('original-ide-held-session-read')}={}){
 let opening=null,owner=null,ready=false,retired=false,closed=false,firstPresent=false,firstCause;
 let retireSelected=false,retireFailed=false,retireCause,closePromise=null,cleanupFailed=false;
 const flights=new Set();
 const latch=cause=>{if(!firstPresent){firstPresent=true;firstCause=cause;}};
 const active=()=>{if(firstPresent)throw firstCause;if(retired||closed)throw fail('IDE_HELD_READ_RETIRED');};
 function retire(){
  retired=true;ready=false;
  if(owner&&!retireSelected){
   retireSelected=true;
   try{const method=field(owner,'retire');if(typeof method!=='function'||method.call(owner)!==undefined)throw fail('IDE_HELD_READ_RETIRE_UNCONFIRMED');}
   catch(error){retireFailed=true;retireCause=error;latch(error);}
  }
 }
 const refuse=cause=>{latch(cause);retire();throw cause;};
 async function acquire(){
  active();
  if(!opening)opening=(async()=>{
   let outcome;
   try{
    const sdk=originalSDK??await loadSDK();active();
    if(typeof sdk?.acquireOriginalIDEHeldSessionRead!=='function')throw fail('IDE_HELD_READ_IMPLEMENTATION_NOT_SUPPLIED');
    outcome=await sdk.acquireOriginalIDEHeldSessionRead(); // exactly zero inputs
   }catch(error){
    const partial=field(error,'partial');if(partial!==undefined&&partial!==null)owner=partial;
    return refuse(error);
   }
   // Adopt custody BEFORE interpreting discriminants, including throw null.
   const acquired=field(outcome,'owner');if(acquired!==undefined&&acquired!==null)owner=acquired;
   const originalError=!types.isProxy(outcome)&&outcome&&Object.getOwnPropertyDescriptor(outcome,'error');
   if(originalError&&Object.hasOwn(originalError,'value')&&field(outcome,'failed')===true&&field(outcome,'errorPresent')===true&&field(outcome,'cleanupOnly')===true){
    return refuse(field(outcome,'error'));
   }
   if(field(outcome,'failed')!==false||field(outcome,'errorPresent')!==false||field(outcome,'cleanupOnly')!==false||field(outcome,'error')!==null||!owner||['assertCurrent','createBusinessProof','retire','status','close'].some(name=>typeof field(owner,name)!=='function'))return refuse(fail('IDE_HELD_READ_OUTCOME_INVALID'));
   if(retired){retire();throw firstPresent?firstCause:fail('IDE_HELD_READ_RETIRED');}
   ready=true;return owner;
  })();
  return opening;
 }
 function createBusinessProof(input){
  active();const captured=captureRead(input);
  const run=Promise.resolve().then(async()=>{
   const held=await acquire();active();
   try{
    if(await held.assertCurrent()!==undefined)throw fail('IDE_HELD_READ_CURRENT_UNCONFIRMED');active();
    const proof=await held.createBusinessProof(captured);active();
    if(await held.assertCurrent()!==undefined)throw fail('IDE_HELD_READ_CURRENT_UNCONFIRMED');active();
    return proof; // Original opaque proof; no reconstructed header/member.
   }catch(error){return refuse(error);}
  });
  flights.add(run);void run.finally(()=>flights.delete(run)).catch(()=>{});return run;
 }
 function assertCurrent(){
  active();const run=Promise.resolve().then(async()=>{const held=await acquire();active();try{if(await held.assertCurrent()!==undefined)throw fail('IDE_HELD_READ_CURRENT_UNCONFIRMED');active();}catch(error){return refuse(error);}});
  flights.add(run);void run.finally(()=>flights.delete(run)).catch(()=>{});return run;
 }
 function close(){
  retire();
  if(!closePromise)closePromise=(async()=>{
   if(opening)await opening.catch(()=>{});
   await Promise.allSettled([...flights]);
   retire();
   if(retireFailed){cleanupFailed=true;throw retireCause;}
   try{
    if(owner){const method=field(owner,'close');if(typeof method!=='function'||await method.call(owner)!==undefined)throw fail('IDE_HELD_READ_CLOSE_UNCONFIRMED');}
    closed=true;
   }catch(error){cleanupFailed=true;latch(error);throw error;}
  })();
  return closePromise;
 }
 return Object.freeze({assertCurrent,createBusinessProof,retire,close,status:()=>Object.freeze({ready,retired,closed,acquisitionEntered:opening!==null,ownerRetained:owner!==null,activeOperations:flights.size,firstCausePresent:firstPresent,cleanupFailed,cleanupPending:owner!==null&&!closed,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,connected:false,newSession:false})});
}
