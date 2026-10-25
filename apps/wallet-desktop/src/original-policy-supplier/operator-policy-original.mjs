// Preserve the exact nested span from ONE HTTP response. This is a generic
// JSON span scanner, NOT another policy codec/Source/checkpoint authority.
// The sole SDK still interprets policy and Protocol alone enforces its native
// canonical policy bytes. Nothing here reconstructs bytes from a flat DTO.
import {createHash} from 'node:crypto';
const fail=()=>{throw Object.assign(Error('AUTH_POLICY_ORIGINAL_JSON'),{code:'AUTH_POLICY_ORIGINAL_JSON'});};
export function captureAuthorizationHTTPOriginal(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>8*1024*1024)fail();
 let body;try{body=JSON.parse(text);}catch{fail();}if(!body||typeof body!=='object'||Array.isArray(body))fail();
 let at=0,policy=null;
 const ws=()=>{while(/[\t\n\r ]/.test(text[at]??'!'))at++;};
 const string=()=>{const start=at;if(text[at++]!=='"')fail();while(at<text.length){const c=text[at++];if(c==='"')return text.slice(start,at);if(c==='\\')at++;}fail();};
 const value=depth=>{
  if(depth>64)fail();ws();const c=text[at];
  if(c==='"'){string();return;}
  if(c==='{'){
   at++;ws();const seen=new Set();if(text[at]==='}'){at++;return;}
   for(;;){ws();const key=JSON.parse(string());if(seen.has(key))fail();seen.add(key);ws();if(text[at++]!==':')fail();ws();const start=at;value(depth+1);const end=at;
    if(depth===0&&key==='policy')policy={start,end};ws();if(text[at]==='}'){at++;return;}if(text[at++]!==',')fail();}
  }
  if(c==='['){at++;ws();if(text[at]===']'){at++;return;}for(;;){value(depth+1);ws();if(text[at]===']'){at++;return;}if(text[at++]!==',')fail();}}
  const start=at;while(at<text.length&&!/[\t\n\r ,\]}]/.test(text[at]))at++;if(at===start)fail();
 };
 ws();if(text[at]!=='{')fail();value(0);ws();if(at!==text.length)fail();
 const policyText=policy&&text[policy.start]==='{'?text.slice(policy.start,policy.end):null;
 return Object.freeze({body,policyText});
}
export function encodeObservedPolicyOriginal(policyText,authorization){
 if(policyText===null||policyText===undefined)return null;
 if(typeof policyText!=='string'||!policyText.startsWith('{')||Buffer.byteLength(policyText)>8*1024*1024)fail();
 const bytes=Buffer.from(policyText,'utf8');return Object.freeze({format:'YNX-OBSERVED-POLICY-BYTES/v1',utf8:bytes.toString('base64url'),sha256:createHash('sha256').update(bytes).digest('hex'),executionHeight:authorization.executionHeight,ledgerNonce:authorization.ledgerNonce,activeRevision:authorization.activeRevision??null});
}
export function decodeObservedPolicyOriginal(value,authorization){
 const keys=['format','utf8','sha256','executionHeight','ledgerNonce','activeRevision'];
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')))fail();
 if(value.format!=='YNX-OBSERVED-POLICY-BYTES/v1'||typeof value.utf8!=='string'||value.utf8.length>Math.ceil(8*1024*1024*4/3)||!/^[A-Za-z0-9_-]+$/.test(value.utf8)||!/^[0-9a-f]{64}$/.test(value.sha256)||value.executionHeight!==authorization.executionHeight||value.ledgerNonce!==authorization.ledgerNonce||value.activeRevision!==(authorization.activeRevision??null))fail();
 const bytes=Buffer.from(value.utf8,'base64url');if(!bytes.length||bytes.length>8*1024*1024||bytes.toString('base64url')!==value.utf8||createHash('sha256').update(bytes).digest('hex')!==value.sha256)fail();
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail();}
 // Validate JSON framing/duplicate keys without re-encoding a single byte.
 captureAuthorizationHTTPOriginal(text);if(text[0]!=='{'||text.at(-1)!=='}')fail();return Object.freeze({...value});
}
