// Sole shared Social stdio DATA controls. No Auth helper/process or Native execution.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
function run(binary,args,cwd=root,env=process.env){const r=spawnSync(binary,args,{cwd,env,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error(`SOCIAL_STDIO_CI_CHILD_FAILED:${r.status}:${r.signal}`);}
run(process.execPath,['--test','test/social-principal-stdio-v1.test.mjs']);
run(process.execPath,['node_modules/typescript/bin/tsc','--strict','--noEmit','--target','es2022','--module','nodenext','--moduleResolution','nodenext','test/types/social-principal-stdio-v1.mts']);
run('go',['test','-v','-count=1','./...'],path.join(root,'native/social-principal-stdio-v1'),{...process.env,GOTOOLCHAIN:'local',GOWORK:'off',GOPROXY:'off',GOSUMDB:'off'});
