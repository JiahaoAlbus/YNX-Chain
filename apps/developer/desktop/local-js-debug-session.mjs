import { createServer } from 'node:net';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, realpath, lstat, chmod, unlink } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadSealedDebugPty } from './local-debug-session.mjs';
import { assertWorkspacePathIdentity } from './workspace-path-identity.mjs';
const exec = promisify(execFile), MAX_FRAME = 1024 * 1024;
export const JS_DEBUG_PINS = Object.freeze({
  'src/extension.js': '06ec7bec3fc7023f09c1ee2ebad2f0e360f62abb5ecc77401a89e4a8fa11b846',
  'src/bootloader.js': 'd5d4ca4d1e87d5840042a4ad93221bae84596d69c459e9c3d3210d77a4401ff2',
  'src/watchdog.js': 'c50e5a44dd4fde57fa2203c03cd29d550ed5e0d24895f23b936610bdf9759394',
});
const inside = (root,path) => path === root || path.startsWith(root+'/');
async function canonical(path,directory=false) {
  if (typeof path !== 'string' || resolve(path) !== path || await realpath(path) !== path) throw Error('JavaScript debug path must be canonical');
  const stat = await lstat(path);if(stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw Error('JavaScript debug path is not regular');return stat;
}
async function projectSource(root,unit) {
  let path=root;for(const part of unit.split('/')){if(!part||part==='.'||part==='..')throw Error('Invalid JavaScript source path');path=join(path,part);const stat=await lstat(path);if(stat.isSymbolicLink()||(path!==join(root,unit)&&!stat.isDirectory()))throw Error('JavaScript source has a symbolic ancestor');}
  const stat=await lstat(path);if(!stat.isFile())throw Error('JavaScript entry source is not a regular file');return stat;
}
export function trustedJsNodeAncestor(path,stat) {
  if(stat.isSymbolicLink()||!stat.isDirectory()||![0,process.getuid()].includes(stat.uid))return false;
  // macOS's system installation parent is root:admin 0775. App internals
  // remain protected by their normal owner/mode and sealed byte checks.
  return !(stat.mode&0o022)||(path==='/Applications'&&stat.uid===0&&stat.gid===80&&(stat.mode&0o777)===0o775);
}
export function jsDebugSessionPolicy(base,port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !base.includes('(deny network*)')) throw Error('Invalid JavaScript debug endpoint allocation');
  return base + `\n(allow network-bind (local ip "localhost:${port}"))\n(allow network-inbound (local ip "localhost:${port}"))\n(allow network-outbound (remote ip "localhost:${port}"))`;
}
export async function createJsDebugSessionSupervisor({ context, plugins, runtime, basePolicy, pathIdentities = [], deadlineMs = 30*60*1000, warn = console.error }) {
  await canonical(context.workspace,true);await canonical(context.ipcTemporary,true);
  const extension = join(plugins,'ms-vscode.js-debug-1.140.0');await canonical(extension,true);
  const metadata = JSON.parse(await readFile(join(extension,'package.json'),'utf8'));
  if(metadata.publisher!=='ms-vscode'||metadata.name!=='js-debug'||metadata.version!=='1.140.0')throw Error('Unsupported official JavaScript debugger identity');
  for(const [name,pin] of Object.entries(JS_DEBUG_PINS)) {await canonical(join(extension,name));if(createHash('sha256').update(await readFile(join(extension,name))).digest('hex')!==pin)throw Error('Official JavaScript debugger bytes changed');}
  const alias = join(dirname(process.execPath),'ynx-js-node');
  const aliasStat=await canonical(alias),nodeStat=await canonical(process.execPath);
  if(aliasStat.uid!==nodeStat.uid||(aliasStat.mode&0o022)||!(aliasStat.mode&0o111))throw Error('The sealed JavaScript Node entry is not trusted');
  for(let directory=dirname(alias);;directory=dirname(directory)){
    const stat=await lstat(directory);if(!trustedJsNodeAncestor(directory,stat))throw Error('The sealed JavaScript Node entry has a writable ancestor');if(directory==='/')break;
  }
  const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
  if(await sha(alias)!==await sha(process.execPath))throw Error('The JavaScript Node entry differs from the sealed runtime');
  const version=await exec(alias,['--version'],{env:{OPENSSL_CONF:'/dev/null',PATH:dirname(process.execPath)},timeout:5000,maxBuffer:1024});
  if(version.stdout.trim()!==process.version)throw Error('The JavaScript Node entry version differs');
  const aliasAfter=await lstat(alias);if(aliasAfter.dev!==aliasStat.dev||aliasAfter.ino!==aliasStat.ino||aliasAfter.size!==aliasStat.size||aliasAfter.mtimeMs!==aliasStat.mtimeMs)throw Error('The JavaScript Node entry changed during validation');
  const workspaceProof=pathIdentities.find(proof=>proof.canonical===context.workspace);if(!workspaceProof)throw Error('JavaScript debugging requires verified project paths');await assertWorkspacePathIdentity(workspaceProof);
  const sourceMapping=workspaceProof.paths.length===2?{localRoot:context.workspace,remoteRoot:workspaceProof.paths[1]}:undefined;
  const pty = await loadSealedDebugPty();
  const credential = randomBytes(32).toString('hex'), path = join(context.ipcTemporary,'js-debug.sock');
  const launches = new Map(), leased = new Set(), connections = new Set();let stopped=false, preparing=0, faulted=false;
  async function allocatePort() {
    const reservation=createServer();await new Promise((ok,bad)=>{reservation.once('error',bad);reservation.listen(0,'127.0.0.1',ok);});
    const port=reservation.address().port;await new Promise(ok=>reservation.close(ok));if(leased.has(port))return allocatePort();leased.add(port);return port;
  }
  async function retire(entry) {
    if(entry.stopping)return entry.stopping;
    entry.stopping=(async()=>{
      clearTimeout(entry.timer);let failure;
      if(entry.child && !entry.closed) {
        try {await exec(join(runtime.root,'lib/backend/ynx-process-tree'),[String(entry.child.pid),'--force'],{timeout:5000});}catch(error){failure=error;}
        await Promise.race([entry.done,new Promise(ok=>setTimeout(ok,1000))]);if(!entry.closed)failure ||= Error('JavaScript target exit was not verified');
        }
      entry.data?.dispose();entry.exit?.dispose();
      launches.delete(entry.id);if(!failure)leased.delete(entry.port);
      if(failure){faulted=true;throw Error('JavaScript cleanup is unverified; endpoint lease retained: '+failure.message);}
    })();return entry.stopping;
  }
  function prepare(consoleMode,noDebug) {
    if(stopped||faulted||launches.size+preparing>=8||leased.size>=32)throw Error('JavaScript debug session admission is unavailable');
    if(!['internalConsole','integratedTerminal'].includes(consoleMode))throw Error('External JavaScript terminals are not supported by the local sandbox');
    preparing++;return allocatePort().then(port=>{
      if(stopped){leased.delete(port);throw Error('JavaScript supervisor stopped');}
      const entry={id:randomUUID(),port,consoleMode,noDebug:noDebug===true,phase:'prepared'};entry.timer=setTimeout(()=>retire(entry).catch(warn),30000);entry.timer.unref();launches.set(entry.id,entry);return entry;
    }).finally(()=>{preparing--;});
  }
  const server=createServer(socket=>{
    connections.add(socket);socket.setEncoding('utf8');let buffer='',entry,guard=false,chain=Promise.resolve();const reply=value=>{if(!socket.destroyed)socket.write(JSON.stringify(value)+'\n');};
    const cleanup=()=>{connections.delete(socket);if(entry)retire(entry).catch(warn);};socket.on('error',()=>{});socket.on('close',cleanup);
    socket.on('data',chunk=>{buffer+=chunk;if(Buffer.byteLength(buffer)>MAX_FRAME){socket.destroy();return;}
      for(let end;(end=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);chain=chain.then(async()=>{
        const message=JSON.parse(line);
        if(!entry && message.op!=='input' && message.op!=='resize' && message.op!=='stop') {
          if(message.credential!==credential||message.projectId!==context.id||stopped)throw Error('JavaScript debug project admission was refused');
          if(message.op==='guard'){
            entry=launches.get(message.launchId);if(!entry||entry.phase!=='running'||entry.guard||entry.child?.pid!==message.pid)throw Error('JavaScript guardian binding was refused');entry.guard=socket;guard=true;reply({kind:'target',args:entry.targetArgs,cwd:entry.targetCwd,env:entry.targetEnv,executable:entry.noDebug?process.execPath:alias});return;
          }
          if(message.op==='cancel'){const selected=launches.get(message.launchId);if(selected)await retire(selected);reply({kind:'cancelled'});return;}
          if(message.op==='prepare'){if(sourceMapping && message.program){const supplied=resolve(message.cwd||context.workspace,message.program);const root=workspaceProof.paths.find(path=>inside(path,supplied));if(!root)throw Error('JavaScript entry source is outside its verified project');const unit=relative(root,supplied);const a=await projectSource(sourceMapping.localRoot,unit),b=await projectSource(sourceMapping.remoteRoot,unit);if(a.isSymbolicLink()||b.isSymbolicLink()||!a.isFile()||!b.isFile()||a.dev!==b.dev||a.ino!==b.ino)throw Error('JavaScript entry source alias changed');await assertWorkspacePathIdentity(workspaceProof);}const prepared=await prepare(message.console,message.noDebug);reply({kind:'prepared',launchId:prepared.id,sourceMapping});return;}
          if(message.op!=='start')throw Error('Invalid JavaScript debug request');
          entry=launches.get(message.launchId);if(!entry||entry.phase!=='prepared')throw Error('JavaScript launch request expired or was replayed');
          let cwd=await realpath(message.cwd);
          if(workspaceProof){await assertWorkspacePathIdentity(workspaceProof);const alias=workspaceProof.paths.find(path=>inside(path,cwd));if(alias)cwd=join(context.workspace,relative(alias,cwd));}
          if(!inside(context.workspace,cwd))throw Error('JavaScript target working directory is outside its project');await canonical(cwd,true);
          if(!Array.isArray(message.args)||message.args.length>1024||message.args.some(x=>typeof x!=='string'||x.includes('\0'))||Buffer.byteLength(JSON.stringify(message.args))>128*1024)throw Error('Invalid JavaScript target arguments');
          const env=message.env;if(!env||typeof env!=='object'||Array.isArray(env)||Object.keys(env).length>256||Object.entries(env).some(([k,v])=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)||typeof v!=='string'||v.includes('\0')||v.length>65536))throw Error('Invalid JavaScript target environment');
          if(message.args.some(x=>/^--(?:inspect(?:-brk|-wait|-port)?|debug(?:-brk|-port)?)(?:=|$)/.test(x))||/(?:^|\s)--(?:inspect(?:-brk|-wait|-port)?|debug(?:-brk|-port)?)(?:=|\s|$)/.test(env.NODE_OPTIONS||''))throw Error('A user-specified Inspector endpoint conflicts with supervised local debugging');
          if(!entry.noDebug){const options=JSON.parse((env.VSCODE_INSPECTOR_OPTIONS||'').split(':::').reverse().find(value=>value)||'null');if(!options||typeof options.inspectorIpc!=='string'||!inside(context.ipcTemporary,options.inspectorIpc)||!String(env.NODE_OPTIONS||'').includes(join(extension,'src/bootloader.js')))throw Error('The official JavaScript bootloader is required');const socketStat=await lstat(options.inspectorIpc);if(await realpath(options.inspectorIpc)!==options.inspectorIpc||socketStat.isSymbolicLink()||!socketStat.isSocket()||socketStat.uid!==process.getuid())throw Error('Official Inspector IPC is not an owned socket');}
          const targetEnv={...env};
          if(entry.noDebug){
            // The official adapter injects its bootloader even for noDebug.
            // Remove only this known preload, preserving all user Node flags
            // and preloads. Clearing its control environment also makes any
            // official compatibility shim inert without removing user code.
            const bootloader=join(extension,'src/bootloader.js');
            for(const preload of [` --require ${bootloader} `,` --require "${bootloader}" `]){
              if(targetEnv.NODE_OPTIONS?.startsWith(preload)){targetEnv.NODE_OPTIONS=targetEnv.NODE_OPTIONS.slice(preload.length);break;}
            }
            delete targetEnv.VSCODE_INSPECTOR_OPTIONS;
          }else{const parts=env.VSCODE_INSPECTOR_OPTIONS.split(':::');const last=parts.findLastIndex(value=>value);const options=JSON.parse(parts[last]);options.execPath=join(resolve(process.execPath,'..'),'local-js-debug-launcher.sh');parts[last]=JSON.stringify(options);targetEnv.VSCODE_INSPECTOR_OPTIONS=parts.join(':::');}
          for(const key of Object.keys(targetEnv))if(key.startsWith('YNX_JS_DEBUG_')||key==='YNX_JS_ORIGINAL_NODE_OPTIONS')delete targetEnv[key];
          for(const key of ['TMPDIR','TMP','TEMP','XDG_RUNTIME_DIR'])targetEnv[key]=context.ipcTemporary;
          for(const proof of pathIdentities)await assertWorkspacePathIdentity(proof);
          clearTimeout(entry.timer);entry.phase='running';entry.timer=setTimeout(()=>retire(entry).catch(warn),deadlineMs);entry.timer.unref();
          entry.targetArgs=[...(entry.noDebug?[]:[`--inspect=127.0.0.1:${entry.port}`]),...message.args];entry.targetEnv=targetEnv;entry.targetCwd=cwd;
          const guardianEnv={...targetEnv,YNX_JS_DEBUG_SOCKET:path,YNX_JS_DEBUG_CREDENTIAL:credential,YNX_JS_DEBUG_LAUNCH:entry.id,YNX_LOCAL_PROJECT_ID:context.id};delete guardianEnv.NODE_OPTIONS;delete guardianEnv.VSCODE_INSPECTOR_OPTIONS;
          const argv=['-p',entry.noDebug?basePolicy:jsDebugSessionPolicy(basePolicy,entry.port),process.execPath,join(resolve(process.execPath,'..'),'local-js-debug-launcher.mjs'),'--ynx-guardian'];
          const output=(stream,data)=>reply({kind:'output',stream,data:Buffer.from(data).toString('base64')});
          let resolveDone;entry.done=new Promise(ok=>resolveDone=ok);
          const ended=(code,signal)=>{if(entry.closed)return;entry.closed=true;resolveDone();reply({kind:'exit',code:entry.targetExit?.code??undefined,signal:entry.targetExit?.signal??signal});retire(entry).catch(warn);};
          if(entry.consoleMode==='integratedTerminal') {entry.child=pty.spawn('/usr/bin/sandbox-exec',argv,{cwd,env:guardianEnv,cols:80,rows:24,name:'xterm-256color'});entry.data=entry.child.onData(data=>output('stdout',data));entry.exit=entry.child.onExit(event=>ended(event.exitCode,event.signal));}
          else {entry.child=spawn('/usr/bin/sandbox-exec',argv,{cwd,env:guardianEnv,detached:true,stdio:['pipe','pipe','pipe']});entry.child.stdout.on('data',data=>output('stdout',data));entry.child.stderr.on('data',data=>output('stderr',data));entry.child.once('error',error=>{reply({kind:'error',message:error.message});ended(undefined);});entry.child.once('close',ended);}
          reply({kind:'ready',pid:entry.child.pid});return;
        }
        if(!entry||entry.phase!=='running')throw Error('JavaScript target is not active');
        if(guard){if(message.op!=='target-exit'||entry.targetExit)throw Error('Invalid guardian result');if(!(message.code===null||Number.isInteger(message.code)&&message.code>=0&&message.code<=255)&&!message.error)throw Error('Invalid guardian exit code');entry.targetExit={code:message.code,signal:message.signal};await retire(entry);return;}
        if(message.op==='stop'){await retire(entry);return;}
        if(message.op==='input'){if(typeof message.data!=='string'||message.data.length>131072||!/^[A-Za-z0-9+/]*={0,2}$/.test(message.data))throw Error('Invalid JavaScript target input');const bytes=Buffer.from(message.data,'base64');if(entry.consoleMode==='integratedTerminal')entry.child.write(bytes.toString('utf8'));else entry.child.stdin.write(bytes);return;}
        if(message.op==='resize'){if(!Number.isInteger(message.columns)||!Number.isInteger(message.rows)||message.columns<1||message.columns>1000||message.rows<1||message.rows>1000)throw Error('Invalid JavaScript terminal size');if(entry.consoleMode==='integratedTerminal')entry.child.resize(message.columns,message.rows);return;}
        throw Error('Unsupported JavaScript debug request');
      }).catch(error=>{reply({kind:'error',message:error.message});socket.end();});}
    });
  });
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(path,ok);});await chmod(path,0o600);
  return {path,credential,activeSessions:()=>launches.size,sessionStates:()=>[...launches.values()].map(entry=>({phase:entry.phase,pid:entry.child?.pid,closed:entry.closed,stopping:!!entry.stopping,targetExit:entry.targetExit})),async stop(){stopped=true;const results=await Promise.allSettled([...launches.values()].map(retire));for(const socket of connections)socket.destroy();await new Promise(ok=>server.close(ok));try{await unlink(path);}catch(error){if(error.code!=='ENOENT')throw error;}const errors=results.filter(x=>x.status==='rejected').map(x=>x.reason);if(errors.length)throw new AggregateError(errors,'JavaScript session cleanup failed');}};
}
