// Main-only lazy ownership. The actual Main fixes the module and constructor;
// these functions are not IPC, Source/caller qualification or a provider setter.
const fail=()=>{throw Object.assign(Error('IDE identity peer is closing.'),{code:'AUTH_IDENTITY_PEER_CLOSING'});};
export function createWalletIDEIdentityPeerOwner({load,create}){
 let owner=null,loading=null,closing=false,closeFlight=null,loadSettled=false,closeComplete=false;
 return Object.freeze({
  get(){
   // An already held owner remains reachable for explicit local-save recovery.
   // No replacement may be constructed after shutdown began.
   if(owner)return Promise.resolve(owner);if(closing)fail();
   if(!loading){loading=(async()=>{const module=await load();if(closing)fail();owner=create(module);if(closing)fail();return owner;})();void loading.then(()=>{loadSettled=true;},()=>{loadSettled=true;});}return loading;
  },
  retire(){owner?.retire();},
  shutdown(){
   closing=true;
   if(closeFlight)return closeFlight;
   const work=(async()=>{
    // Adopt before load completion, including a synchronously constructed late
    // owner. Load failure has no owner; an actual owner always drains first.
    let loadFailed=false,cause;try{if(!owner)await loading;}catch(error){loadFailed=true;cause=error;}
    if(owner)await owner.shutdown();
    if(loadFailed&&owner)throw cause;closeComplete=true;
   })();
   closeFlight=work;void work.catch(()=>{if(closeFlight===work)closeFlight=null;});return work;
  },
  assertSafeToClose(){if(loading&&!loadSettled||closing&&!closeComplete)fail();owner?.assertSafeToClose();},
 });
}
