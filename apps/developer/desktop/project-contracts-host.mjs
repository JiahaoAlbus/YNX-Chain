const unavailable = () => Object.assign(Error('Project Wallet service is unavailable. Local development remains available.'),{code:'IDE_CONTRACT_SERVICE_UNAVAILABLE'});

// This host belongs to exactly one local-workbench process/project. Neither a
// WebSocket client nor a plugin can select its SDK, account, project or origin.
export function createProjectContractsHost(options){
  let retired=false,attempt=createProjectContractsAttempt({...options,openPublication:undefined}),cancelling,cleanup;
  // Cancelling Wallet must not retire an independent publication observer.
  const publication=createProjectContractsAttempt({context:options.context,assertPathCurrent:options.assertPathCurrent,openPublication:options.openPublication});
  function close(){
    retired=true;
    return cleanup ||= (async()=>{
      const results=await Promise.allSettled([attempt.close(),publication.close(),cancelling]);
      if(typeof options.closeContractAuthority==='function')try{await options.closeContractAuthority();}catch(reason){results.push({status:'rejected',reason});}
      const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);
      if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'Project contract cleanup remains uncertain.');
    })();
  }
  async function cancelSelected(selected){
    // An old RPC's late abort may retire its old attempt, never a successor.
    if(selected!==attempt){await selected.close();return{state:'retired',queryOnly:true};}
    if(cancelling)return cancelling;
    cancelling=(async()=>{
      await selected.close();
      if(retired||selected!==attempt)return{state:'retired',queryOnly:true};
      if(typeof options.resetContractAuthority==='function')await options.resetContractAuthority();
      if(retired||selected!==attempt)return{state:'retired',queryOnly:true};
      await options.assertPathCurrent();if(retired||selected!==attempt)return{state:'retired',queryOnly:true};
      attempt=createProjectContractsAttempt({...options,openPublication:undefined});
      return{state:'cancelled',queryOnly:true};
    })();
    try{return await cancelling;}finally{cancelling=null;}
  }
  return Object.freeze({async call(action,body={},signal){
    signal?.throwIfAborted();if(retired)throw unavailable();
    if(action==='publication-preview'||action==='publication-observe'||action==='publication-observe-cancel')return publication.call(action,body);
    if(action==='cancel')return cancelSelected(attempt);
    if(cancelling){await options.assertPathCurrent();if(action==='inspect')return{state:'cancelling',projectId:options.context.id,onlineConfigured:false,pairingURI:null};throw Object.assign(unavailable(),{code:'IDE_CONTRACT_BUSY'});}
    const selected=attempt;
    const sensitive=['connect','deployment-prepare','deployment-broadcast','execution-prepare','execution-broadcast'].includes(action);
    let cancellation,failed=false;
    const abort=()=>{if(sensitive&&!cancellation){cancellation=cancelSelected(selected);cancellation.catch(()=>{});}};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try{signal?.throwIfAborted();const result=await selected.call(action,body);signal?.throwIfAborted();return result;}
    catch(error){failed=true;throw error;}
    finally{signal?.removeEventListener('abort',abort);if(cancellation)try{await cancellation;}catch(error){if(!failed)throw error;}}
  },close});
}
function createProjectContractsAttempt({context, openClient, openPublication, openDeployment, assertPathCurrent, assertNetworkApproved}) {
  let retired = false, client, acquiring, publication, acquiringPublication, deployment, acquiringDeployment, busy = false, uri = null, cleanup, observing;
  async function current() { if(retired)throw unavailable(); await assertPathCurrent(); if(retired)throw unavailable(); }
  async function acquire() {
    await current();
    if(!client) {
      acquiring ||= Promise.resolve().then(()=>openClient(context));
      const acquired=await acquiring;
      client=acquired;
      if(retired){ await close(); throw unavailable(); }
    }
    await current(); return client;
  }
  async function close() {
    retired=true;uri=null;
    if(cleanup)return cleanup;
    // Retain the same acquisition and cleanup; closing a pending acquisition
    // must not construct a second connection or discard the original owner.
    cleanup=(async()=>{const results=await Promise.allSettled([(async()=>{const owned=client||await acquiring?.catch(()=>null);if(owned)await owned.close();})(),(async()=>{const owned=publication||await acquiringPublication?.catch(()=>null);if(owned)await owned.close();})(),(async()=>{const owned=deployment||await acquiringDeployment?.catch(()=>null);if(owned)await owned.close();})()]);const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;})();
    return cleanup;
  }
  async function deploymentOwner(){await current();if(!deployment){if(typeof openDeployment!=='function')throw unavailable();acquiringDeployment ||= Promise.resolve().then(()=>openDeployment(context));deployment=await acquiringDeployment;if(retired){await close();throw unavailable();}}await current();return deployment;}
  return Object.freeze({
    async call(action,body={}) {
      if(action==='cancel'){await close();return {state:'retired',queryOnly:true};}
      await current();
      if(action==='inspect')return {state:busy?'pending':'idle',projectId:context.id,onlineConfigured:typeof assertNetworkApproved==='function',pairingURI:uri};
      if(action==='publication-observe-cancel'){
        const selected=observing;
        if(!selected||selected.id!==body.observationId)return{cancelled:false,queryOnly:true,replayAllowed:false};
        selected.controller.abort(Object.assign(Error('The status and log query was stopped.'),{code:'IDE_PUBLICATION_OBSERVATION_CANCELLED'}));
        if(publication)await publication.cancelObservation(body.observationId);
        await current();return{cancelled:true,queryOnly:true,replayAllowed:false};
      }
      if(busy)throw Object.assign(unavailable(),{code:'IDE_CONTRACT_BUSY'});
      busy=true;
      try {
        if(action==='deployment-preview'){const result=await(await deploymentOwner()).preview(body);await current();return result;}
        if(action==='execution-preview'){const result=await(await deploymentOwner()).previewExecution(body);await current();return result;}
        if(action==='publication-preview'||action==='publication-observe'){
          const selected=action==='publication-observe'&&body.observationId?{id:body.observationId,controller:new AbortController()}:null;
          if(selected)observing=selected;
          let abort;const cancelled=selected?new Promise((_resolve,reject)=>{abort=()=>reject(selected.controller.signal.reason);selected.controller.signal.addEventListener('abort',abort,{once:true});}):null;
          const operation=Promise.resolve().then(async()=>{
            selected?.controller.signal.throwIfAborted();
            if(!publication){if(typeof openPublication!=='function')throw unavailable();acquiringPublication ||= Promise.resolve().then(()=>openPublication(context));publication=await acquiringPublication;if(retired){await close();throw unavailable();}}
            selected?.controller.signal.throwIfAborted();await current();selected?.controller.signal.throwIfAborted();
            const result=action==='publication-preview'?await publication.preview(body):await publication.observe(body.requestId,{observationId:body.observationId});await current();selected?.controller.signal.throwIfAborted();return result;
          });
          try{return await(cancelled?Promise.race([operation,cancelled]):operation);}
          finally{if(selected){selected.controller.signal.removeEventListener('abort',abort);if(observing===selected)observing=undefined;}}
        }
        if(action==='read'){const result=await (await acquire()).read(body.referenceId);await current();return result;}
        if(action==='references'){const result=await(await acquire()).listReferences();await current();return result;}
        if(!['connect','query','deployment-prepare','deployment-broadcast','execution-prepare','execution-broadcast'].includes(action))throw unavailable();
        // A product session or a project DATA object is not network admission.
        // The actual owner must supply this guard; absence never starts Relay.
        if(typeof assertNetworkApproved!=='function')throw unavailable();
        if(await assertNetworkApproved() !== undefined)throw unavailable();await current();
        const owned=await acquire();
        if(action==='deployment-prepare'){const result=await(await deploymentOwner()).prepare(body.draftId,owned);await current();return result;}
        if(action==='deployment-broadcast'){const result=await(await deploymentOwner()).broadcast(body.referenceId,owned);await current();return result;}
        if(action==='execution-prepare'){const result=await(await deploymentOwner()).prepareExecution(body.draftId,owned);await current();return result;}
        if(action==='execution-broadcast'){const result=await(await deploymentOwner()).broadcastExecution(body.referenceId,owned);await current();return result;}
        if(action==='connect') {
          uri=null;
          const result=await owned.connect({onURI:value=>{if(!retired)uri=value;}});
          await current();uri=null;return result;
        }
        const result=await owned.query(body.referenceId,{refresh:body.refresh});await current();return result;
      } finally { busy=false; }
    },close,
  });
}
