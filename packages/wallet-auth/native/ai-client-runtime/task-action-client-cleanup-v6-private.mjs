// Custody only, NOT Source/Root authority. Used by the actual normal factory.
const fail=code=>{throw Object.assign(Error(code),{code});};
export function createOriginalAITaskV6CompositionCleanup(readOwnedResources){
 const stages=['kernel','registration','root','serverRoot','borrow','sql','image','nativeRoot'],states=new Map(),retireSelected=new WeakSet();let retired=false,closed=false,closeFlight,drainFlight,firstClose;
 const resources=()=>readOwnedResources();
 const state=(name,owner)=>{let s=states.get(name);if(s&&s.owner!==owner)fail('AI_V6_CLEANUP_OWNER_REPLACED');if(!s){s={owner,selected:false,done:false,error:null};states.set(name,s);}return s;};
 const remember=cause=>{firstClose??={cause};};
 function retire(){retired=true;let first;const r=resources();
  // Native epoch goes down BEFORE any foreign child callback can throw.
  for(const name of['nativeRoot',...stages.filter(k=>k!=='nativeRoot')]){const o=r[name];if(!o||retireSelected.has(o)||typeof o.retire!=='function')continue;retireSelected.add(o);try{if(o.retire()!==undefined)fail('AI_V6_RETIRE_RESULT');}catch(cause){first??={cause};}}
  if(first)throw first.cause;
 }
 async function join(){const r=resources();r.persistenceGuard?.();for(const name of stages){const o=r[name];if(!o)continue;const s=state(name,o);if(s.selected&&!s.done){if(s.error)throw s.error.cause;fail('AI_V6_CLOSE_PENDING');}if(typeof o.join==='function'&&await o.join()!==undefined)fail('AI_V6_JOIN_RESULT');}}
 async function advance(){if(closed)return;let retireError;try{retire();}catch(cause){retireError={cause};remember(cause);}const r=resources();r.persistenceGuard?.();
  for(const name of stages){const o=r[name];if(!o)continue;const s=state(name,o);if(s.done)continue;if(s.selected){if(s.error)throw s.error.cause;fail('AI_V6_CLOSE_PENDING');}
   if(typeof o.join==='function'&&await o.join()!==undefined)fail('AI_V6_JOIN_RESULT');
   if(typeof o.close!=='function')fail('AI_V6_CLOSE_METHOD_REQUIRED');
   s.selected=true;try{if(await o.close()!==undefined)fail('AI_V6_CLOSE_RESULT');s.done=true;}catch(cause){s.error={cause};remember(cause);throw cause;}
  }
  closed=true;if(retireError)throw retireError.cause;
 }
 function close(){return closeFlight??=(async()=>{try{await advance();}catch(cause){remember(cause);throw firstClose.cause;}})();}
 function drainPartial(){return drainFlight??=(async()=>{try{await advance();}catch(cause){remember(cause);throw firstClose.cause;}finally{drainFlight=null;}})();}
 return Object.freeze({retire,join,close,drainPartial,readOriginalCleanupDATA:()=>Object.freeze({retired,closed,firstClosePresent:!!firstClose,firstCloseCause:firstClose?.cause,stages:Object.freeze([...states].map(([name,s])=>Object.freeze({name,selected:s.selected,done:s.done,errorPresent:!!s.error}))),dataOnly:true,SourceAdmission:false})});
}
