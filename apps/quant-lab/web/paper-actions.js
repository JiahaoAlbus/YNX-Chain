import {getPaperSessionState,getPaperWorkspaceSnapshot,paperWorkspaceRequest} from './paper-session.js';
import {createPaperIntentController} from './paper-intents.js';
import {paperActionCopy,paperRiskCopy} from './paper-session-copy.js';
import {createPaperRiskController} from './paper-risk-intents.js';
import {createPaperBacktestController} from './paper-backtest-intents.js';
import {paperNativeCostCopy,paperNativeBacktestBoundary} from './paper-native-cost-copy.js';
import {mountNativePaperHistory} from './paper-history.js';

export function mountPaperActions(){
  const find=id=>document.getElementById(id),dialog=find('paper-owned-preview');if(!dialog)return;
  const controller=createPaperIntentController({session:getPaperSessionState,snapshot:getPaperWorkspaceSnapshot,request:paperWorkspaceRequest,storage:localStorage,uuid:()=>crypto.randomUUID()});
  const risk=createPaperRiskController({session:getPaperSessionState,request:paperWorkspaceRequest,storage:localStorage,uuid:()=>crypto.randomUUID()});
  const research=createPaperBacktestController({session:getPaperSessionState,request:paperWorkspaceRequest,storage:localStorage,uuid:()=>crypto.randomUUID()});
  const renderHistory=mountNativePaperHistory(find('paper-owned-result'),{session:getPaperSessionState,snapshot:getPaperWorkspaceSnapshot,language:()=>localStorage.getItem('ynx.quant.locale')||'en'});
  for(const [id,name,value] of [['paper-native-fee','fee','10'],['paper-native-slippage','slippage','5']]){const label=document.createElement('label'),title=document.createElement('span'),input=document.createElement('input');title.dataset.paperCost=name;input.id=id;input.type='text';input.inputMode='numeric';input.maxLength=5;input.value=value;label.append(title,input);find('paper-owned-review').before(label);}
  const costBoundary=document.createElement('p');costBoundary.id='paper-native-cost-boundary';find('paper-owned-form').append(costBoundary);
  const riskPanel=document.createElement('section');
  for(const [id,key,type] of [['paper-native-reason','reason','text'],['paper-native-cash','cash','text'],['paper-native-position','position','text']]){
    const label=document.createElement('label'),title=document.createElement('span'),input=document.createElement('input');title.dataset.paperRisk=key;input.id=id;input.type=type;input.maxLength=id==='paper-native-reason'?500:24;label.append(title,input);riskPanel.append(label);
  }
  for(const key of ['kill','reconcile']){const button=document.createElement('button');button.id='paper-native-'+key;button.type='button';button.dataset.paperRisk=key;riskPanel.append(button);}
  const boundary=document.createElement('p');boundary.dataset.paperRisk='boundary';riskPanel.append(boundary);find('paper-owned-form').after(riskPanel);
  let review=null,working=false,renderedOwner=null;
  const copy=()=>paperActionCopy(localStorage.getItem('ynx.quant.locale')||'en');
  function invalidate(){review=null;controller.invalidate();risk.invalidate();research.invalidate();if(dialog.open)dialog.close();}
  function render(){
    const current=getPaperSessionState(),snapshot=getPaperWorkspaceSnapshot(),text=copy();
    renderHistory();
    const costText=paperNativeCostCopy(localStorage.getItem('ynx.quant.locale')||'en');for(const element of document.querySelectorAll('[data-paper-cost]'))element.textContent=costText[element.dataset.paperCost];
    let legacy=false;try{const retained=controller.pending();legacy=!!retained&&!retained.executionCosts;}catch{}costBoundary.textContent=legacy?text.model:costText.boundary;for(const id of ['paper-native-fee','paper-native-slippage'])find(id).disabled=legacy;
    for(const element of document.querySelectorAll('[data-paper-action]'))element.textContent=text[element.dataset.paperAction];
    const riskText=paperRiskCopy(localStorage.getItem('ynx.quant.locale')||'en');for(const element of riskPanel.querySelectorAll('[data-paper-risk]'))element.textContent=riskText[element.dataset.paperRisk];
    for(const id of ['paper-native-kill','paper-native-reconcile'])find(id).disabled=working||current.status!=='connected'||!current.ready;
    const select=find('paper-owned-strategy'),previous=select.value;select.replaceChildren();
    for(const value of Object.values(snapshot?.strategies||{})){if(!/^[0-9a-f]{64}$/.test(value.StrategyHash||''))continue;const option=document.createElement('option');option.value=value.StrategyHash;option.textContent=String(value.Name||value.ID||value.StrategyHash);select.append(option);}
    if([...select.options].some(option=>option.value===previous))select.value=previous;
    if(current.account!==renderedOwner){
      for(const id of ['paper-native-reason','paper-native-cash','paper-native-position'])find(id).value='';
      try{const retained=risk.pending();if(retained){if(retained.action==='kill')find('paper-native-reason').value=retained.body.reason;else{find('paper-native-cash').value=String(retained.body.cash);find('paper-native-position').value=String(retained.body.position);}}}catch(error){find('paper-owned-result').textContent=text.unavailable+' '+error.code;}
      renderedOwner=current.ready?current.account:null;find('paper-owned-side').value='buy';find('paper-owned-amount').value='1000000';find('paper-native-fee').value='10';find('paper-native-slippage').value='5';
      try{const retained=controller.pending();if(retained){select.value=retained.strategyHash;find('paper-owned-side').value=retained.side;find('paper-owned-amount').value=String(retained.amount);find('paper-native-fee').value=retained.executionCosts?String(retained.executionCosts.feeBPS):'';find('paper-native-slippage').value=retained.executionCosts?String(retained.executionCosts.slippageBPS):'';}}
      catch(error){find('paper-owned-result').textContent=text.unavailable+' '+error.code;}
    }
    for(const id of ['paper-owned-review','paper-owned-backtest'])find(id).disabled=working||current.status!=='connected'||!current.ready;
    find('paper-owned-review').disabled||=(select.options.length===0||snapshot?.paper?.KillSwitch===true);
    find('paper-owned-confirm').disabled=working;find('paper-owned-cancel').disabled=working;
  }
  function show(kind,value){review={kind,value,account:getPaperSessionState().account,epoch:getPaperSessionState().epoch};find('paper-owned-preview-text').textContent=JSON.stringify(value.body||value,null,2);const language=localStorage.getItem('ynx.quant.locale')||'en';find('paper-owned-model').textContent=kind==='risk'?paperRiskCopy(language).boundary:kind==='backtest'?paperNativeBacktestBoundary(language):value.body.executionCosts?paperNativeCostCopy(language).boundary:copy().model;dialog.showModal();}
  const integer=id=>{const raw=find(id).value;if(!raw.trim()||!Number.isSafeInteger(Number(raw)))throw Object.assign(new Error(),{code:'PAPER_DRAFT_INVALID'});return Number(raw);};
  for(const action of ['kill','reconcile'])find('paper-native-'+action).addEventListener('click',()=>{try{invalidate();show('risk',risk.preview(action,action==='kill'?{reason:find('paper-native-reason').value}:{cash:integer('paper-native-cash'),position:integer('paper-native-position')}));}catch(error){find('paper-owned-result').textContent=copy().unavailable+' '+error.code;}});
  riskPanel.addEventListener('input',invalidate);
  function signalInput(){const retained=controller.pending();return {strategyHash:find('paper-owned-strategy').value,side:find('paper-owned-side').value,amount:integer('paper-owned-amount'),...(!retained||retained.executionCosts?{executionCosts:{policy:'adverse_price_ceil_fee_micro_v1',feeBPS:integer('paper-native-fee'),slippageBPS:integer('paper-native-slippage')}}:{})};}
  find('paper-owned-form').addEventListener('submit',event=>{event.preventDefault();try{show('signal',controller.preview(signalInput()));}catch(error){find('paper-owned-result').textContent=copy().unavailable+' '+error.code;}});
  find('paper-owned-backtest').addEventListener('click',()=>{try{invalidate();const retained=research.pending();const value=retained||window.YNXQuantBacktestDraft();if(!retained)value.strategy.id='native-paper-'+crypto.randomUUID();show('backtest',research.preview(value));}catch{find('paper-owned-result').textContent=copy().unavailable;}});
  for(const id of ['paper-owned-strategy','paper-owned-side','paper-owned-amount','paper-native-fee','paper-native-slippage'])find(id).addEventListener('input',invalidate);
  document.getElementById('backtest')?.addEventListener('input',invalidate);
  find('paper-owned-cancel').addEventListener('click',invalidate);
  dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();else invalidate();});
  find('paper-owned-confirm').addEventListener('click',async()=>{
    if(working||!review)return;const submitted=review,current=getPaperSessionState();
    if(current.account!==submitted.account||current.epoch!==submitted.epoch||current.status!=='connected'){invalidate();return;}
    if(submitted.kind==='signal'){try{const current=signalInput(),body=submitted.value.body;if(current.strategyHash!==body.strategyHash||current.side!==body.side||current.amount!==body.amount||JSON.stringify(current.executionCosts)!==JSON.stringify(body.executionCosts)){invalidate();return;}}catch{invalidate();return;}}
    if(submitted.kind==='risk'){
      try{const body=submitted.value.body;if(submitted.value.action==='kill'?find('paper-native-reason').value!==body.reason:integer('paper-native-cash')!==body.cash||integer('paper-native-position')!==body.position){invalidate();return;}}catch{invalidate();return;}
    }
    working=true;render();
    try{
      const result=submitted.kind==='risk'?await risk.confirm(submitted.value):submitted.kind==='signal'?await controller.confirm(submitted.value):await research.confirm(submitted.value);
      const after=getPaperSessionState();if(after.account!==submitted.account||after.epoch!==submitted.epoch)throw Object.assign(new Error(),{code:'PRIVATE_OPERATION_SUPERSEDED'});
      find('paper-owned-result').textContent=JSON.stringify(result,null,2);invalidate();
      await paperWorkspaceRequest('/v1/wallet/paper/snapshot');
    }catch(error){find('paper-owned-result').textContent=copy().unavailable+' '+(error.code||'PAPER_SERVICE_UNAVAILABLE');invalidate();}
    finally{working=false;render();}
  });
  window.addEventListener('ynx:quant-paper-session',()=>{invalidate();render();});
  find('locale')?.addEventListener('change',()=>queueMicrotask(()=>{invalidate();render();}));render();
}
