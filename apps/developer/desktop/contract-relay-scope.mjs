// Private backend adapter over the original SDK's branded current check.
// Scope DATA is a query namespace, never a Wallet account or Auth principal.
const keys=['kind','origin','chainId','projectId','projectGeneration','callerIdentity','expiresMS','relayURL'];
const methods=['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
const fail=()=>Object.assign(Error('The original contract project is no longer current.'),{code:'IDE_CONTRACT_RETIRED'});
export function contractScopeNamespace(scope){
 if(!scope||scope.kind!=='ide-contract-relay-v1'||scope.origin!=='https://developer.ynxweb4.com'||scope.chainId!=='eip155:6423'||typeof scope.projectId!=='string'||!scope.projectId||scope.projectId.length>512||!Number.isSafeInteger(scope.projectGeneration)||scope.projectGeneration<1||typeof scope.callerIdentity!=='string'||!scope.callerIdentity||scope.callerIdentity.length>512)throw fail();
 return Object.freeze(Object.fromEntries(keys.slice(0,6).map(key=>[key,scope[key]])));
}
export function createContractScopeFence({relayAuthority,now=Date.now}){
 let captured,lastTime,terminal=false,firstCause;
 return async()=>{
  if(terminal)throw firstCause;
  try{
  if(typeof relayAuthority?.assertCurrent!=='function')throw fail();
  const actual=await relayAuthority.assertCurrent(),time=now();
  contractScopeNamespace(actual);
  if(actual.dataOnly!==true||actual.authorized!==false||actual.nativeAdmission!==false||actual.relayURL!=='wss://relay.walletconnect.org'||!Number.isSafeInteger(time)||!Number.isSafeInteger(actual.expiresMS)||actual.expiresMS<=time||lastTime!==undefined&&time<lastTime||JSON.stringify(actual.methods)!==JSON.stringify(methods))throw fail();
  const scope=Object.freeze({...Object.fromEntries(keys.map(key=>[key,actual[key]])),methods:Object.freeze([...actual.methods])});
  if(captured&&JSON.stringify(scope)!==JSON.stringify(captured))throw fail();
  captured ||= scope;lastTime=time;return captured;
  }catch(error){terminal=true;firstCause=error;throw error;}
 };
}
