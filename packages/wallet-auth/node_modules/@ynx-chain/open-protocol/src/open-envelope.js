import{encodeFields,decodeFields}from'./framing.js';
import{IDENTITY_CHALLENGE_DOMAIN,decodeIdentityChallengeV1DATA}from'./identity-challenge.js';
import{IDENTITY_ROLE_DOMAINS,decodeIdentityRoleAuthorizationV1DATA,decodeIdentityEventV1DATA}from'./identity-event.js';
const invalid=()=>{throw Object.assign(Error('invalid OPEN envelope DATA'),{code:'INVALID'})};
const id=s=>{if(typeof s!=='string'||! /^[a-f0-9]{32}$/.test(s))invalid();const b=new Uint8Array(16);for(let i=0;i<16;i++)b[i]=parseInt(s.slice(i*2,i*2+2),16);return b};
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
function context(value){if(!value||Object.getPrototypeOf(value)!==Object.prototype)invalid();const keys=['realm','tenant','actor','actorEpoch','traceId','requestId'],ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))invalid();const c=Object.fromEntries(keys.map(k=>[k,ds[k].value]));id(c.realm);id(c.tenant);if(c.actor!==null)id(c.actor);if(typeof c.actorEpoch!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(c.actorEpoch)||BigInt(c.actorEpoch)>0xffffffffffffffffn)invalid();for(const k of ['traceId','requestId'])if(typeof c[k]!=='string'||!c[k].length||c[k].length>128||!/^[\x20-\x7e]+$/.test(c[k]))invalid();return c;}
/** OPEN-02's public Call wrapper. The typed challenge and four identity role profiles
 * are supported. This binds DATA to ctx realm/tenant; it does not authorize an
 * actor, assert channel authenticity, consume a challenge or sign anything. */
export async function encodeOpenEnvelope(ctx,domain,realm,fields){
 let requestId='';try{const d=Object.getOwnPropertyDescriptor(ctx??{},'requestId');if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string')requestId=d.value;}catch{}
 try{
  const c=context(ctx);requestId=c.requestId;
  const role=Object.values(IDENTITY_ROLE_DOMAINS).includes(domain);
  if(domain!==IDENTITY_CHALLENGE_DOMAIN&&!role)return {ok:false,code:'UNSUPPORTED',requestId};
  if(c.realm!==realm)invalid();const realmBytes=id(realm);
  const count=role?8:9;if(!Array.isArray(fields)||fields.length!==count)invalid();
  // encodeFields captures descriptors and copies all bytes before using them.
  const body=encodeFields(fields),captured=decodeFields(body,count);
  const wire=encodeFields([new TextEncoder().encode(domain),realmBytes,...captured]);
  const binding=role?decodeIdentityEventV1DATA(decodeIdentityRoleAuthorizationV1DATA(wire).eventOriginal).subject:decodeIdentityChallengeV1DATA(wire);
  if(hex(binding.realm)!==c.realm||hex(binding.tenant)!==c.tenant)invalid();
  return {ok:true,value:wire};
 }catch(error){let code='INVALID';try{const d=Object.getOwnPropertyDescriptor(error??{},'code');if(d&&Object.hasOwn(d,'value')&&d.value==='BOUNDS')code='BOUNDS';}catch{}return {ok:false,code,requestId};}
}
