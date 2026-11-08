// A post-link probe, not executed against Native by this SDK intake task.
import{createRequire}from'node:module';import{types}from'node:util';import{fileURLToPath}from'node:url';
const fault=(code,cause)=>Object.assign(Error(code),{code,cause});
// Expected from the actual empty desktop release registry -> capture() chain.
const expectedMissing=new Set(['AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED']);
export function inspectTaskGrantRoot0CauseDATA(value){
 if(value===null)return Object.freeze({kind:'null',value:null,code:null,expectedMissing:false});
 if(value===undefined)return Object.freeze({kind:'undefined',code:null,expectedMissing:false});
 if(typeof value==='number'||typeof value==='boolean')return Object.freeze({kind:typeof value,value:Number.isFinite(value)||typeof value==='boolean'?value:null,code:null,expectedMissing:false});
 const safe=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{1,95}$/.test(v)?v:null;
 let code=typeof value==='string'?safe(value):null;
 if(value&&typeof value==='object'&&!types.isProxy(value)){const ds=Object.getOwnPropertyDescriptors(value);code=safe(ds.code?.value)??safe(ds.message?.value)}
 return Object.freeze({kind:typeof value,code,expectedMissing:expectedMissing.has(code),rawMessageOrPathIncluded:false});
}

export async function inspectTaskGrantBuiltImageRoot0DATA(namespace){
 let owner,first,cleanupFirst,closed=false,root0Cause;const keep=e=>{first??={error:e}};
 try{
  const fn=Object.getOwnPropertyDescriptor(namespace,'acquireOriginalTaskGrantAuthorityBackendV1')?.value;if(typeof fn!=='function')throw fault('TASK_GRANT_IMAGE_EXPORT_MISSING');
  let a;try{a=Reflect.apply(fn,namespace,[])}catch(e){owner=e?.partial??null;throw e}owner=a?.owner;
  if(!a||typeof a.errorPresent!=='boolean')throw fault('TASK_GRANT_IMAGE_ACQUIRE_STATUS');
  if(!owner)throw fault('TASK_GRANT_IMAGE_PARTIAL_OWNER_REQUIRED');
  for(const k of['readOriginalTaskReadContinuationModulePath','retire','join','close','isClosed'])if(typeof Object.getOwnPropertyDescriptor(owner,k)?.value!=='function')throw fault('TASK_GRANT_IMAGE_REQUIRED_METHOD_MISSING:'+k);
  if(a.errorPresent!==true)throw fault('TASK_GRANT_ROOT0_EXPECTED_REFUSAL');root0Cause=inspectTaskGrantRoot0CauseDATA(a.error);if(!root0Cause.expectedMissing)throw Object.assign(fault('TASK_GRANT_ROOT0_CAUSE_UNEXPECTED',a.error),{firstCauseDATA:root0Cause});
 }catch(e){keep(e)}finally{
  if(owner){for(const k of['retire','join','close'])try{if(typeof owner[k]!=='function')throw fault('TASK_GRANT_IMAGE_CLEANUP_METHOD_MISSING');if(await owner[k]()!==undefined)throw fault('TASK_GRANT_IMAGE_CLEANUP_RESULT')}catch(e){cleanupFirst??={error:e}}try{closed=owner.isClosed()===true}catch(e){cleanupFirst??={error:e}}}
 }
 if(first)throw first.error;if(cleanupFirst)throw fault('TASK_GRANT_ROOT0_CLEANUP_FAILED',cleanupFirst.error);if(!closed)throw fault('TASK_GRANT_ROOT0_CLEANUP_PENDING');
 return Object.freeze({requiredNAPIExportAndInstanceGetter:true,Root0Refused:true,Root0ErrorPresent:true,Root0FirstCauseDATA:root0Cause,partialClosed:true,matchingImagePositive:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.argv.length!==3)throw fault('TASK_GRANT_ROOT0_IMAGE_ARGUMENT_REQUIRED');console.log(JSON.stringify(await inspectTaskGrantBuiltImageRoot0DATA(createRequire(import.meta.url)(process.argv[2]))))}
