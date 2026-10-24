import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

const unavailable=()=>Object.assign(Error('The original publication project is not available.'),{code:'IDE_PUBLICATION_PROJECT_UNAVAILABLE'});
const retired=()=>Object.assign(Error('The publication project changed. Review it again.'),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});
// Local composition identity only; never a Native Source or signing approval.
// The real protected constructor still independently enforces original custody.
const composedPublicationSelections=new WeakSet();
export function assertComposedPublicationSelection(selection){
 if(!composedPublicationSelections.has(selection))throw Object.assign(Error('Original project composition is unavailable.'),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
}
const text=(value,maxBytes=1024)=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=maxBytes&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const principalKeys=['account','deviceId','sessionRef','currentRef','accountGeneration','sessionGeneration'];
const projectKeys=['projectId','ownerAccount','currentReference','projectRevision','catalogRevision'];
const publisherKeys=['account','projectId','publisherId','keyRole','publicOriginal','publicSHA256','registrationRef','revision'];

// Fixed original SDK only. The selector is DATA, never a Source, grant, bearer,
// local project UUID mapping or caller-supplied Native implementation.
export async function openBundledOriginalPublicationProject(options){
 const metadataURL=new URL('../../../packages/wallet-auth/package.json',import.meta.url);
 const metadata=JSON.parse(await fs.readFile(metadataURL,'utf8'));
 if(metadata.name!=='@ynx-chain/wallet-auth')throw unavailable();
 const root=await fs.realpath(path.dirname(fileURLToPath(metadataURL)));
 const target=await fs.realpath(createRequire(metadataURL).resolve('@ynx-chain/wallet-auth/original-ide-admission'));
 if(!target.startsWith(root+path.sep))throw unavailable();
 const api=await import(pathToFileURL(target).href);
 return captureOriginalWorkspacePublicationProject({...options,api});
}

// Return cleanup custody before any read of a possibly partial original owner.
// Nothing returned here grants HTTP access or approves/signs a deployment.
export function captureOriginalPublicationProject({projectID,publisherID,assertLocalCurrent,api,now=Date.now,expectedProjectRevision,expectedCatalogRevision}){
 const names=['acquireOriginalIDEProjectAuthority','readOriginalIDECurrentProject','readOriginalIDECurrentPublisher','closeOriginalIDEProjectAuthority'];
 if(!text(projectID)||!text(publisherID)||typeof assertLocalCurrent!=='function'||names.some(name=>typeof api?.[name]!=='function'))throw unavailable();
 let reference,closed=false,failed=false,firstCause,baseline,deadline,cleanupSelected=false,cleanupFailed=false,cleanupCause;
 const remember=cause=>{if(!failed){failed=true;firstCause=cause;}return firstCause;};
 const live=()=>{if(failed)throw firstCause;if(closed)throw retired();};
 try{reference=api.acquireOriginalIDEProjectAuthority();if(reference===null||reference===undefined)throw unavailable();}catch(cause){remember(cause);}
 function normalized(value,withPublisher){
  const {principal,project,publisher}=value??{};
  if(principalKeys.some(key=>!text(principal?.[key]))||projectKeys.some(key=>!text(project?.[key]))||project.projectId!==projectID||project.publish!==true||typeof project.read!=='boolean'||typeof project.runtime!=='boolean'||typeof project.runtimeOrigin!=='string'||Buffer.byteLength(project.runtimeOrigin)>32768)throw retired();
  if(expectedProjectRevision!==undefined&&project.projectRevision!==expectedProjectRevision||expectedCatalogRevision!==undefined&&project.catalogRevision!==expectedCatalogRevision)throw retired();
  const times=[value.expiresMS,principal.expiresMS,project.expiresMS];
  const result={principal:Object.fromEntries(principalKeys.map(key=>[key,principal[key]])),project:{...Object.fromEntries(projectKeys.map(key=>[key,project[key]])),runtimeOrigin:project.runtimeOrigin,read:project.read,publish:project.publish,runtime:project.runtime}};
  if(withPublisher){
   // R171 bounds the complete authority JSON to 32768 bytes; the R13
   // publicOriginal is a PQ public record, not a short identifier.
   if(publisherKeys.some(key=>!text(publisher?.[key],key==='publicOriginal'?32768:1024))||publisher.account!==principal.account||publisher.projectId!==project.projectId||publisher.publisherId!==publisherID||publisher.keyRole!=='ide-artifact-publisher'||publisher.revoked!==false||!(value.publisherOriginal instanceof Uint8Array)||value.publisherOriginal.byteLength===0||value.publisherOriginal.byteLength>32768)throw retired();
   times.push(publisher.expiresMS);
   result.publisher=Object.fromEntries(publisherKeys.map(key=>[key,publisher[key]]));
   result.publisherOriginal=Buffer.from(value.publisherOriginal).toString('base64');
  }
  if(times.some(time=>!Number.isSafeInteger(time)||time<=now()))throw retired();
  return {result,expires:Math.min(...times)};
 }
 async function assertCurrent(){
  live();
  try{
   await assertLocalCurrent();live();
   const project=normalized(api.readOriginalIDECurrentProject(reference,projectID),false);live();
   const publisher=normalized(api.readOriginalIDECurrentPublisher(reference,projectID,publisherID),true);live();
   if(JSON.stringify(project.result)!==JSON.stringify({principal:publisher.result.principal,project:publisher.result.project}))throw retired();
   await assertLocalCurrent();live();
   const fingerprint=JSON.stringify(publisher.result),expires=Math.min(project.expires,publisher.expires);
   if(now()>=expires)throw retired();
   if(baseline!==undefined&&(baseline!==fingerprint||expires<deadline||now()>=deadline))throw retired();
   if(baseline===undefined){baseline=fingerprint;deadline=expires;}
   // Only the canonical ID read back from original Native, never an echo of
   // the local UUID, can be used to encode a publication manifest.
   return Object.freeze({projectId:publisher.result.project.projectId,publisherId:publisher.result.publisher.publisherId,expiresMS:deadline});
  }catch(cause){throw remember(cause);}
 }
 return Object.freeze({
  assertCurrent,
  close(){
   closed=true;
   if(cleanupSelected){if(cleanupFailed)throw cleanupCause;return;}
   cleanupSelected=true;
   try{if(reference!==null&&reference!==undefined&&api.closeOriginalIDEProjectAuthority(reference)!==undefined)throw unavailable();}
   catch(cause){cleanupFailed=true;cleanupCause=cause;throw cause;}
  },
  status:()=>Object.freeze({captured:reference!==null&&reference!==undefined,closed,firstCausePresent:failed,cleanupSelected,cleanupFailed}),
  authority:'original-project-data-only',signingApproved:false,deploymentApproved:false,
 });
}

// R177: only the normal launch's three local primitive strings select the
// original workspace Source. Canonical IDs come back from the original owner.
// This independent selector is not an authority ref or an HTTP grant.
export function captureOriginalWorkspacePublicationProject({context,assertLocalCurrent,api,now=Date.now}){
 const names=['acquireOriginalIDEWorkspaceProjectSelection','readOriginalIDEWorkspaceProjectSelection','closeOriginalIDEWorkspaceProjectSelection','acquireOriginalIDEProjectAuthority','readOriginalIDECurrentProject','readOriginalIDECurrentPublisher','closeOriginalIDEProjectAuthority'];
 const local={workspace:context?.workspace,profile:context?.profile,id:context?.id};
 const physical=value=>typeof value==='string'&&!value.includes('\0')&&Buffer.byteLength(value)<=4096&&path.isAbsolute(value)&&path.resolve(value)===value;
 if(!physical(local.workspace)||!physical(local.profile)||!text(local.id)||typeof assertLocalCurrent!=='function'||names.some(name=>typeof api?.[name]!=='function'))throw unavailable();
 let selector,project,selected,selectionFingerprint,closed=false,failed=false,firstCause,cleanupSelected=false,cleanupFailed=false,cleanupCause;
 const remember=cause=>{if(!failed){failed=true;firstCause=cause;}return firstCause;};
 const live=()=>{if(failed)throw firstCause;if(closed)throw retired();if(Object.keys(local).some(key=>context[key]!==local[key]))throw remember(retired());};
 try{selector=api.acquireOriginalIDEWorkspaceProjectSelection(local.workspace,local.profile,local.id);if(selector===null||selector===undefined)throw unavailable();}catch(cause){remember(cause);}
 const u64=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n;
 async function selectionCurrent(){
  live();await assertLocalCurrent();live();
  const value=api.readOriginalIDEWorkspaceProjectSelection(selector);live();
  if(!text(value?.projectId)||!(value.publisherId===null||text(value.publisherId))||!u64(value.projectRevision)||!u64(value.catalogRevision)||!Number.isSafeInteger(value.expiresMS)||value.expiresMS<=now())throw retired();
  const snapshot=Object.freeze({projectId:value.projectId,publisherId:value.publisherId,projectRevision:value.projectRevision,catalogRevision:value.catalogRevision,expiresMS:value.expiresMS});
  const fingerprint=JSON.stringify(snapshot);
  if(selectionFingerprint!==undefined&&selectionFingerprint!==fingerprint)throw retired();
  if(!selected){selected=snapshot;selectionFingerprint=fingerprint;}
  return selected;
 }
 async function assertCurrent(){
  live();
  try{
   const mapping=await selectionCurrent();live();
   if(mapping.publisherId===null)throw Object.assign(Error('The selected project has no original publication publisher.'),{code:'IDE_PUBLICATION_PUBLISHER_UNAVAILABLE'});
   // Capture this separate original authority before reading its possible
   // partial state. IDs/revisions cannot be taken from a local UUID or AI lease.
   project ||= captureOriginalPublicationProject({projectID:mapping.projectId,publisherID:mapping.publisherId,expectedProjectRevision:mapping.projectRevision,expectedCatalogRevision:mapping.catalogRevision,api,now,assertLocalCurrent:selectionCurrent});
   const current=await project.assertCurrent();live();await selectionCurrent();live();
   const expiresMS=Math.min(mapping.expiresMS,current.expiresMS);if(now()>=expiresMS)throw retired();
   return Object.freeze({projectId:current.projectId,publisherId:current.publisherId,expiresMS});
  }catch(cause){throw remember(cause);}
 }
 return Object.freeze({assertCurrent,
  close(){
   closed=true;if(cleanupSelected){if(cleanupFailed)throw cleanupCause;return;}
   cleanupSelected=true;let caught=false,cause;
   try{project?.close();}catch(error){caught=true;cause=error;}
   // Never let Source/project cleanup failure skip independent selector FD
   // custody, and never retry either close when the result remains UNKNOWN.
   try{if(selector!==null&&selector!==undefined&&api.closeOriginalIDEWorkspaceProjectSelection(selector)!==undefined)throw unavailable();}catch(error){if(!caught){caught=true;cause=error;}}
   if(caught){cleanupFailed=true;cleanupCause=cause;throw cause;}
  },
  status:()=>Object.freeze({selectorCaptured:selector!==null&&selector!==undefined,projectCaptured:!!project,closed,firstCausePresent:failed,cleanupSelected,cleanupFailed}),
  authority:'original-workspace-project-data-only',signingApproved:false,deploymentApproved:false,
 });
}

// Compose file freshness and original project freshness in the backend. This
// produces canonical manifest DATA only; the protected operation stays gated
// independently on the original approval and server-proof supplier.
export async function bindOriginalPublicationProject({selection,project}){
 if(typeof selection?.assertCurrent!=='function'||typeof selection?.artifactBytes!=='function'||typeof project?.assertCurrent!=='function')throw unavailable();
 const {localProjectId,...local}=selection.binding??{};
 const canonical=await project.assertCurrent();await selection.assertCurrent();
 const binding=Object.freeze({...local,projectId:canonical.projectId});
 async function assertCurrent(){
  await selection.assertCurrent();const current=await project.assertCurrent();
  if(current.projectId!==binding.projectId)throw retired();
  await selection.assertCurrent();return binding;
 }
 const composed=Object.freeze({binding,assertCurrent,artifactBytes:()=>selection.artifactBytes(),
  async encodeManifest(encoder){await assertCurrent();if(typeof encoder!=='function')throw unavailable();return encoder(binding);},
  authority:'artifact-data-only',signingApproved:false,deploymentApproved:false});
 composedPublicationSelections.add(composed);return composed;
}
