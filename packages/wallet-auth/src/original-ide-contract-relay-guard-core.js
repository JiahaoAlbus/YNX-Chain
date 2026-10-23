// Private portable reader. Only the fixed Node/native adapter registers owners.
// A JavaScript object or successful local scope comparison grants nothing.
const owners=new WeakMap();
const fail=code=>{throw Object.assign(new Error(code),{code});};
const invalid=()=>fail('YNX_CONTRACT_RELAY_GUARD_SCOPE_INVALID');
export const CONTRACT_RELAY_URL='wss://relay.walletconnect.org';
export const CONTRACT_RELAY_METHODS=Object.freeze(['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal']);
const fixed=Object.freeze({kind:'ide-contract-relay-v1',origin:'https://developer.ynxweb4.com',chainId:'eip155:6423',relayURL:CONTRACT_RELAY_URL});
const fields=['kind','projectId','projectGeneration','callerIdentity','origin','expiresMS','chainId','methods','relayURL'];
function record(value,exact){
 if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);if(exact&&keys.length!==fields.length||keys.some(k=>!fields.includes(k)))invalid();
 const out=Object.create(null);for(const k of keys){const d=ds[k];if(!d.enumerable||!Object.hasOwn(d,'value'))invalid();out[k]=d.value;}return out;
}
const own=(v,k)=>Object.hasOwn(v,k);
function text(v){if(typeof v!=='string'||!v.length||v.length>512||/[\ud800-\udfff\p{Cc}\p{Cf}]/u.test(v)||new TextEncoder().encode(v).length>512)invalid();return v;}
function positive(v){if(!Number.isSafeInteger(v)||v<1)invalid();return v;}
function methods(v){
 if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype)invalid();const ds=Object.getOwnPropertyDescriptors(v);
 if(Reflect.ownKeys(ds).length!==4||ds.length?.value!==3||CONTRACT_RELAY_METHODS.some((m,i)=>!ds[i]||!Object.hasOwn(ds[i],'value')||!ds[i].enumerable||ds[i].value!==m))invalid();return Object.freeze([...CONTRACT_RELAY_METHODS]);
}
/** Private DATA capture. Native expected expiry is an upper bound; the consumer
 * context may omit it. Only Native supplies the actual signed caller identity. */
export function captureContractRelayExpectedScope(input,requireExpiry=false){
 try{const e=record(input,false);text(e.projectId);positive(e.projectGeneration);
  if(own(e,'callerIdentity'))text(e.callerIdentity);
  if(requireExpiry||own(e,'expiresMS'))positive(e.expiresMS);
  for(const k of Object.keys(fixed))if(own(e,k)&&e[k]!==fixed[k])invalid();
  if(own(e,'methods'))e.methods=methods(e.methods);return Object.freeze({...e});
 }catch{invalid();}
}
export function assertContractRelayScope(scope,expected,now=Date.now()){
 try{const s=record(scope,true),e=captureContractRelayExpectedScope(expected);
  for(const k of Object.keys(fixed))if(s[k]!==fixed[k])invalid();
  text(s.projectId);text(s.callerIdentity);positive(s.projectGeneration);positive(s.expiresMS);s.methods=methods(s.methods);
  if(!Number.isSafeInteger(now)||s.expiresMS<=now||s.projectId!==e.projectId||s.projectGeneration!==e.projectGeneration||own(e,'callerIdentity')&&s.callerIdentity!==e.callerIdentity||own(e,'expiresMS')&&s.expiresMS>e.expiresMS)invalid();
  return Object.freeze({...s});
 }catch{invalid();}
}
export function assertSameContractRelayScope(actual,original){
 if(fields.some(k=>k==='methods'?actual.methods.length!==original.methods.length||actual.methods.some((m,i)=>m!==original.methods[i]):actual[k]!==original[k]))invalid();return actual;
}
export function registerOriginalContractRelayGuard(owner,adapter){owners.set(owner,{adapter,scope:null});}
export function assertOriginalContractRelayGuard(owner,expected){
 const entry=owner&&owners.get(owner);if(!entry)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');const {adapter}=entry;
 // Freeze the real scope BEFORE current, then check again after current; an
 // adapter cannot replace peer identity or expiry under the same opaque owner.
 const before=assertContractRelayScope(adapter.scope(),expected);
 if(entry.scope)assertSameContractRelayScope(before,entry.scope);else entry.scope=before;
 if(adapter.current()!==true)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
 return assertSameContractRelayScope(assertContractRelayScope(adapter.scope(),expected),entry.scope);
}
export function observeOriginalContractRelayGuard(owner,listener){
 const entry=owner&&owners.get(owner);if(!entry)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');return entry.adapter.observe(listener);
}
export function cancelOriginalContractRelayGuard(owner){
 const entry=owner&&owners.get(owner);if(!entry)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');return entry.adapter.cancel();
}
// Private bridge only. Ordinary browser consumers never import a Node checker.
export async function assertOriginalContractRelayRuntime(owner){
 const entry=owner&&owners.get(owner);if(!entry||typeof entry.adapter.runtimeCheck!=='function')fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
 if(await entry.adapter.runtimeCheck()!==true)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');return true;
}
