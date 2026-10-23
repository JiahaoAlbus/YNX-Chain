'use strict';
const {BaseWidget}=require('@theia/core/lib/browser/widgets');
const {CommonMenus}=require('@theia/core/lib/browser/common-menus');
const ID='ynx-artifact-publication';
function node(document,tag,text){const value=document.createElement(tag);if(text!==undefined)value.textContent=text;return value;}
class ArtifactPublicationWidget extends BaseWidget{
 constructor(project,target,translate){
  super();this.id=ID;this.title.label=translate('publicationTitle','Publish project');this.title.caption=this.title.label;this.title.closable=true;this.title.iconClass='codicon codicon-cloud-upload';
  const document=this.node.ownerDocument,t=(key,text)=>translate(key,text);let live=true,epoch=0,selectedURI;
  const status=node(document,'p',t('publicationNote','Review a built project file before requesting publication. Nothing is uploaded by this view.'));status.setAttribute('role','status');const output=node(document,'pre');output.setAttribute('aria-live','polite');
  this.fields={};
  for(const [key,label]of[['artifact','Build artifact'],['version','Version'],['publishPurpose','Publication purpose'],['targetEnvironment','Target environment'],['requestId','Saved deployment request']]){const input=node(document,'input');input.type='text';input.value='';input.maxLength=key==='artifact'?4096:256;input.setAttribute('aria-label',t('publicationField'+key,label));if(key==='artifact')input.readOnly=true;const caption=node(document,'label',t('publicationField'+key,label));caption.append(input);this.fields[key]=input;this.node.append(caption);}
  const choose=node(document,'button',t('publicationChoose','Choose build artifact…')),review=node(document,'button',t('publicationReview','Review selected artifact')),observe=node(document,'button',t('publicationObserve','Read deployment status and logs'));
  for(const button of[choose,review,observe]){button.type='button';button.className='theia-button secondary';}
  this.buttons={choose,review,observe};review.disabled=true;
  const busy=value=>{choose.disabled=value;review.disabled=value||!selectedURI;observe.disabled=value;};
  choose.addEventListener('click',()=>{if(!live)return;const request=++epoch;busy(true);void Promise.resolve().then(()=>{if(typeof target.ynxDesktopFiles?.open!=='function')throw Error('Native file picker unavailable');return target.ynxDesktopFiles.open({kind:'file'});}).then(result=>{if(!live||request!==epoch)return;if(result.cancelled||result.openedInNewWindow||!result.uris?.length)return;selectedURI=result.uris[0];this.fields.artifact.value=selectedURI;output.textContent='';},()=>{if(live&&request===epoch)status.textContent=t('publicationUnavailable','Publication is not ready. Your project files are preserved.');}).finally(()=>{if(live&&request===epoch)busy(false);});});
  const call=async action=>{
   const request=++epoch;busy(true);
   try{
    let body;
    if(action==='publication-preview'){
      const values={version:this.fields.version.value.trim(),publishPurpose:this.fields.publishPurpose.value.trim(),targetEnvironment:this.fields.targetEnvironment.value.trim()};
      if(!selectedURI||Object.values(values).some(value=>!value))throw Error('Complete the review fields');
      body={artifactURI:selectedURI,...values};
    }else body={requestId:this.fields.requestId.value.trim()};
    const result=await project.call(action,body);
    if(!live||request!==epoch)return;
    output.textContent=JSON.stringify(result,null,2);
    status.textContent=t(action==='publication-preview'?'publicationReviewOnly':'publicationObserved',action==='publication-preview'?'Local artifact reviewed. Signing and deployment still require their own approval.':'Original deployment status and logs read. No deployment was resubmitted.');
   }catch{if(live&&request===epoch)status.textContent=t('publicationUnavailable','Publication is not ready. Your project files are preserved.');}
   finally{if(live&&request===epoch)busy(false);}
  };
  review.addEventListener('click',()=>{if(live)void call('publication-preview');});observe.addEventListener('click',()=>{if(live)void call('publication-observe');});
  this.node.append(choose,review,observe,status,output);this.status=status;this.output=output;
  this.toDispose.push({dispose(){live=false;epoch++;selectedURI=undefined;}});
 }
}
class ArtifactPublicationContribution{
 constructor(widgets,shell,translate){Object.assign(this,{widgets,shell,translate});}
 registerCommands(registry){registry.registerCommand({id:'ynx.publication.open',label:this.translate('publicationTitle','Publish project'),category:'YNX'},{execute:async()=>{const widget=await this.widgets.getOrCreateWidget(ID);if(!this.shell.getTabBarFor(widget))this.shell.addWidget(widget,{area:'left'});await this.shell.activateWidget(ID);}});}
 registerMenus(menus){menus.registerMenuAction([...CommonMenus.VIEW_VIEWS,'ynx-publication'],{commandId:'ynx.publication.open',label:this.translate('publicationTitle','Publish project'),order:'21'});}
}
module.exports={ArtifactPublicationWidget,ArtifactPublicationContribution,ARTIFACT_PUBLICATION_ID:ID};
