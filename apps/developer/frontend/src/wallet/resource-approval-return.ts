/** NEW resource callback boundary only. No Session parser, crypto supplier,
 * permission grant, dispatch or pending-state mutation is imported here. */
export const RESOURCE_RETURN_SOURCE = '4c9b2e04b37b1b1cb819c03e11c7fe64b12a317e01e3435c8d5228648afc2126';
const callback = 'ynxdeveloper://wallet-auth/callback?developerResourceResult=';
const expectedFields = 'account deviceId sessionBinding projectId projectDigest resourceOrigin resourceId action bodyDigest';
const unsignedFields = expectedFields + ' version purpose accountPublicKey productClientId bundleId platform origin requiredScope nonce issuedAt expiresAt';
const captured = new WeakSet<object>();
const fail = (): never => { throw new Error('DEVELOPER_RESOURCE_RETURN_INVALID'); };
const canonical = (v: any): string => v && typeof v === 'object' ? (Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}') : JSON.stringify(v);
function fields(v: any, list: string) { if (!v || Array.isArray(v) || typeof v !== 'object' || Object.keys(v).sort().join(' ') !== list.split(' ').sort().join(' ')) fail(); }
function parse(raw: string, limit: number) { if (typeof raw !== 'string' || raw.length > limit || new TextEncoder().encode(raw).length > limit) fail(); try { return JSON.parse(raw); } catch { return fail(); } }
function decode(raw: string, limit: number): string {
 if (typeof raw !== 'string' || raw.length > limit || !/^[A-Za-z0-9_-]+$/.test(raw)) fail();
 try { const bytes=Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
 const encoded=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 if(encoded!==raw)fail();return new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { return fail(); }
}
export type ResourceOperationSnapshot = Readonly<{operationId:string;unsigned:string;expected:string;nonce:string;reviewDigest:string;projectId:string;projectDigest:string;bodyDigest:string}>;
/** Caller supplies the original reviewed snapshot, never a callback-selected project. */
export function captureResourceOperation(input: ResourceOperationSnapshot): ResourceOperationSnapshot {
 fields(input,'operationId unsigned expected nonce reviewDigest projectId projectDigest bodyDigest');
 if(typeof input.operationId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.operationId)||!/^([0-9a-f]{64})$/.test(input.reviewDigest))fail();
 if(typeof input.nonce!=='string'||input.nonce.length!==43)fail();decode(input.nonce,43);
 const u=parse(input.unsigned,8192),e=parse(input.expected,4096);fields(u,unsignedFields);fields(e,expectedFields);
 if(canonical(u)!==input.unsigned||canonical(e)!==input.expected)fail();
 for(const k of expectedFields.split(' '))if(typeof e[k]!=='string'||u[k]!==e[k])fail();
 if(u.version!==1||u.purpose!=='developer-project-resource/v1'||u.nonce!==input.nonce||u.productClientId!=='ynx-developer-v1'||u.bundleId!=='com.ynxweb4.developer.testnetpreview'||u.platform!=='macos'||u.origin!=='app://macos/com.ynxweb4.developer.testnetpreview')fail();
 for(const k of ['projectId','projectDigest','bodyDigest'] as const)if(u[k]!==input[k])fail();
 const result=Object.freeze({...input});captured.add(result);return result;
}
export function receiveResourceReturn(url: string, pending: ResourceOperationSnapshot, current: ResourceOperationSnapshot) {
 if(!captured.has(pending)||!captured.has(current)||current!==pending)fail();
 if(typeof url!=='string'||url.length>16000||!url.startsWith(callback))fail();
 const text=decode(url.slice(callback.length),15900),packet=parse(text,12000);
 fields(packet,'version purpose nonce reviewDigest status approval readOnly');
 // The supplier emits JSON.stringify, not sorted canonical JSON. Round-trip
 // rejects duplicate JSON keys without imposing a different field ordering.
 if(JSON.stringify(packet)!==text||packet.version!==1||packet.purpose!=='developer-project-resource/v1'||packet.nonce!==pending.nonce||packet.reviewDigest!==pending.reviewDigest||typeof packet.readOnly!=='boolean'||!['signed','rejected','declined'].includes(packet.status))fail();
 if(packet.status==='signed'){
  const proof=parse(packet.approval,8192);fields(proof,unsignedFields+' signature');
  if(canonical(proof)!==packet.approval||typeof proof.signature!=='string'||!/^[0-9a-f]{128}$/.test(proof.signature))fail();
  const {signature,...unsigned}=proof;if(canonical(unsigned)!==pending.unsigned)fail();
 }else if(packet.approval!==null)fail();
 // No unverified callback can settle UNKNOWN/old signed operations. A declined
 // callback is only an observation; the caller retains the original operation.
 return Object.freeze({operationId:pending.operationId,status:packet.status as 'signed'|'rejected'|'declined',readOnly:packet.readOnly,
  approval:packet.approval as string|null,verification:packet.status==='signed'?'supplier-unavailable':'not-applicable',
  authorityGranted:false,projectResourceApproved:false,productSessionCreated:false,effectAllowed:false,settlesPending:false});
}

/** Classification only: malformed/mixed NEW packets must never reach Session. */
export function isDeveloperResourceReturn(url: string): boolean {
 if(typeof url !== 'string') return false;
 try { return new URL(url).searchParams.has('developerResourceResult') || url.includes('developerResourceResult'); }
 catch { return url.includes('developerResourceResult'); }
}
