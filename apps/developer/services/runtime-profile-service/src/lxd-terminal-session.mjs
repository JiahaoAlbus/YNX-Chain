import { randomBytes, createHash } from "node:crypto";

const ROOT = "/var/lib/ynx-terminal-sessions";
export function terminalIdentity({ owner, runtimeId, projectId, sessionId }) {
  if (!owner || !/^[a-f0-9]{24}$/.test(runtimeId) || !/^[A-Za-z0-9_-]{1,160}$/.test(projectId) || !/^[0-9a-f-]{36}$/.test(sessionId)) throw new Error("Invalid terminal identity");
  return { version: 1, token: randomBytes(24).toString("hex"), ownerHash: createHash("sha256").update(owner).digest("hex"), runtimeId, projectId, sessionId };
}
export function validateTerminalIdentity(value) {
  if (!value || value.version !== 1 || !/^[a-f0-9]{48}$/.test(value.token) || !/^[a-f0-9]{64}$/.test(value.ownerHash) || !/^[a-f0-9]{24}$/.test(value.runtimeId) || !/^[A-Za-z0-9_-]{1,160}$/.test(value.projectId) || !/^[0-9a-f-]{36}$/.test(value.sessionId)) throw Object.assign(new Error("This terminal has no verified process identity; its workspace remains protected."), { code: "remote_terminal_recovery_required", status: 409 });
  return value;
}

// Executed only as container root through the protected LXD client. The shell
// runs as an unprivileged user in a system service cgroup. Unlike a process
// group, this also contains children that call setsid(). User code cannot write
// the identity receipt or create/change this system unit.
export const TERMINAL_SESSION_PYTHON = String.raw`
import os,sys,json,stat,subprocess,time,tempfile,fcntl,pwd
mode,raw=sys.argv[1:3]
i=json.loads(raw)
root='/var/lib/ynx-terminal-sessions'
unit='ynx-terminal-'+i['token']+'.service'
path=root+'/'+i['token']+'.json'
def fail(message): raise RuntimeError(message)
def protected(path, directory=False):
 s=os.lstat(path)
 if s.st_uid!=0 or s.st_mode&0o022 or stat.S_ISLNK(s.st_mode) or (directory and not stat.S_ISDIR(s.st_mode)): fail('Unprotected terminal receipt')
def write(value):
 fd,p=tempfile.mkstemp(dir=root);os.fchmod(fd,0o600)
 with os.fdopen(fd,'w') as f: json.dump(value,f);f.flush();os.fsync(f.fileno())
 os.replace(p,path)
 fd=os.open(root,os.O_RDONLY);os.fsync(fd);os.close(fd)
def show():
 p=subprocess.run(['systemctl','show',unit,'--property=Id,LoadState,ActiveState,SubState,ControlGroup,ExecMainPID,ExecMainStartTimestampMonotonic'],capture_output=True,text=True,timeout=8)
 if p.returncode: fail('Unit inspection failed')
 return dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)
def empty(group):
 if not group or not group==('/system.slice/'+unit) or '..' in group: fail('Invalid terminal cgroup')
 target='/sys/fs/cgroup'+group
 if not os.path.exists(target): return True
 for d,dirs,files in os.walk(target):
  if 'cgroup.procs' in files and open(d+'/cgroup.procs').read().strip(): return False
 return True
if os.geteuid()!=0: fail('Protected terminal supervisor must run as root')
# Validate the entire protected directory chain and the exact project root.
for parent in ['/var','/var/lib']: protected(parent,True)
if os.path.lexists(root): protected(root,True)
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
if mode=='preflight':
 import shutil
 protected('/workspaces',True)
 workspace='/workspaces/'+i['projectId']
 if os.path.islink(workspace) or not os.path.isdir(workspace) or os.path.realpath(workspace)!=workspace: fail('Unsafe project root')
 if open('/proc/1/comm').read().strip()!='systemd' or not os.path.isfile('/sys/fs/cgroup/cgroup.controllers'): fail('Systemd with cgroup v2 is required')
 for command in ['systemd-run','systemctl','useradd','python3']:
  if not shutil.which(command): fail('Required supervisor command unavailable: '+command)
 subprocess.run(['systemctl','show','--property=Version'],check=True,capture_output=True,timeout=8)
 print(json.dumps({'systemd':True,'cgroupV2':True,'supervisorCommands':True}));sys.exit(0)
if mode=='prepare':
 os.makedirs(root,mode=0o700,exist_ok=True);protected(root,True)
 protected('/workspaces',True)
 workspace='/workspaces/'+i['projectId']
 if os.path.islink(workspace) or not os.path.isdir(workspace) or os.path.realpath(workspace)!=workspace: fail('Unsafe project root')
 if open('/proc/1/comm').read().strip()!='systemd' or not os.path.isfile('/sys/fs/cgroup/cgroup.controllers'): fail('Systemd with cgroup v2 is required')
 if not os.path.isdir('/sys/fs/cgroup/system.slice'): fail('System service cgroups unavailable')
 lock=open(root+'/'+i['token']+'.lock','x');os.chmod(lock.name,0o600);lock.close()
 if os.path.lexists(path): fail('Terminal identity already exists')
 subprocess.run(['id','-u','ynx-terminal'],check=False,capture_output=True).returncode==0 or subprocess.run(['useradd','--system','--create-home','--shell','/bin/bash','ynx-terminal'],check=True)
 user=pwd.getpwnam('ynx-terminal')
 if user.pw_uid<=0 or user.pw_gid<=0 or set(os.getgrouplist('ynx-terminal',user.pw_gid))!={user.pw_gid}: fail('Terminal user has unexpected privilege groups')
 subprocess.run(['chown','-R','--no-dereference','ynx-terminal:ynx-terminal','/workspaces/'+i['projectId']],check=True)
 # Refuse images without a system manager rather than falling back to root bash.
 subprocess.run(['systemctl','show','--property=Version'],check=True,capture_output=True,timeout=8)
 write({'identity':i,'unit':unit,'boot':boot,'state':'prepared','group':'/system.slice/'+unit})
 print(json.dumps({'prepared':True}))
else:
 protected(root,True);protected(path)
 lock=open(root+'/'+i['token']+'.lock','r+');protected(lock.name);fcntl.flock(lock,fcntl.LOCK_EX)
 r=json.load(open(path))
 if r.get('identity')!=i or r.get('unit')!=unit or r.get('boot')!=boot: fail('Terminal identity changed')
 if mode=='launch':
  if r['state']!='prepared': fail('Terminal already launched')
  r['state']='launching';write(r);fcntl.flock(lock,fcntl.LOCK_UN)
  args=['systemd-run','--quiet','--pty','--wait','--unit='+unit,'--service-type=exec','--uid=ynx-terminal','--gid=ynx-terminal','--working-directory=/workspaces/'+i['projectId'],'--property=KillMode=control-group','--property=TimeoutStopSec=5s','--property=NoNewPrivileges=yes','--property=ProtectControlGroups=yes','--property=RestrictSUIDSGID=yes']
  env=json.loads(sys.argv[3])
  args+=['--setenv='+k+'='+v for k,v in env.items()]
  args+=['--setenv=TERM=xterm-256color','/bin/bash','-l']
  child=subprocess.Popen(args)
  while child.poll() is None:
   snapshot=show()
   timestamp=snapshot.get('ExecMainStartTimestampMonotonic','0')
   if timestamp.isdigit() and int(timestamp)>0:
    fcntl.flock(lock,fcntl.LOCK_EX)
    current=json.load(open(path))
    if current['state']=='launching' and not current.get('startTime'):
     current.update({'startTime':timestamp,'group':snapshot.get('ControlGroup') or current['group']});write(current)
    fcntl.flock(lock,fcntl.LOCK_UN)
   time.sleep(0.05)
  code=child.wait()
  fcntl.flock(lock,fcntl.LOCK_EX)
  r=json.load(open(path))
  if r['state']=='launching':
   r['launchExited']=True;r['launchCode']=code;write(r)
  sys.exit(code)
 elif mode=='stop':
  if r.get('state')=='prepared':
   r.update({'state':'stopped','startTime':'0'});write(r)
  if r.get('state')=='stopped':
   if not empty(r['group']): fail('Terminal children remain')
   print(json.dumps({'stopped':True,'identity':i,'startTime':r['startTime']}));sys.exit(0)
  s=show()
  started=s.get('ExecMainStartTimestampMonotonic','0')
  if s.get('LoadState')=='not-found' and r.get('launchExited') and empty(r['group']):
   r.update({'state':'stopped','startTime':r.get('startTime','0')});write(r)
   print(json.dumps({'stopped':True,'identity':i,'startTime':r['startTime']}));sys.exit(0)
  if s.get('Id')!=unit or s.get('LoadState')!='loaded' or not started.isdigit() or int(started)<=0: fail('No launched terminal identity')
  group=s.get('ControlGroup') or r.get('group')
  # Persist the observed start time before asking systemd to stop the exact unit.
  if r.get('startTime') and r['startTime']!=started: fail('Terminal unit was replaced')
  pid=s.get('ExecMainPID','0')
  if pid.isdigit() and int(pid)>0 and os.path.exists('/proc/'+pid+'/stat'):
   processStart=open('/proc/'+pid+'/stat').read().rsplit(')',1)[1].split()[19]
   if r.get('processStart') and r['processStart']!=processStart: fail('Terminal PID was reused')
   r['processStart']=processStart
  if not group: fail('No terminal cgroup proof')
  r.update({'startTime':started,'group':group});write(r)
  subprocess.run(['systemctl','stop',unit],check=True,timeout=10)
  s=show()
  if s.get('ActiveState') not in ('inactive','failed') or not empty(group): fail('Terminal children remain')
  r['state']='stopped';write(r)
  print(json.dumps({'stopped':True,'identity':i,'startTime':started}))
 else: fail('Invalid supervisor operation')
`;

export function createLxdTerminalSessions({ run, environment }) {
  const call = async (mode, context) => {
    const identity = validateTerminalIdentity(context.terminalIdentity);
    if (context.containerName !== `ynx-${identity.ownerHash.slice(0,10)}-${identity.runtimeId}` || context.projectId !== identity.projectId) throw new Error("Terminal runtime identity mismatch");
    const result = await run("lxc", ["exec", context.containerName, "--", "python3", "-c", TERMINAL_SESSION_PYTHON, mode, JSON.stringify(identity)], { timeout: 25_000, maxBuffer: 64 * 1024, env: environment() });
    return JSON.parse(result.stdout);
  };
  return {
    preflight: context => call("preflight", context),
    prepare: context => call("prepare", context),
    launch(context) {
      const identity = validateTerminalIdentity(context.terminalIdentity);
      if (context.containerName !== `ynx-${identity.ownerHash.slice(0,10)}-${identity.runtimeId}` || context.projectId !== identity.projectId) throw new Error("Terminal runtime identity mismatch");
      return { command: "lxc", args: ["exec", context.containerName, "--mode", "interactive", "--", "python3", "-c", TERMINAL_SESSION_PYTHON, "launch", JSON.stringify(context.terminalIdentity), JSON.stringify(context.environment || {})], env: { ...environment(), TERM: "xterm-256color", COLORTERM: "truecolor" }, sandbox: { kind: "lxd-container", network: false, writableRoot: "workspace" } };
    },
    async stop(context) {
      try {
        const receipt = await call("stop", context);
        if (receipt.stopped !== true || JSON.stringify(receipt.identity) !== JSON.stringify(context.terminalIdentity)) throw new Error("Stop receipt identity mismatch");
        return receipt;
      } catch (cause) { throw Object.assign(new Error("Remote terminal stop could not be verified. Its files remain protected; retry Stop after checking runtime availability.", { cause }), { code: "remote_terminal_recovery_required", status: 409 }); }
    },
  };
}
