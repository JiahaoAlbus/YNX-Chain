import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=new URL('../../packages/wallet-auth/',import.meta.url),require=createRequire(new URL('package.json',root));
function run(args){const r=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(r.error)throw r.error;if(r.signal)throw Error(`V6_CLIENT_SIGNAL:${r.signal}`);if(r.status!==0)process.exit(r.status??1);}
run(['--test',fileURLToPath(new URL('test/ai-task-action-v6-review.test.mjs',root))]);
run([require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','esnext','--moduleResolution','bundler','--target','es2022','--lib','es2022,dom',fileURLToPath(new URL('test/ai-task-action-v6-review.types.mts',root))]);
