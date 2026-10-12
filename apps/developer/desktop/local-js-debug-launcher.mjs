import { connect } from 'node:net';
// Public runtimeExecutable bridge only. The original official adapter still
// owns DAP/CDP, launch configuration, source maps, breakpoints and stepping.
// The guardian remains the live process-group leader after the true target
// closes. Only the supervisor's identity-checked TERM/force helper retires it.
if (process.argv[2] === '--ynx-watchdog') {
  const {lstat,realpath,readFile}=await import('node:fs/promises');
  const {createHash}=await import('node:crypto');const {createRequire}=await import('node:module');
  const file=process.argv[3],info=JSON.parse(process.env.NODE_INSPECTOR_INFO||'null');
  const stat=file&&await lstat(file),socket=info?.ipcAddress&&await lstat(info.ipcAddress);
  if(process.argv.length!==4||!file.endsWith('/ms-vscode.js-debug-1.140.0/src/watchdog.js')||await realpath(file)!==file||
      !stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o022)||stat.uid!==process.getuid()||
      createHash('sha256').update(await readFile(file)).digest('hex')!=='c50e5a44dd4fde57fa2203c03cd29d550ed5e0d24895f23b936610bdf9759394'||
      Number(info?.pid)!==process.ppid||!info.ipcAddress.startsWith('/private/tmp/yi-')||!socket.isSocket()||socket.uid!==process.getuid()||
      !/^ws:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\//.test(info.inspectorURL||''))throw Error('Official JavaScript watchdog admission was refused');
  process.argv=[process.execPath,file];createRequire(import.meta.url)(file);
} else if (process.argv[2] === '--ynx-guardian') {
  const { spawn } = await import('node:child_process');
  for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal,()=>{});
  const channel=connect(process.env.YNX_JS_DEBUG_SOCKET);channel.setEncoding('utf8');let buffer='',target;
  const send=value=>channel.write(JSON.stringify(value)+'\n');
  channel.on('connect',()=>send({op:'guard',credential:process.env.YNX_JS_DEBUG_CREDENTIAL,projectId:process.env.YNX_LOCAL_PROJECT_ID,launchId:process.env.YNX_JS_DEBUG_LAUNCH,pid:process.pid}));
  channel.on('error',()=>{if(target)target.kill('SIGTERM');});
  channel.on('data',data=>{buffer+=data;for(let end;(end=buffer.indexOf('\n'))>=0;){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(message.kind!=='target'||target)continue;
    target=spawn(message.executable,message.args,{cwd:message.cwd,env:message.env,stdio:'inherit'});
    target.once('error',error=>send({op:'target-exit',error:error.message}));
    target.once('close',(code,signal)=>send({op:'target-exit',code,signal}));
  }});
  channel.on('close',()=>{if(target)target.kill('SIGTERM');});
} else {
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') { process.stdout.write(process.version + '\n'); process.exit(0); }
const env = process.env;
if (env.YNX_WORKSPACE_MODE !== 'local' || !/^[a-f0-9]{64}$/.test(env.YNX_JS_DEBUG_CREDENTIAL || '') ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(env.YNX_LOCAL_PROJECT_ID || '') || !/^[a-f0-9-]{36}$/.test(env.YNX_JS_DEBUG_LAUNCH || '') ||
    !env.YNX_JS_DEBUG_SOCKET?.startsWith('/private/tmp/yi-') || Object.keys(env).some(key => key.startsWith('YNX_CORE_'))) {
  process.stderr.write('A current supervised local JavaScript launch is required.\n'); process.exit(64);
}
const socket = connect(env.YNX_JS_DEBUG_SOCKET);socket.setEncoding('utf8');
let buffer = '', finished = false, admitted = false, killTimer;
const send = message => { if (!socket.destroyed) socket.write(JSON.stringify(message) + '\n'); };
function stop() {
  if (finished) return;
  send({ op: 'stop' });process.stdin.pause();
  killTimer ||= setTimeout(() => { socket.destroy();process.exitCode = 1; }, 5000);
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, stop);
const input = data => send({ op: 'input', data: data.toString('base64') });
const resize = () => { if (process.stdout.isTTY) send({ op: 'resize', columns: process.stdout.columns, rows: process.stdout.rows }); };
function dispose() { clearTimeout(killTimer);process.stdin.off('data', input);process.stdout.off('resize', resize);process.stdin.pause(); }
socket.once('connect', () => send({ op: 'start', credential: env.YNX_JS_DEBUG_CREDENTIAL, projectId: env.YNX_LOCAL_PROJECT_ID,
  launchId: env.YNX_JS_DEBUG_LAUNCH, args, cwd: process.cwd(), env: { ...env, NODE_OPTIONS: env.YNX_JS_ORIGINAL_NODE_OPTIONS || '' } }));
socket.on('data', chunk => {
  buffer += chunk;if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) { process.stderr.write('JavaScript supervisor frame exceeded its bound.\n');stop();return; }
  for (let end;(end = buffer.indexOf('\n')) >= 0;) {
    const line = buffer.slice(0,end);buffer = buffer.slice(end+1);
    try {
      const message = JSON.parse(line);
      if (message.kind === 'ready') { admitted = true;process.stdin.on('data',input);process.stdin.resume();process.stdout.on('resize',resize);resize(); }
      else if (message.kind === 'output') (message.stream === 'stderr' ? process.stderr : process.stdout).write(Buffer.from(message.data,'base64'));
      else if (message.kind === 'exit') { finished = true;dispose();process.exitCode = Number.isInteger(message.code) ? message.code : 1;socket.end(); }
      else if (message.kind === 'error') { process.stderr.write('Local JavaScript launch: '+message.message+'\n');stop(); }
    } catch (error) { process.stderr.write('Invalid JavaScript supervisor response: '+error.message+'\n');stop(); }
  }
});
socket.on('error', error => { if (!finished) { process.stderr.write('Local JavaScript supervisor: '+error.message+'\n');process.exitCode = 1; }dispose(); });
socket.on('close', () => { if (!finished) { process.exitCode = 1;if (admitted) process.stderr.write('JavaScript supervisor closed before target exit.\n'); }dispose(); });

}
