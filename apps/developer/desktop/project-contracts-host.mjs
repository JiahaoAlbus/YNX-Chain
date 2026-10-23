const unavailable = () => Object.assign(Error('Project Wallet service is unavailable. Local development remains available.'),{code:'IDE_CONTRACT_SERVICE_UNAVAILABLE'});

// This host belongs to exactly one local-workbench process/project. Neither a
// WebSocket client nor a plugin can select its SDK, account, project or origin.
export function createProjectContractsHost({context, openClient, assertPathCurrent, assertNetworkApproved}) {
  let retired = false, client, acquiring, busy = false, uri = null, cleanup;
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
    cleanup=(async()=>{const owned=client||await acquiring?.catch(()=>null);if(owned)await owned.close();})();
    return cleanup;
  }
  return Object.freeze({
    async call(action,body={}) {
      if(action==='cancel'){await close();return {state:'retired',queryOnly:true};}
      await current();
      if(action==='inspect')return {state:busy?'pending':'idle',projectId:context.id,onlineConfigured:typeof assertNetworkApproved==='function',pairingURI:uri};
      if(busy)throw Object.assign(unavailable(),{code:'IDE_CONTRACT_BUSY'});
      busy=true;
      try {
        if(action==='read'){const result=await (await acquire()).read(body.referenceId);await current();return result;}
        if(action!=='connect'&&action!=='query')throw unavailable();
        // A product session or a project DATA object is not network admission.
        // The actual owner must supply this guard; absence never starts Relay.
        if(typeof assertNetworkApproved!=='function')throw unavailable();
        if(await assertNetworkApproved() !== undefined)throw unavailable();await current();
        const owned=await acquire();
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
