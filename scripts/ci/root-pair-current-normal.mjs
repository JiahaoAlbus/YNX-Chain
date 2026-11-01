import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const pkg=new URL('../../packages/wallet-auth/',import.meta.url),require=createRequire(new URL('package.json',pkg));
function run(args){const p=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(p.error)throw p.error;if(p.signal)throw Error('ROOT_PAIR_NORMAL_SIGNAL:'+p.signal);if(p.status!==0)process.exit(p.status??1);}
run(['--test',fileURLToPath(new URL('test/root-pair-current-normal.test.mjs',pkg))]);
run([require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',fileURLToPath(new URL('test/root-pair-current-normal.types.mts',pkg))]);
// The workflow runs the actual normal-package artifact checker once after these new cases/types.
