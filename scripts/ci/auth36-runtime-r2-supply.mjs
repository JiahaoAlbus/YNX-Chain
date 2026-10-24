// Build-only immutable correction of the four frozen Auth36 manifest objects.
// No SDK payload, dependency, reader, old supply, component or account is edited.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {serializeAuth36NormalManifestData,inspectAuth36NormalManifestData} from './auth36-normal-manifest-serialization.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=c=>{throw Object.assign(Error(c),{code:c});};
function canonicalPath(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||path.resolve(p)!==p)fail('AUTH36_R2_PATH');
 for(let at=p;;at=path.dirname(at)){if(fs.lstatSync(at).isSymbolicLink())fail('AUTH36_R2_SYMLINK');if(at===path.dirname(at))break;}
 if(fs.realpathSync(p)!==p)fail('AUTH36_R2_PATH');
}
function read(ref){
 canonicalPath(ref.path);const st=fs.lstatSync(ref.path);
 if(!st.isFile()||st.size!==ref.bytes||st.size>8388608)fail('AUTH36_R2_PARENT_PIN');
 const b=fs.readFileSync(ref.path);if(sha(b)!==ref.sha256)fail('AUTH36_R2_PARENT_PIN');return b;
}
const pin=(p,b)=>({path:p,bytes:b.length,sha256:sha(b)});
export function produceAuth36RuntimeR2(parentHandoffPath,outputRoot){
 const parentRef={path:parentHandoffPath,bytes:12518,sha256:'c9b809eaf045ed273dc658a6fbf99ff56e92a81be2d8a3570f4a10c28017dafb'};
 const parent=JSON.parse(read(parentRef));
 if(parent.versionSDK!=='1.3.0-pq.3.32-auth.36'||parent.sourceCommit!=='55fcb9c71a5437b935a50afe76fd555a7ad76559')fail('AUTH36_R2_IDENTITY');
 if(typeof outputRoot!=='string'||!path.isAbsolute(outputRoot)||path.resolve(outputRoot)!==outputRoot)fail('AUTH36_R2_OUTPUT');
 canonicalPath(path.dirname(outputRoot));if(fs.existsSync(outputRoot))fail('AUTH36_R2_OUTPUT_EXISTS');
 const rows=[
  ['fullAuth',parent.runtime.Auth.manifest,'original-auth-runtime-manifest.json','runtime/original-auth-runtime-manifest.json',566],
  ['fullUnion',parent.runtime.union.manifest,'original-ide-contract-relay-runtime-manifest.json','runtime/original-ide-contract-relay-runtime-manifest.json',9426],
  ['productAuth',parent.runtime.product.Auth,'original-ide-auth-runtime-manifest.json','runtime-projections/sdk36-product/original-ide-auth-runtime-manifest.json',556],
  ['productUnion',parent.runtime.product.union,'original-ide-contract-relay-runtime-manifest.json','runtime-projections/sdk36-product/original-ide-contract-relay-runtime-manifest.json',9417]
 ];
 const prepared=rows.map(([role,before,name,relative,count])=>{
  const old=read(before),body=JSON.parse(old),raw=serializeAuth36NormalManifestData(name,body);
  if(body.files.length!==count||!Buffer.concat([raw,Buffer.from('\n')]).equals(old))fail('AUTH36_R2_EXPECTED_LF_ONLY_DELTA');
  let rejected=false;try{inspectAuth36NormalManifestData(name,old);}catch(e){if(e.code!=='AUTH36_NORMAL_MANIFEST_INVALID')throw e;rejected=true;}
  if(!rejected)fail('AUTH36_R2_PARENT_NOT_REJECTED');
  const inspected=inspectAuth36NormalManifestData(name,raw);
  if(JSON.stringify(inspected)!==raw.toString('utf8'))fail('AUTH36_R2_NORMAL_RAW_CONTRACT');
  return {role,before,name,relative,count,raw};
 });
 fs.mkdirSync(outputRoot,{mode:0o700});const outputs=[];
 try{
  for(const p of prepared){
   const target=path.join(outputRoot,p.relative);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
   fs.writeFileSync(target,p.raw,{flag:'wx',mode:0o600});const after=pin(target,p.raw);read(after);
   outputs.push({role:p.role,before:p.before,after,manifestName:p.name,fileCount:p.count,onlyTerminalLFRemoved:true,rowsChanged:false});
  }
  const result={kind:'YNX_AUTH36_CANONICAL_RUNTIME_SUPPLY_R2_PRODUCER_RECEIPT/v1',versionSDK:parent.versionSDK,supplyRevision:2,parentHandoff:parentRef,outputs,normalRawContractChecked:true,newOutputReadback:true,oldSupplyMutated:false,SDKPayloadChanged:false,dependenciesRead:false,NativeExecuted:false,SourceAdmitted:false,AppQualified:false,installed:false,published:false};
  fs.writeFileSync(path.join(outputRoot,'SERIALIZATION_PRODUCER_RECEIPT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return result;
 }catch(e){if(e&&typeof e==='object'){e.partialOutputPreserved=true;e.firstCause??=e.code??e.message;}throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4)fail('AUTH36_R2_ARGUMENTS');
 process.stdout.write(JSON.stringify(produceAuth36RuntimeR2(process.argv[2],process.argv[3]))+'\n');
}
