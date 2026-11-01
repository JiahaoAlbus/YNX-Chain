import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),pkg=join(root,'packages/wallet-auth');
function run(args,cwd=root){const r=spawnSync(process.execPath,args,{cwd,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error(`NORMAL_CONSUMER_FAILED status=${r.status} signal=${r.signal}`);}
run(['scripts/ci/wallet-ide-v4-connection.mjs']);
run(['--test','packages/wallet-auth/test/server-current-host-construction.test.mjs']);
run(['packages/wallet-auth/node_modules/typescript/bin/tsc','--strict','--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','packages/wallet-auth/test/server-current-host-startup.types.mts']);
run(['--check','packages/wallet-auth/scripts/ynx-wallet-gatewayd.mjs']);
run(['--input-type=module','-e',`const m=await import('@ynx-chain/wallet-auth/original-wallet-ide-v4-connection');const o=m.openOriginalWalletIDEV4Connection();if(o.statusDATA().connected!==false)throw Error('false connected');await o.close();console.log('actual normal package import and empty owner cleanup passed; no Native acquisition');`],pkg);
run(['--conditions=browser','--input-type=module','-e',`try{await import('@ynx-chain/wallet-auth/original-wallet-ide-v4-connection');throw Error('browser exposed')}catch(e){if(e.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw e;console.log('browser package export correctly refused')}`],pkg);
console.log(JSON.stringify({node:process.version,newOrchestrationControls:16,newHostConstructorControls:6,strictNoSkipLibCheck:true,actualNormalPackageImport:true,browserRefused:true,NativeAcquired:false,RootAdmission:false,realLogin:false,realRestore:false,realRevoke:false}));
