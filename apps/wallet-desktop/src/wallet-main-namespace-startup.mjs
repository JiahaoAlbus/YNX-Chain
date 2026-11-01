import {types} from 'node:util';
const failure=code=>Object.assign(Error(code),{code});
// Main owns the fixed SDK's attempt before awaiting it. This controller owns
// cleanup only; neither status DATA nor completion booleans admit a namespace.
export function createWalletMainNamespaceStartup({initialize}){
  let selected=false,attempt=null,valid=false,closing=false,completion=null,drain=null,drained=false,retireSelected=false;
  let startupErrorPresent=false,startupError,cleanupErrorPresent=false,cleanupError,rawCompletion=null;
  let initializing=false,allocationReady=null,finishAllocation;
  const rememberStartup=cause=>{if(!startupErrorPresent){startupErrorPresent=true;startupError=cause;}};
  const rememberCleanup=cause=>{if(!cleanupErrorPresent){cleanupErrorPresent=true;cleanupError=cause;}};
  function retireAttempt(){
    if(!attempt)return;
    if(retireSelected)return;retireSelected=true;
    if(!valid)throw failure('WALLET_MAIN_STARTUP_ATTEMPT_INVALID');
    if(attempt.retire()!==undefined)throw failure('WALLET_MAIN_STARTUP_RETIRE_RESULT');
  }
  function selectDrain(){
    if(drain)return drain;
    // Reserve before invoking a potentially reentrant retirement callback.
    let resolve,reject;drain=new Promise((yes,no)=>{resolve=yes;reject=no;});
    try{retireAttempt();}catch(cause){rememberCleanup(cause);}
    void(async()=>{
      try{
        if(initializing)await allocationReady;
        try{retireAttempt();}catch(cause){rememberCleanup(cause);}
        if(attempt){
          if(!valid)throw failure('WALLET_MAIN_STARTUP_ATTEMPT_INVALID');
          if(await attempt.join()!==undefined)throw failure('WALLET_MAIN_STARTUP_JOIN_RESULT');
          if(await attempt.close()!==undefined)throw failure('WALLET_MAIN_STARTUP_CLOSE_RESULT');
        }
        if(cleanupErrorPresent)throw cleanupError;
        drained=true;resolve();
      }catch(cause){rememberCleanup(cause);reject(cleanupError);}
    })();
    void drain.catch(()=>{});return drain;
  }
  return Object.freeze({
    start(){
      if(closing)throw failure('WALLET_MAIN_STARTUP_CLOSING');
      if(selected){if(startupErrorPresent&&!completion)throw startupError;return attempt;}
      selected=true;
      initializing=true;allocationReady=new Promise(resolve=>{finishAllocation=resolve;});
      try{
        attempt=initialize(); // Adopt the SAME synchronous return first.
        if(!attempt||types.isProxy(attempt)||!Object.isFrozen(attempt))throw failure('WALLET_MAIN_STARTUP_ATTEMPT_INVALID');
        const d=Object.getOwnPropertyDescriptors(attempt),keys=['completion','retire','join','close','statusDATA'];
        if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!Object.hasOwn(d[k]??{},'value'))||!types.isPromise(d.completion.value)||keys.slice(1).some(k=>typeof d[k].value!=='function'))throw failure('WALLET_MAIN_STARTUP_ATTEMPT_INVALID');
        valid=true;
        if(closing){try{retireAttempt();}catch(cause){rememberCleanup(cause);}throw failure('WALLET_MAIN_STARTUP_RETIRED');}
        return attempt;
      }catch(cause){rememberStartup(cause);throw cause;}
      finally{initializing=false;finishAllocation();}
    },
    settle(sameAttempt){
      if(!valid||sameAttempt!==attempt)throw failure('WALLET_MAIN_STARTUP_ATTEMPT_CHANGED');
      if(!completion){
        completion=(async()=>{
          try{
            rawCompletion=await attempt.completion;
            if(!rawCompletion||types.isProxy(rawCompletion))throw failure('WALLET_MAIN_STARTUP_COMPLETION_INVALID');
            const d=Object.getOwnPropertyDescriptors(rawCompletion);
            if(!Object.hasOwn(d.errorPresent??{},'value')||typeof d.errorPresent.value!=='boolean'||!Object.hasOwn(d.error??{},'value'))throw failure('WALLET_MAIN_STARTUP_COMPLETION_INVALID');
            if(d.errorPresent.value)throw d.error.value;
            // Keep the fixed SDK's SAME completed attempt alive. Completion
            // is lifecycle DATA, never a Source/Root or payment permission.
            // Operational getters must independently borrow the actual Native
            // namespace and their separate original operation Source.
            return rawCompletion;
          }catch(cause){
            rememberStartup(cause);
            try{await selectDrain();}catch{/* separate cleanup cause retained */}
            throw startupError;
          }
        })();
        void completion.catch(()=>{});
      }
      return completion;
    },
    retire(){closing=true;try{retireAttempt();}catch(cause){rememberCleanup(cause);throw cause;}},
    shutdown(){closing=true;return selectDrain();},
    isClosing:()=>closing,
    assertSafeToClose(){if(attempt&&!drained)throw failure('WALLET_MAIN_STARTUP_CLEANUP_PENDING');if(cleanupErrorPresent)throw cleanupError;},
    statusDATA:()=>Object.freeze({selected,attemptPresent:attempt!==null,closing,drained,startupErrorPresent,startupError,cleanupErrorPresent,cleanupError,completionRetained:rawCompletion!==null,MainRegistered:false,SourceAdmission:false,NativeAdmission:false}),
  });
}
