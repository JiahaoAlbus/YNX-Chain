'use strict';
const {BaseWidget}=require('@theia/core/lib/browser/widgets');
const {CommonMenus}=require('@theia/core/lib/browser/common-menus');
const ID='ynx-contract-deployment',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const errorKey=error=>({PQ_CONTRACT_DEPLOYMENT_MATERIAL_INVALID:'deployInvalidMaterial',IDE_CONTRACT_MATERIAL_REVIEW_REQUIRED:'deployReviewAgain',IDE_CONTRACT_NOT_CONNECTED:'deployConnectFirst',IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED:'deployOriginalQueryRequired',IDE_CONTRACT_REFERENCE_EXISTS:'deployOriginalQueryRequired',IDE_CONTRACT_SIGNED_REFERENCE_INVALID:'deployOriginalQueryRequired',IDE_CONTRACT_REFERENCE_NOT_DURABLE:'deployOriginalQueryRequired'})[error?.code];
function element(document,tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
class ContractDeploymentWidget extends BaseWidget{
 constructor(project,target,commands,translate){
  super();this.id=ID;this.title.label=translate('deployTitle','Review testnet deployment');this.title.caption=this.title.label;this.title.closable=true;this.title.iconClass='codicon codicon-rocket';
  const document=this.node.ownerDocument,t=(key,text)=>translate(key,text);let live=true,epoch=0,busy=false,configured=false,draft,entered=false,prepared=false,broadcastEntered=false;
  const status=element(document,'p',t('deployNote','Supports the two admitted YNX Testnet contracts. Review real compiler files, then approve signing and broadcast separately in Wallet.'));status.setAttribute('role','status');
  const output=element(document,'pre');output.setAttribute('aria-live','polite');this.fields={};this.buttons={};
  const name=element(document,'select');name.className='theia-select';name.value='';for(const value of['','SampleEVMWriteCounter','SampleYNXTCompatibleERC20']){const option=element(document,'option',value||t('deployChooseName','Select an admitted contract'));option.value=value;name.append(option);}name.setAttribute('aria-label',t('deployName','Contract'));this.fields.name=name;this.node.append(name);
  const recent=element(document,'select');recent.className='theia-select';recent.setAttribute('aria-label',t('deployRecent','Saved project requests'));this.node.append(recent);recent.addEventListener('change',()=>{if(UUID.test(recent.value||'')){this.fields.referenceId.value=recent.value;prepared=false;refresh();}});
  for(const [key,label]of[['sourceURI','Solidity source'],['artifactURI','Compiler artifact JSON'],['buildInfoURI','Compiler build-info JSON'],['constructorArg','Constructor value'],['referenceId','Saved request reference']]){
    const input=element(document,'input');input.type='text';input.className='theia-input';input.value='';input.maxLength=key.endsWith('URI')?4096:key==='constructorArg'?20:36;input.setAttribute('aria-label',t('deployField'+key,label));if(key==='constructorArg')input.placeholder='0 … 18446744073709551615';if(key.endsWith('URI'))input.readOnly=true;const caption=element(document,'label',t('deployField'+key,label));caption.append(input);this.node.append(caption);this.fields[key]=input;
  }
  const refresh=()=>{for(const[key,button]of Object.entries(this.buttons))button.disabled=busy||(key==='prepare'&&(!configured||!draft||entered))||(key==='broadcast'&&(!configured||!prepared||broadcastEntered))||(key==='query'&&!configured);name.disabled=busy;this.fields.constructorArg.disabled=busy;this.fields.referenceId.disabled=busy;recent.disabled=busy;};
  const invalidate=()=>{epoch++;draft=undefined;entered=false;prepared=false;broadcastEntered=false;output.textContent='';refresh();};
  name.addEventListener('change',invalidate);this.fields.constructorArg.addEventListener('input',invalidate);
  this.fields.referenceId.addEventListener('input',()=>{prepared=false;refresh();});
  const button=(key,text,click)=>{const node=element(document,'button',t('deployButton'+key,text));node.type='button';node.className='theia-button secondary';node.addEventListener('click',()=>{if(live&&!node.disabled)click();});this.buttons[key]=node;this.node.append(node);return node;};
  for(const [key,label]of[['sourceURI','Choose source…'],['artifactURI','Choose artifact…'],['buildInfoURI','Choose build-info…']])button(key,label,()=>{
    const request=++epoch;busy=true;refresh();void Promise.resolve().then(()=>{if(typeof target.ynxDesktopFiles?.open!=='function')throw Error('Native picker unavailable');return target.ynxDesktopFiles.open({kind:'file'});}).then(result=>{if(!live||epoch!==request||result.cancelled||result.openedInNewWindow||!result.uris?.length)return;this.fields[key].value=result.uris[0];draft=undefined;entered=false;prepared=false;broadcastEntered=false;output.textContent='';},()=>{if(live&&epoch===request)status.textContent=t('deployUnavailable','Deployment service or materials are unavailable. Existing requests were preserved.');}).finally(()=>{if(live&&epoch===request){busy=false;refresh();}});
  });
  const call=async action=>{
    const request=++epoch;busy=true;refresh();
    try{
      let body;
      if(action==='deployment-preview'){body=Object.fromEntries(['name','sourceURI','artifactURI','buildInfoURI','constructorArg'].map(key=>[key,this.fields[key].value]));if(Object.values(body).some(value=>!value))throw Error('Choose real files and an explicit constructor value');}
      else if(action==='deployment-prepare'){if(!draft||entered)throw Error('Review required');entered=true;body={draftId:draft.draftId};}
      else if(action==='deployment-broadcast'){if(!draft||!prepared||broadcastEntered)throw Error('Signed preparation required');broadcastEntered=true;this.fields.referenceId.value=draft.broadcastReferenceId;body={referenceId:draft.referenceId};}
      else body=action==='references'?{}:action==='read'?{referenceId:this.fields.referenceId.value.trim()}:{referenceId:this.fields.referenceId.value.trim(),refresh:true};
      const result=await project.call(action,body);if(!live||epoch!==request)return;output.textContent=JSON.stringify(result,null,2);
      if(action==='deployment-preview'){draft=result;this.fields.referenceId.value=result.referenceId;entered=false;prepared=false;broadcastEntered=false;status.textContent=t('deployReviewed','Materials reviewed locally. Nothing has been signed or broadcast.');}
      else if(action==='deployment-prepare'){prepared=result?.reference?.state==='saved'&&typeof result.reference.operationId==='string'&&result?.result?.savedLocally===true&&result.result.submitted===false;status.textContent=t('deployPrepared','Wallet preparation returned. Broadcast requires another explicit Wallet review.');}
      else{if(action==='references'&&Array.isArray(result)){recent.replaceChildren();for(const row of result){const option=element(document,'option',`${row.method} · ${row.state} · ${row.referenceId}`);option.value=row.referenceId;recent.append(option);}if(result[0])this.fields.referenceId.value=result[0].referenceId;prepared=false;}status.textContent=t('deployQueryOnly','Inspect the original result. This view does not infer chain confirmation or retry an UNKNOWN operation.');}
    }catch(error){if(live&&epoch===request){if(UUID.test(error?.referenceId||'')){this.fields.referenceId.value=error.referenceId;prepared=false;}const key=errorKey(error);status.textContent=key?t(key,{deployInvalidMaterial:'Choose matching compiler files for one of the two supported contracts and an explicit uint64 constructor value.',deployReviewAgain:'Project or compiler files changed. Review the actual materials again.',deployConnectFirst:'Connect this project in Wallet before requesting signing.',deployOriginalQueryRequired:'An original request must be queried. Do not sign or broadcast it again.'}[key]):t('deployUnavailable','Deployment service or materials are unavailable. Existing requests were preserved.');}}
    finally{if(live&&epoch===request){busy=false;refresh();}}
  };
  button('review','Review compiler materials',()=>void call('deployment-preview'));
  button('connect','Open project Wallet',()=>void commands.executeCommand('ynx.workbench.wallet'));
  button('prepare','Request signing review',()=>void call('deployment-prepare'));
  button('broadcast','Request separate broadcast review',()=>void call('deployment-broadcast'));
  button('read','Read saved reference',()=>void call('read'));
  button('references','Find saved project requests',()=>void call('references'));
  button('query','Query original Wallet result',()=>void call('query'));
  this.node.append(status,output);this.status=status;this.output=output;refresh();
  void project.call('inspect',{}).then(value=>{if(live){configured=value?.onlineConfigured===true;refresh();}},()=>{});
  this.toDispose.push({dispose(){live=false;epoch++;draft=undefined;}});
 }
 storeState(){return{referenceId:this.fields.referenceId.value};}
 restoreState(state){if(UUID.test(state?.referenceId||''))this.fields.referenceId.value=state.referenceId;}
}
class ContractDeploymentContribution{
 constructor(widgets,shell,translate){Object.assign(this,{widgets,shell,translate});}
 registerCommands(commands){commands.registerCommand({id:'ynx.deploy.open',label:this.translate('deployTitle','Review testnet deployment'),category:'YNX'},{execute:async()=>{const widget=await this.widgets.getOrCreateWidget(ID);if(!this.shell.getTabBarFor(widget))this.shell.addWidget(widget,{area:'left'});await this.shell.activateWidget(ID);}});}
 registerMenus(menus){menus.registerMenuAction([...CommonMenus.VIEW_VIEWS,'ynx-deploy'],{commandId:'ynx.deploy.open',label:this.translate('deployTitle','Review testnet deployment'),order:'22'});}
}
module.exports={ContractDeploymentWidget,ContractDeploymentContribution,CONTRACT_DEPLOYMENT_ID:ID};
