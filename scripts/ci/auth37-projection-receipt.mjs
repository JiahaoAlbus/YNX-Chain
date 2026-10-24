// Build-only completion of the exact finite exclusion DATA. No files, Native
// input, runtime manifest, Source registration or permission are changed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const VERSION='1.3.0-pq.3.32-auth.37',COMMIT='7bb0e17d2bd1aa6d4bde96f45c14774fcc4ccff9';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=c=>{throw Object.assign(Error(c),{code:c});};
const originalPolicyRaw=fs.readFileSync(new URL('./fixtures/sdk35-product-runtime-policy.json',import.meta.url));
if(originalPolicyRaw.length!==4082||sha(originalPolicyRaw)!=='df1d8e329a4e9d3266359da9999081ccafcf3396a3c6439aa31dbae1ce93a5b7')fail('AUTH37_EXCLUSION_POLICY_PIN');
const excluded=JSON.parse(originalPolicyRaw).excluded;
const flags=['SourceQualified','Root','NativeModuleBuilt','installed','published'];
const baseKeys='kind versionSDK sourceCommit parentSupply completePrefixInventory Auth union selection staticSourceAnalysis fullPrefixFiles productFiles fullAuthFiles productAuthFiles fullUnionFiles productUnionFiles excludedFiles installedLockRetained NativeInputChanged existingJSSourceGraphUnchanged generatedRawCanonicalNoLF SourceQualified Root NativeModuleBuilt installed published'.split(' ');
const resultKeys=['excluded','finite15Contract','finite15RowsCount','oldSDK36IdentityOrAdmissionInherited','inheritedExclusionRowsDATAOnly','projectionMetadataRevision'];
function keys(v,expected){if(Object.keys(v).sort().join('|')!==expected.slice().sort().join('|'))fail('AUTH37_RECEIPT_SCHEMA');}
function data(v){
 if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).some(k=>typeof k!=='string'||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')))fail('AUTH37_RECEIPT_DATA');
}
function rowMap(rows,count){
 if(!Array.isArray(rows)||rows.length!==count)fail('AUTH37_RECEIPT_COUNT');
 let previous='';const out=new Map();
 for(const r of rows){data(r);if(Object.keys(r).sort().join('|')!=='bytes|path|sha256'||typeof r.path!=='string'||r.path<=previous||r.path.startsWith('/')||r.path.includes('\\')||r.path.split('/').some(p=>!p||p==='.'||p==='..')||!Number.isSafeInteger(r.bytes)||r.bytes<0||!/^[a-f0-9]{64}$/.test(r.sha256))fail('AUTH37_RECEIPT_ROW');previous=r.path;out.set(r.path,r);}
 return out;
}
const same=(a,b)=>a?.bytes===b.bytes&&a?.sha256===b.sha256;
export function validateSDK37FiniteReceiptDATA(receipt){
 data(receipt);
 if(receipt.kind!=='YNX_SDK37_PRODUCT_RUNTIME_METADATA_PROJECTION/v1'||receipt.versionSDK!==VERSION||receipt.sourceCommit!==COMMIT||receipt.excludedFiles!==15||flags.some(k=>receipt[k]!==false))fail('AUTH37_RECEIPT_SELECTION');
 if(JSON.stringify(receipt.excluded)!==JSON.stringify(excluded)||receipt.finite15RowsCount!==15||receipt.inheritedExclusionRowsDATAOnly!==true||receipt.oldSDK36IdentityOrAdmissionInherited!==false)fail('AUTH37_RECEIPT_EXACT_EXCLUSIONS_REQUIRED');
 keys(receipt,[...baseKeys,...resultKeys]);
 data(receipt.finite15Contract);if(typeof receipt.finite15Contract.path!=='string'||!path.isAbsolute(receipt.finite15Contract.path)||receipt.finite15Contract.bytes!==3013||receipt.finite15Contract.sha256!=='55a2dece3fa0aa55290e0347deb2a7775ff4b28509fdb6130e892b72117ef8c6')fail('AUTH37_RECEIPT_POLICY_REF');
 return true;
}
export function finalizeSDK37FiniteReceiptDATA({receipt,inventory,selection,policy,policyRef}){
 data(receipt);data(inventory);data(selection);data(policy);data(policyRef);
 keys(receipt,baseKeys);
 if(receipt.kind!=='YNX_SDK37_PRODUCT_RUNTIME_METADATA_PROJECTION/v1'||receipt.versionSDK!==VERSION||receipt.sourceCommit!==COMMIT||receipt.excludedFiles!==15||flags.some(k=>receipt[k]!==false)||inventory.kind!=='YNX_SDK37_COMPLETE_NORMAL_PREFIX_FILE_INVENTORY/v1'||inventory.versionSDK!==VERSION||inventory.sourceCommit!==COMMIT||selection.kind!=='YNX_SDK37_PRODUCT_PACK_SELECTION/v1'||selection.versionSDK!==VERSION||policy.kind!=='YNX_SDK37_FINITE_PRODUCT_EXCLUSION_POLICY/v1'||policy.versionSDK!==VERSION||policy.oldSDK36IdentityOrAdmissionInherited!==false||JSON.stringify(policy.excluded)!==JSON.stringify(excluded))fail('AUTH37_RECEIPT_SELECTION');
 const full=rowMap(inventory.files,9581),product=rowMap(selection.files,9566),removed=new Set(excluded.map(r=>r.path));
 for(const r of excluded)if(!same(full.get(r.path),r)||product.has(r.path))fail('AUTH37_RECEIPT_EXCLUSION_MEMBER');
 for(const r of product.values())if(removed.has(r.path)||!same(full.get(r.path),r))fail('AUTH37_RECEIPT_PRODUCT_MEMBER');
 for(const r of full.values())if(!removed.has(r.path)&&!product.has(r.path))fail('AUTH37_RECEIPT_PRODUCT_MEMBER');
 const output={...structuredClone(receipt),excluded:structuredClone(excluded),finite15Contract:structuredClone(policyRef),finite15RowsCount:15,oldSDK36IdentityOrAdmissionInherited:false,inheritedExclusionRowsDATAOnly:true,projectionMetadataRevision:2};
 validateSDK37FiniteReceiptDATA(output);return output;
}
function read(ref){
 data(ref);if(typeof ref.path!=='string'||!path.isAbsolute(ref.path)||path.resolve(ref.path)!==ref.path)fail('AUTH37_RECEIPT_PATH');
 for(let p=ref.path;;p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink())fail('AUTH37_RECEIPT_SYMLINK');if(p===path.dirname(p))break;}
 const st=fs.lstatSync(ref.path);if(!st.isFile()||st.size!==ref.bytes||st.size>8388608)fail('AUTH37_RECEIPT_INPUT_PIN');const b=fs.readFileSync(ref.path);if(sha(b)!==ref.sha256)fail('AUTH37_RECEIPT_INPUT_PIN');return JSON.parse(b);
}
export function produceSDK37FiniteReceipt(handoffPath,policyPath,outputPath){
 const h=read({path:handoffPath,bytes:9317,sha256:'3d922d6dbdb456bc4b2a92c07b96af1c504018f5f770f407fc0845457f98fd28'});
 const policyRef={path:policyPath,bytes:3013,sha256:'55a2dece3fa0aa55290e0347deb2a7775ff4b28509fdb6130e892b72117ef8c6'};
 const receipt=read(h.projectionReceipt),inventory=read(h.normalPrefix.inventory),selection=read(h.runtime.product.selection),policy=read(policyRef);
 const result=finalizeSDK37FiniteReceiptDATA({receipt,inventory,selection,policy,policyRef});
 if(!path.isAbsolute(outputPath)||path.resolve(outputPath)!==outputPath||fs.realpathSync(path.dirname(outputPath))!==path.dirname(outputPath))fail('AUTH37_RECEIPT_OUTPUT');
 const raw=Buffer.from(JSON.stringify(result,null,2)+'\n');fs.writeFileSync(outputPath,raw,{flag:'wx',mode:0o600});
 return {path:outputPath,bytes:raw.length,sha256:sha(raw),prefixRead:false,NativeExecuted:false,SourceQualified:false,installed:false,published:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==5)fail('AUTH37_RECEIPT_ARGUMENTS');console.log(JSON.stringify(produceSDK37FiniteReceipt(...process.argv.slice(2))));
}
