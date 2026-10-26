import {createHash} from 'node:crypto';
import {join} from 'node:path';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=m=>{throw Error('SDK48 component '+m);};
function inventory(actual,expected){
 if(!Array.isArray(actual)||actual.length!==expected.length)fail('input count differs.');
 const pins=new Map(expected.map(p=>[p.path,p])),seen=new Set();
 for(const row of actual){const p=pins.get(row.relative);if(!p||seen.has(row.relative)||p.bytes!==row.bytes||p.sha256!==row.sha256)fail('input pin differs.');seen.add(row.relative);}
}
function scan(value,output){if(value?.tool!=='/usr/bin/nm'||!same(value.argv,['-u',output])||value.rejectPattern!=='YNX|ynx'||value.exit!==0||!same(value.ownedUndefined,[]))fail('undefined-symbol scan differs.');}
export function validateSDK48NativeComponent(record,inputs){
 if(inputs.nativeBuildQualification?.state!=='ACTUAL_EXECUTED_SDK48_RECORD'||inputs.nativeBuildQualification.strictToolchainIdentityQualified!==false||inputs.nativeBuildQualification.compileReuseAdmitted!==false)fail('actual matching record qualification differs.');
 if(inputs.nativeBuildInputs?.length!==115||inputs.requiredBuild?.helperInputs?.length!==107||inputs.requiredBuild?.NativeSupplierFiles!==102||inputs.requiredBuild?.helperSupplierFiles!==5)fail('SDK48 paired source count differs.');
 if(inputs.sdkVersion!=='1.3.0-pq.3.32-auth.48'||inputs.requiredBuild?.nodeTU!==18||inputs.requiredBuild?.helperTU!==11)fail('selection differs.');
 if(hash(record)!==inputs.nativeComponent.executedRecordCanonicalSha256)fail('producer record differs.');
 const root=inputs.requiredBuild.normalPlanSourceRoot,helper=record.helperBuild;
 if(typeof root!=='string'||!root.startsWith('/')||!inputs.requiredBuild.normalPlans?.node?.commands||!inputs.requiredBuild.normalPlans?.helper?.commands||!inputs.nativeComponent||!inputs.helperComponent)fail('original executed producer not supplied.');
 if(record.schemaVersion!==1||record.kind!=='YNX_WALLET_ORIGINAL_NATIVE_BUILD'||record.sourceRoot!==root||record.readbackOnly!==false||record.commandsKind!=='executed-normal-build'||record.appSigned!==false||record.nativeQualified!==false||record.registrationAccepted!==false||!same(record.exitCodes,[0])||!same(record.architectures,['arm64']))fail('executed build boundary differs.');
 if(!same(record.commands,inputs.requiredBuild.normalPlans.node.commands))fail('Node command differs.');
 if(inputs.requiredBuild.nodeUnits.length!==18||!same(inputs.requiredBuild.normalPlans.node.sources,inputs.requiredBuild.nodeUnits.map(p=>join(root,p))))fail('Node TU order differs.');
 inventory(record.inputFiles,inputs.nativeBuildInputs);
 const sourcePath='integration/SDK332_R140_NATIVE_COMPATIBILITY.json';
 const sourcePin=inputs.files.find(p=>p.path===sourcePath);
 if(!sourcePin||record.sourceInventory?.relative!=='packages/wallet-auth/'+sourcePin.path||record.sourceInventory.bytes!==sourcePin.bytes||record.sourceInventory.sha256!==sourcePin.sha256)fail('source inventory differs.');
 for(const [row,pin] of [[record.output,inputs.nativeComponent.module],[helper?.output,inputs.helperComponent.helper],[helper?.plist,inputs.helperComponent.helperPlist]])if(!row||row.relative!==pin.path||row.bytes!==pin.bytes||row.sha256!==pin.sha256)fail('output pin differs.');
 if(helper?.kind!=='YNX_WALLET_ORIGINAL_HELPER_BUILD/v1'||helper.sourceRoot!==root||helper.readbackOnly!==false||helper.commandsKind!=='executed-normal-build'||helper.executed!==true||helper.serviceRegistered!==false||helper.installed!==false||helper.nativeQualified!==false||helper.appSigned!==false||!same(helper.exitCodes,[0])||!same(helper.architectures,['arm64'])||helper.packagedOutput!=='apps/wallet-desktop/native/YNXIdentityReceiver')fail('helper boundary differs.');
 if(!same(helper.commands,inputs.requiredBuild.normalPlans.helper.commands))fail('helper command differs.');
 inventory(helper.inputFiles,inputs.requiredBuild.helperInputs);
 scan(record.ownedUndefinedScan,join(root,record.output.relative));scan(helper.ownedUndefinedScan,join(root,helper.output.relative));
 const union=record.runtimeUnion,pin=inputs.runtimeClosure.contractRelay.manifest;
 if(union?.bytes!==pin.bytes||union.sha256!==pin.sha256||union.files!==9434||union.filesVerified!==9434||!Number.isSafeInteger(inputs.runtimeClosure.contractRelay.totalBytes)||union.totalBytes!==inputs.runtimeClosure.contractRelay.totalBytes||union.sourceRoot!==join(root,'packages/wallet-auth')||['NativeAdmission','installedImageQualified','platformQualified','networkActivated'].some(k=>union[k]!==false))fail('full build runtime differs.');
 return record; // Preserve producer record and its original full-build closure.
}
