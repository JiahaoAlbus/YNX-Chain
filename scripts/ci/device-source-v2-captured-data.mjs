// New captured DATA composition only. No Native/Go/Root or existing suite.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url)),pkg=root+'/packages/wallet-auth';
for(const args of [[pkg+'/test/device-source-v2-captured-data.test.mjs'],[pkg+'/node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','false','--exactOptionalPropertyTypes','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',pkg+'/test/device-source-v2-captured-data.types.mts']]){
 const r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);
}
