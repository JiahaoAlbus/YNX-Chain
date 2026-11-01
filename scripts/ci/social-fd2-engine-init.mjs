import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const root=new URL('../../packages/wallet-auth/',import.meta.url),require=createRequire(new URL('package.json',root));
function run(args){const r=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(r.error)throw r.error;if(r.signal)throw Error('SOCIAL_FD2_SIGNAL:'+r.signal);if(r.status!==0)process.exit(r.status??1);}
run(['--test',fileURLToPath(new URL('test/social-fd2-engine-init.test.mjs',root))]);run([require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',fileURLToPath(new URL('test/social-fd2-engine-init.types.mts',root))]);
