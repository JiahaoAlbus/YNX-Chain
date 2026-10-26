import{readFileSync,lstatSync,realpathSync}from'node:fs';import{createHash}from'node:crypto';import{join,resolve,isAbsolute}from'node:path';
import{verifySDK332R140Source}from'./sdk49-coherent-native-plan.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),fail=(code,path)=>{throw Object.assign(new Error(code+': '+path),{code,path});};
/** Materialized SOURCE projection only. This neither qualifies a runtime nor
 * accepts the npm member set as a replacement for declared Native sources. */
export function verifySDK49RuntimeSourceProjection({sourceRoot,prefix}){
 const{root,contract}=verifySDK332R140Source(sourceRoot);
 if(typeof prefix!=='string'||!isAbsolute(prefix)||resolve(prefix)!==prefix||realpathSync(prefix)!==prefix||!lstatSync(prefix).isDirectory())fail('SDK49_PREFIX_ROOT_INVALID',String(prefix));
 const metadata='integration/SDK332_R140_NATIVE_COMPATIBILITY.json',raw=readFileSync(join(root,'packages/wallet-auth',metadata)),materialized=readFileSync(join(prefix,metadata));if(!raw.equals(materialized))fail('SDK49_RUNTIME_SOURCE_METADATA_DIFFERS',metadata);
 const seen=new Set();for(const pin of[...contract.NativeInputs,...contract.sourceCurrentIOInputs,...contract.pureDeploymentInputs]){
  if(!pin.path.startsWith('packages/wallet-auth/'))continue;
  const rel=pin.path.slice('packages/wallet-auth/'.length);if(seen.has(rel))fail('SDK49_RUNTIME_SOURCE_DUPLICATE',rel);seen.add(rel);const p=join(prefix,rel);let stat,body;try{stat=lstatSync(p);body=readFileSync(p);}catch{fail('SDK49_RUNTIME_SOURCE_MISSING',rel);}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||body.length!==pin.bytes||hash(body)!==pin.sha256)fail('SDK49_RUNTIME_SOURCE_PIN_DIFFERS',rel);
 }
 return{sourceRoot:root,prefix,packageSourceRowsMatched:seen.size,NativeInputs:117,HelperInputs:5,SourceCurrentIOInputs:1,NativeCompiled:false,SourceAdmission:false,RootAdmission:false};
}
