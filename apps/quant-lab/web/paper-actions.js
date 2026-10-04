import {getPaperSessionState,getPaperWorkspaceSnapshot,paperWorkspaceRequest} from './paper-session.js';
import {createPaperIntentController} from './paper-intents.js';
import {paperActionCopy} from './paper-session-copy.js';

export function mountPaperActions(){
  const find=id=>document.getElementById(id),dialog=find('paper-owned-preview');if(!dialog)return;
  const controller=createPaperIntentController({session:getPaperSessionState,snapshot:getPaperWorkspaceSnapshot,request:paperWorkspaceRequest,storage:localStorage,uuid:()=>crypto.randomUUID()});
  let review=null,working=false,renderedOwner=null;
  const copy=()=>paperActionCopy(localStorage.getItem('ynx.quant.locale')||'en');
  function invalidate(){review=null;controller.invalidate();if(dialog.open)dialog.close();}
  function render(){
    const current=getPaperSessionState(),snapshot=getPaperWorkspaceSnapshot(),text=copy();
    for(const element of document.querySelectorAll('[data-paper-action]'))element.textContent=text[element.dataset.paperAction];
    const select=find('paper-owned-strategy'),previous=select.value;select.replaceChildren();
    for(const value of Object.values(snapshot?.strategies||{})){if(!/^[0-9a-f]{64}$/.test(value.StrategyHash||''))continue;const option=document.createElement('option');option.value=value.StrategyHash;option.textContent=String(value.Name||value.ID||value.StrategyHash);select.append(option);}
    if([...select.options].some(option=>option.value===previous))select.value=previous;
    if(current.account!==renderedOwner){
      renderedOwner=current.ready?current.account:null;find('paper-owned-side').value='buy';find('paper-owned-amount').value='1000000';
      try{const retained=controller.pending();if(retained){select.value=retained.strategyHash;find('paper-owned-side').value=retained.side;find('paper-owned-amount').value=String(retained.amount);}}
      catch(error){find('paper-owned-result').textContent=text.unavailable+' '+error.code;}
    }
    for(const id of ['paper-owned-review','paper-owned-backtest'])find(id).disabled=working||current.status!=='connected'||!current.ready;
    find('paper-owned-review').disabled||=(select.options.length===0||snapshot?.paper?.KillSwitch===true);
    find('paper-owned-confirm').disabled=working;find('paper-owned-cancel').disabled=working;
  }
  function show(kind,value){review={kind,value,account:getPaperSessionState().account,epoch:getPaperSessionState().epoch};find('paper-owned-preview-text').textContent=JSON.stringify(value.body||value,null,2);find('paper-owned-model').textContent=copy().model;dialog.showModal();}
  find('paper-owned-form').addEventListener('submit',event=>{event.preventDefault();try{show('signal',controller.preview({strategyHash:find('paper-owned-strategy').value,side:find('paper-owned-side').value,amount:Number(find('paper-owned-amount').value)}));}catch(error){find('paper-owned-result').textContent=copy().unavailable+' '+error.code;}});
  find('paper-owned-backtest').addEventListener('click',()=>{try{invalidate();const value=window.YNXQuantBacktestDraft();value.strategy.id='native-paper-'+crypto.randomUUID();show('backtest',JSON.parse(JSON.stringify(value)));}catch{find('paper-owned-result').textContent=copy().unavailable;}});
  for(const id of ['paper-owned-strategy','paper-owned-side','paper-owned-amount'])find(id).addEventListener('input',invalidate);
  document.getElementById('backtest')?.addEventListener('input',invalidate);
  find('paper-owned-cancel').addEventListener('click',invalidate);
  dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();else invalidate();});
  find('paper-owned-confirm').addEventListener('click',async()=>{
    if(working||!review)return;const submitted=review,current=getPaperSessionState();
    if(current.account!==submitted.account||current.epoch!==submitted.epoch||current.status!=='connected'){invalidate();return;}
    if(submitted.kind==='signal'&&(find('paper-owned-strategy').value!==submitted.value.body.strategyHash||find('paper-owned-side').value!==submitted.value.body.side||Number(find('paper-owned-amount').value)!==submitted.value.body.amount)){invalidate();return;}
    working=true;render();
    try{
      const result=submitted.kind==='signal'?await controller.confirm(submitted.value):await paperWorkspaceRequest('/v1/wallet/paper/backtests/from-market',{method:'POST',body:JSON.stringify(submitted.value)});
      const after=getPaperSessionState();if(after.account!==submitted.account||after.epoch!==submitted.epoch)throw Object.assign(new Error(),{code:'PRIVATE_OPERATION_SUPERSEDED'});
      find('paper-owned-result').textContent=JSON.stringify(result,null,2);invalidate();
      await paperWorkspaceRequest('/v1/wallet/paper/snapshot');
    }catch(error){find('paper-owned-result').textContent=copy().unavailable+' '+(error.code||'PAPER_SERVICE_UNAVAILABLE');invalidate();}
    finally{working=false;render();}
  });
  window.addEventListener('ynx:quant-paper-session',()=>{invalidate();render();});
  find('locale')?.addEventListener('change',()=>queueMicrotask(()=>{invalidate();render();}));render();
}
