const failure=code=>Object.assign(new Error(code),{code});
/** App-private custody for one dual-PQ key preparation. The fixed normal-main
 * adapter calls the SDK; this module implements no crypto or backup format.
 * Neither the adapter, original key handle nor receipt is an IPC argument.
 * A late key result is captured before a lock fence, and never silently replaced
 * by another KeyGen. Persistence uncertainty permits read-only reconciliation,
 * not an automatic second save, regeneration, migration or transaction. */
export function createDualPQKeyPreparation({lifecycle,getBinding,source,id,onState=()=>{}}){
  for(const name of ['prepare','persist','reconcile','verifyPersisted'])if(typeof source?.[name]!=='function')throw failure('PQ_KEY_SOURCE_REQUIRED');
  if(typeof lifecycle?.run!=='function'||typeof getBinding!=='function'||typeof id!=='function')throw failure('PQ_KEY_CUSTODY_REQUIRED');
  let phase='idle',active=false,revision=0,record=null,firstCause,firstCausePresent=false;
  const retain=e=>{if(!firstCausePresent){firstCause=e;firstCausePresent=true;}};
  const publicBinding=()=>{
    const b=getBinding();
    if(!b||typeof b.account!=='string'||!b.account||b.account.length>128||typeof b.network!=='string'||!/^[a-f0-9]{64}$/.test(b.network))throw failure('PQ_KEY_BINDING_REQUIRED');
    return Object.freeze({account:b.account,network:b.network});
  };
  const same=(a,b)=>a.account===b.account&&a.network===b.network;
  const retainedPhase=()=>record?.persisted?'saved':record?.prepareUnknown?'prepare-unknown':record?.persistenceAttempted?'save-unknown':record?'retained':'failed';
  const status=()=>Object.freeze({phase,busy:active,hasOriginal:record!==null&&record.material!==null,preparationUnknown:record?.prepareUnknown??false,persistenceAttempted:record?.persistenceAttempted??false,persisted:record?.persisted??false,recoveryRequired:record!==null&&!record.persisted,error:firstCausePresent?'PQ_KEY_PREPARATION_INCOMPLETE':null});
  const notify=()=>{try{onState(status());}catch{/* Observation cannot change custody. */}};
  function check(binding,token,guard){guard.assert();if(guard.account!==binding.account||token!==revision||!same(binding,publicBinding()))throw failure('PQ_KEY_PREPARATION_CANCELLED');}
  async function persistOriginal(binding,token,guard){
    check(binding,token,guard);
    // The original handle remains reachable before persistence can fail or
    // return after lock; even a lost acknowledgement makes this ID unresolved.
    record.persistenceAttempted=true;phase='saving';notify();
    const receipt=await source.persist(record.material,{binding,operationId:record.operationId,guard});
    record.receipt=receipt;record.receiptReturned=true;
    check(binding,token,guard);
    if(await source.verifyPersisted(record.material,receipt,{binding,operationId:record.operationId,guard})!==true)throw failure('PQ_KEY_PERSISTENCE_UNCONFIRMED');
    check(binding,token,guard);record.persisted=true;phase='saved';notify();
  }
  async function prepare(kind){
    if(active||record!==null)throw failure('PQ_KEY_ORIGINAL_REQUIRES_RECOVERY');
    const binding=publicBinding(),operationId=id();
    if(typeof operationId!=='string'||!operationId||operationId.length>128)throw failure('PQ_KEY_OPERATION_ID_INVALID');
    const token=revision;active=true;phase='preparing';notify();
    let entered=false;
    try{
      await lifecycle.run(async guard=>{
        check(binding,token,guard);entered=true;
        const material=await source.prepare(kind,{binding,guard,operationId});
        // Do not call guard.step here: its post-await fence could hide a
        // returned original from this custodian before it can be retained.
        record={material,binding,operationId,kind,persistenceAttempted:false,persisted:false,receiptReturned:false,receipt:null};
        phase='retained';notify();check(binding,token,guard);
        await persistOriginal(binding,token,guard);
      });
    }catch(error){
      retain(error);
      // The SDK may fail after producing private output without returning a
      // handle. Keep the exact entered attempt as unknown; never auto-KeyGen.
      if(!record&&entered)record={material:null,binding,operationId,kind,persistenceAttempted:false,persisted:false,receiptReturned:false,receipt:null,prepareUnknown:true};
      phase=retainedPhase();notify();throw failure('PQ_KEY_PREPARATION_INCOMPLETE');
    }finally{active=false;notify();}
    return status();
  }
  return Object.freeze({status,
    generate:()=>prepare('generate'),restore:()=>prepare('restore'),
    cancel(){revision++;if(!active)phase=record?retainedPhase():'cancelled';notify();return status();},
    async saveRetained(){
      if(active||!record||record.prepareUnknown||record.persistenceAttempted||record.persisted)throw failure('PQ_KEY_ORIGINAL_REQUIRES_RECOVERY');
      const binding=publicBinding();if(!same(binding,record.binding))throw failure('PQ_KEY_BINDING_CHANGED');
      const token=revision;active=true;
      try{await lifecycle.run(guard=>persistOriginal(binding,token,guard));}
      catch(error){retain(error);phase=retainedPhase();throw failure('PQ_KEY_PREPARATION_INCOMPLETE');}
      finally{active=false;notify();}
      return status();
    },
    async reconcile(){
      if(active||!record||record.prepareUnknown||!record.persistenceAttempted||record.persisted)throw failure('PQ_KEY_ORIGINAL_REQUIRES_RECOVERY');
      const binding=publicBinding();if(!same(binding,record.binding))throw failure('PQ_KEY_BINDING_CHANGED');
      const token=revision;active=true;phase='reconciling';notify();
      try{
        await lifecycle.run(async guard=>{
          check(binding,token,guard);
          const receipt=await source.reconcile(record.material,{binding,operationId:record.operationId,guard});
          record.reconciliationReceipt=receipt; // Preserve a late returned fact.
          check(binding,token,guard);
          if(await source.verifyPersisted(record.material,receipt,{binding,operationId:record.operationId,guard})!==true)throw failure('PQ_KEY_PERSISTENCE_UNCONFIRMED');
          check(binding,token,guard);record.receipt=receipt;record.receiptReturned=true;record.persisted=true;phase='saved';
        });
      }catch(error){retain(error);phase=retainedPhase();throw failure('PQ_KEY_PREPARATION_INCOMPLETE');}
      finally{active=false;notify();}
      return status();
    },
    // Private main recovery only. Never serialize this result to the renderer.
    selectRetainedOutcome(observer){if(typeof observer!=='function')throw failure('PQ_KEY_RECOVERY_OBSERVER_REQUIRED');return observer(Object.freeze({record:record?Object.freeze({...record}):null,firstCause,firstCausePresent}));},
  });
}
