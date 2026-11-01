import {spawnSync} from 'node:child_process';import {resolve,dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),pkg=join(root,'packages/wallet-auth'),base=process.env.WALLET_AUTH_TEST_BASE_ROOT??pkg;
function run(args){const r=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,WALLET_AUTH_TEST_BASE_ROOT:base},timeout:120000});if(r.error)throw r.error;if(r.status!==0)throw Error(JSON.stringify({status:r.status,signal:r.signal}));}
if(!process.argv.includes('--types-only'))run(['--test',join(pkg,'test/device-v4-management-client.test.mjs'),join(pkg,'test/device-v4-management-client-math.test.mjs')]);
run([join(base,'node_modules/typescript/bin/tsc'),'--strict','--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',join(pkg,'test/device-v4-management-client.types.mts')]);console.log('MANAGEMENT_CLIENT_STRICT_TYPES_PASS five refusals noSkipLibCheck');
