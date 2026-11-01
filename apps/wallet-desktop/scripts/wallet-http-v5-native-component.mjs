// Exact normal build DATA for this successor. It is not a Source certificate,
// permission to load/sign, an installed image, or an SDK version alias.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {types} from 'node:util';
import {PINNED_NODE_HEADER_PINS} from './canonical-package.mjs';
import {verifySDK49FullRuntimeTables} from './sdk49-runtime-source.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export const HTTP_V5_NORMAL_INPUT=Object.freeze({path:'apps/wallet-desktop/native/http-v5-normal-build-inputs.json',bytes:101964,sha256:'dd46d03a07336ceb709292a80f963841abe105eba949f1dde641b2dbc53e5e23'});
const raw=readFileSync(new URL('../native/http-v5-normal-build-inputs.json',import.meta.url));
const fail=()=>{throw Error('WALLET_HTTP_V5_MATCHED_NORMAL_COMPONENT_REQUIRED');};
if(raw.length!==HTTP_V5_NORMAL_INPUT.bytes||hash(raw)!==HTTP_V5_NORMAL_INPUT.sha256)fail();
const manifest=JSON.parse(raw),output='apps/wallet-desktop/native/original-auth-identity.node';
if(manifest.kind!=='YNX_WALLET_HTTP_V5_NORMAL_BUILD_INPUTS/v1'||manifest.sdkSource!=='98467012696ad5b0f51425c5f6c48e20fe4f9b4e'||manifest.translationUnits!==33||manifest.files.filter(p=>p.path.endsWith('.a')).length!==1||manifest.files.find(p=>p.path.endsWith('.a')).sha256!=='f078524c371648a284343d69496e4d37276f3a90bea220af7ef99e568e883c6a')fail();
export const HTTP_V5_NORMAL_ROLE=Object.freeze({kind:'YNX_WALLET_HTTP_V5_NORMAL_SINGLE_CORE/v1',sdkSource:manifest.sdkSource,input:HTTP_V5_NORMAL_INPUT,SourceAdmission:false,RootAdmission:false});
export const HTTP_V5_REQUIRED_NAPI_EXPORTS=Object.freeze(['originalPQOpen','originalPQOpenInitial','originalPQTransactionOnce','acquireOriginalProductSessionHTTPProofV5Source','acquireOriginalProductSessionDeviceV4RegisteredFinalizationSource','acquireOriginalPQHostCatalogSource','isOriginalPQHostCatalogSource','readOriginalPQHostCatalogHandoff','assertOriginalPQHostCatalogSourceCurrent','observeOriginalPQHostCatalogSourceRevocation','retireOriginalPQHostCatalogSource','joinOriginalPQHostCatalogSource','closeOriginalPQHostCatalogSource','readOriginalPQHostCatalogSourceStatus']);
export function assertHTTPV5NormalNativeExports(image){
 if(!image||types.isProxy(image))fail();
 for(const key of HTTP_V5_REQUIRED_NAPI_EXPORTS){const d=Object.getOwnPropertyDescriptor(image,key);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')throw Error('WALLET_HTTP_V5_NORMAL_EXPORT_MISSING:'+key);}
 return Object.freeze({required:HTTP_V5_REQUIRED_NAPI_EXPORTS.length,SourceInvoked:false,SourceAdmission:false});
}
const table=[...manifest.files,HTTP_V5_NORMAL_INPUT],names=table.map(p=>p.path);
if(new Set(names).size!==names.length)fail();
export const HTTP_V5_NORMAL_INPUT_NAMES=Object.freeze(names);
export const httpV5NormalSourceAsset=name=>names.includes(name);
export const isHTTPV5NormalSelection=value=>value?.includes(HTTP_V5_NORMAL_INPUT.path)===true;
const same=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))fail();};
const absolute=p=>{if(typeof p!=='string'||!path.isAbsolute(p)||path.normalize(p)!==p||p.includes('\0'))fail();};
const shape=p=>p&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&p.bytes<=16777216&&/^[a-f0-9]{64}$/.test(p.sha256);
const pinned=(bytes,p)=>{if(!Buffer.isBuffer(bytes)||!shape(p)||bytes.length!==p.bytes||hash(bytes)!==p.sha256)fail();};
const rows=()=>table.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.relative.localeCompare(b.relative,'en'));
const commands=(templates,root,headers)=>templates.map(c=>({tool:c.tool,argv:c.argv.map(a=>a.replaceAll('${SOURCE_ROOT}',root).replaceAll('${HEADER_ROOT}',headers))}));
export function selectHTTPV5NormalInputs(version,available,inventoryBytes,receiptRows){
 if(version!==manifest.sdkVersion||!Array.isArray(available)||names.some(p=>!available.includes(p)))fail();pinned(inventoryBytes,manifest.sdkInventory);
 same([...receiptRows].sort((a,b)=>a.relative.localeCompare(b.relative,'en')),rows());
 return {inputs:[...names],evidenceAssets:[],inventory:manifest.sdkInventory,walletInputs:table.filter(p=>p.path.startsWith('apps/wallet-desktop/')),supplierNodeInputCount:171,httpV5NormalRole:HTTP_V5_NORMAL_ROLE};
}
function verifyRows(input,readSource){same([...input].sort((a,b)=>a.relative.localeCompare(b.relative,'en')),rows());for(const p of table)pinned(readSource(p.path),p);}
export function verifyHTTPV5NormalReceipt(record,moduleBytes,expectedInputs,readSource){
 if(record?.schemaVersion!==1||record.kind!=='YNX_WALLET_ORIGINAL_NATIVE_BUILD'||record.napiVersion!==8||record.headerVersion!=='22.13.1'||record.minimumSystemVersion!=='13.0'||record.readbackOnly!==false||record.commandsKind!=='executed-normal-build'||record.appSigned!==false||record.nativeQualified!==false||record.registrationAccepted!==false)fail();
 same(record.httpV5NormalRole,HTTP_V5_NORMAL_ROLE);absolute(record.sourceRoot);absolute(record.headerRoot);same(record.architectures,['arm64']);same(record.relativeBases,{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'});
 same([...expectedInputs].sort(),[...names].sort());verifyRows(record.inputFiles,readSource);pinned(readSource(manifest.sdkInventory.path),manifest.sdkInventory);same(record.sourceInventory,{relative:manifest.sdkInventory.path,bytes:manifest.sdkInventory.bytes,sha256:manifest.sdkInventory.sha256});
 verifySDK49FullRuntimeTables(readSource('packages/wallet-auth/native/original-ide-auth-runtime-manifest.json'),readSource('packages/wallet-auth/native/original-ide-contract-relay-runtime-manifest.json'));
 same(record.headers,PINNED_NODE_HEADER_PINS);if(record.output?.relative!==output)fail();pinned(moduleBytes,record.output);
 const expected=commands(manifest.commands,record.sourceRoot,record.headerRoot);same(record.commands,expected);same(record.exitCodes,expected.map(()=>0));
 const scan=record.ownedUndefinedScan;if(scan?.tool!=='/usr/bin/nm'||scan.exit!==0||!/^[a-f0-9]{64}$/.test(scan.stdoutSHA256))fail();same(scan.argv,['-u',path.join(record.sourceRoot,output)]);same(scan.ownedUndefined,[]);
 if(expected.at(-1).argv.filter(p=>p.endsWith('.a')).length!==1||Object.hasOwn(record,'buildContinuation')||Object.hasOwn(record,'pqNativeRole')||Object.hasOwn(record,'deviceV4PQRole'))fail();
 return {output:record.output,pinsVerified:true,sourceBytesVerified:true,artifactBytesVerified:true,readbackOnly:false,commandsKind:record.commandsKind,httpV5NormalRole:HTTP_V5_NORMAL_ROLE,walletInputs:table.filter(p=>p.path.startsWith('apps/wallet-desktop/')),nativeQualified:false,appSigned:false,installed:false,SourceAdmission:false,RootAdmission:false};
}
export function verifyHTTPV5NormalComponent({record,inventoryBytes,moduleBytes,helperBytes},readSource){
 pinned(inventoryBytes,manifest.sdkInventory);const result=verifyHTTPV5NormalReceipt(record,moduleBytes,names,readSource),h=record.helperBuild;
 if(h?.kind!=='YNX_WALLET_ORIGINAL_HELPER_BUILD/v1'||h.sourceRoot!==record.sourceRoot||h.readbackOnly!==false||h.commandsKind!=='executed-normal-build'||h.executed!==true||h.serviceRegistered!==false||h.installed!==false||h.nativeQualified!==false||h.appSigned!==false)fail();
 same(h.architectures,['arm64']);same(h.commands,commands(manifest.helperCommands,record.sourceRoot,record.headerRoot));same(h.exitCodes,h.commands.map(()=>0));verifyRows(h.inputFiles,readSource);
 if(h.output?.relative!=='apps/developer/helper/YNXIdentityReceiver'||h.packagedOutput?.relative!=='apps/wallet-desktop/native/YNXIdentityReceiver')fail();pinned(helperBytes,h.output);pinned(helperBytes,h.packagedOutput);
 const scan=h.ownedUndefinedScan;if(scan?.tool!=='/usr/bin/nm'||scan.exit!==0||!/^[a-f0-9]{64}$/.test(scan.stdoutSHA256))fail();same(scan.argv,['-u',path.join(record.sourceRoot,h.output.relative)]);same(scan.ownedUndefined,[]);
 return {...result,helper:{output:h.output,packagedOutput:h.packagedOutput,translationUnits:manifest.helperTranslationUnits,sourceInputs:names.length},supplierNodeInputCount:171,serviceRegistered:false};
}
