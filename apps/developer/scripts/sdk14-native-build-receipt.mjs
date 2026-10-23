import {createHash} from 'node:crypto';
import {join,basename} from 'node:path';

// Read the original A execution record unchanged. This view translates its
// public build evidence into the existing packager contract; it grants no role.
export function sdk14NativeBuildReceipt(record,inputs){
  const digest=createHash('sha256').update(JSON.stringify(record)).digest('hex');
  if(record?.schema!=='YNX_SDK14_R166_ORIGINAL_A_EXECUTED_NATIVE_RECORD_V1'
    ||digest!==inputs.nativeComponent?.executedRecordCanonicalSha256
    ||record.sourceCommit!==inputs.sdkCommit||record.SDKVersion!=='1.3.0-pq.3.32-auth.14'
    ||record.executed!==true||record.NAPI_VERSION!==8||record.headerVersion!=='22.13.1'
    ||record.noWalletPrivateStoreInputs!==true
    ||['NativeQualified','helperExecuted','helperRegistered','installed','GUI','SourceGranted','privateReleaseRowsGranted','accountKeysTouched'].some(k=>record[k]!==false)
    ||record.inputCounts?.Native!==71||record.inputCounts?.helperAdditional!==5||record.inputCounts?.allSupplied!==81
    ||record.nodeTUs?.length!==13||record.helperTUs?.length!==11
    ||record.normalNodeLoad?.exactSourceExports!==80||record.normalElectronLoad?.exactSourceExports!==80)
    throw Error('SDK14 original executed Native receipt differs.');
  const required=['NORMAL_NODE13_BUILD','NORMAL_HELPER11_BUILD','ACTUAL_NODE_NAPI_LOAD','ACTUAL_ELECTRON_NAPI_LOAD'];
  if(!required.every(phase=>record.actualSteps?.some(s=>s.phase===phase&&s.actualExit===0&&s.guard===null&&s.remaining?.length===0))
    ||['NODE','HELPER'].some(k=>record.ownedUndefined?.[k]?.ownedUndefined?.length!==0))
    throw Error('SDK14 Native compilation/load evidence differs.');
  const commands=record.actualCompilerDrivers;
  if(commands?.length!==2||!commands.every(c=>c.normalPlanArgvExact===true)
    ||!commands.some(c=>c.role==='node'&&c.translationUnits===13)
    ||!commands.some(c=>c.role==='helper'&&c.translationUnits===11))throw Error('SDK14 compiler provenance differs.');
  for(const role of ['node','helper']){
    const argv=commands.find(c=>c.role===role).actual.argv;
    const units=role==='node'?record.nodeTUs:record.helperTUs;
    if(!Array.isArray(argv)||!argv[0]?.endsWith('/clang++')||units.some(p=>!argv.includes(p))
      ||!argv.includes('-mmacosx-version-min=13.0')||!argv.some((v,i)=>v==='-framework'&&argv[i+1]==='ServiceManagement'))
      throw Error('SDK14 actual compiler closure differs.');
  }
  const helper=inputs.helperComponent;
  for(const k of ['helper','helperPlist']){
    const pin=helper?.[k],actual=record.artifacts[k];
    if(!pin||actual?.path!==join(record.sourceRoot,pin.path)||actual.bytes!==pin.bytes||actual.sha256!==pin.sha256)
      throw Error('SDK14 helper component differs.');
  }
  const node=commands.find(c=>c.role==='node').actual;
  return {schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,
    headerVersion:record.headerVersion,minimumSystemVersion:'13.0',readbackOnly:false,
    commandsKind:'executed-normal-build',appSigned:false,nativeQualified:false,registrationAccepted:false,
    architectures:['arm64'],sourceRoot:record.sourceRoot,headerRoot:record.headerCopyRoot,
    relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},
    commands:[{tool:'/usr/bin/clang++',actualTool:node.argv[0],argv:node.argv.slice(1)}],
    inputFiles:record.inputFiles,headers:record.header5.map(p=>({...p,relative:basename(p.path)})),
    output:{...record.artifacts.module,relative:'apps/wallet-desktop/native/original-auth-identity.node'},
    originalExecutedRecordSchema:record.schema};
}
