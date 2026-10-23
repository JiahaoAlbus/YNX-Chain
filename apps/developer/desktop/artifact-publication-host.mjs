import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {capturePublicationArtifact} from './artifact-publication-client.mjs';
const unavailable=()=>Object.assign(Error('The original publication service has not been supplied. No artifact was sent.'),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
// Per-project owner used by the normal local-workbench pipe, not a global
// publisher or a source of identity. Preview reads only the chosen local file.
export function createArtifactPublicationHost({context,admittedProject,openObservation}){
 let closed=false,busy=false,draft,observation,opening,cleanup;
 const active=new Set();
 const live=()=>{if(closed)throw unavailable();};
 async function observer(){live();if(!observation){if(typeof openObservation!=='function')throw unavailable();opening ||= Promise.resolve().then(()=>openObservation(context,admittedProject));observation=await opening;if(closed){await close();throw unavailable();}}live();return observation;}
 async function close(){closed=true;draft=undefined;for(const controller of active)controller.abort(unavailable());active.clear();cleanup ||= (async()=>{const owner=observation||await opening?.catch(()=>null);owner?.close();})();return cleanup;}
 return Object.freeze({
  async preview({artifactURI,version,publishPurpose,targetEnvironment}){
   live();if(busy)throw unavailable();busy=true;
   try{const uri=new URL(artifactURI);if(uri.protocol!=='file:'||uri.host||uri.search||uri.hash)throw unavailable();const controller=new AbortController();active.add(controller);try{const selected=await capturePublicationArtifact({context,admittedProject,artifactPath:fileURLToPath(uri),version,publishPurpose,targetEnvironment,signal:controller.signal});live();draft={id:randomUUID(),selected};return {draftId:draft.id,binding:selected.binding,signingApproved:false,deploymentApproved:false};}finally{active.delete(controller);}}finally{busy=false;}
  },
  async observe(requestId){live();if(busy)throw unavailable();busy=true;const controller=new AbortController();active.add(controller);try{const owner=await observer(),result=await owner.resume(requestId,{signal:controller.signal});live();return result;}finally{active.delete(controller);busy=false;}},
  close,
 });
}
