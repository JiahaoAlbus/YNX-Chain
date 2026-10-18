/** Existing provider approval UI owns confirmation. These buttons only open
 * a separate broadcast review or query the same retained original. No wire,
 * account override, signing callback, endpoint or approval boolean crosses IPC. */
export function appendPQBroadcastActions({row,record,api,getKeyState,isCurrent,onResult,onRefresh,document:doc=document}){
 if(!['pq-transfer','pq-typed-action'].includes(record.kind)||!/^0x[0-9a-f]{64}$/.test(record.hash??''))return;
 const prepare=record.status==='pq-signed-unsubmitted';
 if(!prepare&&!['pq-submission-unknown','pq-inclusion-observed','pq-rejection-observed'].includes(record.status))return;
 const button=doc.createElement('button');button.type='button';button.textContent=prepare?(record.kind==='pq-typed-action'?'另行审查提交原 PQ 操作 / Review broadcast of original PQ action':'另行审查提交原 PQ 转账 / Review broadcast of original PQ transfer'):'查询同一 PQ 提交 / Query the same PQ submission';button.disabled=getKeyState().locked;
 let consumed=false;
 button.addEventListener('click',async()=>{
  const before={...getKeyState()};if(consumed||before.locked||before.authenticating||before.account!==record.account||!isCurrent())return;
  const current=()=>{const s=getKeyState();return isCurrent()&&!s.locked&&!s.authenticating&&s.account===before.account&&s.revision===before.revision;};
  // Consume before IPC: a lost callback must never leave a resend button.
  consumed=true;button.disabled=true;
  try{
   const response=await(prepare?api.preparePQBroadcast(record.hash):api.queryPQSubmission(record.hash));if(!current())return;
   if(prepare){onResult(response?.ok===true&&typeof response.value?.requestId==='string'&&response.value?.submitted===false?'请在独立批准窗口审查提交原件；此按钮未发送交易。 / Review the original in the separate approval window; this button did not send.':'提交审查未完成；原件保留，不自动重试。 / Broadcast review unavailable; original retained without automatic retry.');}
   else{const v=response?.value;onResult(response?.ok===true&&v?.account===record.account&&v?.hash===record.hash&&v?.consensusFinality===false&&v?.canRetry===false&&v?.clearsOriginal===false?'已读取同一提交结果；不代表独立最终确认，未重签或重发。 / Same submission read; no independent finality, replacement signature or resend.':'未能核实原提交；保留记录，只查原件。 / Original submission unverified; preserve the record.');}
  }catch{if(current())onResult('操作结果未确认；保留原件，不自动重试或重发。 / Operation unconfirmed; preserve original without automatic retry or resend.');}
  finally{if(current())onRefresh();}
 });row.append(button);
}
