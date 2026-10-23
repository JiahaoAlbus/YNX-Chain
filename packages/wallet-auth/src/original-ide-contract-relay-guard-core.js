// Private portable reader. Only the fixed Node/native adapter registers owners.
// A JavaScript object or successful local scope comparison grants nothing.
const owners=new WeakMap();
const fail=code=>{throw Object.assign(new Error(code),{code});};
export const CONTRACT_RELAY_URL='wss://relay.walletconnect.org';
export const CONTRACT_RELAY_METHODS=Object.freeze(['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal']);
export function assertContractRelayScope(scope,expected,now=Date.now()){
  if(!scope||scope.kind!=='ide-contract-relay-v1'||scope.origin!=='https://developer.ynxweb4.com'||scope.chainId!=='eip155:6423'||scope.relayURL!==CONTRACT_RELAY_URL||!Array.isArray(scope.methods)||scope.methods.join(',')!==CONTRACT_RELAY_METHODS.join(',')||!Number.isSafeInteger(scope.expiresMS)||scope.expiresMS<=now||!expected||['projectId','projectGeneration','callerIdentity'].some(k=>scope[k]!==expected[k])||typeof scope.projectId!=='string'||!scope.projectId||!Number.isSafeInteger(scope.projectGeneration)||scope.projectGeneration<1||typeof scope.callerIdentity!=='string'||!scope.callerIdentity)fail('YNX_CONTRACT_RELAY_GUARD_SCOPE_INVALID');
  return scope;
}
export function registerOriginalContractRelayGuard(owner,adapter){owners.set(owner,adapter);}
export function assertOriginalContractRelayGuard(owner,expected){
  const adapter=owner&&owners.get(owner);if(!adapter)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
  if(adapter.current()!==true)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
  return assertContractRelayScope(adapter.scope(),expected);
}
export function observeOriginalContractRelayGuard(owner,listener){
  const adapter=owner&&owners.get(owner);if(!adapter)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
  return adapter.observe(listener);
}
export function cancelOriginalContractRelayGuard(owner){
  const adapter=owner&&owners.get(owner);if(!adapter)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
  return adapter.cancel();
}
