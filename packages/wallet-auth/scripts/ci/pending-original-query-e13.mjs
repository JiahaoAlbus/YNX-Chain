// Only this new E13 DATA/shape/matching profile, never Core/Native old matrices.
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../../',import.meta.url));
const steps=[['pending-query-e13-data',['--test','test/pending-query-e13.test.mjs','test/pending-query-e13-envelope-header.test.mjs','test/pending-query-e13-core-interop.test.mjs']],['pending-query-e13-types',[fileURLToPath(import.meta.resolve('typescript/bin/tsc')),'--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','test/pending-query-e13.types.mts']]];
for(const [step,args]of steps){const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',maxBuffer:1048576});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);console.log(JSON.stringify({step,status:r.status,signal:r.signal,error:r.error?.code??null}));if(r.status!==0)process.exit(r.status??1);}
