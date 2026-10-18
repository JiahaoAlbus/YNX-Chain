/** Explicit recovery of an existing signed result; never signing or transport. */
export function appendPQOriginalRecoveryActions({row,record,api,getKeyState,isCurrent,onResult,onRefresh,document:doc=document}){
 if(record.status!=='pq-save-unconfirmed'||!['pq-transfer','pq-migration','pq-revocation'].includes(record.kind))return;
 let busy=false;
 for(const readOnly of [false,true]){
  const button=doc.createElement('button');button.type='button';button.disabled=getKeyState().locked;
  button.textContent=readOnly?'只读核对本地原结果 / Reconcile original locally (read only)':'保存同一原签名 / Save the same signed original';
  button.addEventListener('click',async()=>{
   const security={...getKeyState()};if(busy||security.locked||security.authenticating||security.account!==record.account||!isCurrent())return;
   const live=()=>{const now=getKeyState();return isCurrent()&&!now.locked&&!now.authenticating&&now.account===security.account&&now.revision===security.revision;};
   busy=true;button.disabled=true;
   try{
    const response=await (readOnly?api.reconcilePQOriginal(record.hash):api.savePQOriginal(record.hash));if(!live())return;
    const value=response?.value;
    onResult(response?.ok===true&&value?.account===record.account&&value?.hash===record.hash&&value.savedLocally===true&&value.submitted===false&&value.confirmed===false?'同一原签名已确认保存在本地；没有重新签名或发送。 / Same original saved locally; no replacement signature or send.':'本地原结果尚无法确认。请保留原件；保存回执丢失时使用只读核对，不重新签名或发送。 / Local outcome remains unverified. Preserve the original; reconcile a lost acknowledgement without re-signing or sending.');
   }catch{if(live())onResult('无法确认本地原结果；保留原件，不自动重试。 / Original local outcome unverified; retained without automatic retry.');}
   finally{busy=false;if(isCurrent())button.disabled=getKeyState().locked;if(live())onRefresh();}
  });row.append(button);
 }
}
