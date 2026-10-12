const {randomBytes}=require('node:crypto');
const escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Normal editor webview; no fetch, credentials, filesystem or model code in it.
function createLocalAIPanel(api,context,environment,connection,review){
 const t=(text,...args)=>api.l10n?.t?api.l10n.t(text,...args):text.replace(/\{(\d+)\}/g,(_,i)=>args[i]);
 let panel,draft='',source,proposal,result,error='',status='',epoch=0,controller,busy=false,disposed=false;
 const retire=()=>{++epoch;controller?.abort();controller=undefined;busy=false;proposal=undefined;result=undefined;};
 function render(){if(!panel||disposed)return;const nonce=randomBytes(18).toString('base64');
  const button=(action,label,disabled=false)=>`<button data-action="${action}" ${disabled?'disabled':''}>${escape(t(label))}</button>`;
  panel.webview.html=`<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">body{color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family);padding:20px}textarea{box-sizing:border-box;width:100%;min-height:100px;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{margin:6px;padding:8px}aside{border:1px solid var(--vscode-panel-border);padding:12px}</style></head><body><h2>${escape(t('YNX AI Builder'))}</h2><p role="status">${escape(status)}</p><p>${escape(t('Only this context is sent to the model after approval. Preview sends it to the admitted review service. No project files are collected automatically.'))}</p><label>${escape(t('Request'))}<textarea id="draft" ${busy?'disabled':''}>${escape(draft)}</textarea></label><h3>${escape(t('Selected context'))}</h3><pre>${escape(source?.selectedText||t('No selection captured. Select code, then reopen AI Builder.'))}</pre>${button('preview','Preview AI request',busy||!source)}${button('cancel','Stop waiting',!busy)}${error?`<p role="alert">${escape(error)}</p>`:''}${proposal?`<aside><h3>${escape(t('Approve this request'))}</h3><p>${escape(proposal.model)} · ${proposal.requestBytes} bytes</p><pre>${escape(proposal.wirePrompt)}</pre>${button('approve','Send reviewed context once',busy)}${button('reject','Reject request',busy)}</aside>`:''}${result?`<h3>${escape(t('Model result'))}</h3><p>${escape(result.model)}</p><pre>${escape(result.text)}</pre><pre>${escape(JSON.stringify(result.operation||{},null,2))}</pre>${result.edit?button('diff','Review suggested diff',busy):''}`:''}<script nonce="${nonce}">const api=acquireVsCodeApi(),field=document.getElementById('draft');field.addEventListener('input',()=>api.postMessage({action:'draft',text:field.value}));document.querySelectorAll('button[data-action]').forEach(b=>b.addEventListener('click',()=>api.postMessage({action:b.dataset.action})));</script></body></html>`;
 }
 async function run(action){
  if(disposed||busy)return;busy=true;const operation=++epoch;controller=new AbortController();const signal=controller.signal;render();
  try{await action(signal,operation);}catch(e){if(operation===epoch&&!disposed)error=t(e.code==='AI_NOT_SUPPLIED'?'The admitted AI service is not supplied. Nothing was sent.':e.code==='AI_UNKNOWN'?'The remote outcome is unknown. This request will not be resent.':'The AI request failed. Your draft is preserved. Review a new request to retry.');}
  finally{if(operation===epoch){busy=false;controller=undefined;render();}}
 }
 const current=async(operation)=>{if(disposed||operation!==epoch)throw Error('retired');await review.assertCaptured(source);if(disposed||operation!==epoch)throw Error('retired');};
 async function message(m){
  if(!m||typeof m.action!=='string')return;
  if(m.action==='draft'){if(busy||Object.keys(m).sort().join()!=='action,text'||typeof m.text!=='string'||Buffer.byteLength(m.text)>4096)return;draft=m.text;proposal=undefined;result=undefined;return;}
  if(Object.keys(m).join()!=='action')return;
  if(m.action==='cancel'){const wasApprove=busy&&status===t('Waiting for the model result');retire();error=t(wasApprove?'The remote outcome is unknown. This request will not be resent.':'Request cancelled. Nothing was approved.');render();return;}
  if(m.action==='reject'){if(!busy){proposal=undefined;render();}return;}
  if(m.action==='preview')return run(async(signal,operation)=>{
   proposal=undefined;result=undefined;error='';await current(operation);
   const value=await connection('context',{},signal);await current(operation);
   if(!value.available){status=t('AI service not connected');error=t('The admitted AI service is not supplied. Nothing was sent.');return;}
   if(!draft.trim()||Buffer.byteLength(draft)>4096)throw Error('invalid');
   const selected=JSON.stringify({uri:source.uri,version:source.version,fullTextDigest:source.fullTextDigest,selectedText:source.selectedText,sessionId:value.sessionId});
   const next=await connection('proposals',{csrf:value.csrf,prompt:draft,context:selected,mode:'selected-edit'},signal);await current(operation);
   if(next.prompt!==draft||next.context!==selected||next.mode!=='selected-edit'||!Number.isFinite(next.expiresAt)||next.expiresAt<=Date.now())throw Error('changed');proposal=next;status=t('Request ready for approval');
  });
  if(m.action==='approve'&&proposal)return run(async(signal,operation)=>{
   const approved=proposal, captured=source;proposal=undefined;result=undefined;await current(operation);
   if(approved.expiresAt<=Date.now())throw Error('expired');
   const attempt=await review.beginTransmission(captured);
   try {
   if(disposed||operation!==epoch||signal.aborted||source!==captured){await review.finishTransmission(captured,attempt,'not-dispatched');throw Error('retired');}
   status=t('Waiting for the model result');render();
   const value=await connection('approve',{csrf:approved.csrf,proposalId:approved.proposalId,approval:'send-reviewed-context-once'},signal);
   // Declined is authoritative no-dispatch; UNKNOWN retains possible sending.
   if(value.rejected===true){await review.finishTransmission(captured,attempt,'not-dispatched');await current(operation);if(signal.aborted||source!==captured)throw Error('retired');status=t('Request rejected');return;}
   await current(operation);
   if(value.model!==approved.model||value.edit?.bundle?.sessionId!==JSON.parse(approved.context).sessionId)throw Error('model or session mismatch');
   await review.finishTransmission(captured,attempt,'confirmed');
   await current(operation);
   if(disposed||operation!==epoch||signal.aborted||source!==captured)throw Error('retired');
   result=value;error='';status=t('Model result received. Review the diff before applying.');
   } catch (failure) { await review.finishTransmission(captured,attempt,'unknown').catch(()=>{}); throw failure; }
  });
  if(m.action==='diff'&&result?.edit)return run(async(_signal,operation)=>{await current(operation);await review.stageGenerated(source,result);await review.open(false);});
 }
 async function open(){
  if(disposed)return;retire();error='';const operation=epoch;
  let captured;try{captured=await review.captureAI();}catch{captured=undefined;}
  if(disposed||operation!==epoch)return;source=captured;
  if(!panel){panel=api.window.createWebviewPanel('ynx.localAI',t('YNX AI Builder'),api.ViewColumn.Beside,{enableScripts:true,localResourceRoots:[]});
   panel.webview.onDidReceiveMessage(message,undefined,context.subscriptions);panel.onDidDispose(()=>{retire();panel=undefined;},undefined,context.subscriptions);
  }else panel.reveal(api.ViewColumn.Beside);
  status=t('AI availability has not been checked');render();
 }
 context.subscriptions.push(api.workspace.onDidChangeTextDocument(event=>{if(source&&event.document.uri.toString()===source.uri){retire();error=t('The source changed. Capture a fresh selection.');render();}}));
 if(api.workspace.onDidChangeWorkspaceFolders)context.subscriptions.push(api.workspace.onDidChangeWorkspaceFolders(()=>{retire();source=undefined;render();}));
 context.subscriptions.push(api.window.onDidChangeActiveTextEditor(editor=>{if(source&&editor&&editor.document.uri.toString()!==source.uri){retire();source=undefined;render();}}));
 context.subscriptions.push({dispose(){disposed=true;retire();panel?.dispose();}});
 return {open,message,state:()=>({draft,source,proposal,result,error,status,busy})};
}
module.exports={createLocalAIPanel,escape};
