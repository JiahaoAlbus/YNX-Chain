// Public display only. Native qualification, expected request parsing, proof
// production and the private endpoint stay with the original Main owner.
export function appendWalletIDEIdentityApproval({container,review,api,getKeyState,isCurrent,onResult,document:doc=document}){
 const bounded=(value,max)=>typeof value==='string'&&value.length>0&&BufferlessBytes(value)<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
 // No authority is inferred from these labels. Main alone issues an opaque
 // reviewId for its already retained same-owner qualified Native request.
 if(!review||!bounded(review.reviewId,128)||!bounded(review.requestId,128)||!bounded(review.purpose,256)||!bounded(review.account,256)||!bounded(review.networkId,256))throw Error('IDE_IDENTITY_REVIEW_INVALID');
 const own=Object.freeze({reviewId:review.reviewId,requestId:review.requestId,purpose:review.purpose,account:review.account,networkId:review.networkId});
 let busy=false,entered=false;const buttons=[];
 const live=before=>{const now=getKeyState();return isCurrent()&&!now.locked&&!now.authenticating&&now.account===own.account&&now.account===before.account&&now.revision===before.revision;};
 const heading=doc.createElement('h3');heading.textContent='IDE 身份请求 / IDE identity request';container.append(heading);
 for(const [label,value]of [['用途 / Purpose',own.purpose],['账户 / Account',own.account],['网络 / Network',own.networkId],['请求 / Request',own.requestId]]){const line=doc.createElement('p');line.textContent=label+': '+value;container.append(line);}
 const note=doc.createElement('p');note.textContent='请核对原请求。此选择不授予转账或其他用途权限。 / Review the original request. This choice grants no transfer or unrelated-purpose permission.';container.append(note);
 const render=()=>{const s=getKeyState();for(const b of buttons)b.disabled=busy||entered||s.locked||s.authenticating||s.account!==own.account;};
 for(const [decision,label]of [['approve','同意此请求 / Approve this request'],['reject','拒绝 / Reject'],['cancel','取消 / Cancel']]){
  const button=doc.createElement('button');button.type='button';button.textContent=label;buttons.push(button);
  button.addEventListener('click',async()=>{
   const before={...getKeyState()};if(busy||entered||!live(before))return;
   // Reserve once before IPC: a lost response never becomes permission to
   // send the same decision/proof again or fall back to reject on cancel.
   busy=true;entered=true;render();
   try{
    const response=await api.decideIDEIdentityPeer(own.reviewId,decision);if(!live(before))return;
    const v=response?.value;
    if(response?.ok!==true||v?.reviewId!==own.reviewId||v?.decision!==decision||v?.recorded!==true){onResult('选择结果未确认，请保留原请求并核对已有记录；不会自动重试。 / Decision outcome unknown; preserve the original and inspect existing records. No automatic retry.');return;}
    onResult(decision==='cancel'?'取消选择已记录，不等于拒绝或操作完成；不会自动重发。 / Cancellation recorded, not rejection or operation completion. No automatic resend.':decision==='reject'?'拒绝选择已记录；没有生成同意证明，不代表其他操作完成。 / Rejection recorded; no approval proof or unrelated completion is implied.':'同意选择已记录；不等于身份授权或业务完成，请核对原通道结果。 / Approval choice recorded, not identity authorization or business completion. Check the original channel result.');
   }catch{if(live(before))onResult('回执未知，保留原请求；不会自动重试、改成拒绝或再次生成证明。 / Acknowledgement unknown; preserve the original. No retry, fallback rejection or replacement proof.');}
   finally{busy=false;if(isCurrent())render();}
  });container.append(button);
 }
 render();return Object.freeze({refresh:render});
}
function BufferlessBytes(value){return new TextEncoder().encode(value).length;}
