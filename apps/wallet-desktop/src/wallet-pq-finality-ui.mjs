/** Main returns bounded public DATA only. No proof body, context, local path,
 * wire, key, provider or independent trust selection crosses this interface. */
export function appendPQFinalityActions({row,record,api,getKeyState,isCurrent,onResult,document:doc=document}){
 if(record.kind!=='pq-transfer'||!/^0x[0-9a-f]{64}$/.test(record.hash??''))return;
 let busy=false,uncertain=false,held=false;const buttons=[];
 const current=before=>{const s=getKeyState();return isCurrent()&&!s.locked&&!s.authenticating&&s.account===record.account&&s.account===before.account&&s.revision===before.revision;};
 const base=v=>v?.account===record.account&&v?.consensusFinality===false&&v?.independentFinality===false&&v?.canRetry===false&&v?.clearsOriginal===false;
 const notice='仅收集或读取资料，尚未独立验证；原交易保留，没有重签或发送。 / Evidence only, not independently verified. Original retained; no replacement signature or send.';
 function render(){const s=getKeyState();for(const {button,action}of buttons){button.hidden=action==='save'&&!held;button.disabled=busy||s.locked||s.authenticating||s.account!==record.account||['collect','verify'].includes(action)&&uncertain;}}
 const actions=[['collect','只读收集证明资料（未验证） / Collect proof evidence (unverified)'],['restore','读取本地核验资料 / Read saved proof evidence'],['save','仅保存保留的核验资料 / Save held evidence locally']];
 if(typeof api.verifyPQFinalityEvidence==='function')actions.push(['verify','使用原 Host 校验证明（不发送） / Check proof with original Host (no send)']);
 for(const [action,label]of actions){
  const button=doc.createElement('button');button.type='button';button.textContent=label;buttons.push({button,action});
  button.addEventListener('click',async()=>{
   const before={...getKeyState()};if(busy||!current(before)||['collect','verify'].includes(action)&&uncertain||action==='save'&&!held)return;
   busy=true;if(['collect','verify'].includes(action))uncertain=true;if(action==='save')held=false;render();
   try{
    const response=await(action==='collect'?api.collectPQFinalityEvidence(record.hash):action==='verify'?api.verifyPQFinalityEvidence(record.hash):action==='restore'?api.restorePQFinalityEvidence(record.hash):api.savePQFinalityEvidence(record.hash));if(!current(before))return;
    const v=response?.value;
    if(response?.ok!==true){onResult(response?.error?.code==='PQ_HOST_SOURCE_NOT_SUPPLIED'?'原 Host 信任材料尚未供给，校验未启用；已取得的资料与原交易保留。没有签名或发送。 / Original Host source not supplied; verification unavailable. Evidence and original retained; no sign or send.':'核验资料操作未确认；请保留记录，先读取本地资料。没有重签或发送。 / Evidence operation unconfirmed. Preserve originals and read local evidence before another query. No re-sign or send.');return;}
    if(action==='restore'){
     if(!base(v)||v.hash!==record.hash||!Array.isArray(v.records)||!Number.isSafeInteger(v.unreadable)||v.unreadable<0||typeof v.heldLocally!=='boolean'){onResult('本地资料尚未核实；原交易保留。 / Local evidence unverified; original retained.');return;}
     held=v.heldLocally;uncertain=held;onResult(notice+(v.unreadable?' 部分本地记录不可读，请保留。 / Some local records are unreadable; preserve them.':''));
    }else if(action==='verify'||action==='save'&&v?.saved===true){
     if(!base(v)||v.hash!==record.hash||action==='verify'&&(v.rawStored!==true||!['verifier-result-data','verifier-error-data'].includes(v.status))){onResult('资料回执未绑定原交易；原记录保留。 / Evidence acknowledgement unbound; original retained.');return;}
     held=false;uncertain=false;onResult(action==='verify'&&v.status==='verifier-error-data'?'证明校验返回错误，已保留原始结果；这不证明交易失败，未授予重试、重签或发送权限。 / Proof verification returned an error; original evidence retained. This does not establish transaction failure or authorize retry, signing or sending.':notice);
    }else{
     if(!base(v)||v.hash!==record.hash||v.nativeTransactionHash!==record.hash&&!(v.status==='unavailable'&&v.executionHeight==='0'&&v.nativeTransactionHash==='')||v.rawStored!==true||!['collected','pending','unavailable'].includes(v.status)){onResult('资料回执未绑定原交易；原记录保留。 / Evidence acknowledgement unbound; original retained.');return;}
     held=false;uncertain=false;onResult(notice);
    }
   }catch{if(current(before))onResult('回执未知；请先读取本地核验资料，不自动重复查询。 / Acknowledgement unknown. Read local evidence first; no automatic repeat query.');}
   finally{busy=false;if(isCurrent())render();}
  });row.append(button);
 }
 render();
}
