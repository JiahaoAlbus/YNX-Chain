// Build-time byte gate only. Never repairs/re-encodes the supplied artifact.
const fail=()=>{throw Error('SDK39 canonical runtime manifest bytes differ.');};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
export function inspectSDK39CanonicalRuntimeManifest(raw,expectedFiles){
 if(!(raw instanceof Uint8Array)||raw.length<1||raw.length>8388608)fail();let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));}catch{fail();}
 if(!value||Object.keys(value).sort().join(',')!=='files,version'||value.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||!Array.isArray(value.files)||value.files.length!==expectedFiles)fail();
 let previous='';for(const p of value.files){if(!p||Object.keys(p).sort().join(',')!=='bytes,path,sha256'||typeof p.path!=='string'||p.path<=previous||p.path.startsWith('/')||p.path.includes('\\')||p.path.split('/').some(v=>!v||v==='.'||v==='..')||!Number.isSafeInteger(p.bytes)||p.bytes<0||!/^[a-f0-9]{64}$/.test(p.sha256))fail();previous=p.path;}
 const encoded=new TextEncoder().encode(canonical(value));if(encoded.length!==raw.length||!encoded.every((b,i)=>b===raw[i]))fail();return value;
}
