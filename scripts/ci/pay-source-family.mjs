// Existing SDK CI delta only; no Native/service/Go/legacy matrix execution.
import {spawnSync} from 'node:child_process';import{fileURLToPath}from'node:url';import path from'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),pkg=path.join(root,'packages/wallet-auth');
const commands=[['--test','test/pay-source-family.test.mjs','test/pay-source-boundary.test.mjs'],['node_modules/typescript/bin/tsc','--strict','--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--skipLibCheck','test/pay-source-family.types.mts']];
for(const args of commands){const r=spawnSync(process.execPath,args,{cwd:pkg,stdio:'inherit',env:process.env,timeout:120000});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
