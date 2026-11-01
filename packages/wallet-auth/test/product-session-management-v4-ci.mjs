// New management profile only. No legacy matrix, Native build or real network.
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const steps=[['management-v4', ['--test','test/product-session-management-v4.test.mjs']],['management-v4-types',['node_modules/typescript/bin/tsc','--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','test/product-session-management-v4.types.mts']]];
for(const [name,args]of steps){const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',maxBuffer:1048576});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);console.log(JSON.stringify({step:name,exitCode:r.status,signal:r.signal,error:r.error?.code??null}));if(r.status!==0)process.exit(r.status??1);}
