// Private factory lexical gates only. No global/module/provider/key/domain
// setter and no Source grant. Native supplies exactly these two fixed ports.
import {encodeOriginalAuthSourceStatementV2}from'./original-auth-source-v2-public-codec.mjs';
import {SourceUTF8Encoder}from'./original-source-private-utf8.mjs';
import {pqHexBytes,pqU64}from'../src/pq-public-bytes.js';
const utf8=new SourceUTF8Encoder(),roles=Object.freeze({enrollment:1,profile:2,current:3});
const fail=(code,originalMathObservation)=>{throw Object.assign(new Error(code),{code,...(originalMathObservation?{originalMathObservation}: {})});};
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('SOURCE_FIXED_CORE_SHAPE');const ds=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(ds);if(own.length!==keys.length||own.some(k=>!keys.includes(k)||!Object.hasOwn(ds[k],'value')))fail('SOURCE_FIXED_CORE_SHAPE');};
const ab=bytes=>new Uint8Array(bytes).buffer;
const resultKeys=['rawCode','errorPresent','entered','bridgeRejection','version','structSize','verified','memberCount','index','cleanupStatus','reservedDecimal','dataOnly'];
function checkedResult(raw){
 exact(raw,resultKeys);const r=Object.freeze(Object.fromEntries(resultKeys.map(k=>[k,Object.getOwnPropertyDescriptor(raw,k).value])));
 if(typeof r.errorPresent!=='boolean'||typeof r.entered!=='boolean'||!(r.bridgeRejection===null||['ACTOR','SHAPE','HISTORICAL_ROLE'].includes(r.bridgeRejection))||r.dataOnly!==true||!(r.rawCode===null||Number.isInteger(r.rawCode)&&r.rawCode>=-2147483648&&r.rawCode<=2147483647)||r.entered!==(r.rawCode!==null))fail('SOURCE_FIXED_CORE_RESULT_SHAPE',r);
 if(r.errorPresent||!r.entered||r.rawCode!==0||r.bridgeRejection!==null)fail('SOURCE_FIXED_CORE_ORIGINAL_FAILURE',r);
 if(r.version!==1||r.structSize!==32||r.verified!==1||r.memberCount!==1||r.index!==0||r.cleanupStatus!==0||r.reservedDecimal!=='0')fail('SOURCE_FIXED_CORE_NOT_VERIFIED',r);
 return r;
}
export function createOriginalSourceV2FixedCoreGates(nativeObject){
 if(arguments.length!==1)fail('SOURCE_FIXED_CORE_FACTORY_ARGUMENTS');
 exact(nativeObject,['verifySourceStatementV2','verifyRegisteredSourceCurrentN1V1']);
 const fresh=Object.getOwnPropertyDescriptor(nativeObject,'verifySourceStatementV2').value,historical=Object.getOwnPropertyDescriptor(nativeObject,'verifyRegisteredSourceCurrentN1V1').value;
 if(typeof fresh!=='function'||typeof historical!=='function')fail('SOURCE_FIXED_CORE_FACTORY_SHAPE');
 // Only the private Source kernel calls this with its decoded exact envelope
 // and original independently parsed registered snapshot. It is not an App API.
 return function verifySourceEnvelopeMath(role,frame,binding,bodyRaw,memberWire,registered,historicalCurrent=false){
  if(!Object.hasOwn(roles,role)||historicalCurrent&&role!=='current')fail('SOURCE_FIXED_CORE_ROLE');
  const observed=pqU64(registered.observedHeight),issued=pqU64(binding.executionHeight),active=pqU64(registered.activeFrom);
  if(active>issued||issued>observed||role==='current'&&!historicalCurrent&&issued!==observed)fail('SOURCE_FIXED_CORE_HEIGHT');
  const body=utf8.encode(bodyRaw),frameBytes=utf8.encode(frame),owner=utf8.encode(binding.owner);
  const member=new Uint8Array(memberWire);
  if(!member.length||member.length>(historicalCurrent?98304:262144)||!body.length||body.length>65536||!frameBytes.length||frameBytes.length>512||owner.length!==42)fail('SOURCE_FIXED_CORE_CAPACITY');
  // EXACT16. Core struct_size176/reserved0 are fixed in Native, not caller DTO.
  const request=Object.freeze({version:1,role:roles[role],member:ab(member),bodyOriginal:ab(body),expectedFrame:ab(frameBytes),network:ab(pqHexBytes(binding.networkId,32)),owner:ab(owner),pkA:ab(pqHexBytes(registered.pkA,2592)),pkB:ab(pqHexBytes(registered.pkB,64)),keyVersion:binding.keyVersion,issuedHeight:binding.executionHeight,observedHeight:registered.observedHeight,activeFrom:registered.activeFrom,revokedAt:registered.revokedAt,enabled:registered.enabled,hasRevokedAt:registered.hasRevokedAt});
  let raw;
  if(historicalCurrent){
   // Same ORIGINAL E8 encoder; preserve actual observedHeight. RegisteredAND
   // gate fixes AUTH-SOURCE-CURRENT. No new Native or JS encoder is installed.
   const e8=encodeOriginalAuthSourceStatementV2('current',frame,binding,bodyRaw);
   if(!e8.length||e8.length>65536)fail('SOURCE_FIXED_CORE_HISTORICAL_MESSAGE_CAPACITY');
   raw=historical.call(nativeObject,request,ab(e8));
  }else raw=fresh.call(nativeObject,request);
  const observation=checkedResult(raw);
  return Object.freeze({memberCount:1,memberIndex:0,signatureVerified:true,dataOnly:true,nativeAdmission:false,RootAdmission:false,SourceAdmission:false,originalMathObservation:observation});
 };
}
