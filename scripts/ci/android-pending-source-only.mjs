// NEW pending-only models/types/bundle and canonical package are separate jobs.
// No old Android3/Node8 groups, Native build, Root/Source registration or App.
import fs from'node:fs';import os from'node:os';import path from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
const root=fileURLToPath(new URL('../..',import.meta.url)),pkg=path.join(root,'packages/wallet-auth'),out=process.env.YNX_PENDING_TEST_OUT??fs.mkdtempSync(path.join(os.tmpdir(),'ynx-android-pending-source-')),env={...process.env,YNX_PENDING_TEST_OUT:out,YNX_PENDING_BUNDLE:path.join(out,'PENDING_SOURCE_ONLY_COLLECTOR.bundle.js')};fs.mkdirSync(out,{recursive:true});
function run(args){const r=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
run([pkg+'/scripts/build-original-device-pending-source-private-bundle.mjs','--out='+out]);
for(const name of ['android-pending-source-integration.test.mjs','pending-v4-message-extraction.test.mjs','android-pending-private-bundle.test.mjs'])run([pkg+'/test/'+name]);
run([pkg+'/node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','false','--exactOptionalPropertyTypes','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',pkg+'/test/types/android-pending-source-private.mts']);
fs.writeFileSync(out+'/PUBLIC_CI_RESULT.json',JSON.stringify({pendingOnly:true,captureKind:4,typedValueFields:6,scopeFields:8,expectedFields:16,namespace:null,accountComparisonDATA:null,NodeVMAndPUBLICN1Only:true,HermesExecuted:false,CoreNativeExecuted:false,RootAdmission:false,SourceAdmission:false,NativeOnceConsumed:false},null,2)+'\n');console.log('Pending public source controls: '+out);
