// PRIVATE P08 Go DATA adapter, not an OPEN codec, verifier or Source grant.
import{createHash}from'node:crypto';
import{decodeBoundGrant,decodeGrantEffect,encodeBoundGrant,encodeGrantEffect}from'@ynx-chain/open-protocol/bound-grant';
import{canonicalJSON}from'./canonical.js';
import{originalTaskReadBindingDATA}from'./desktop-grant-resource-binding-data.mjs';
export const RESOURCE_SERVICE='ynx-ai-original-task-read-v1';
export const RESOURCE_PATHS=Object.freeze({input:'/internal/ai/original-task-read/input',execute:'/internal/ai/original-task-read/execute',query:'/internal/ai/original-task-read/query'});
const fail=c=>{throw Object.assign(Error(c),{code:c})},same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
export function rawBinding(b){return{bytes:String(b.length),sha3_512:createHash('sha3-512').update(b).digest('hex'),sha512:createHash('sha512').update(b).digest('hex')}}
export function base64(v,cap){if(typeof v!=='string'||v.length>4*Math.ceil(cap/3))fail('TASK_RESOURCE_BASE64_BOUND');const b=Buffer.from(v,'base64');if(b.length>cap||b.toString('base64')!==v)fail('TASK_RESOURCE_BASE64_CANONICAL');return b}
// Reuses the original projection-data mapping, with an independently held
// Root material's Account/Fields. Neither is inferred from transport/Grant.
export function originalBindingDATA(g,material){return originalTaskReadBindingDATA(material,g)}
export function originalProofsDATA(g,grantOriginal,holderProof){
 let grant;try{grant=JSON.parse(grantOriginal)}catch{const wire=Buffer.from(grantOriginal,'base64url');if(!wire.length||wire.toString('base64url')!==grantOriginal)fail('TASK_RESOURCE_GRANT_ORIGINAL_ENCODING');grant={Payload:Buffer.from(encodeBoundGrant(g)).toString('base64'),Wire:wire.toString('base64'),Purpose:'YNX-OPEN/BOUND-GRANT/1'}}
 const member=holderProof?.memberOriginal;
 let holder=holderProof;
 if(typeof member!=='undefined'){const raw=typeof member==='string'?Buffer.from(member,'base64url'):member;if(!(raw instanceof Uint8Array)||!raw.length||(typeof member==='string'&&Buffer.from(raw).toString('base64url')!==member))fail('TASK_RESOURCE_HOLDER_ORIGINAL_ENCODING');holder={Payload:Buffer.from(encodeGrantEffect(g,g.binding)).toString('base64'),Wire:Buffer.from(raw).toString('base64'),Purpose:'YNX-OPEN/GRANT-EFFECT/1'}}
 for(const[v,purpose]of[[grant,'YNX-OPEN/BOUND-GRANT/1'],[holder,'YNX-OPEN/GRANT-EFFECT/1']]){if(!v||Object.keys(v).sort().join('|')!=='Payload|Purpose|Wire'||v.Purpose!==purpose)fail('TASK_RESOURCE_TYPED_PROOF_REQUIRED');base64(v.Payload,1048576);if(!base64(v.Wire,262144).length)fail('TASK_RESOURCE_TYPED_PROOF_REQUIRED')}
 if(!same(decodeBoundGrant(base64(grant.Payload,1048576)),g)||!same(decodeGrantEffect(base64(holder.Payload,1048576)),{grant:g,step:g.binding}))fail('TASK_RESOURCE_PROOF_PAYLOAD_BINDING');return{Grant:structuredClone(grant),Holder:structuredClone(holder)};
}
export function requestDATA(stage,g,material,proofs,operation='',input=Buffer.alloc(0)){
 if(!Object.hasOwn(RESOURCE_PATHS,stage)||g.operation!=='ai.conversation.read'||g.binding.tool.id!=='ai.conversation.read'||g.binding.tool.version!=='1'||g.binding.risk!=='read'||!material?.Account||!material.AuthorizationRef||!Array.isArray(material.Fields)||!material.Fields.length)fail('TASK_RESOURCE_CLOSED_SELECTION');
 if(stage==='input'?(operation!==''||input.length!==0):typeof operation!=='string'||!operation||operation.length>256)fail('TASK_RESOURCE_OPERATION_STAGE');
 if(stage==='execute'&&!same(rawBinding(input),g.binding.input))fail('TASK_RESOURCE_INPUT_BINDING');
 const r={Version:'1',AuthorityOperationID:operation,ExpectedGrantRevision:g.rev,Binding:originalBindingDATA(g,material),Grant:proofs.Grant,Holder:proofs.Holder,RawInput:input.length?Buffer.from(input).toString('base64'):null,AuthorizationRef:stage==='query'?material.AuthorizationRef:''};
 const raw=Buffer.from(JSON.stringify(r).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));if(raw.length>1048576)fail('TASK_RESOURCE_REQUEST_TOTAL_BOUND');return raw;
}
// Retains exact spans of the resource's ORIGINAL receipt. No reconstruction
// of Result bytes from JSON values is used for its two-hash binding.
export function parseOriginalJSON(raw,cap=1048576){
 if(!(raw instanceof Uint8Array)||raw.length<1||raw.length>cap)fail('TASK_RESOURCE_RESPONSE_TOTAL_BOUND');const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);let i=0;const spans=new Map();
 const ws=()=>{while(/[\t\r\n ]/.test(text[i]??'')&&i<text.length)i++};
 function string(){const start=i++;for(;i<text.length;i++){if(text[i]==='\\'){i++;continue}if(text[i]==='"'){i++;return JSON.parse(text.slice(start,i))}if(text.charCodeAt(i)<32)fail('TASK_RESOURCE_JSON_STRING')}fail('TASK_RESOURCE_JSON_EOF')}
 function value(depth){if(depth>32)fail('TASK_RESOURCE_JSON_DEPTH');ws();const start=i,c=text[i];if(c==='"')string();else if(c==='{'||c==='['){const object=c==='{',seen=new Set();i++;ws();if(text[i]===(object?'}':']'))i++;else for(let count=0;;count++){if(count>16384)fail('TASK_RESOURCE_JSON_COUNT');let key;if(object){if(text[i]!=='"')fail('TASK_RESOURCE_JSON_KEY');key=string();if(seen.has(key))fail('TASK_RESOURCE_JSON_DUPLICATE');seen.add(key);ws();if(text[i++]!==':')fail('TASK_RESOURCE_JSON_COLON')}ws();const vstart=i;value(depth+1);if(depth===0&&object)spans.set(key,{start:vstart,end:i});ws();if(text[i]===(object?'}':']')){i++;break}if(text[i++]!==',')fail('TASK_RESOURCE_JSON_COMMA');ws()}}else{while(i<text.length&&!/[\s,}\]]/.test(text[i]))i++;if(i===start)fail('TASK_RESOURCE_JSON_VALUE');JSON.parse(text.slice(start,i))}return start}
 value(0);ws();if(i!==text.length)fail('TASK_RESOURCE_JSON_TRAILING');return{value:JSON.parse(text),span:key=>{const s=spans.get(key);if(!s)fail('TASK_RESOURCE_JSON_MISSING_SPAN');return Buffer.from(text.slice(s.start,s.end))}};
}
function keys(v,expected){if(!v||Object.keys(v).sort().join('|')!==[...expected].sort().join('|'))fail('TASK_RESOURCE_RESPONSE_SCHEMA')}
export function decodeResponseDATA(stage,body,status,g,operation){
 const parsed=parseOriginalJSON(body),v=parsed.value;
 if(status!==200){keys(v,['State','OriginalOperationID']);if(v.State!=='UNKNOWN'||v.OriginalOperationID!==operation)fail('TASK_RESOURCE_UNKNOWN_ASSOCIATION');return{state:'UNKNOWN',operationId:operation,original:null,responseOriginal:Buffer.from(body)}}
 if(stage==='input'){keys(v,['input']);const input=base64(v.input,32768);if(!same(rawBinding(input),g.binding.input))fail('TASK_RESOURCE_INPUT_BINDING');return{input,responseOriginal:Buffer.from(body)}}
 keys(v,['operationId','state','original','authScope']);if(v.operationId!==operation)fail('TASK_RESOURCE_RECEIPT_OPERATION');
 if(v.state==='UNKNOWN'){if(v.original!==null&&v.original!=='')fail('TASK_RESOURCE_UNKNOWN_WITH_BODY');return{state:'UNKNOWN',operationId:operation,original:null,responseOriginal:Buffer.from(body)}}
 if(v.state!=='COMMITTED'||v.authScope!=='egress-only-read-fence')fail('TASK_RESOURCE_RECEIPT_SCOPE');
 const original=base64(v.original,1048576),receipt=parseOriginalJSON(original),r=receipt.value;
 const required=['effectRef','state','scope','binding','result','originalOperationId','authorityOperationId','authScope'];keys(r,required);
 if(r.effectRef!==g.binding.stepId||r.state!=='COMMITTED'||r.scope!=='same-resource-transaction'||r.authScope!==v.authScope||r.originalOperationId!==operation||r.authorityOperationId!==operation)fail('TASK_RESOURCE_RECEIPT_ORIGINAL_ASSOCIATION');
 const resultOriginal=receipt.span('result'),actual=rawBinding(resultOriginal);keys(r.binding,['bytes','sha3_512','sha512']);if(!Number.isSafeInteger(r.binding.bytes)||String(r.binding.bytes)!==actual.bytes||r.binding.sha3_512!==actual.sha3_512||r.binding.sha512!==actual.sha512||!same(actual,g.binding.sources[0]?.binding))fail('TASK_RESOURCE_RECEIPT_RESULT_BINDING');
 return{state:'COMMITTED',operationId:operation,original:original.toString('utf8'),resultOriginal,responseOriginal:Buffer.from(body),authScope:v.authScope};
}
