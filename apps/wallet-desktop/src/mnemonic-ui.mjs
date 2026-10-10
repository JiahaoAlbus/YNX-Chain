import {setWalletCopy} from './wallet-locale.mjs';

/** Secret-bearing normal UI. No clipboard, screenshots, telemetry or persistence adapters. */
export function createMnemonicUI({document:doc,api,getState,getAccount,onAccount}) {
  const $=id=>doc.querySelector(id),sheet=$('#mnemonic-sheet');
  let epoch=0,context=null,draft=null,busy=false;
  const current=token=>token===epoch&&context&&getState().locked===false&&getState().revision===context.revision&&getAccount()===context.account;
  function erase(){draft=null;$('#mnemonic-words').replaceChildren();$('#mnemonic-password').value='';for(const input of doc.querySelectorAll('#mnemonic-confirmation input'))input.value='';}
  function busyState(value){busy=value;for(const control of doc.querySelectorAll('#mnemonic-sheet input,#mnemonic-sheet select,#mnemonic-sheet button'))control.disabled=value;$('#mnemonic-close').disabled=false;}
  function invalidate(){epoch++;context=null;erase();busyState(false);if(sheet.open)sheet.close();void Promise.resolve(api.cancelMnemonicAccount()).catch(()=>{});}
  function stage(name){for(const node of doc.querySelectorAll('[data-mnemonic-stage]'))node.hidden=node.dataset.mnemonicStage!==name;}
  function begin(name){invalidate();const state=getState();if(state.locked)return;context={revision:state.revision,account:getAccount()};$('#mnemonic-result').textContent='';stage(name);sheet.showModal();}
  function words(phrase){$('#mnemonic-words').replaceChildren(...phrase.split(' ').map(word=>{const li=doc.createElement('li');li.textContent=word;li.dir='ltr';return li}));}
  function error(result){$('#mnemonic-result').textContent=result?.error?.message??'Wallet did not finish. Reopen the current Wallet before continuing.';}
  async function prepare(event){event.preventDefault();if(busy)return;const token=epoch;busyState(true);
    try{const result=await api.prepareMnemonicAccount({wordCount:Number($('#mnemonic-word-count').value)});if(!current(token))return;if(!result?.ok){error(result);return}draft={id:result.value.id,indexes:result.value.indexes};words(result.value.phrase);$('#mnemonic-path').textContent=result.value.path;stage('words');$('#mnemonic-next').hidden=false;}
    catch{if(current(token))error()}finally{if(current(token))busyState(false)}
  }
  function confirm(){if(!draft||busy)return;$('#mnemonic-words').replaceChildren();for(let i=0;i<3;i++)setWalletCopy($('#mnemonic-label-'+i),'Word {number}',{number:draft.indexes[i]+1});stage('confirmation');}
  async function commit(event){event.preventDefault();if(busy||!draft)return;const token=epoch,id=draft.id,answers=[0,1,2].map(i=>$('#mnemonic-answer-'+i).value.trim());for(const input of doc.querySelectorAll('#mnemonic-confirmation input'))input.value='';busyState(true);
    try{const result=await api.commitMnemonicAccount({id,words:answers});if(!current(token))return;if(result?.ok){invalidate();onAccount(result)}else error(result)}catch{if(current(token))error()}finally{answers.fill('');if(current(token))busyState(false)}
  }
  async function reveal(event){event.preventDefault();if(busy)return;const token=epoch;let password=$('#mnemonic-password').value;$('#mnemonic-password').value='';busyState(true);
    try{const result=await api.recoveryPhrase(password);if(!current(token))return;if(!result?.ok){error(result);return}words(result.value.phrase);$('#mnemonic-path').textContent=result.value.path;stage('words');$('#mnemonic-next').hidden=true;}catch{if(current(token))error()}finally{password=null;if(current(token))busyState(false)}
  }
  $('#mnemonic-create').addEventListener('submit',prepare);$('#mnemonic-next').addEventListener('click',confirm);
  $('#mnemonic-confirmation').addEventListener('submit',commit);$('#mnemonic-reveal').addEventListener('submit',reveal);
  $('#mnemonic-close').addEventListener('click',invalidate);sheet.addEventListener('cancel',event=>{event.preventDefault();invalidate()});sheet.addEventListener('close',()=>{if(context)invalidate()});
  return {openCreate:()=>begin('create'),openBackup:()=>begin('reveal'),invalidate,render(){if(context&&!current(epoch))invalidate()}};
}
