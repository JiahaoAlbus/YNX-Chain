// Portable envelope DATA only. Deliberately does not parse/verify Member,
// Action or classic transaction semantics. Use the original Node/Native
// validator before review/send; decoded bytes are never an approval or grant.
export const PQ_ACTION_TRANSPORT_MAX_BYTES=24<<20;
export const PQ_ACTION_MEMBER_MAX_BYTES=128<<10;
export const PQ_ACTION_ORIGINAL_MAX_BYTES=16<<10;
const fail=()=>{throw Object.assign(new Error('PQ_ACTION_TRANSPORT_INVALID'),{code:'PQ_ACTION_TRANSPORT_INVALID'});};
const te=new TextEncoder(),td=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const getBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,getLength=Object.getOwnPropertyDescriptor(typed,'length').get,getOffset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get;
function bytes(value,max){
  try{
    const buffer=getBuffer.call(value),length=getLength.call(value),offset=getOffset.call(value);
    if(!(value instanceof Uint8Array)||!length||length>max||buffer.resizable||buffer.detached||(typeof SharedArrayBuffer!=='undefined'&&buffer instanceof SharedArrayBuffer))fail();
    return new Uint8Array(new Uint8Array(buffer,offset,length));
  }catch{fail();}
}
function record(value,keys){
  if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
  const ds=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(ds);
  if(actual.length!==keys.length||actual.some(k=>!keys.includes(k))||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail();
  return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
function originalCopies(input,baseSize){
  if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype)fail();
  const length=Object.getOwnPropertyDescriptor(input,'length')?.value;
  // Even a one-byte original takes four base64 bytes, quotes and a comma.
  if(!Number.isSafeInteger(length)||length<0||baseSize+(length?',"originals":[]'.length+length*7-1:0)>PQ_ACTION_TRANSPORT_MAX_BYTES)fail();
  const out=[];let size=baseSize+(length?',"originals":[]'.length:0);
  for(let i=0;i<length;i++){
    // Inspect only the next element. Never allocate a descriptor object for a
    // potentially million-entry caller array, and never invoke its getters.
    const d=Object.getOwnPropertyDescriptor(input,String(i));
    if(!d||!Object.hasOwn(d,'value'))fail();
    const copy=bytes(d.value,PQ_ACTION_ORIGINAL_MAX_BYTES);
    size+=4*Math.ceil(copy.length/3)+2+(i?1:0);
    if(size>PQ_ACTION_TRANSPORT_MAX_BYTES)fail();
    out.push(copy);
  }
  return out;
}
const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(b){
  const chunks=[];let s='';
  for(let i=0;i<b.length;i+=3){
    const n=(b[i]<<16)|((b[i+1]??0)<<8)|(b[i+2]??0);
    s+=abc[n>>>18]+abc[(n>>>12)&63]+(i+1<b.length?abc[(n>>>6)&63]:'=')+(i+2<b.length?abc[n&63]:'=');
    if(s.length>=8192){chunks.push(s);s='';}
  }
  chunks.push(s);return chunks.join('');
}
function unbase64(s){
  if(typeof s!=='string'||!s.length||s.length>4*Math.ceil(PQ_ACTION_ORIGINAL_MAX_BYTES/3)||s.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))fail();
  const out=new Uint8Array(s.length/4*3-(s.endsWith('==')?2:s.endsWith('=')?1:0));let at=0;
  for(let i=0;i<s.length;i+=4){
    const n=(abc.indexOf(s[i])<<18)|(abc.indexOf(s[i+1])<<12)|((s[i+2]==='='?0:abc.indexOf(s[i+2]))<<6)|(s[i+3]==='='?0:abc.indexOf(s[i+3]));
    if(at<out.length)out[at++]=n>>>16;if(at<out.length)out[at++]=(n>>>8)&255;if(at<out.length)out[at++]=n&255;
  }
  if(!out.length||out.length>PQ_ACTION_ORIGINAL_MAX_BYTES||base64(out)!==s)fail();return out;
}
function hex(b){return Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');}
function unhex(s){if(typeof s!=='string'||!s.length||s.length>2*PQ_ACTION_MEMBER_MAX_BYTES||s.length%2||!/^[0-9a-f]+$/.test(s))fail();const out=new Uint8Array(s.length/2);for(let i=0;i<out.length;i++)out[i]=parseInt(s.slice(i*2,i*2+2),16);return out;}
function encode(member,originals){
  let size=JSON.stringify({version:1,type:'pq_action',wireHex:''}).length+2*member.length+(originals.length?',"originals":[]'.length:0);
  for(let i=0;i<originals.length;i++){size+=4*Math.ceil(originals[i].length/3)+2+(i?1:0);if(size>PQ_ACTION_TRANSPORT_MAX_BYTES)fail();}
  // Go struct order, intentionally not alphabetically sorted JSON.
  const out={version:1,type:'pq_action',wireHex:hex(member)};
  if(originals.length)out.originals=originals.map(base64);
  const raw=te.encode(JSON.stringify(out));if(raw.length>PQ_ACTION_TRANSPORT_MAX_BYTES)fail();return raw;
}
export function encodePQActionTransportData(value){
  const input=record(value,['member','originals']),member=bytes(input.member,PQ_ACTION_MEMBER_MAX_BYTES);
  return encode(member,originalCopies(input.originals,JSON.stringify({version:1,type:'pq_action',wireHex:''}).length+2*member.length));
}
export function decodePQActionTransportData(value){
  const raw=bytes(value,PQ_ACTION_TRANSPORT_MAX_BYTES);let text,input;
  try{text=td.decode(raw);input=JSON.parse(text);}catch{fail();}
  const hasOriginals=Object.hasOwn(input??{},'originals');
  const parsed=record(input,hasOriginals?['version','type','wireHex','originals']:['version','type','wireHex']);
  if(parsed.version!==1||parsed.type!=='pq_action')fail();
  const member=unhex(parsed.wireHex);
  if(hasOriginals&&(!Array.isArray(parsed.originals)||!parsed.originals.length))fail();
  const originals=hasOriginals?parsed.originals.map(unbase64):[];
  if(td.decode(encode(member,originals))!==text)fail();
  return Object.freeze({version:1,type:'pq_action',get member(){return new Uint8Array(member);},get originals(){return Object.freeze(originals.map(b=>new Uint8Array(b)));},dataOnly:true,nativeAdmission:false,memberValidationRequired:true,classicWitnessValidationRequired:originals.length>0});
}
