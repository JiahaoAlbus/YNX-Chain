// Main-owned lifecycle around the desktop management view adapter. This port
// is not an Auth grant schema or a Source constructor. The normal SDK consumer
// supplies the adapter; renderer drafts never construct proofs or authority.
const fault=code=>Object.assign(Error(code),{code});
const unavailable=()=>Object.freeze({state:'unavailable'});
export function createDesktopAgentDelegationController({getContext,management=null}){
  if(typeof getContext!=='function')throw fault('AGENT_CONTEXT_REQUIRED');
  let epoch=0,closed=false,busy=false,heldReview=null,scope=null,debt=false,closing=null;
  const originals=new Map();
  const context=()=>{
    const c=getContext();
    if(!c||typeof c.account!=='string'||!c.account||c.locked!==false)return null;
    return {account:c.account,revision:c.revision};
  };
  const same=(a,b)=>a&&b&&a.account===b.account&&a.revision===b.revision;
  const sameOwner=(a,b)=>a&&b&&a.account===b.account;
  const originalKey=(owner,id)=>JSON.stringify([owner.account,id]);
  function invalidate(){debt=debt||busy||heldReview!==null;epoch++;busy=false;heldReview=null;scope=null;}
  function check(){
    const next=context();
    if(scope&&!same(scope,next))invalidate();
    scope=next;
    return next;
  }
  async function call(name,args,{mutation=false,recovery=false}={}){
    if(closed)throw fault('AGENT_VIEW_CLOSED');
    const before=check();if(!before)return Object.freeze({state:'locked'});
    if(!management||typeof management[name]!=='function')return unavailable();
    if(debt)throw fault('AGENT_CLEANUP_REQUIRED');
    if(busy)throw fault('AGENT_OPERATION_IN_PROGRESS');
    if(mutation&&heldReview)throw fault('AGENT_REVIEW_IN_PROGRESS');
    if(mutation&&[...originals.values()].some(v=>sameOwner(v.scope,before)))throw fault('AGENT_ORIGINAL_RECOVERY_REQUIRED');
    const token=epoch;busy=true;
    try{
      const value=await management[name](...args);
      // Capture an uncertain original BEFORE rejecting a late result. Keeping
      // it does not execute, authorize, resend or re-sign that operation.
      if(mutation&&value?.state==='unknown'){
        if(typeof value.operationId!=='string'||!value.operationId)throw fault('AGENT_UNKNOWN_ORIGINAL_REQUIRED');
        originals.set(originalKey(before,value.operationId),{scope:before,value});
      }
      if(closed||token!==epoch||!same(before,context())){debt=true;throw fault('AGENT_CONTEXT_CHANGED');}
      if(name==='readProjection'&&!['unavailable','locked'].includes(value?.state)){
        if(value?.account!==before.account||!Array.isArray(value.delegations)||!Array.isArray(value.operations))throw fault('AGENT_PROJECTION_ACCOUNT_MISMATCH');
        for(const operation of value.operations)if(operation?.state==='unknown'&&operation.recoverable===true&&typeof operation.id==='string'&&operation.id)originals.set(originalKey(before,operation.id),{scope:before,value:operation});
      }
      if(mutation&&value?.state==='review'){
        if(typeof value.operationId!=='string'||!value.operationId)throw fault('AGENT_ORIGINAL_REVIEW_REQUIRED');
        heldReview={scope:before,id:value.operationId};
      }
      if(recovery&&value?.state==='resolved'&&value.operationId===args[0])originals.delete(originalKey(before,args[0]));
      return value;
    }catch(error){
      if(error?.code==='AGENT_CONTEXT_CHANGED'||closed||token!==epoch||!same(before,context())){debt=true;throw fault('AGENT_CONTEXT_CHANGED');}
      // Absence is distinct from an empty successful list. Adapter errors stay
      // errors; no fabricated rows, allowance, authority or successful action.
      if(/NOT_SUPPLIED|UNAVAILABLE/.test(String(error?.code??'')))return unavailable();
      throw error;
    }finally{if(token===epoch)busy=false;}
  }
  return Object.freeze({
    readProjection:()=>call('readProjection',[]),
    reviewDraft:draft=>call('reviewDraft',[draft],{mutation:true}),
    reviewAction:selection=>{
      if(!selection||!['pause','revoke'].includes(selection.action)||typeof selection.rowId!=='string'||!selection.rowId)throw fault('AGENT_SELECTION_INVALID');
      return call('reviewAction',[selection],{mutation:true});
    },
    recoverOperation:operationId=>{
      const current=check(),original=current&&originals.get(originalKey(current,operationId));
      if(!original||!sameOwner(current,original.scope))throw fault('AGENT_ORIGINAL_OPERATION_REQUIRED');
      return call('recoverOperation',[operationId],{recovery:true});
    },
    async cancelView(){
      invalidate();debt=true;
      const clean=!management||typeof management.cancelView==='function'&&await management.cancelView()===true;
      debt=!clean;return clean;
    },
    close(){return closing??=(async()=>{
      closed=true;invalidate();debt=true;
      const clean=!management||typeof management.cancelView==='function'&&await management.cancelView()===true;
      debt=!clean;return clean;
    })();},
  });
}
