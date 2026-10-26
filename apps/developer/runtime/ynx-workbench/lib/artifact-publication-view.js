'use strict';
const {BaseWidget}=require('@theia/core/lib/browser/widgets');
const {CommonMenus}=require('@theia/core/lib/browser/common-menus');
const ID='ynx-artifact-publication';
// A disposed widget still owns its in-flight native cleanup. A replacement
// must not enqueue a new review ahead of that cleanup or retry an UNKNOWN end.
const nativeReadOwners=new WeakMap();
function retireNativeRead(target,selected){
 if(nativeReadOwners.get(target)!==selected)return Promise.resolve();
 selected.ending??=Promise.resolve().then(()=>target.ynxDesktopWallet.endDeploymentObservation());
 return selected.ending.then(value=>{if(nativeReadOwners.get(target)===selected)nativeReadOwners.delete(target);return value;});
}
const REQUEST_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function node(document,tag,text){const value=document.createElement(tag);if(text!==undefined)value.textContent=text;return value;}
function publicationError(error,t){
 switch(error?.code||error?.message){
  case 'IDE_SERVICE_READ_CLEANUP_PENDING':return t('publicationReadCleanupPending','The previous query still owns native cleanup. A new query has not started.');
  case 'IDE_SERVICE_READ_REVIEW_CANCELLED':case 'IDE_PUBLICATION_OBSERVATION_CANCELLED':return t('publicationObservationStopped','Status and log query stopped.');
  case 'IDE_PUBLICATION_REQUEST_ID_REQUIRED':return t('publicationRequestRequired','Enter a valid saved deployment request ID before reading its status.');
  case 'IDE_PUBLICATION_REVIEW_FIELDS_REQUIRED':return t('publicationReviewFieldsRequired','Choose a build artifact and fill in its version, publication purpose and target environment.');
  case 'IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED':case 'IDE_PUBLICATION_PROJECT_UNAVAILABLE':return t('publicationProjectSourceMissing','The original project identity is not available yet. Local editing, running and debugging remain available.');
  case 'IDE_PUBLICATION_PROJECT_RETIRED':return t('publicationProjectChanged','Project identity or permissions changed. Select the current project and review the artifact again.');
  case 'IDE_PUBLICATION_PUBLISHER_UNAVAILABLE':return t('publicationPublisherMissing','The current project has no original registered publisher. No upload or signing was requested.');
  case 'IDE_ARTIFACT_FILE_CHANGED':case 'IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED':case 'IDE_ARTIFACT_PATH_CHANGED':return t('publicationArtifactChanged','The selected file changed. Choose the current build artifact and review it again.');
  case 'IDE_ARTIFACT_OUTSIDE_PROJECT':return t('publicationArtifactOutsideProject','Choose a build artifact inside the current project.');
  case 'IDE_SERVICE_OBSERVER_UNAVAILABLE':case 'IDE_SERVICE_OBSERVER_NOT_SUPPLIED':case 'IDE_PUBLICATION_NOT_SUPPLIED':case 'IDE_ARTIFACT_CLOUD_NOT_SUPPLIED':return t('publicationServiceMissing','The original publication service is not connected yet. Nothing was uploaded or signed.');
  default:return t('publicationUnavailable','Publication is not ready. Your project files are preserved.');
 }
}
class ArtifactPublicationWidget extends BaseWidget{
 constructor(project,target,translate){
  super();this.id=ID;this.title.label=translate('publicationTitle','Publish project');this.title.caption=this.title.label;this.title.closable=true;this.title.iconClass='codicon codicon-cloud-upload';
  const document=this.node.ownerDocument,t=(key,text)=>translate(key,text);let live=true,epoch=0,selectedURI,observing;
  const status=node(document,'p',t('publicationNote','Review a built project file before requesting publication. Nothing is uploaded by this view.'));status.setAttribute('role','status');const output=node(document,'pre');output.setAttribute('aria-live','polite');
  this.fields={};
  for(const [key,label]of[['artifact','Build artifact'],['version','Version'],['publishPurpose','Publication purpose'],['targetEnvironment','Target environment'],['requestId','Saved deployment request']]){const input=node(document,'input');input.type='text';input.value='';input.maxLength=key==='artifact'?4096:256;input.setAttribute('aria-label',t('publicationField'+key,label));if(key==='artifact')input.readOnly=true;const caption=node(document,'label',t('publicationField'+key,label));caption.append(input);this.fields[key]=input;this.node.append(caption);}
  const choose=node(document,'button',t('publicationChoose','Choose build artifact…')),review=node(document,'button',t('publicationReview','Review selected artifact')),observe=node(document,'button',t('publicationObserve','Read deployment status and logs')),cancel=node(document,'button',t('publicationStopObservation','Stop status query'));
  for(const button of[choose,review,observe,cancel]){button.type='button';button.className='theia-button secondary';}
  this.buttons={choose,review,observe,cancel};review.disabled=true;cancel.disabled=true;
  const busy=value=>{choose.disabled=value;review.disabled=value||!selectedURI;observe.disabled=value;cancel.disabled=!observing||observing.cancelled;};
  choose.addEventListener('click',()=>{if(!live)return;const request=++epoch;busy(true);void Promise.resolve().then(()=>{if(!live||request!==epoch)return;if(typeof target.ynxDesktopFiles?.open!=='function')throw Error('Native file picker unavailable');return target.ynxDesktopFiles.open({kind:'file'});}).then(result=>{if(!live||request!==epoch)return;if(result.cancelled||result.openedInNewWindow||!result.uris?.length)return;selectedURI=result.uris[0];this.fields.artifact.value=selectedURI;output.textContent='';},()=>{if(live&&request===epoch)status.textContent=t('publicationUnavailable','Publication is not ready. Your project files are preserved.');}).finally(()=>{if(live&&request===epoch)busy(false);});});
  const call=async action=>{
   const request=++epoch;let ownObservation,failed=false;busy(true);
   try{
    let body;
    if(action==='publication-preview'){
      const values={version:this.fields.version.value.trim(),publishPurpose:this.fields.publishPurpose.value.trim(),targetEnvironment:this.fields.targetEnvironment.value.trim()};
      if(!selectedURI||Object.values(values).some(value=>!value||value.length>256))throw Object.assign(Error('Complete the review fields'),{code:'IDE_PUBLICATION_REVIEW_FIELDS_REQUIRED'});
      body={artifactURI:selectedURI,...values};
    }else{const requestId=this.fields.requestId.value.trim();if(!REQUEST_ID.test(requestId))throw Object.assign(Error('A valid saved request ID is required'),{code:'IDE_PUBLICATION_REQUEST_ID_REQUIRED'});const observationId=target.crypto?.randomUUID();if(!REQUEST_ID.test(observationId||''))throw Error('Observation correlation unavailable');if(nativeReadOwners.has(target))throw Object.assign(Error('Previous native query cleanup is pending'),{code:'IDE_SERVICE_READ_CLEANUP_PENDING'});
      if(typeof target.ynxDesktopWallet?.approveDeploymentObservation!=='function'||typeof target.ynxDesktopWallet?.endDeploymentObservation!=='function')throw Object.assign(Error('Native read review is unavailable'),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
      ownObservation={id:observationId,cancelled:false,phase:'review'};nativeReadOwners.set(target,ownObservation);observing=ownObservation;busy(true);body={requestId,observationId};
      const approved=await target.ynxDesktopWallet.approveDeploymentObservation(requestId);
      if(!live||request!==epoch||ownObservation.cancelled)return;
      if(approved?.approved!==true||approved.requestId!==requestId)throw Object.assign(Error('Native read approval does not match this query'),{code:'IDE_SERVICE_READ_REVIEW_CANCELLED'});
      ownObservation.phase='query';}
    const result=await project.call(action,body);
    if(!live||request!==epoch)return;
    output.textContent=JSON.stringify(result,null,2);
    status.textContent=t(action==='publication-preview'?'publicationReviewOnly':'publicationObserved',action==='publication-preview'?'Local artifact reviewed. Signing and deployment still require their own approval.':'Original deployment status and logs read. No deployment was resubmitted.');
   }catch(error){failed=true;if(live&&request===epoch)status.textContent=publicationError(error,t);}
   finally{
    if(ownObservation&&observing===ownObservation&&!ownObservation.cancelled&&typeof target.ynxDesktopWallet?.endDeploymentObservation==='function'){
     try{await retireNativeRead(target,ownObservation);}catch(error){if(!failed&&live&&request===epoch)status.textContent=publicationError(error,t);}
    }
    if(observing===ownObservation)observing=undefined;if(live&&request===epoch)busy(false);
   }
  };
  const stopObservation=async()=>{
   const selected=observing;if(!selected||selected.cancelled)return;selected.cancelled=true;const request=++epoch;busy(true);
   try{
    // Retire native proof permission and backend observation independently.
    const stop=selected.phase==='query'?Promise.resolve().then(()=>project.call('publication-observe-cancel',{observationId:selected.id})):Promise.resolve();
    const revoke=retireNativeRead(target,selected);
    const results=await Promise.allSettled([revoke,stop]);const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    if(live&&request===epoch)status.textContent=t('publicationObservationStopped','Status and log query stopped.');
   }
   catch(error){if(live&&request===epoch)status.textContent=publicationError(error,t);}
   finally{if(observing===selected)observing=undefined;if(live&&request===epoch)busy(false);}
  };
  cancel.addEventListener('click',()=>{if(live)void stopObservation();});
  review.addEventListener('click',()=>{if(live)void call('publication-preview');});observe.addEventListener('click',()=>{if(live)void call('publication-observe');});
  this.node.append(choose,review,observe,cancel,status,output);this.status=status;this.output=output;
  this.toDispose.push({dispose(){if(observing)void stopObservation();live=false;epoch++;selectedURI=undefined;}});
 }
}
class ArtifactPublicationContribution{
 constructor(widgets,shell,translate){Object.assign(this,{widgets,shell,translate});}
 registerCommands(registry){registry.registerCommand({id:'ynx.publication.open',label:this.translate('publicationTitle','Publish project'),category:'YNX'},{execute:async()=>{const widget=await this.widgets.getOrCreateWidget(ID);if(!this.shell.getTabBarFor(widget))this.shell.addWidget(widget,{area:'left'});await this.shell.activateWidget(ID);}});}
 registerMenus(menus){menus.registerMenuAction([...CommonMenus.VIEW_VIEWS,'ynx-publication'],{commandId:'ynx.publication.open',label:this.translate('publicationTitle','Publish project'),order:'21'});}
}
module.exports={ArtifactPublicationWidget,ArtifactPublicationContribution,ARTIFACT_PUBLICATION_ID:ID};
