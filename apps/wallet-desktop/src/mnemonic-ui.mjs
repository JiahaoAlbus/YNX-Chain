import {setWalletCopy} from './wallet-locale.mjs';

/** Local import editor only; custody and BIP39 validation remain in importAccount. */
export function createMnemonicImportUI({document:doc,getState,getAccount}) {
  const $=id=>doc.querySelector(id),sheet=$('#import-sheet');
  let context=null,fields=[],visible=false,pending=null;
  function conceal(){visible=false;for(const field of fields)field.type='password';$('#import-show-words').setAttribute('aria-pressed','false');setWalletCopy($('#import-show-words'),'Show words');}
  function clear(){for(const field of fields)field.value='';for(const id of ['#import-value','#import-password','#import-file'])$(id).value='';$('#import-editor-result').textContent='';conceal();}
  function valid(){const state=getState();return context&&!state.locked&&!state.authenticating&&state.revision===context.revision&&getAccount()===context.account;}
  function close(dismissed=true){if(dismissed&&pending)pending.dismissed=true;context=null;clear();if(sheet.open)sheet.close();}
  function controls(){for(const node of doc.querySelectorAll('#import-form input,#import-form select,#import-form button'))node.disabled=!!pending||!valid();$('#import-close').disabled=false;$('#open-import').disabled=!!pending||getState().locked||getState().authenticating;}
  function grid(){clear();fields=[];const count=Number($('#import-word-count').value);if(![12,15,18,21,24].includes(count))return;
    const cells=[];for(let i=0;i<count;i++){const label=doc.createElement('label'),caption=doc.createElement('span'),input=doc.createElement('input');input.id='import-word-'+(i+1);input.type='password';input.autocomplete='off';input.spellcheck=false;input.autocapitalize='none';input.dir='ltr';input.required=true;input.maxLength=32;input.pattern='[A-Za-z]+';label.htmlFor=input.id;setWalletCopy(caption,'Word {number}',{number:i+1});label.append(caption,input);cells.push(label);fields.push(input)}$('#import-word-grid').replaceChildren(...cells);controls();}
  function format(){clear();const kind=$('#import-kind').value,phrase=kind==='recovery-phrase',encrypted=kind==='encrypted-json';$('#import-word-group').hidden=!phrase;$('#import-value').hidden=phrase||encrypted;$('#import-value').required=kind==='private-key';$('label[for="import-value"]').hidden=phrase||encrypted;$('#import-file-group').hidden=!encrypted;$('#import-password-group').hidden=!encrypted;for(const field of fields)field.required=phrase;controls();}
  $('#open-import').addEventListener('click',()=>{if(pending||getState().locked||getState().authenticating||doc.querySelector('dialog[open]'))return;clear();context={revision:getState().revision,account:getAccount()};$('#import-kind').value='recovery-phrase';$('#import-word-count').value='12';$('#import-result').textContent='';grid();format();sheet.showModal();fields[0]?.focus();});
  $('#import-kind').addEventListener('change',format);$('#import-word-count').addEventListener('change',()=>{grid();format()});
  $('#import-show-words').addEventListener('click',()=>{if(pending||!valid())return;visible=!visible;for(const field of fields)field.type=visible?'text':'password';$('#import-show-words').setAttribute('aria-pressed',String(visible));setWalletCopy($('#import-show-words'),visible?'Hide words':'Show words');});
  $('#import-close').addEventListener('click',()=>close());sheet.addEventListener('cancel',event=>{event.preventDefault();close()});sheet.addEventListener('close',()=>{if(context)close()});
  doc.defaultView?.addEventListener('blur',()=>{close();controls()});
  doc.addEventListener?.('visibilitychange',()=>{if(doc.visibilityState!=='visible'){close();controls()}});
  return {
    beginSubmission(){if(pending||!valid()||!sheet.open)return null;pending={dismissed:false};controls();return pending},
    value(){return $('#import-kind').value==='recovery-phrase'?fields.map(field=>field.value.trim().toLowerCase()).join(' '):$('#import-value').value},
    clearSecrets:clear,
    accepts(token){return token===pending&&!token.dismissed},
    finish(token,success=false){if(token!==pending)return;if(success)close(false);pending=null;controls()},
    invalidate(){close(false);controls()},
    render(){if(context&&!valid())close(false);controls()}
  };
}

/** Secret-bearing normal UI. No clipboard, screenshots, telemetry or persistence adapters. */
export function createMnemonicUI({document:doc,api,getState,getAccount,onAccount,getView=()=>null,onCommitFailure=()=>{}}) {
  const $=id=>doc.querySelector(id),sheet=$('#mnemonic-sheet');
  let epoch=0,context=null,draft=null,busy=false,pendingCommit=null;
  const current=token=>token===epoch&&context&&getState().locked===false&&getState().revision===context.revision&&getAccount()===context.account;
  function erase(){draft=null;$('#mnemonic-words').replaceChildren();$('#mnemonic-password').value='';for(const input of doc.querySelectorAll('#mnemonic-confirmation input'))input.value='';}
  function busyState(value){busy=value;for(const control of doc.querySelectorAll('#mnemonic-sheet input,#mnemonic-sheet select,#mnemonic-sheet button'))control.disabled=value;$('#mnemonic-close').disabled=false;}
  function invalidate({explicit=false}={}){if(explicit&&pendingCommit)pendingCommit.dismissed=true;epoch++;context=null;erase();busyState(false);if(sheet.open)sheet.close();void Promise.resolve(api.cancelMnemonicAccount()).catch(()=>{});}
  function stage(name){for(const node of doc.querySelectorAll('[data-mnemonic-stage]'))node.hidden=node.dataset.mnemonicStage!==name;}
  function begin(name){invalidate({explicit:true});const state=getState();if(state.locked)return;context={revision:state.revision,account:getAccount()};$('#mnemonic-result').textContent='';stage(name);sheet.showModal();}
  function words(phrase){$('#mnemonic-words').replaceChildren(...phrase.split(' ').map(word=>{const li=doc.createElement('li');li.textContent=word;li.dir='ltr';return li}));}
  function error(result){$('#mnemonic-result').textContent=result?.error?.message??'Wallet did not finish. Reopen the current Wallet before continuing.';}
  async function prepare(event){event.preventDefault();if(busy)return;const token=epoch;busyState(true);
    try{const result=await api.prepareMnemonicAccount({wordCount:Number($('#mnemonic-word-count').value)});if(!current(token))return;if(!result?.ok){error(result);return}draft={id:result.value.id,indexes:result.value.indexes};words(result.value.phrase);$('#mnemonic-path').textContent=result.value.path;stage('words');$('#mnemonic-next').hidden=false;}
    catch{if(current(token))error()}finally{if(current(token))busyState(false)}
  }
  function confirm(){if(!draft||busy)return;$('#mnemonic-words').replaceChildren();for(let i=0;i<3;i++)setWalletCopy($('#mnemonic-label-'+i),'Word {number}',{number:draft.indexes[i]+1});stage('confirmation');}
  function retiredCommitFailure(owner,result){
    const state=getState(),checkpoint=result?.creationView;
    return result?.ok===false&&pendingCommit===owner&&!owner.dismissed&&epoch===owner.epoch+1&&getView()===owner.view&&
      getAccount()===owner.account&&state.account===owner.account&&state.locked===false&&!state.authenticating&&
      checkpoint?.id===owner.id&&checkpoint.account===owner.account&&checkpoint.revision===owner.revision&&
      checkpoint.retiredRevision===owner.revision+1&&state.revision===checkpoint.retiredRevision;
  }
  async function commit(event){event.preventDefault();if(busy||!draft)return;const token=epoch,id=draft.id,answers=[0,1,2].map(i=>$('#mnemonic-answer-'+i).value.trim());
    const owner={epoch:token,id,account:context.account,revision:context.revision,view:getView(),dismissed:false};pendingCommit=owner;
    for(const input of doc.querySelectorAll('#mnemonic-confirmation input'))input.value='';busyState(true);
    try{const result=await api.commitMnemonicAccount({id,words:answers});if(!current(token)){if(retiredCommitFailure(owner,result))onCommitFailure(result);return}if(result?.ok){invalidate();onAccount(result)}else error(result)}catch{if(current(token))error()}finally{answers.fill('');if(pendingCommit===owner)pendingCommit=null;if(current(token))busyState(false)}
  }
  async function reveal(event){event.preventDefault();if(busy)return;const token=epoch;let password=$('#mnemonic-password').value;$('#mnemonic-password').value='';busyState(true);
    try{const result=await api.recoveryPhrase(password);if(!current(token))return;if(!result?.ok){error(result);return}words(result.value.phrase);$('#mnemonic-path').textContent=result.value.path;stage('words');$('#mnemonic-next').hidden=true;}catch{if(current(token))error()}finally{password=null;if(current(token))busyState(false)}
  }
  $('#mnemonic-create').addEventListener('submit',prepare);$('#mnemonic-next').addEventListener('click',confirm);
  $('#mnemonic-confirmation').addEventListener('submit',commit);$('#mnemonic-reveal').addEventListener('submit',reveal);
  $('#mnemonic-close').addEventListener('click',()=>invalidate({explicit:true}));sheet.addEventListener('cancel',event=>{event.preventDefault();invalidate({explicit:true})});sheet.addEventListener('close',()=>{if(context)invalidate({explicit:true})});
  return {openCreate:()=>begin('create'),openBackup:()=>begin('reveal'),invalidate,render(){if(context&&!current(epoch))invalidate()}};
}
