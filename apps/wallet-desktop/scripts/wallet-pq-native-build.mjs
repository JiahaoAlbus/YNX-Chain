import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const fail=()=>{throw Error('WALLET_PQ_NATIVE_BUILD_ROLE_DIFFERS');};
export const PQ_NATIVE_MANIFEST=Object.freeze({path:'apps/wallet-desktop/native/pq-transaction/BUILD_INPUTS.json',bytes:5122,sha256:'51642679aeb72478c0101d2d7519e79fd9b7e914d726f893bb1c756eda5408c0'});
const bytes=readFileSync(new URL('../native/pq-transaction/BUILD_INPUTS.json',import.meta.url));
if(bytes.length!==PQ_NATIVE_MANIFEST.bytes||createHash('sha256').update(bytes).digest('hex')!==PQ_NATIVE_MANIFEST.sha256)fail();
const contract=JSON.parse(bytes),overlay=contract.MainTranslationUnitOverlay;
export const PQ_NATIVE_ARCHIVE=Object.freeze({path:'apps/wallet-desktop/native/libynx_artifact_release.a',bytes:11192240,sha256:'dcaca724942436806f564477f8729cce3ba03cdbc5621611c9d704bb12cf8a72'});
export const PQ_NATIVE_SOURCE=Object.freeze({path:'apps/wallet-desktop/native/pq-transaction/PROTOCOL_SOURCE.json',bytes:26460,sha256:'6b946af20360bc6fb7f03cfb69ac3324bbac55f4c2eb8f304357230391f4594a'});
export const PQ_NATIVE_PROTOCOL=Object.freeze({commit:'a59f7673f487e50d3a176bf48293e3647092e2cb',goVersion:'go version go1.26.10 darwin/arm64',source:PQ_NATIVE_SOURCE,archive:PQ_NATIVE_ARCHIVE});
export function verifyPQNativeProtocolSource(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length!==PQ_NATIVE_SOURCE.bytes||createHash('sha256').update(bytes).digest('hex')!==PQ_NATIVE_SOURCE.sha256)fail();
 const s=JSON.parse(bytes),pins=contract.inputs,header=(actual,expected)=>actual?.bytes===expected?.bytes&&actual?.sha256===expected?.sha256;
 if(s.commit!==PQ_NATIVE_PROTOCOL.commit||s.goVersion!==PQ_NATIVE_PROTOCOL.goVersion||s.host?.os!=='darwin'||s.host?.arch!=='arm64'||s.minimumSystemVersion!=='13.0'||!header(s.archive,PQ_NATIVE_ARCHIVE)||!header(s.transactionHeader,pins.find(p=>p.path.endsWith('/tx_batch.h')))||!header(s.initialAccountHeader,pins.find(p=>p.path.endsWith('/account_initial.h')))||!header(s.header,{bytes:5089,sha256:'1da905e0b38581ad34a9cf995c36f8d368425df9242a35f4e49d7b41c8100616'}))fail();
 if(['actualCABIExecuted','actualTransactionCABIExecuted','actualInitialAccountCABIExecuted','independentGoDualANDVerified','transactionIndependentGoDualANDVerified','initialAccountIndependentGoDualANDVerified'].some(k=>s[k]!==true)||['nativeRootAuthorized','publisherAuthorized','transactionAccountAuthorized','initialAccountAuthorized','productInstalled','publicDeployment','pqActivation'].some(k=>s[k]!==false))fail();
 return Object.freeze({commit:s.commit,goVersion:s.goVersion,source:PQ_NATIVE_SOURCE,archive:PQ_NATIVE_ARCHIVE,componentCABI:true,wholeCIPassed:false,Root:false,approval:false,installed:false,publicActivation:false});
}
const protocol=contract.build.linkGoArchiveExactlyOnce;
if(protocol.sourceCommit!==PQ_NATIVE_PROTOCOL.commit||protocol.goVersion!==PQ_NATIVE_PROTOCOL.goVersion||protocol.bytes!==PQ_NATIVE_ARCHIVE.bytes||protocol.sha256!==PQ_NATIVE_ARCHIVE.sha256||JSON.stringify(protocol.sourceRecord)!==JSON.stringify(PQ_NATIVE_SOURCE))fail();
verifyPQNativeProtocolSource(readFileSync(new URL('../native/pq-transaction/PROTOCOL_SOURCE.json',import.meta.url)));
export const PQ_NATIVE_INPUTS=Object.freeze([...contract.inputs.filter(p=>p.path!==overlay.path),PQ_NATIVE_MANIFEST,PQ_NATIVE_SOURCE,PQ_NATIVE_ARCHIVE].map(p=>Object.freeze({...p})));
export const PQ_NATIVE_PROVENANCE=Object.freeze({kind:'YNX_WALLET_MAIN_PQ_NATIVE_R2/v1',manifest:PQ_NATIVE_MANIFEST,protocol:PQ_NATIVE_PROTOCOL,override:{path:overlay.path,before:overlay.supplierBase,after:overlay.after}});
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
