// Adoption by the EXISTING gatewayd bootstrap only. No listener, endpoint,
// state directory, Root/profile, signer or second Host is created here.
import {types} from 'node:util';
import {WalletAuthError} from '@ynx-chain/wallet-auth';
import {ProductSessionGatewayNodeHost,captureOriginalWalletServiceRuntimeHostSource} from '@ynx-chain/wallet-auth/product-session-gateway-node-host';
import {createOriginalNodeHostAccountPolicy} from './account-context-source.mjs';
const fail=code=>{throw new WalletAuthError(code,code);};
export function buildOriginalHostPublisherOptions(registry,original){
 if(!original||types.isProxy(original)||Object.getPrototypeOf(original)!==Object.prototype)fail('AUTH_PUBLISHER_BOOTSTRAP_OPTIONS');
 const ds=Object.getOwnPropertyDescriptors(original),keys=['statePath','now','tokenFactory'];
 if(Reflect.ownKeys(ds).length!==3||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value'))||typeof ds.statePath.value!=='string'||typeof ds.now.value!=='function'||typeof ds.tokenFactory.value!=='function')fail('AUTH_PUBLISHER_BOOTSTRAP_OPTIONS');
 // These are the original protected bootstrap dependencies, NOT HTTP/App
 // options. There is intentionally no baseURL, endpoint or required=false.
 return Object.freeze({statePath:ds.statePath.value,now:ds.now.value,tokenFactory:ds.tokenFactory.value,accountPolicy:createOriginalNodeHostAccountPolicy(registry)});
}
const methods=['publishOriginalProductSessionReturn','readOriginalProductSessionReturnChallenge','completeOriginalProductSessionReturn','readOriginalProductSessionReturnCompletionOutcome','readOriginalProductSessionPublicationOutcome'];
export function bindOriginalHostReturnPublisher(host){
 if(!host||types.isProxy(host))fail('AUTH_PUBLISHER_ORIGINAL_HOST_REQUIRED');
 const proto=ProductSessionGatewayNodeHost.prototype;
 if(methods.some(k=>typeof proto[k]!=='function')||typeof proto.readOriginalProductSessionReturnOutcome!=='function')fail('AUTH_PUBLISHER_IMPLEMENTATION_NOT_SUPPLIED');
 // The original method's private fields reject structural/fake Host objects.
 // This proves code ownership only, NEVER registered service/TLS/Native grant.
 const original=proto.captureOriginalWalletServiceRuntimeSource.call(host);
 const selected=captureOriginalWalletServiceRuntimeHostSource(original),pending=new Set();
 let retired=false,closed=false,joining,closing;
 const current=()=>{if(retired||closed)fail('AUTH_PUBLISHER_RETIRED');const view=captureOriginalWalletServiceRuntimeHostSource(original);if(view!==selected)fail('AUTH_PUBLISHER_ORIGINAL_CHANGED');};
 const run=(name,input)=>{
  current();
  const task=Promise.resolve().then(async()=>{
   current();const result=await proto[name].call(host,input); // original transaction alone persists
   try{current();}catch(cause){const error=new WalletAuthError('AUTH_PUBLISHER_OUTCOME_UNKNOWN','Original publication result was retained; do not retry');Object.defineProperties(error,{cause:{value:cause},originalResult:{value:result}});throw error;}
   return result;
  });
  pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
 };
 const ports={registryDigest:selected.registryDigest,assertCurrent:current,
  // Main-only trusted requestId recovery. DO NOT mount this as a public
  // requestId bearer endpoint or hand this Host object to the App process.
  readOriginalProductSessionReturnOutcome(requestId){current();const result=proto.readOriginalProductSessionReturnOutcome.call(host,requestId);current();return result;},
  retire(){retired=true;},
  join(){if(!retired)fail('AUTH_PUBLISHER_RETIRE_REQUIRED');if(!joining)joining=Promise.allSettled([...pending]).then(()=>undefined);return joining;},
  close(){if(!closing){retired=true;closing=Promise.resolve().then(()=>ports.join()).then(()=>{closed=true;return undefined;});}return closing;}
 };
 for(const name of methods)ports[name]=input=>run(name,input);
 return Object.freeze(ports);
}
