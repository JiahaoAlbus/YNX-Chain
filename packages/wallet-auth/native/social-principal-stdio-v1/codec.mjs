// Sole shared stdio DATA codec. No process/provider/Root/native owner creation.
import{types}from'node:util';
import{createHash}from'node:crypto';
export const SOCIAL_PRINCIPAL_STDIO_VERSION=1;
export const SOCIAL_PRINCIPAL_STDIO_MAX_FRAME_BYTES=3149824;
export const SOCIAL_PRINCIPAL_STDIO_COMMANDS=Object.freeze(['read','current','qualify','retire','join','close']);
export const SOCIAL_PRINCIPAL_EXPECTED17=Object.freeze(['networkId','canonicalOwner','account','sessionBinding','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision','registrationDigest']);
const requestKeys=['version','sequence','command','requestOriginal','replayKey','proofExpiresMS'],responseKeys=['version','sequence','original','errorPresent','error','physicalDone'];
const bindingKeys=['version','profileOriginal','registrationOriginal','expiresMS','expected','dataOnly','RootAdmission','V4Authentication'];
const principalKeys=['version','profileOriginal','registrationOriginal','requestOriginalSHA256','proofReplayKey','expiresMS','dataOnly','RootAdmission','V4Authentication'];
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const fail=code=>{throw Object.assign(Error(code),{code})};
function record(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('SOCIAL_STDIO_FIELDS');const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('SOCIAL_STDIO_FIELDS');return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function text(v,cap,nonempty=false){if(typeof v!=='string'||!v.isWellFormed()||Buffer.byteLength(v)>cap||nonempty&&!v.length)fail('SOCIAL_STDIO_TEXT');return v;}
function sequence(v){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>18446744073709551615n)fail('SOCIAL_STDIO_SEQUENCE');return v;}
export function nextSocialPrincipalSequence(v){sequence(v);if(v==='18446744073709551615')fail('SOCIAL_STDIO_SEQUENCE_OVERFLOW');return(BigInt(v)+1n).toString();}
function ms(v,zero=false){if(!Number.isSafeInteger(v)||v<(zero?0:1))fail('SOCIAL_STDIO_TIME');return v;}
function ascii(v,cap){text(v,cap,true);if(/[^\x21-\x7e]/.test(v))fail('SOCIAL_STDIO_ASCII');return v;}
function errorData(v,present){const e=record(v,['tag','code']);if(!['none','code','retained'].includes(e.tag)||!Number.isInteger(e.code)||e.code< -2147483648||e.code>2147483647||!present&&(e.tag!=='none'||e.code!==0)||present&&e.tag==='none'||e.tag==='retained'&&e.code!==0)fail('SOCIAL_STDIO_ERROR_PRESENCE');return Object.freeze(e);}
// Go Marshal struct order and Go's default HTML escaping. This is framing DATA,
// never a new signed serialization/domain. Embedded original strings unchanged.
function canonical(v){return JSON.stringify(v).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));}
function owned(v){if(!(v instanceof Uint8Array)||v.buffer instanceof SharedArrayBuffer)fail('SOCIAL_STDIO_BYTES');return Buffer.from(v);}
function parse(v){const b=owned(v);if(!b.length||b.length>SOCIAL_PRINCIPAL_STDIO_MAX_FRAME_BYTES||b[b.length-1]!==10)fail('SOCIAL_STDIO_FRAME_BOUNDS');let raw,value;try{raw=decoder.decode(b.subarray(0,-1));value=JSON.parse(raw);}catch{fail('SOCIAL_STDIO_UTF8_OR_JSON');}return {raw,value};}
function frame(v){const b=Buffer.from(canonical(v)+'\n');if(b.length>SOCIAL_PRINCIPAL_STDIO_MAX_FRAME_BYTES)fail('SOCIAL_STDIO_FRAME_BOUNDS');return b;}
function request(v){const r=record(v,requestKeys);if(r.version!==1||!SOCIAL_PRINCIPAL_STDIO_COMMANDS.includes(r.command)||sequence(r.sequence)==='0')fail('SOCIAL_STDIO_REQUEST');text(r.requestOriginal,393216);text(r.replayKey,512);ms(r.proofExpiresMS,true);if(r.command==='qualify'){text(r.requestOriginal,393216,true);ascii(r.replayKey,512);ms(r.proofExpiresMS);}else if(r.requestOriginal!==''||r.replayKey!==''||r.proofExpiresMS!==0)fail('SOCIAL_STDIO_COMMAND_FIELDS');return Object.freeze(r);}
export function encodeSocialPrincipalRequestFrame(v){return frame(request(v));}
export function decodeSocialPrincipalRequestFrame(v){const p=parse(v),r=request(p.value);if(canonical(r)!==p.raw)fail('SOCIAL_STDIO_NONCANONICAL');return r;}
function response(v,expectedSequence,command){const r=record(v,responseKeys);if(r.version!==1||sequence(r.sequence)!==sequence(expectedSequence)||!SOCIAL_PRINCIPAL_STDIO_COMMANDS.includes(command)||typeof r.errorPresent!=='boolean'||typeof r.physicalDone!=='boolean')fail('SOCIAL_STDIO_RESPONSE');r.error=errorData(r.error,r.errorPresent);if(r.original!==null)text(r.original,524288,true);if(r.physicalDone&&command!=='close')fail('SOCIAL_STDIO_PHYSICAL_DONE');if(!r.errorPresent){if(['read','qualify'].includes(command)){if(r.original===null)fail('SOCIAL_STDIO_ORIGINAL_REQUIRED');}else if(r.original!==null)fail('SOCIAL_STDIO_UNEXPECTED_ORIGINAL');}return Object.freeze(r);}
export function encodeSocialPrincipalResponseFrame(v,expectedSequence,command){return frame(response(v,expectedSequence,command));}
export function decodeSocialPrincipalResponseFrame(v,expectedSequence,command){const p=parse(v),r=response(p.value,expectedSequence,command);if(canonical(r)!==p.raw)fail('SOCIAL_STDIO_NONCANONICAL');return r;}
function expected(v){const e=record(v,SOCIAL_PRINCIPAL_EXPECTED17);for(const k of SOCIAL_PRINCIPAL_EXPECTED17){if(['bundleId','packageId'].includes(k)&&e[k]===null)continue;text(e[k],2048,true);}if(e.productId!=='social')fail('SOCIAL_STDIO_PRODUCT');for(const k of ['generation','revision'])if(sequence(e[k])==='0')fail('SOCIAL_STDIO_SEQUENCE');return Object.freeze(e);}
function original(v,keys,kind){text(v,524288,true);let value;try{value=JSON.parse(v);}catch{fail('SOCIAL_STDIO_ORIGINAL_JSON');}const o=record(value,keys);if(o.version!==kind||o.dataOnly!==true||o.RootAdmission!==false||o.V4Authentication!==false)fail('SOCIAL_STDIO_ORIGINAL_FIELDS');text(o.profileOriginal,65536,true);text(o.registrationOriginal,65536,true);ms(o.expiresMS);if(kind==='YNX-SOCIAL-JOINT-PROFILE-ORIGINAL/v1')o.expected=expected(o.expected);else{if(!/^[a-f0-9]{64}$/.test(o.requestOriginalSHA256))fail('SOCIAL_STDIO_DIGEST');ascii(o.proofReplayKey,512);}if(canonical(o)!==v)fail('SOCIAL_STDIO_ORIGINAL_NONCANONICAL');return Object.freeze(o);}
export function decodeSocialPrincipalBindingOriginal(v){return original(v,bindingKeys,'YNX-SOCIAL-JOINT-PROFILE-ORIGINAL/v1');}
export function decodeSocialPrincipalQualifiedOriginal(v){return original(v,principalKeys,'YNX-SOCIAL-DIRECTORY-PRINCIPAL-ORIGINAL/v1');}
export function createSocialPrincipalFrameReaderDATA(){let tail=Buffer.alloc(0),first;
 return Object.freeze({push(chunk){if(first)return Object.freeze({frames:Object.freeze([]),errorPresent:true,error:first});const frames=[];try{const b=owned(chunk);let at=0;while(at<b.length){const lf=b.indexOf(10,at),end=lf<0?b.length:lf+1,part=b.subarray(at,end);if(tail.length+part.length>SOCIAL_PRINCIPAL_STDIO_MAX_FRAME_BYTES)fail('SOCIAL_STDIO_FRAME_BOUNDS');tail=Buffer.concat([tail,part]);at=end;if(lf>=0){frames.push(tail);tail=Buffer.alloc(0);}}return Object.freeze({frames:Object.freeze(frames),errorPresent:false});}catch(e){first=e;return Object.freeze({frames:Object.freeze(frames),errorPresent:true,error:e});}},finish(){if(first)return Object.freeze({errorPresent:true,error:first});if(tail.length){first=Object.assign(Error('SOCIAL_STDIO_TRUNCATED_FRAME'),{code:'SOCIAL_STDIO_TRUNCATED_FRAME'});return Object.freeze({errorPresent:true,error:first});}return Object.freeze({errorPresent:false});}});
}

/** One-child exchange DATA bookkeeping. Only the Auth fixed process owner may
 * own the real child/FD/credential; this object is NOT a Native/Root brand. */
export function createSocialPrincipalExchangeDATA(){let last='0',startup=false,pending=null,binding=null,bindingRaw=null,retired=false,physicalDone=false,unknown=false,firstPresent=false,first,lastOriginal=null;
 const remember=e=>{unknown=true;if(!firstPresent){firstPresent=true;first=e;}};
 function adopt(raw,seq,cmd){const response=decodeSocialPrincipalResponseFrame(raw,seq,cmd);lastOriginal=response; // BEFORE interpretation/late mismatch
  if(response.physicalDone)physicalDone=true;
  if(response.errorPresent){remember(response.error);return response;}
  if(cmd==='read'){const next=decodeSocialPrincipalBindingOriginal(response.original);if(bindingRaw!==null&&response.original!==bindingRaw)fail('SOCIAL_STDIO_BINDING_CHANGED');binding=next;bindingRaw=response.original;}
  if(cmd==='qualify'){const o=decodeSocialPrincipalQualifiedOriginal(response.original),p=pending.request;if(!binding||o.profileOriginal!==binding.profileOriginal||o.registrationOriginal!==binding.registrationOriginal||o.expiresMS>binding.expiresMS||o.expiresMS>p.proofExpiresMS||o.proofReplayKey!==p.replayKey||o.requestOriginalSHA256!==createHash('sha256').update(p.requestOriginal,'utf8').digest('hex'))fail('SOCIAL_STDIO_QUALIFY_CHANGED');}
  return response;
 }
 return Object.freeze({
  acceptStartup(raw){if(startup||pending)fail('SOCIAL_STDIO_STARTUP_ALREADY_OBSERVED');startup=true;try{return adopt(raw,'0','read');}catch(e){remember(e);throw e;}},
  begin(command,payload={requestOriginal:'',replayKey:'',proofExpiresMS:0}){if(!startup||pending||physicalDone)fail('SOCIAL_STDIO_SINGLE_CHILD_PENDING');if((retired||unknown)&&!['retire','join','close'].includes(command))fail('SOCIAL_STDIO_RETIRED_OR_UNKNOWN');const p=record(payload,['requestOriginal','replayKey','proofExpiresMS']),sequence=nextSocialPrincipalSequence(last),r=request({version:1,sequence,command,...p});const raw=encodeSocialPrincipalRequestFrame(r);last=sequence;pending={command,sequence,request:r};if(command==='retire'||command==='close')retired=true;return raw;},
  acceptResponse(raw){if(!pending)fail('SOCIAL_STDIO_NO_OUTSTANDING_REQUEST');const p=pending,prior=lastOriginal;try{const out=adopt(raw,p.sequence,p.command);pending=null;return out;}catch(e){remember(e);if(lastOriginal!==prior)e.partialOriginalFrame=lastOriginal;throw e;}},
  retainUnknownDATA(cause){remember(cause);},
  readStatusDATA(){return Object.freeze({startupObserved:startup,sequence:last,pending:pending!==null,retired,physicalDoneObserved:physicalDone,unknown,firstCausePresent:firstPresent,firstCause:first,lastOriginalFrame:lastOriginal,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});}
 });
}
