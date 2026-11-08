// New registration difference controls only. Models do not supply Native/Root.
import fs from'node:fs';import os from'node:os';import path from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
const root=fileURLToPath(new URL('../..',import.meta.url)),pkg=path.join(root,'packages/wallet-auth'),out=process.env.YNX_REGISTRATION_TEST_OUT??fs.mkdtempSync(path.join(os.tmpdir(),'ynx-registration-private-'));fs.mkdirSync(out,{recursive:true});
function run(args){const r=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,YNX_REGISTRATION_TEST_OUT:out},stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1)}
run([pkg+'/scripts/build-original-device-v4-registration-private-bundle.mjs','--out='+out]);
for(const name of ['registration-orchestration-portable-delta.test.mjs','registration-http-response-data-delta.test.mjs','registration-native-http-custody-model.test.mjs','registration-native-shapes-delta.test.mjs','registration-private-factory-model.test.mjs'])run([pkg+'/test/'+name]);
run([pkg+'/node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','false','--exactOptionalPropertyTypes','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',pkg+'/test/types/registration-private-native.mts']);
fs.writeFileSync(out+'/PUBLIC_CI_RESULT.json',JSON.stringify({newGroups:5,strictTypes:true,actualEmittedBundle:true,NativeHostModelOnly:true,HermesExecuted:false,NativeInstallerExecuted:false,actualHTTPS:false,RootAdmission:false,SourceAdmission:false},null,2)+'\n');
