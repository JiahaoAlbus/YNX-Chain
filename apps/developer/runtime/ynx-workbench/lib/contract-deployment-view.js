'use strict';
const {BaseWidget}=require('@theia/core/lib/browser/widgets');
const {CommonMenus}=require('@theia/core/lib/browser/common-menus');
const ID='ynx-contract-deployment',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const errorKey=error=>({IDE_CONTRACT_REFERENCE_INPUT_REQUIRED:'deployReferenceRequired',PQ_CONTRACT_DEPLOYMENT_MATERIAL_INVALID:'deployInvalidMaterial',IDE_CONTRACT_MATERIAL_REVIEW_REQUIRED:'deployReviewAgain',IDE_CONTRACT_EXECUTION_REVIEW_REQUIRED:'executeInvalidCall',PQ_NATIVE_ACTION_INVALID:'executeInvalidCall',IDE_CONTRACT_ORIGINAL_RESULT_INVALID:'deployOriginalQueryRequired',IDE_CONTRACT_NOT_CONNECTED:'deployConnectFirst',IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED:'deployOriginalQueryRequired',IDE_CONTRACT_REFERENCE_EXISTS:'deployOriginalQueryRequired',IDE_CONTRACT_SIGNED_REFERENCE_INVALID:'deployOriginalQueryRequired',IDE_CONTRACT_REFERENCE_NOT_DURABLE:'deployOriginalQueryRequired'})[error?.code];
function element(document,tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
class ContractDeploymentWidget extends BaseWidget{
 constructor(project,target,commands,translate){
  super();this.id=ID;this.title.label=translate('deployTitle','Review testnet deployment');this.title.caption=this.title.label;this.title.closable=true;this.title.iconClass='codicon codicon-rocket';
  const document=this.node.ownerDocument,t=(key,text)=>translate(key,text);let live=true,epoch=0,busy=false,configured=false,draft,entered=false,prepared=false,broadcastEntered=false,cancelling=false,pendingAction,serviceProblem;
  this.node.className=(this.node.className||'')+' ynx-contract-deployment';
  const section=(key,title)=>{const node=element(document,'section');node.className='ynx-contract-section';node.append(element(document,'h3',t(key,title)));this.node.append(node);return node;};
  const materials=section('deployMaterialsStep','1 · Contract and materials');
  const preview=section('deployPreviewStep','2 · Review current inputs');
  const wallet=section('deployWalletStep','3 · Wallet approval');
  const history=section('deployHistoryStep','4 · Original requests and recovery');
  const walletHint=element(document,'p');walletHint.className='ynx-contract-hint';walletHint.setAttribute('role','status');wallet.append(walletHint);
  const status=element(document,'p',t('deployNote','Supports the two admitted YNX Testnet contracts. Review real compiler files, then approve signing and broadcast separately in Wallet.'));status.setAttribute('role','status');
  const legacyNotice=element(document,'p');legacyNotice.hidden=true;legacyNotice.setAttribute('role','status');
  const output=element(document,'pre');output.tabIndex=0;output.setAttribute('aria-label',t('deployResultDetails','Original result details'));this.fields={};this.buttons={};
  const details=element(document,'details'),summary=element(document,'summary',t('deployResultDetails','Original result details'));details.className='ynx-contract-details';details.open=false;details.append(summary,output);
  const copy=element(document,'button',t('deployCopyDetails','Copy result details'));copy.type='button';copy.className='theia-button secondary';copy.addEventListener('click',()=>{if(!live||copy.disabled)return;const captured=output.textContent;void Promise.resolve().then(()=>{if(!live)return;if(typeof target.navigator?.clipboard?.writeText!=='function')throw Error('Clipboard unavailable');return target.navigator.clipboard.writeText(captured);}).catch(()=>{if(live){details.open=true;status.textContent=t('deployCopyFallback','Select the result details and use Copy from the Edit menu.');}});});details.append(copy);
  const mode=element(document,'select');mode.className='theia-select';mode.value='deploy';mode.setAttribute('aria-label',t('contractOperation','Contract operation'));
  for(const[value,label]of[['deploy','Deploy supported contract'],['execute','Call deployed contract']]){const option=element(document,'option',t('contractOperation'+value,label));option.value=value;mode.append(option);}this.fields.mode=mode;const modeLabel=element(document,'label',t('contractOperation','Contract operation'));modeLabel.append(mode);materials.append(modeLabel);
  const name=element(document,'select');name.className='theia-select';name.value='';for(const value of['','SampleEVMWriteCounter','SampleYNXTCompatibleERC20']){const option=element(document,'option',value||t('deployChooseName','Select an admitted contract'));option.value=value;name.append(option);}name.setAttribute('aria-label',t('deployName','Contract'));this.fields.name=name;const nameLabel=element(document,'label',t('deployName','Contract'));nameLabel.append(name);materials.append(nameLabel);
  const recent=element(document,'select');recent.className='theia-select';recent.setAttribute('aria-label',t('deployRecent','Saved project requests'));const recentLabel=element(document,'label',t('deployRecent','Saved project requests'));recentLabel.append(recent);history.append(recentLabel);recent.addEventListener('change',()=>{if(UUID.test(recent.value||'')){this.fields.referenceId.value=recent.value;invalidate();}});
  const labels={},reasons={};this.disabledReasons=reasons;
  for(const [key,label]of[['sourceURI','Solidity source'],['artifactURI','Compiler artifact JSON'],['buildInfoURI','Compiler build-info JSON'],['constructorArg','Constructor value'],['referenceId','Saved request reference']]){
    const input=element(document,'input');input.type='text';input.className='theia-input';input.value='';input.maxLength=key.endsWith('URI')?4096:key==='constructorArg'?20:36;input.setAttribute('aria-label',t('deployField'+key,label));if(key==='constructorArg')input.placeholder='0 … 18446744073709551615';if(key.endsWith('URI'))input.readOnly=true;const caption=element(document,'label',t('deployField'+key,label));caption.append(input);(key==='referenceId'?history:materials).append(caption);this.fields[key]=input;labels[key]=caption;
  }
  const callFields=['target','sourceHash','deployedBytecodeHash','compilerConfigHash','expectedStorageCommitment','calldata'];
  for(const key of callFields){const label=t('executeField'+key,{target:'Deployed contract address',sourceHash:'Registered source hash',deployedBytecodeHash:'Deployed bytecode hash',compilerConfigHash:'Compiler configuration hash',expectedStorageCommitment:'Expected storage commitment',calldata:'Encoded function call'}[key]),input=element(document,'input'),caption=element(document,'label',label);input.type='text';input.className='theia-input';input.maxLength=4096;input.value='';input.setAttribute('aria-label',label);caption.append(input);materials.append(caption);this.fields[key]=input;labels[key]=caption;}
  const serviceReason=()=>serviceProblem==='verification'?t('deployWalletVerification','The local Wallet connection could not be verified. Check Wallet setup before reconnecting. Local development remains available.'):serviceProblem==='wallet'?t('deployConnectFirst','Connect this project in Wallet before requesting signing.'):serviceProblem==='not-supplied'||!configured?t('deployServiceMissing','The project deployment service is not connected yet. Local file editing remains available.'):t('deployServiceRetry','The project service connection is unavailable. Retry the read or open project Wallet to check it.');
  const reasonFor=key=>{
    if(key==='cancel')return cancelling?t('deployCancellingHint','The current request is being cancelled.'):t('deployNoPending','There is no pending request to cancel.');
    if(busy)return t('deployBusyHint','A project request is pending. Cancel it before starting another.');
    if(key==='prepare'||key==='broadcast'){
      if(broadcastEntered||(entered&&!prepared))return t('deployOriginalQueryRequired','An original request must be queried. Do not sign or broadcast it again.');
      if(serviceProblem||!configured)return serviceReason();
      if(key==='prepare'&&entered)return t('deployAlreadyPrepared','This signing request is already recorded. Continue with its separate broadcast review or query its original result.');
      if(key==='broadcast'&&!prepared)return t('deploySignatureFirst','Complete the separate Wallet signing review before requesting broadcast.');
      if(!draft)return mode.value==='execute'?t('deployCallReviewFirst','Complete and review the contract call before requesting signing.'):t('deployMaterialsFirst','Choose the contract, matching compiler files and constructor value, then review them.');
    }
    if(key==='query'&&!configured)return serviceReason();
    return '';
  };
  const refresh=()=>{
    const executing=mode.value==='execute';
    for(const[key,button]of Object.entries(this.buttons)){
      button.disabled=key==='cancel'?(!busy||cancelling):busy||(key==='prepare'&&(!configured||!draft||entered||!!serviceProblem))||(key==='broadcast'&&(!configured||!prepared||broadcastEntered||!!serviceProblem))||(key==='query'&&!configured);
      if(['sourceURI','artifactURI','buildInfoURI'].includes(key))button.hidden=executing;
      const explanation=button.disabled?reasonFor(key):'';button.title=explanation;
      if(reasons[key]){reasons[key].textContent=explanation;reasons[key].hidden=!button.disabled||busy||!['prepare','broadcast','query','cancel'].includes(key);}
    }
    for(const input of Object.values(this.fields))input.disabled=busy;
    for(const key of ['sourceURI','artifactURI','buildInfoURI','constructorArg'])labels[key].hidden=executing;
    for(const key of callFields)labels[key].hidden=!executing;
    if(this.buttons.review){this.buttons.review.textContent=executing?t('executeReview','Review contract call'):t('deployButtonreview','Review compiler materials');this.buttons.review.setAttribute('aria-label',this.buttons.review.textContent);}
    recent.disabled=busy;copy.disabled=busy||!output.textContent;copy.title=copy.disabled?(busy?t('deployBusyHint','A project request is pending. Cancel it before starting another.'):t('deployNoResult','There is no result to copy yet.')):'';
    walletHint.textContent=busy?t('deployBusyHint','A project request is pending. Cancel it before starting another.'):serviceProblem||!configured?serviceReason():!draft?t('deployReviewHint','Review current inputs first. Signing remains disabled until that review succeeds.'):broadcastEntered||(entered&&!prepared)?t('deployOriginalQueryRequired','An original request must be queried. Do not sign or broadcast it again.'):!prepared?t('deploySignHint','Approve signing in Wallet. This does not submit a transaction.'):t('deployBroadcastHint','Signing preparation is saved. Broadcasting needs its own Wallet approval.');
  };
  const invalidate=()=>{epoch++;draft=undefined;entered=false;prepared=false;broadcastEntered=false;output.textContent='';status.textContent=t('contractReviewRequired','Review the current materials or contract call before requesting Wallet approval.');refresh();};
  name.addEventListener('change',invalidate);this.fields.constructorArg.addEventListener('input',invalidate);
  mode.addEventListener('change',invalidate);for(const key of callFields)this.fields[key].addEventListener('input',invalidate);
  this.fields.referenceId.addEventListener('input',invalidate);
  const button=(key,text,click)=>{const node=element(document,'button',t('deployButton'+key,text));node.type='button';node.className='theia-button secondary';node.addEventListener('click',()=>{if(live&&!node.disabled)click();});node.setAttribute('aria-label',node.textContent);const reason=element(document,'p');reason.className='ynx-contract-disabled-reason';reason.id=ID+'-'+key+'-reason';node.setAttribute('aria-describedby',reason.id);reasons[key]=reason;this.buttons[key]=node;(labels[key]||(['read','references','query'].includes(key)?history:key==='review'?preview:wallet)).append(node,reason);return node;};
  for(const [key,label]of[['sourceURI','Choose source…'],['artifactURI','Choose artifact…'],['buildInfoURI','Choose build-info…']])button(key,label,()=>{
    const request=++epoch;busy=true;refresh();void Promise.resolve().then(()=>{if(!live||epoch!==request)return{cancelled:true};if(typeof target.ynxDesktopFiles?.open!=='function')throw Error('Native picker unavailable');return target.ynxDesktopFiles.open({kind:'file'});}).then(result=>{if(!live||epoch!==request||result.cancelled||result.openedInNewWindow||!result.uris?.length)return;this.fields[key].value=result.uris[0];this.fields[key].title=result.uris[0];draft=undefined;entered=false;prepared=false;broadcastEntered=false;output.textContent='';},()=>{if(live&&epoch===request)status.textContent=t('deployPickerUnavailable','The system file window could not be opened. Retry choosing the file; existing requests are preserved.');}).finally(()=>{if(live&&epoch===request){busy=false;refresh();}});
  });
  const call=async action=>{
    if(action.endsWith('-preview')||action==='references'||action==='cancel'){draft=undefined;entered=false;prepared=false;broadcastEntered=false;}
    const request=++epoch;busy=true;refresh();
    try{
      let body;
      if(action==='deployment-preview'){body=Object.fromEntries(['name','sourceURI','artifactURI','buildInfoURI','constructorArg'].map(key=>[key,this.fields[key].value]));if(Object.values(body).some(value=>!value))throw Object.assign(Error('Choose real files and an explicit constructor value'),{code:'PQ_CONTRACT_DEPLOYMENT_MATERIAL_INVALID'});}
      else if(action==='execution-preview'){body={...Object.fromEntries(['name',...callFields].map(key=>[key,this.fields[key].value])),value:'0'};if(Object.values(body).some(value=>!value))throw Object.assign(Error('Complete contract call fields'),{code:'PQ_NATIVE_ACTION_INVALID'});}
      else if(action==='deployment-prepare'||action==='execution-prepare'){if(!draft||entered)throw Error('Review required');entered=true;body={draftId:draft.draftId};}
      else if(action==='deployment-broadcast'||action==='execution-broadcast'){if(!draft||!prepared||broadcastEntered)throw Error('Signed preparation required');broadcastEntered=true;this.fields.referenceId.value=draft.broadcastReferenceId;body={referenceId:draft.referenceId};}
      else body=(action==='references'||action==='cancel')?{}:action==='read'?{referenceId:this.fields.referenceId.value.trim()}:{referenceId:this.fields.referenceId.value.trim(),refresh:true};
      if((action==='read'||action==='query')&&!UUID.test(body.referenceId||''))throw Object.assign(Error('Saved reference required'),{code:'IDE_CONTRACT_REFERENCE_INPUT_REQUIRED'});
      pendingAction=action;const result=await project.call(action,body);if(!live||epoch!==request)return;output.textContent=JSON.stringify(result,null,2);if(action==='query'||action.endsWith('-preview')||action.endsWith('-prepare')||action.endsWith('-broadcast'))serviceProblem=undefined;
      if(action==='deployment-preview'||action==='execution-preview'){draft=result;this.fields.referenceId.value=result.referenceId;entered=false;prepared=false;broadcastEntered=false;status.textContent=t('deployReviewed','Materials reviewed locally. Nothing has been signed or broadcast.');}
      else if(action==='deployment-prepare'||action==='execution-prepare'){prepared=result?.reference?.state==='saved'&&typeof result.reference.operationId==='string'&&result?.result?.savedLocally===true&&result.result.submitted===false;status.textContent=t('deployPrepared','Wallet preparation returned. Broadcast requires another explicit Wallet review.');}
      else{if(action==='references'){if(result?.version!==2||!Array.isArray(result.references)||!['none','retained-scope-unavailable'].includes(result.legacy?.state))throw Error('Invalid history response');legacyNotice.hidden=result.legacy.state==='none'&&result.uncertainWriter!==true;legacyNotice.textContent=legacyNotice.hidden?'':result.uncertainWriter===true?t('deployWriterUncertain','Retained request writes are incomplete. Check the original Wallet result before preparing again.'):t('deployLegacyUnavailable','Earlier request records are retained but unavailable under this project scope. Do not recreate an UNKNOWN request; check the original Wallet result.');recent.replaceChildren();for(const row of result.references){const option=element(document,'option',`${row.method} · ${row.state} · ${row.referenceId}`);option.value=row.referenceId;recent.append(option);}if(result.references[0])this.fields.referenceId.value=result.references[0].referenceId;prepared=false;}status.textContent=t('deployQueryOnly','Inspect the original result. This view does not infer chain confirmation or retry an UNKNOWN operation.');}
    }catch(error){if(live&&epoch===request){if(UUID.test(error?.referenceId||'')){this.fields.referenceId.value=error.referenceId;prepared=false;}const key=errorKey(error);if(key==='deployConnectFirst')serviceProblem='wallet';else if(error?.code==='YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE')serviceProblem='verification';else if(!key)serviceProblem=['IDE_CONTRACT_NOT_SUPPLIED','IDE_CONTRACT_SERVICE_UNAVAILABLE','AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED','YNX_CONTRACT_RELAY_INITIATOR_ROLE_BOUNDARY_UNQUALIFIED'].includes(error?.code)?'not-supplied':'unavailable';status.textContent=key?t(key,{deployReferenceRequired:'Enter a valid saved request reference before reading or querying its result.',executeInvalidCall:'Review the supported contract, registered hashes, current storage commitment and encoded call. No transaction was automatically retried.',deployInvalidMaterial:'Choose matching compiler files for one of the two supported contracts and an explicit uint64 constructor value.',deployReviewAgain:'Project or compiler files changed. Review the actual materials again.',deployConnectFirst:'Connect this project in Wallet before requesting signing.',deployOriginalQueryRequired:'An original request must be queried. Do not sign or broadcast it again.'}[key]):serviceReason();}}
    finally{if(live&&epoch===request){pendingAction=undefined;busy=false;refresh();}}
  };
  const action=suffix=>(mode.value==='execute'?'execution':'deployment')+'-'+suffix;
  button('review','Review compiler materials',()=>void call(action('preview')));
  button('connect','Open project Wallet',()=>void commands.executeCommand('ynx.workbench.wallet'));
  button('prepare','Request signing review',()=>void call(action('prepare')));
  button('broadcast','Request separate broadcast review',()=>void call(action('broadcast')));
  // Retire this project's pending attempt through the existing host. Advancing
  // the epoch prevents a late Wallet reply from restoring signing authority.
  // Cancellation does not undo a signature or submission: retain the reference.
  button('cancel','Cancel pending request',()=>{
    if(cancelling)return;cancelling=true;
    void call('cancel').finally(()=>{if(live){cancelling=false;refresh();}});
  });
  button('read','Read saved reference',()=>void call('read'));
  button('references','Find saved project requests',()=>void call('references'));
  button('query','Query original Wallet result',()=>void call('query'));
  preview.append(status);this.node.append(legacyNotice,details);this.status=status;this.output=output;this.resultDetails=details;this.copyDetails=copy;refresh();
  void project.call('inspect',{}).then(value=>{if(live){configured=value?.onlineConfigured===true;refresh();}},()=>{if(live){configured=false;serviceProblem='not-supplied';status.textContent=serviceReason();refresh();}});
  this.toDispose.push({dispose(){live=false;epoch++;draft=undefined;if(['deployment-prepare','deployment-broadcast','execution-prepare','execution-broadcast'].includes(pendingAction))void project.call('cancel',{}).catch(()=>{});}});
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
