// Node wrapper retains all original nested Proxy/accessor guards. The DEVICE
// DATA grammar is shared with the private parsed-originals SOURCE entry.
import{types}from'node:util';
import{inspectOriginalProductDeviceV4SourceScopeDATA as core,ORIGINAL_DEVICE_SOURCE_DATA_FIELDS}from'./original-product-device-v4-scope-data-core.mjs';
export{PRODUCT_DEVICE_V4_SOURCE_PURPOSE,PRODUCT_DEVICE_V4_SOURCE_OPERATIONS}from'./original-source-device-family-constants.mjs';
const contextFields=ORIGINAL_DEVICE_SOURCE_DATA_FIELDS.context,expectedFields=ORIGINAL_DEVICE_SOURCE_DATA_FIELDS.expected;
const fail=()=>{throw Object.assign(Error('AUTH_SOURCE_V2_DEVICE_SCOPE'),{code:'AUTH_SOURCE_V2_DEVICE_SCOPE'});};
function exact(value,fields){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(keys.some(k=>typeof k!=='string')||keys.sort().join('|')!==[...fields].sort().join('|')||Object.values(ds).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))fail();
}
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
function scopes(value){
 if(types.isProxy(value)||!Array.isArray(value)||value.length<1||value.length>8)fail();
 const d=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(d).length!==value.length+1)fail();
 for(let i=0;i<value.length;i++)if(!d[i]||!Object.hasOwn(d[i],'value')||typeof d[i].value!=='string'||!/^[A-Za-z0-9._:-]{1,64}$/.test(d[i].value))fail();
 if(new Set(value).size!==value.length||[...value].sort().join('\n')!==value.join('\n'))fail();
 return value;
}
export function inspectOriginalProductDeviceV4SourceScopeDATA(scope,association,networkId,subjectOwner,profileIssued,profileExpires,at){
 exact(scope,['version','expected','context','registrationOriginal','sessionOriginal']);
 exact(association,['account','clientId','productId','platform','applicationId','deviceId']);
 exact(scope.expected,expectedFields);exact(scope.context,contextFields);scopes(scope.context.scopes);
 return core(scope,association,networkId,subjectOwner,profileIssued,profileExpires,at);
}
