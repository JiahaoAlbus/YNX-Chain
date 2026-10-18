/** Local journal read/save only. This UI cannot choose a Source, result body,
 * original wire, signer or outward transport. */
export function appendPQProgressActions({row,record,api,getKeyState,isCurrent,onResult,onRefresh,document:doc=document}){
 if(!['pq-submission-unknown','pq-inclusion-observed','pq-rejection-observed'].includes(record.status))return;
 let busy=false;
 if(record.resultStorageConfirmed===false){const warning=doc.createElement('p');warning.textContent='提交进度尚未确认持久化；如原返回结果仅保留在内存，请保持 Wallet 运行并保存同一结果。不重签、不重发。 / Submission progress storage unconfirmed. Keep Wallet running to save any held original response; no re-sign or resend.';row.append(warning);}
 else if(record.resultHeldInMemory===true){const warning=doc.createElement('p');warning.textContent='原返回结果已保存，但仍有提交诊断元数据仅保留在内存。可保存同一本地记录；不会重签或发送。 / Original response saved; some submission diagnostics remain in memory. Save the same local record without re-signing or sending.';row.append(warning);}
 for(const flush of [false,...(record.resultHeldInMemory===true?[true]:[])]){
  const button=doc.createElement('button');button.type='button';button.textContent=flush?'保存保留的同一提交结果 / Save the same held submission result':'核对本地提交记录（只读） / Check local submission record (read only)';button.disabled=getKeyState().locked;
  button.addEventListener('click',async()=>{
   const security={...getKeyState()};if(busy||security.locked||security.authenticating||security.account!==record.account||!isCurrent())return;
   const live=()=>{const state=getKeyState();return isCurrent()&&!state.locked&&!state.authenticating&&state.account===security.account&&state.revision===security.revision;};busy=true;button.disabled=true;
   try{
    const response=await (flush?api.flushPQProgressResult(record.hash):api.readPQProgress(record.hash));if(!live())return;
    const value=response?.value;if(response?.ok!==true||value?.account!==record.account||value?.hash!==record.hash||value.retryAuthorized!==false||value.clearsOriginal!==false||value.consensusFinality!==false){onResult('本地原结果未核实；保留记录，不重签或重发。 / Original local outcome unverified; retained without re-sign or resend.');return;}
    onResult(flush&&value.stored===true?'同一提交结果已本地保存；没有发送交易。 / Same submission result saved locally; no transaction sent.':value.metadataConfirmed===false&&value.storageConfirmed===true?'原结果已保存，但诊断元数据仍待保存；没有新的链上查询。 / Original response saved; diagnostics still need saving. No fresh chain query.':value.storageConfirmed===true?'本地提交记录已核对；不是新的链上查询或最终性证明。 / Local submission record checked; not a fresh chain query or finality proof.':'本地结果尚未确认持久化；保持 Wallet 运行，保留原件。 / Local result storage remains unconfirmed; keep Wallet running and preserve the original.');
   }catch{if(live())onResult('本地记录操作未确认；不自动重试，不重新签名或发送。 / Local record operation unconfirmed; no automatic retry, re-sign or send.');}
   finally{busy=false;if(isCurrent())button.disabled=getKeyState().locked;if(live())onRefresh();}
  });row.append(button);
 }
}
