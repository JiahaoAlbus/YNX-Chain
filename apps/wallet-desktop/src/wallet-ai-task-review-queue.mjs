// Renderer observes copied pending DATA only. It never constructs a Native
// review, approves a request or receives Source originals or private keys.
export function createAITaskReviewQueueObserver({readPending,getContext,queue,now=Date.now}){
 let generation=0,inFlight=false,known=new Set();
 const clear=()=>{for(const id of known)queue.remove('provider',id);known=new Set();};
 const same=(a,b)=>a.account===b.account&&a.revision===b.revision&&!b.locked&&!b.authenticating;
 return Object.freeze({
  invalidate(){generation++;clear();},
  async refresh(){
   const before={...getContext()},epoch=generation;
   if(inFlight||before.locked||before.authenticating||!before.account)return;
   inFlight=true;
   try{
    const response=await readPending();
    if(epoch!==generation||!same(before,getContext()))return;
    const rows=response?.ok===true?response.value:null;
    if(!Array.isArray(rows)||rows.length>64){clear();return;}
    const next=new Set();
    for(const row of rows){
     if(!row||typeof row.id!=='string'||next.has(row.id)||row.method!=='ynx_approveAITaskActionV6'||row.review?.purpose!=='PRODUCT-SESSION-AI-TASK-ACTION'||row.review?.reviewId!==row.id||row.review?.selectedAssetAccountDATA?.account!==before.account||!Number.isFinite(Date.parse(row.expiresAt))||Date.parse(row.expiresAt)<=now())throw Error('AI_TASK_V6_DISPLAY_INVALID');
     next.add(row.id);
    }
    for(const id of known)if(!next.has(id))queue.remove('provider',id);
    for(const row of rows)queue.enqueue('provider',row);
    known=next;
   }catch{if(epoch===generation)clear();}
   finally{inFlight=false;}
  }
 });
}
