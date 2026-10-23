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
  return Object.freeze({async call(action,body={}){
    if(retired)throw unavailable();
    if(action==='publication-preview'||action==='publication-observe')return publication.call(action,body);
    if(action==='cancel'){
      if(cancelling)return cancelling;
      const selected=attempt;
      cancelling=(async()=>{
        await selected.close();
        if(typeof options.resetContractAuthority==='function')await options.resetContractAuthority();
        if(retired)return{state:'retired',queryOnly:true};
        await options.assertPathCurrent();if(retired)return{state:'retired',queryOnly:true};
        // Constructing a new local attempt does not acquire Source or Relay.
        // The next explicit action still passes the real original guard.
        attempt=createProjectContractsAttempt({...options,openPublication:undefined});
        return{state:'cancelled',queryOnly:true};
      })();
      try{return await cancelling;}finally{cancelling=null;}
    }
    if(cancelling){await options.assertPathCurrent();if(action==='inspect')return{state:'cancelling',projectId:options.context.id,onlineConfigured:false,pairingURI:null};throw Object.assign(unavailable(),{code:'IDE_CONTRACT_BUSY'});}
    return attempt.call(action,body);
  },close});
}
function createProjectContractsAttempt({context, openClient, openPublication, openDeployment, assertPathCurrent, assertNetworkApproved}) {
  let retired = false, client, acquiring, publication, acquiringPublication, deployment, acquiringDeployment, busy = false, uri = null, cleanup;
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
      if(busy)throw Object.assign(unavailable(),{code:'IDE_CONTRACT_BUSY'});
      busy=true;
      try {
        if(action==='deployment-preview'){const result=await(await deploymentOwner()).preview(body);await current();return result;}
        if(action==='publication-preview'||action==='publication-observe'){
          if(!publication){if(typeof openPublication!=='function')throw unavailable();acquiringPublication ||= Promise.resolve().then(()=>openPublication(context));publication=await acquiringPublication;if(retired){await close();throw unavailable();}}
          await current();const result=action==='publication-preview'?await publication.preview(body):await publication.observe(body.requestId);await current();return result;
        }
        if(action==='read'){const result=await (await acquire()).read(body.referenceId);await current();return result;}
        if(action==='references'){const result=await(await acquire()).listReferences();await current();return result;}
        if(!['connect','query','deployment-prepare','deployment-broadcast'].includes(action))throw unavailable();
        // A product session or a project DATA object is not network admission.
        // The actual owner must supply this guard; absence never starts Relay.
        if(typeof assertNetworkApproved!=='function')throw unavailable();
        if(await assertNetworkApproved() !== undefined)throw unavailable();await current();
        const owned=await acquire();
        if(action==='deployment-prepare'){const result=await(await deploymentOwner()).prepare(body.draftId,owned);await current();return result;}
        if(action==='deployment-broadcast'){const result=await(await deploymentOwner()).broadcast(body.referenceId,owned);await current();return result;}
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
