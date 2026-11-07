import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
for(const args of [['--test','test/desktop-grant-paired-finite3-intake.test.mjs'],['node_modules/typescript/bin/tsc','--strict','--noEmit','--target','es2022','--module','nodenext','--moduleResolution','nodenext','test/types/desktop-grant-paired-finite3.mts']]){const r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error('PAIRED_FINITE3_NEW_INTAKE_FAILED:'+r.status)}
