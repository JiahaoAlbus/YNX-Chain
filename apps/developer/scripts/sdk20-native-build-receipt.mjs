import {createHash} from 'node:crypto';
import {join,basename} from 'node:path';

// Translate only the pinned, actually executed original A SDK20 record. This
// is source/build custody, never Native registration, Source or key authority.
export function sdk20NativeBuildReceipt(record,inputs){
 const digest=createHash('sha256').update(JSON.stringify(record)).digest('hex');
 if(record?.schema!=='YNX_SDK20_R181_ORIGINAL_A_EXECUTED_NATIVE_RECORD_V1'
  ||digest!==inputs.nativeComponent?.executedRecordCanonicalSha256
  ||record.sourceCommit!==inputs.sdkCommit||record.SDKVersion!=='1.3.0-pq.3.32-auth.20'
  ||record.executed!==true||record.NAPI_VERSION!==8||record.headerVersion!=='22.13.1'
  ||record.noWalletPrivateStoreInputs!==true
  ||['NativeQualified','helperExecuted','helperRegistered','installed','GUI','SourceGranted','privateReleaseRowsGranted','accountKeysTouched','projectFactoryCalled','getterCalled','workspaceSelectorCalled'].some(key=>record[key]!==false)
  ||record.inputCounts?.Native!==77||record.inputCounts?.helperAdditional!==5||record.inputCounts?.allSupplied!==87
  ||record.inputFiles?.length!==77||record.nodeTUs?.length!==13||record.helperTUs?.length!==11)
  throw Error('SDK20 original executed Native receipt differs.');
 const required=['NORMAL_NODE13_BUILD','NORMAL_HELPER11_BUILD','ACTUAL_PASSIVE_NODE_NAPI_LOAD','ACTUAL_PASSIVE_ELECTRON_NAPI_LOAD','EXACT_ALL_INPUT_POSTCHECK'];
 if(!required.every(phase=>record.actualSteps?.some(step=>step.phase===phase&&step.actualExit===0&&step.guard===null))
  ||['Node','helper'].some(key=>!Array.isArray(record.ownedUndefined?.[key])||record.ownedUndefined[key].length!==0))throw Error('SDK20 compilation/load evidence differs.');
 const nodeLoad=record.normalNodeLoad,electronLoad=record.normalElectronLoad;
 if([nodeLoad,electronLoad].some(load=>load?.state!=='ACTUAL_MODULE_LOAD_EXACT_SOURCE_EXPORTS_PASS'||load.exports?.length!==91||new Set(load.exports).size!==91||load.qualified!==false||load.helperExecuted!==false||load.grant!==false)
  ||JSON.stringify(nodeLoad.exports)!==JSON.stringify(electronLoad.exports))throw Error('SDK20 passive export closure differs.');
 const commands=record.actualCompilerDrivers;
 if(commands?.length!==2||!commands.every(command=>command.exactArgvEqual===true
  &&command.normalPlanCommand?.tool==='/usr/bin/clang++'
  &&JSON.stringify(command.actual?.argv?.slice(1))===JSON.stringify(command.normalPlanCommand.argv))
  ||!commands.some(command=>command.role==='node'&&command.translationUnits===13)
  ||!commands.some(command=>command.role==='helper'&&command.translationUnits===11))throw Error('SDK20 compiler provenance differs.');
 for(const role of ['node','helper']){
  const argv=commands.find(command=>command.role===role).actual.argv,units=role==='node'?record.nodeTUs:record.helperTUs;
  if(!argv[0]?.endsWith('/clang++')||units.some(path=>!argv.includes(path))||!argv.includes('-mmacosx-version-min=13.0')
   ||!argv.some((value,i)=>value==='-framework'&&argv[i+1]==='ServiceManagement'))throw Error('SDK20 compiler closure differs.');
 }
 for(const key of ['helper','helperPlist']){
  const pin=inputs.helperComponent?.[key],actual=record.artifacts?.[key];
  if(!pin||actual?.path!==join(record.sourceRoot,pin.path)||actual.bytes!==pin.bytes||actual.sha256!==pin.sha256)throw Error('SDK20 helper component differs.');
 }
 const node=commands.find(command=>command.role==='node').actual;
 return{schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:record.headerVersion,
  minimumSystemVersion:'13.0',readbackOnly:false,commandsKind:'executed-normal-build',appSigned:false,nativeQualified:false,registrationAccepted:false,
  architectures:['arm64'],sourceRoot:record.sourceRoot,headerRoot:record.headerRoot,
  relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},
  commands:[{tool:'/usr/bin/clang++',actualTool:node.argv[0],argv:node.argv.slice(1)}],inputFiles:record.inputFiles,
  headers:record.header5.map(row=>({...row,relative:basename(row.path)})),
  output:{...record.artifacts.module,relative:'apps/wallet-desktop/native/original-auth-identity.node'},originalExecutedRecordSchema:record.schema};
}
