// New Social L/C DATA + private-adapter MODEL controls only; no actual Root/Native/helper.
import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';import path from'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));function run(bin,args,cwd=root,env=process.env){const r=spawnSync(bin,args,{cwd,env,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error(`SOCIAL_LC_CHILD_FAILED:${r.status}:${r.signal}`);}
run(process.execPath,['--experimental-vm-modules','--test','test/social-directory-lc-header-budget.test.mjs','test/social-directory-lc-ack.test.mjs','test/social-directory-response-loan-adapter.test.mjs','test/social-directory-host-loan-bridge.test.mjs']);
run(process.execPath,['node_modules/typescript/bin/tsc','--strict','--noEmit','--target','es2022','--module','nodenext','--moduleResolution','nodenext','test/types/social-directory-lc-ack.mts','test/types/social-directory-response-loan.mts']);
run('go',['test','-v','-count=1','./...'],path.join(root,'native/social-directory-lc-v1'),{...process.env,GOTOOLCHAIN:'local',GOWORK:'off',GOPROXY:'off',GOSUMDB:'off'});
