import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const fail=()=>{throw Error('WALLET_PQ_NATIVE_BUILD_ROLE_DIFFERS');};
export const PQ_NATIVE_MANIFEST=Object.freeze({path:'apps/wallet-desktop/native/pq-transaction/BUILD_INPUTS.json',bytes:4790,sha256:'44736d84e10f04068315486263e4be187d0eadd1da7960835d5c62149db1ce0f'});
const bytes=readFileSync(new URL('../native/pq-transaction/BUILD_INPUTS.json',import.meta.url));
if(bytes.length!==PQ_NATIVE_MANIFEST.bytes||createHash('sha256').update(bytes).digest('hex')!==PQ_NATIVE_MANIFEST.sha256)fail();
const contract=JSON.parse(bytes),overlay=contract.MainTranslationUnitOverlay;
export const PQ_NATIVE_ARCHIVE=Object.freeze({path:'apps/wallet-desktop/native/libynx_artifact_release.a',bytes:10106960,sha256:'a459fb3fbd7d4a45ea8287f9c5b2283a166716db2db6673f0a9380126eafd3cf'});
export const PQ_NATIVE_INPUTS=Object.freeze([...contract.inputs.filter(p=>p.path!==overlay.path),PQ_NATIVE_MANIFEST,PQ_NATIVE_ARCHIVE].map(p=>Object.freeze({...p})));
export const PQ_NATIVE_PROVENANCE=Object.freeze({kind:'YNX_WALLET_MAIN_PQ_NATIVE_R2/v1',manifest:PQ_NATIVE_MANIFEST,override:{path:overlay.path,before:overlay.supplierBase,after:overlay.after}});
export function pqNativeSupplierInputs(pins,enabled){
 if(!enabled)return pins;
 const before=pins.filter(p=>p.path===overlay.path);if(before.length!==1||['path','bytes','sha256'].some(k=>before[0][k]!==overlay.supplierBase[k]))fail();
 return pins.map(p=>p.path===overlay.path?overlay.after:p);
}
export function pqNativeWalletInputs(pins,enabled){return enabled?[...pins.filter(p=>!p.path.endsWith('.a')),...PQ_NATIVE_INPUTS]:pins;}
export function isPQNativeSelection(names){return names.includes(PQ_NATIVE_MANIFEST.path);}
export function pqNativeReceiptCommands(receipt){
 if(JSON.stringify(receipt.pqNativeRole)!==JSON.stringify(PQ_NATIVE_PROVENANCE)||JSON.stringify(receipt.architectures)!==JSON.stringify(['arm64'])||!Array.isArray(receipt.pqNativeBaseCommands))fail();
 const composed=composePQNativeCommands(receipt.pqNativeBaseCommands,receipt.sourceRoot);
 if(JSON.stringify(composed.commands)!==JSON.stringify(receipt.commands))fail();
 return receipt.pqNativeBaseCommands;
}
/** Build DATA only. C++ is compiled into objects, Swift owns the final link so
 * its original runtime/autolink requirements are resolved by the toolchain.
 * The Protocol Go archive appears exactly once, in that final link. */
export function composePQNativeCommands(base,repo){
 if(base.length!==1||base[0].tool!=='/usr/bin/clang++')fail();
 const argv=base[0].argv,ai=argv.indexOf('-arch'),start=argv.findIndex(a=>a===path.join(repo,overlay.path)),end=argv.lastIndexOf('-o');
 if(ai<0||argv[ai+1]!=='arm64'||start<0||end<0)fail();
 const sources=argv.slice(start,end).filter(p=>p.endsWith('.mm')),archives=argv.slice(start,end).filter(p=>p.endsWith('.a'));
 if(archives.length!==1||archives[0]!==path.join(repo,PQ_NATIVE_ARCHIVE.path)||sources.length<1||sources.length+archives.length!==end-start)fail();
 const prefix=[];for(let i=0;i<start;i++){const a=argv[i];if(a==='-dynamiclib'||a==='-lbsm')continue;if(a==='-framework'||a==='-undefined'){i++;continue;}prefix.push(a);}
 const dir=path.join(repo,'apps/wallet-desktop/native/pq-transaction'),wipe=path.join(dir,'native-wipe.o'),objects=sources.map((_,i)=>path.join(dir,'native-main-'+i+'.o'));
 const commands=[{tool:'/usr/bin/clang',argv:['-arch','arm64','-mmacosx-version-min=13.0','-c',path.join(dir,'native-wipe.c'),'-o',wipe]},...sources.map((source,i)=>({tool:'/usr/bin/clang++',argv:['-DYNX_ORIGINAL_WALLET_NATIVE_PQ_CUSTODY=1',...prefix,'-c',source,'-o',objects[i]]}))];
 const frameworks=[];for(let i=0;i<start;i++)if(argv[i]==='-framework')frameworks.push('-framework',argv[++i]);
 commands.push({tool:'/usr/bin/xcrun',argv:['swiftc','-target','arm64-apple-macosx13.0','-emit-library','-parse-as-library','-DYNX_ACCOUNT_INITIAL_NATIVE_V1','-Xcc','-DYNX_ACCOUNT_INITIAL_NATIVE_V1','-import-objc-header',path.join(dir,'NativeTransactionCABI.h'),'-I',dir,path.join(dir,'PQBackupNativeDecoder.swift'),path.join(dir,'NativePQCustodyExports.swift'),wipe,...objects,archives[0],...frameworks,'-Xlinker','-lbsm','-Xlinker','-lresolv','-Xlinker','-lc++','-Xlinker','-undefined','-Xlinker','dynamic_lookup','-o',argv[end+1]]});
 return {commands,intermediateOutputs:[wipe,...objects]};
}
