import {createProductWalletBusinessReadClient} from '@ynx-chain/wallet-auth/product-wallet-connection';
import {types} from 'node:util';

const fail=code=>{throw Object.assign(new Error(code),{code});};
// PRIVATE same-image composition, not a public provider registration or Root
// constructor. Only the normal Native acquisition may supply this capture.
// Unit-test compile substitution is PUBLIC and confers no Source admission.
export async function holdCapturedOriginalIDERead(capture) {
 // This private function never authenticates its caller. Freeze custody refs
 // from the original Native acquisition; later caller mutation cannot swap a
 // parent, storage instance, registry, stage or timeout under this owner.
 const root=capture?.root,storageOwner=capture?.storageOwner,acquireStage=capture?.acquireStage;
 const registry=capture?.registry,productId=capture?.productId,platform=capture?.platform,gatewayTimeoutMs=capture?.gatewayTimeoutMs,key=capture?.storageKey;
 let stage=null;
 const controller=new AbortController(),abortContext=Object.freeze({signal:controller.signal});
 let firstPresent=false,firstCause,retired=false,closed=false,client=null,opening=true,closePromise=null;
 const flights=new Set(),selected=new Set(),completed=new Set();
 const latch=e=>{if(!firstPresent){firstPresent=true;firstCause=e;}};
 const active=()=>{if(firstPresent)throw firstCause;if(retired||closed)fail('IDE_HELD_SESSION_RETIRED');};
 const current=async()=>{try{active();await root.assertCurrent();active();await storageOwner.assertCurrent();active();}catch(e){latch(e);retire();throw e;}};
 const status=()=>Object.freeze({retired,closed,opening,activeOperations:flights.size,firstCausePresent:firstPresent,cleanupPending:selected.size!==completed.size,RootAdmission:false,SourceAdmission:false,newSession:false,connected:false});
 const retire=()=>{retired=true;if(!controller.signal.aborted)controller.abort(firstPresent?firstCause:Object.assign(new Error('IDE_HELD_SESSION_RETIRED'),{code:'IDE_HELD_SESSION_RETIRED'}));};
 async function closeOne(owner,name){
  if(completed.has(name))return;
  if(selected.has(name))fail('IDE_HELD_SESSION_CLEANUP_UNKNOWN');
  selected.add(name);
  // No parent may be selected if a child failed or returned non-void.
  const methods=name==='readClient'?['close']:['retire','join','close'];
  for(const method of methods){if(!owner||typeof owner[method]!=='function')fail('IDE_HELD_SESSION_CLEANUP_UNKNOWN');if(await owner[method]()!==undefined)fail('IDE_HELD_SESSION_CLEANUP_UNKNOWN');}
  completed.add(name);
 }
 async function drain(){
  retire();await Promise.allSettled([...flights]);
  if(opening)fail('IDE_HELD_SESSION_OPEN_PENDING');
  try{
   if(client)await closeOne(client,'readClient');
   if(stage)await closeOne(stage,'nativeStage');
   if(storageOwner)await closeOne(storageOwner,'originalStorage');
   if(root)await closeOne(root,'root');
   closed=true;
  }catch(e){latch(e);throw e;}
 }
 const flight=fn=>{active();const run=Promise.resolve().then(fn);flights.add(run);void run.finally(()=>flights.delete(run)).catch(()=>{});return run;};
 const owner=Object.freeze({
  status,retire,
  assertCurrent(){return flight(current);},
  createBusinessProof(input){
   active();if(opening||!client)fail('IDE_HELD_SESSION_NOT_READY');
   // Input DATA is captured by the existing SDK before its first await. The
   // original child owns once/UNKNOWN/member and its own final proof fences.
   if(types.isProxy(input)||!input||Reflect.ownKeys(input).sort().join('|')!=='body|method|path|requiredScopes')fail('IDE_HELD_SESSION_REQUEST_INVALID');
   const values={};for(const k of ['method','path','body','requiredScopes']){const d=Object.getOwnPropertyDescriptor(input,k);if(!d||!Object.hasOwn(d,'value'))fail('IDE_HELD_SESSION_REQUEST_INVALID');values[k]=d.value;}
   if(types.isProxy(values.requiredScopes)||!Array.isArray(values.requiredScopes)||values.requiredScopes.length>8)fail('IDE_HELD_SESSION_REQUEST_INVALID');
   const scopes=[];for(let i=0;i<values.requiredScopes.length;i++){const d=Object.getOwnPropertyDescriptor(values.requiredScopes,String(i));if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string')fail('IDE_HELD_SESSION_REQUEST_INVALID');scopes.push(d.value);}
   const original=Object.freeze({...values,requiredScopes:Object.freeze(scopes)});
   return flight(async()=>{await current();const value=await client.createBusinessProof(original);await current();return value;});
  },
  close(){if(!closePromise)closePromise=drain();return closePromise;}
 });
 try{
  if(!root||!storageOwner||typeof acquireStage!=='function')fail('IDE_HELD_SESSION_CAPTURE_NOT_SUPPLIED');
  await current();
  // Capture storage only through the SAME original owner. No session object,
  // RootScope.sessionOriginal, synthesized :revoke or in-memory state allowed.
  if(typeof key!=='string'||!key.startsWith('ynx.product-session.v2:'))fail('IDE_HELD_SESSION_NAMESPACE_INVALID');
  const storage=Object.freeze({
   // Existing SDK constructor checks the historical writable-storage surface
   // even for openExistingBusinessRead. These deny ports never mutate or claim
   // a successful write; the level is copied from the actual Native OS store.
   securityLevel:storageOwner.securityLevel,
   set(){fail('IDE_HELD_SESSION_READ_ONLY');},remove(){fail('IDE_HELD_SESSION_READ_ONLY');},
   async get(k){if(k!==key&&k!==key+':revoke')fail('IDE_HELD_SESSION_KEY_DENIED');await current();const raw=await storageOwner.readOriginal(k);await current();if(raw!==null&&typeof raw!=='string')fail('IDE_HELD_SESSION_STORAGE_INVALID');return raw;},
   revocationRequested(){active();return storageOwner.revocationRequested()===true;}
  });
  if(await storage.get(key+':revoke')!==null)fail('REVOCATION_PENDING');
  const raw=await storage.get(key);if(typeof raw!=='string')fail('SESSION_INACTIVE');
  // Stage is acquired AFTER original storage selection; expected sessionBinding
  // remains the SDK's parse of raw, not a readCurrent-based discovery cycle.
  try{stage=await acquireStage();}catch(e){if(e!==null&&(typeof e==='object'||typeof e==='function')&&Object.hasOwn(e,'partial'))stage=e.partial;throw e;}
  await current();
  try{client=await createProductWalletBusinessReadClient({registry,productId,platform,storage,device:stage.device,deviceCurrent:stage.deviceCurrent,abortContext,gatewayTimeoutMs});}catch(e){if(e!==null&&(typeof e==='object'||typeof e==='function')&&Object.hasOwn(e,'partial'))client=e.partial;throw e;}
  await current();opening=false;return Object.freeze({owner,error:null,failed:false,errorPresent:false,cleanupOnly:false});
 }catch(e){latch(e);opening=false;retire();return Object.freeze({owner,error:e,failed:true,errorPresent:true,cleanupOnly:true});}
}
