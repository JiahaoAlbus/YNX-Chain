import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {capturePublicationArtifact} from './artifact-publication-client.mjs';
import {bindOriginalPublicationProject} from './original-publication-project.mjs';
const unavailable=()=>Object.assign(Error('The original publication service has not been supplied. No artifact was sent.'),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
// Per-project owner used by the normal local-workbench pipe, not a global
// publisher or a source of identity. Preview reads only the chosen local file.
export function createArtifactPublicationHost({context,localProjectSnapshot,openObservation,openNativeArtifact,openOriginalProject}){
 let closed=false,busy=false,draft,cleanup,observing,cleanupDebtPresent=false,cleanupDebt;
 const reads=new Set();
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
 const localLaunch=randomUUID();
 const active=new Set();
 const live=()=>{if(closed)throw unavailable();};
 // One explicit query owns one acquisition. Never cache a failed factory or
 // reuse an expired/retired native read permission for a later user request.
 function cleanupRead(row){
  row.cleanup ??= (async()=>{
   try{if(row.owner)await row.owner.close();}
   catch(cause){if(!cleanupDebtPresent){cleanupDebtPresent=true;cleanupDebt=cause;}throw cause;}
   finally{reads.delete(row);}
  })();
  return row.cleanup;
 }
 // The fixed Native factory returns cleanup custody before current/read checks.
 // A rejected factory has not allocated Native custody; failed close is kept.
 async function closeDraft(value){
  let failed=false,firstCause;
  try{const owner=value?.native||await value?.opening?.catch(()=>null);if(owner&&await owner.close()!==true)throw unavailable();}catch(cause){failed=true;firstCause=cause;}
  // Project cleanup is independent of artifact cleanup, and its original
  // SDK18 success is undefined, not the DATA artifact's true convention.
  try{const owner=value?.project||await value?.projectOpening?.catch(()=>null);if(owner&&await owner.close()!==undefined)throw unavailable();}catch(cause){if(!failed){failed=true;firstCause=cause;}}
  if(failed)throw firstCause;
 }
 async function close(){
  closed=true;for(const controller of active)controller.abort(unavailable());active.clear();
  const selected=draft;
  cleanup ||= (async()=>{
   let failed=false,firstCause;const retain=cause=>{if(!failed){failed=true;firstCause=cause;}};
   try{await closeDraft(selected);}catch(cause){retain(cause);}
   // Observe all late factories/queries before cleanup, independently of drafts.
   for(const row of [...reads])try{await row.settled;}catch{/* query outcome is observed; cleanup debt is retained below */}
   if(cleanupDebtPresent)retain(cleanupDebt);
   if(failed)throw firstCause;draft=undefined;
  })();return cleanup;
 }
 return Object.freeze({
  async preview({artifactURI,version,publishPurpose,targetEnvironment}){
   live();if(busy)throw unavailable();busy=true;
   try{const uri=new URL(artifactURI);if(uri.protocol!=='file:'||uri.host||uri.search||uri.hash)throw unavailable();await closeDraft(draft);draft=undefined;live();const controller=new AbortController();active.add(controller);try{const next={id:randomUUID()};draft=next;const hasOriginalProject=typeof openOriginalProject==='function';
    if(hasOriginalProject){
     // Store the partial before any read; disposal joins a late acquisition.
     // The producer owns canonical selectors. Local context is not authority.
     next.projectOpening=Promise.resolve().then(()=>{live();return openOriginalProject(context,live);});next.project=await next.projectOpening;live();
    }
    let snapshot=localProjectSnapshot;
    if(!snapshot&&hasOriginalProject){
     if(typeof next.project?.assertCurrent!=='function')throw unavailable();
     snapshot={async assertCurrent(){live();const original=await next.project.assertCurrent();live();return{generation:0,localProjectId:context.id,workspace:context.workspace,launch:localLaunch,expiresAt:original.expiresMS};}};
    }
    // These launch fields constrain local file freshness only. Their deadline
    // is the original current project's expiry, never a fabricated grant.
    let selected=await capturePublicationArtifact({context,localProjectSnapshot:snapshot,artifactPath:fileURLToPath(uri),version,publishPurpose,targetEnvironment,signal:controller.signal});live();
    if(hasOriginalProject){selected=await bindOriginalPublicationProject({selection:selected,project:next.project});live();}next.selected=selected;
    if(typeof openNativeArtifact==='function'){next.opening=Promise.resolve().then(()=>{live();return openNativeArtifact(selected);});next.native=await next.opening;live();await next.native.assertCurrent();live();}return {draftId:next.id,binding:selected.binding,signingApproved:false,deploymentApproved:false};}finally{active.delete(controller);}}finally{busy=false;}
  },
  async observe(requestId,{observationId=randomUUID()}={}){
   live();if(cleanupDebtPresent)throw cleanupDebt;
   if(busy||reads.size||!uuid(requestId)||!uuid(observationId)||typeof openObservation!=='function')throw unavailable();
   busy=true;const controller=new AbortController();active.add(controller);
   let finish,abort;const selected={id:observationId,controller,done:new Promise(resolve=>finish=resolve)};
   observing=selected;const row={owner:undefined,cleanup:undefined,settled:undefined};reads.add(row);
   const cancelled=new Promise((_resolve,reject)=>{abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});});
   const work=Promise.resolve().then(()=>{
    controller.signal.throwIfAborted();live();return openObservation(context);
   }).then(owner=>{
    row.owner=owner;controller.signal.throwIfAborted();live();
    if(typeof owner?.resume!=='function'||typeof owner?.close!=='function')throw unavailable();
    return owner.resume(requestId,{signal:controller.signal});
   });
   // Both outcomes are handled even if cancellation wins. The late owner can
   // only be closed, never resumed; replacement waits for known cleanup.
   row.settled=work.then(
    async result=>{await cleanupRead(row);return result;},
    async firstCause=>{try{await cleanupRead(row);}catch{/* retain debt separately; query first cause wins */}throw firstCause;}
   );
   void row.settled.catch(()=>{});
   try{const result=await Promise.race([row.settled,cancelled]);controller.signal.throwIfAborted();live();return result;}
   finally{controller.signal.removeEventListener('abort',abort);active.delete(controller);if(observing===selected)observing=undefined;busy=false;finish();}
  },
  async cancelObservation(observationId){
   live();const selected=observing;
   if(!selected||selected.id!==observationId)return{cancelled:false,queryOnly:true,replayAllowed:false};
   selected.controller.abort(Object.assign(Error('The status and log query was stopped.'),{code:'IDE_PUBLICATION_OBSERVATION_CANCELLED'}));
   await selected.done;live();return{cancelled:true,queryOnly:true,replayAllowed:false};
  },
  close,
 });
}
