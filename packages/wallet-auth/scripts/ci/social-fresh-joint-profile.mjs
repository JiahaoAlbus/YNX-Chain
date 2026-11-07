import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';import path from'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));function run(bin,args,cwd=root,env=process.env){const r=spawnSync(bin,args,{cwd,env,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error(`SOCIAL_FRESH_JOINT_CHILD_FAILED:${r.status}:${r.signal}`);}
run('go',['test','-v','-count=1','./...'],path.join(root,'native/social-fresh-joint-profile-v1'),{...process.env,GOTOOLCHAIN:'local',GOWORK:'off',GOPROXY:'off',GOSUMDB:'off'});
run(process.execPath,['node_modules/typescript/bin/tsc','--strict','--noEmit','--target','es2022','--module','nodenext','--moduleResolution','nodenext','test/types/social-fresh-joint-profile.mts']);
