// New image installation/shared-materialization composition only.
// No Auth29/6, original pair4, Native, Root, service or old math rerun.
import path from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
const pkg=path.join(fileURLToPath(new URL('../../',import.meta.url)),'packages/wallet-auth');
const commands=[['--test','--test-concurrency=1','test/runtime-image-commissioning-install.test.mjs','test/runtime-image-commissioning-postprocess.test.mjs'],['node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','test/runtime-image-commissioning-install.types.mts']];
for(const args of commands){const r=spawnSync(process.execPath,args,{cwd:pkg,stdio:'inherit',timeout:600000,env:{...process.env,NODE_OPTIONS:''}});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
