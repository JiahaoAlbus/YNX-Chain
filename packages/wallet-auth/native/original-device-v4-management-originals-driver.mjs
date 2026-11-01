// Fixed operation-specific PUBLIC DATA reader; never a Root/Source factory.
// Separate from generic Source stdin65536 and signed scope49152.
import fs from'node:fs';
import registry from'../product-session-registry.json'with{type:'json'};
import{canonicalJSON}from'../src/canonical.js';
import{inspectOriginalProductDeviceV4ManagementOriginalsDATA}from'./management-originals.mjs';
const CAP=4194304,OUT=32768;
function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))throw Error('DEVICE_MANAGEMENT_DRIVER_SHAPE');}
try{
 const buffer=Buffer.alloc(CAP+1);let at=0;while(at<buffer.length){const n=fs.readSync(0,buffer,at,buffer.length-at,null);if(!n)break;at+=n;}if(at<1||at>CAP)throw Error('DEVICE_MANAGEMENT_DRIVER_CAPACITY');
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,at)),input=JSON.parse(text);if(canonicalJSON(input)!==text)throw Error('DEVICE_MANAGEMENT_DRIVER_CANONICAL');exact(input,['operation','scope','originals','atMs']);if(input.operation!=='product-device-management-originals/v4'||!Number.isSafeInteger(input.atMs))throw Error('DEVICE_MANAGEMENT_DRIVER_OPERATION');
 exact(input.originals,['request','registration','body','session','approval','challenge','targetOperation']);const originals={};for(const[k,v]of Object.entries(input.originals)){if(v===null){originals[k]=null;continue;}if(typeof v!=='string'||Buffer.byteLength(v)>(['session','registration'].includes(k)?16384:393216))throw Error('DEVICE_MANAGEMENT_DRIVER_ORIGINAL_BOUND');originals[k]=Buffer.from(v,'utf8');}
 if(Buffer.byteLength(canonicalJSON(input.scope))>49152)throw Error('DEVICE_MANAGEMENT_DRIVER_SCOPE_CAPACITY');
 const projection=inspectOriginalProductDeviceV4ManagementOriginalsDATA(registry,input.scope,originals,input.atMs),out=canonicalJSON({projection});if(Buffer.byteLength(out)>OUT)throw Error('DEVICE_MANAGEMENT_DRIVER_OUTPUT_CAPACITY');process.stdout.write(out);
}catch(e){process.stderr.write(typeof e?.code==='string'?e.code:'DEVICE_MANAGEMENT_DRIVER_REJECTED');process.exitCode=1;}
