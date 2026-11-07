import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
for(const args of[['--test','test/desktop-grant-strong-continuation-intake.test.mjs'],['node_modules/typescript/bin/tsc','--strict','--noEmit','--target','es2022','--module','nodenext','--moduleResolution','nodenext','test/types/desktop-grant-strong-continuation.mts']]){const r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error('STRONG_CONTINUATION_NEW_INTAKE_FAILED:'+r.status)}
