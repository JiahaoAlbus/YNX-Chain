import {copyFile,mkdir,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {verifyPhysicalPin} from './next-product-supplier-input.mjs';
import {claimBuildOutput} from './build-output-root.mjs';

const source=fileURLToPath(new URL('../../..',import.meta.url));
const directory='apps/developer/desktop/macos';
const inputs=[
 ['main.m',191090,'13b5057996dd137757125d754f1413b43d660ed4d0d3286d4bd0c9eda593db95'],
 ['ynx-wallet-admission-parent.m',12296,'894c0ec9e19bc71832b77cb3ea6c708c62a50b046b6d1214f280bab4e4383ec8'],
 ['ynx-wallet-admission-parent.h',1486,'7d77c8967ecf40b744b91d15a7bf67fac1e36ba79c02e9e0ddec70475f2df18c'],
 ['ynx-desktop-profile.h',2522,'58fdc5770b85f9829a2ab199fc537f80783d35c4fb3ef35d2de196dc0575277b'],
 ['ynx-native-file-picker.h',2990,'2747180138294c08605a0e6e4edfc7b5bb2bcd51e811c043791687cbe7fc3e0d'],
 ['ynx-startup-failure.h',1153,'2c2f38521f8f3b37b701b31b1c936f455eb3e889136e317c1b32c62717a8dae8'],
 ['ynx-native-trash-broker.h',17462,'9a377bfcffbab1a13885051b9bff2f5007e704ba813c5fa6e168b0da6cbc1134'],
 ['ynx-wallet-admission-launch.h',14442,'9fe3d16252db36895a8121dc15d2ca03c5c62f1ff3f842ea58dce6bfb534598f'],
 ['ynx-wallet-device-bridge.h',50940,'f81e81930230316f5be12f5b76ac0ad25c7f0bb544748bb385ce15a75a960ac8']
];

// Main's quoted local headers must travel with the consumer translation units.
// The SDK-owned producer header remains in the independently pinned SDK input.
export async function stageNextNativeConsumerClosure(output){
 const rows=inputs.map(([name,bytes,sha256])=>({path:join(source,directory,name),relativePath:directory+'/'+name,bytes,sha256}));
 for(const row of rows)await verifyPhysicalPin(row);
 await claimBuildOutput(output);
 const destination=join(output,directory);await mkdir(destination,{recursive:true,mode:0o700});
 const staged=[];
 for(const row of rows){
  const path=join(output,row.relativePath);
  await copyFile(row.path,path,constants.COPYFILE_EXCL);
  staged.push({...await verifyPhysicalPin({...row,path}),relativePath:row.relativePath});
 }
 const result={schema:'YNX_P03_NEXT_NATIVE_CONSUMER_CLOSURE/v1',sourceCommit:'78fd22007abb49da54dd35c6699d4afaa99ede01',sourceRoot:source,output,consumerDirectory:destination,files:staged,SDKOwnedExternalHeader:'original-ide-cocoa-parent-producer.h',compilerExecuted:false,AppBuilt:false,RootAdmission:false,SourceAdmission:false};
 await writeFile(join(output,'CONSUMER_CLOSURE.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 return result;
}
