import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const pkg=new URL('../../packages/wallet-auth/',import.meta.url),require=createRequire(new URL('package.json',pkg));
function run(args){const p=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(p.error)throw p.error;if(p.signal)throw Error('V6_OUTCOME_SIGNAL:'+p.signal);if(p.status!==0)process.exit(p.status??1);}
run(['--test',fileURLToPath(new URL('test/ai-task-v6-outcome.test.mjs',pkg))]);run([require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',fileURLToPath(new URL('test/ai-task-v6-outcome.types.mts',pkg))]);
