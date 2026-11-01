import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {parseProductSessionRegistry} from './product-session-registry.js';
import {parseProductSession} from './product-session-v2.js';
import {ProductSessionGatewayHttpHandler} from './product-session-gateway-http.js';
import {originalSessionProjectionRecord,parseOriginalSessionProjection} from './product-session-authority-projection.js';
import {createOriginalDeveloperResourceRegistryCurrent} from './original-developer-resource-registry-current.js';
import {createOriginalDeveloperResourceDomainEvidenceVerifier} from './original-developer-resource-domain-evidence.js';

const fail=()=>{throw new WalletAuthError('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','Normal original resource source is not configured');};
const originalPairs=new WeakMap();
export function assertOriginalDeveloperResourceSameWriterPair(authority,heldSource){
 if(!authority||originalPairs.get(authority)!==heldSource)fail();return authority;
}
function data(raw){
 const seen=new Set();let nodes=0,budget=0;
 function copy(v,depth){
  if(++nodes>100000||depth>32)fail();
  if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v))return v;
  if(typeof v==='string'){budget+=Buffer.byteLength(v);if(budget>65536)fail();return v;}
  if(!v||typeof v!=='object'||types.isProxy(v)||seen.has(v))fail();seen.add(v);
  const array=Array.isArray(v),out=array?[]:{};if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype))fail();
  const keys=Reflect.ownKeys(v);if(array&&(keys.length!==v.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))))fail();
  for(const k of keys){if(array&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!d.enumerable||!Object.hasOwn(d,'value'))fail();Object.defineProperty(out,k,{value:copy(d.value,depth+1),enumerable:true});}
  seen.delete(v);return Object.freeze(out);
 }
 const value=copy(raw,0);if(Buffer.byteLength(canonicalJSON(value))>65536)fail();return value;
}

// Private construction-time composition. The returned methods receive the
// already-held original Store view; they NEVER call a Store getter or HTTP.
// A root/source declaration is not created, signed or admitted here.
export function prepareOriginalDeveloperResourceSameWriterAuthority(raw){
 if(!raw||typeof raw!=='object'||types.isProxy(raw)||Object.getPrototypeOf(raw)!==Object.prototype)fail();
 const d=Object.getOwnPropertyDescriptors(raw),fields=['registry','tokenFactory','now','rootAnchor','publicSource','originalOperatorSession'];
 if(Reflect.ownKeys(d).length!==fields.length||fields.some(k=>!d[k]||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail();
 for(const k of ['tokenFactory','now'])if(typeof d[k].value!=='function'||types.isProxy(d[k].value))fail();
 const registry=parseProductSessionRegistry(data(d.registry.value));
 const registryDigest=createHash('sha256').update(canonicalJSON(registry)).digest('hex');
 const operator=parseProductSession(data(d.originalOperatorSession.value));
 const rootAnchor=data(d.rootAnchor.value),publicSource=data(d.publicSource.value);
 let active=false,invalid=false,currentState=null,closed=false;
 const verifiers=new Map();
 const enter=()=>{if(active){invalid=true;fail();}if(invalid||closed)fail();active=true;};
 const check=()=>{if(invalid||closed)fail();};
 function captureOperator(state,at,mode){
  let found;
  if(mode==='current')found=originalSessionProjectionRecord(state.snapshot,state.projection,operator.sessionBinding);
  else{
   const projection=parseOriginalSessionProjection(state.projection,state.snapshot);
   const session=state.snapshot.authority.sessions.find(s=>s.sessionBinding===operator.sessionBinding);
   const record=projection.records.find(r=>r.sessionBinding===operator.sessionBinding);
   if(!session||!record)fail();found={session,record};
  }
  if(canonicalJSON(found.session)!==canonicalJSON(operator))fail();
  if(mode==='current'){
   const observed=new ProductSessionGatewayHttpHandler(registry,d.tokenFactory.value,state.snapshot).revalidate(operator,['account:read'],operator.productId,at,true);
   check();if(observed?.active!==true||found.record.revoked)fail();
  }
  return data({session:found.session,projection:found.record});
 }
 const inner=createOriginalDeveloperResourceRegistryCurrent({registry,tokenFactory:d.tokenFactory.value,now:d.now.value,
  verifyDomainEvidence(receipt,association,at,mode){
   if(!active||!currentState)fail();
   const captured=captureOperator(currentState,at,mode);
   let verifier=verifiers.get(mode);
   if(!verifier){
    verifier=createOriginalDeveloperResourceDomainEvidenceVerifier({rootAnchor,publicSource,registryDigest,originalOperatorCaptured:captured,at:Date.prototype.toISOString.call(at),mode});
    verifiers.set(mode,verifier);
   }
   const result=verifier.verifyDomainEvidence(receipt,association,at,mode,captured);check();return result;
  }});
 function run(name,state,args){enter();try{
  currentState=state;const result=inner[name](state,...args);check();
  // inner's last external Now may mutate source files. There is no new clock,
  // callback or Store read after these held-FD checks inside this composition.
  for(const verifier of verifiers.values())verifier.assertHeldSource();check();return result;
 }finally{currentState=null;active=false;}}
 const authority=Object.freeze({
  admit(state,...args){return run('admit',state,args);},
  assertStored(state,...args){return run('assertStored',state,args);},
  readCurrent(state,...args){return run('readCurrent',state,args);}
 });
 const assertHeldSource=()=>{enter();try{if(verifiers.size===0)fail();for(const verifier of verifiers.values())verifier.assertHeldSource();check();return undefined;}finally{active=false;}};
 originalPairs.set(authority,assertHeldSource);
 return Object.freeze({authority,assertHeldSource,
  close(){enter();try{closed=true;for(const verifier of verifiers.values())verifier.close();}finally{active=false;}}
 });
}
