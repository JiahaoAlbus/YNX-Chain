import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {capturePublicationArtifact} from './artifact-publication-client.mjs';
import {bindOriginalPublicationProject} from './original-publication-project.mjs';
const unavailable=()=>Object.assign(Error('The original publication service has not been supplied. No artifact was sent.'),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
// Per-project owner used by the normal local-workbench pipe, not a global
// publisher or a source of identity. Preview reads only the chosen local file.
export function createArtifactPublicationHost({context,localProjectSnapshot,openObservation,openNativeArtifact,openOriginalProject}){
 let closed=false,busy=false,draft,observation,opening,cleanup;
 const localLaunch=randomUUID();
 const active=new Set();
 const live=()=>{if(closed)throw unavailable();};
 async function observer(){live();if(!observation){if(typeof openObservation!=='function')throw unavailable();opening ||= Promise.resolve().then(()=>{live();return openObservation(context);});observation=await opening;if(closed){await close();throw unavailable();}}live();return observation;}
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
 async function close(){closed=true;for(const controller of active)controller.abort(unavailable());active.clear();const selected=draft;cleanup ||= (async()=>{let failed=false,firstCause;try{await closeDraft(selected);}catch(cause){failed=true;firstCause=cause;}try{const owner=observation||await opening?.catch(()=>null);await owner?.close();}catch(cause){if(!failed){failed=true;firstCause=cause;}}if(failed)throw firstCause;draft=undefined;})();return cleanup;}
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
  async observe(requestId){live();if(busy)throw unavailable();busy=true;const controller=new AbortController();active.add(controller);try{const owner=await observer(),result=await owner.resume(requestId,{signal:controller.signal});live();return result;}finally{active.delete(controller);busy=false;}},
  close,
 });
}
