// Root-selected fixed module entry, called only by the Native getter with its
// OWN typed root and private review bridge. No environment/JSON/provider install.
import{createOriginalAITaskActionClientV6Kernel}from'./task-action-client-v6-private.mjs';
import{retainOriginalAITaskAgentRegistrationV6}from'./task-action-agent-registration-v6-private.mjs';
import{loadOriginalAITaskV6Image}from'./task-action-protected-image-private.mjs';
import{OriginalAITaskV6RootCurrent}from'./task-action-root-current-v6-private.mjs';
import{openOriginalTaskAuthoritySQLite,borrowExistingOriginalTaskAuthoritySQLite}from'./task-action-sqlite-bootstrap-private.mjs';
import{createOriginalAITaskV6CompositionCleanup}from'./task-action-client-cleanup-v6-private.mjs';
const releases=Object.freeze([]);
const fail=code=>{throw Object.assign(Error(code),{code});};
const take=(raw,adopt)=>{if(raw?.owner!==null&&raw?.owner!==undefined)adopt(raw.owner);if(!raw||typeof raw.errorPresent!=='boolean')fail('AI_V6_NORMAL_OWNED_OUTCOME');if(raw.errorPresent)throw raw.error;return raw.owner;};
export async function openOriginalAITaskActionV6ClientFromNative(nativeRoot,nativeReviews){
 let image,root,serverRoot,registration,sql,borrow,kernel,first;
 const cleanup=createOriginalAITaskV6CompositionCleanup(()=>({nativeRoot,kernel,registration,root,serverRoot,borrow,sql,image,persistenceGuard:()=>borrow?.store.taskClientV6.assertOriginalNoPersistenceDebt()}));
 const current=()=>{if(first)throw first.cause;if(cleanup.readOriginalCleanupDATA().retired)fail('AI_V6_NORMAL_SOURCE_RETIRED');nativeRoot.assertCurrent();image?.current();borrow?.current();};
 const delegate=name=>(...args)=>{current();if(!kernel)fail('AI_V6_NORMAL_SOURCE_NOT_INITIALIZED');return kernel[name](...args);};
 // Own the complete acquisition before awaiting a held image/current producer.
 const owner=Object.freeze({readOriginalScopeDATA:delegate('readOriginalScopeDATA'),assertCurrent:delegate('assertCurrent'),prepareOriginalAITaskActionV6Review:delegate('prepareOriginalAITaskActionV6Review'),produceOriginalAITaskActionV6:delegate('produceOriginalAITaskActionV6'),readOriginalServerCurrentDATA:delegate('readOriginalServerCurrentDATA'),assertOriginalAITaskActionV6Response:delegate('assertOriginalAITaskActionV6Response'),assertOriginalAITaskActionV6OutcomeCurrent:delegate('assertOriginalAITaskActionV6OutcomeCurrent'),acquireOriginalAITaskActionV6Outcome:delegate('acquireOriginalAITaskActionV6Outcome'),assertOriginalAITaskActionV6LookupCurrent:delegate('assertOriginalAITaskActionV6LookupCurrent'),lookupOriginalAITaskActionV6:delegate('lookupOriginalAITaskActionV6'),retire:cleanup.retire,join:cleanup.join,close:cleanup.close,drainPartial:cleanup.drainPartial});
 try{
  nativeRoot.assertCurrent();const context=nativeRoot.readOriginalContext(),s=context.scope;
  const selected=releases.filter(r=>r.purpose==='ai-native-task-action-source-v6'&&r.role==='client'&&['sourceId','instanceId','resourceKey'].every(k=>r.selector[k]===s.currentSelector[k]));
  if(selected.length!==1)fail('AI_V6_CLIENT_REGISTERED_RESOURCES_NOT_SUPPLIED');const r=selected[0];
  image=take(await loadOriginalAITaskV6Image(r.image),v=>{image=v;});current();
  if(!image.namespaces.sdkPeer||!image.namespaces.mainApproval)fail('AI_V6_CLIENT_FIXED_MODULE_CLOSURE_NOT_SUPPLIED');
  const boundImage=Object.freeze({namespaces:image.namespaces,current(){nativeRoot.assertCurrent();image.current();}});
  root=new OriginalAITaskV6RootCurrent(r.client,boundImage);await root.initialize();current();
  // Fresh independent Current envelopes have different nonces. Compare the
  // SAME three immutable source originals and complete signed scope instead;
  // reviews retain the Native parent's exact four originals below.
  const raw=root.readOriginalSourceCurrentOriginals();for(const k of['rootOriginal','enrollmentOriginal','profileOriginal'])if(!Buffer.from(raw[k]).equals(Buffer.from(context[k])))fail('AI_V6_NATIVE_AND_JS_SOURCE_ORIGINALS_DIFFER');
  if(JSON.stringify(root.readOriginalScopeDATA())!==JSON.stringify(context.scope))fail('AI_V6_NATIVE_AND_JS_SCOPE_DIFFER');
  serverRoot=new OriginalAITaskV6RootCurrent(r.server,boundImage);await serverRoot.initialize();current();
  registration=take(retainOriginalAITaskAgentRegistrationV6({root,image:boundImage,recordReference:r.agentRecord}),v=>{registration=v;});
  borrow=borrowExistingOriginalTaskAuthoritySQLite(r.sqlite);if(!borrow){sql=take(openOriginalTaskAuthoritySQLite(r.sqlite),v=>{sql=v;});borrow=sql.borrowOriginalAuthorityStore();}
  kernel=createOriginalAITaskActionClientV6Kernel({root,serverRoot,image:boundImage,registration,once:borrow.store.taskClientV6,authorityStore:borrow.store,nativeReviews,nativeRoot,clientTarget:r.clientTarget});
  current();kernel.assertCurrent();return Object.freeze({owner,errorPresent:false});
 }catch(cause){first??={cause};return Object.freeze({owner,errorPresent:true,error:first.cause});}
}
