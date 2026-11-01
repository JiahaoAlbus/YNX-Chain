#!/usr/bin/env node
// Isolated official upstream launcher; this is not a DAV implementation.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:net';
const dir=resolve(process.argv[2]||'');
if(!process.argv[2]||!dir.startsWith('/Volumes/'))throw new Error('Explicit external-volume isolation directory required');
const binary=join(dir,'upstream/rclone-v1.70.3-osx-arm64/rclone');
const hash=createHash('sha256').update(await readFile(binary)).digest('hex');
const version=await new Promise((ok,fail)=>{let text='';const child=spawn(binary,['version']);child.stdout.on('data',b=>text+=b);child.on('error',fail);child.on('exit',code=>code===0?ok(text):fail(new Error(`version exit ${code}`)))});
if(!version.startsWith('rclone v1.70.3\n'))throw new Error('Wrong upstream version');
await mkdir(join(dir,'data'),{recursive:true});await mkdir(join(dir,'cache'),{recursive:true});
const socket=createServer();await new Promise((ok,fail)=>{socket.on('error',fail);socket.listen(0,'127.0.0.1',ok)});const port=socket.address().port;await new Promise(ok=>socket.close(ok));
const username='p08-synthetic',password=randomBytes(24).toString('hex');
const args=['serve','webdav',join(dir,'data'),'--addr',`127.0.0.1:${port}`,'--config',join(dir,'upstream/empty.conf'),'--cache-dir',join(dir,'cache'),'--log-level','ERROR','--etag-hash','SHA256'];
await writeFile(join(dir,'upstream/empty.conf'),'# isolated, no user configuration\n',{mode:0o600});
const child=spawn(binary,args,{env:{PATH:process.env.PATH,HOME:dir,TMPDIR:join(dir,'cache'),RCLONE_USER:username,RCLONE_PASS:password},stdio:['ignore','ignore','pipe']});
let errors='';child.stderr.on('data',b=>errors+=b.toString());
const url=`http://127.0.0.1:${port}/`;
let ready=false;
for(let i=0;i<80;i++){try{const response=await fetch(url,{headers:{Authorization:'Basic '+Buffer.from(`${username}:${password}`).toString('base64')},signal:AbortSignal.timeout(1000)});await response.arrayBuffer();if(response.ok){ready=true;break}}catch{}await new Promise(ok=>setTimeout(ok,100))}
if(!ready){child.kill('SIGTERM');throw new Error('Official upstream failed to start: '+errors)}
const connection={url,username,password,pid:child.pid,launcherPid:process.pid,dataRoot:join(dir,'data'),version:'v1.70.3',binarySha256:hash};
await writeFile(join(dir,'connection.private.json'),JSON.stringify(connection,null,2),{mode:0o600});await chmod(join(dir,'connection.private.json'),0o600);
await writeFile(join(dir,'evidence/upstream-live.json'),JSON.stringify({...connection,username:undefined,password:undefined,versionOutput:version,command:{binary,args},startedAt:new Date().toISOString(),auth:'synthetic Basic auth; credentials only connection.private.json (0600)',server:'unmodified official release binary'},null,2));
console.log(JSON.stringify({ready:true,url,pid:child.pid,privateConnection:join(dir,'connection.private.json')}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',async code=>{await writeFile(join(dir,'evidence/upstream-exit.json'),JSON.stringify({code,at:new Date().toISOString()}));process.exitCode=code||0});
