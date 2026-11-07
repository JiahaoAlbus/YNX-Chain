import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../../',import.meta.url);
for(const args of [
 ['--experimental-vm-modules','--test',fileURLToPath(new URL('test/ide-finite-get-preproof-target-source.test.mjs',root))],
 [fileURLToPath(new URL('node_modules/typescript/bin/tsc',root)),'--strict','--noEmit','--target','es2022','--module','nodenext','--moduleResolution','nodenext',fileURLToPath(new URL('test/types/ide-finite-get-preproof-target-source.ts',root))]
]){const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0){process.exitCode=result.status??1;break;}}
