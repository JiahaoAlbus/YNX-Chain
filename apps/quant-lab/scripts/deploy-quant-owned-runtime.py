#!/usr/bin/env python3
"""Quant-only fixed candidate deployment; archive stdin, no secret output.

The existing current symlink also belongs to Exchange and is never changed.
Only a fresh Quant service drop-in selects the candidate. Rollback removes that
exact drop-in and restarts only Quant; it never restores a stale state snapshot.
"""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import socket
import stat
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

SOURCE = 'e022589fbd11024d7df075091a21de9f01565bf9'
TREE = '699f9085b591b9f299e9d0ce5e27648c716ea1c1'
ARCHIVE_SHA = 'd354386dfc4bb7631ecb415a042044f1eac038ace82792eca9342697392924e5'
ARCHIVE_BYTES = 3461756
RELEASE_NAME = 'ynx-quant-lab-e022589fbd11'
RELEASE = Path('/opt/ynx-quant/releases') / RELEASE_NAME
DROP_DIR = Path('/etc/systemd/system/ynx-quant.service.d')
DROP_FILE = DROP_DIR / '90-quant-e022589fbd11-http-ready.conf'
VALIDATION = Path('/var/lib/ynx-quant/validation-e022589fbd11')
STATE = Path('/var/lib/ynx-quant/quant.json')
CURRENT = Path('/opt/ynx-quant/current')
RELEASE_PARENT_ID = (64770,1331062,0,0,0o755,7)
EXPECTED_STATE_SHA = 'cbe3948ec8cbf93ccd07224dac779dd9ccacd8c9a596fcfe0ba917ebc3b3cb60'
EXPECTED_OLD_PID = '1685153'
RETAINED_RELEASE_ID = (64770,2535943,0,0,0o755)
RELEASE_OWNER = (0,0)
OLD_CURRENT = '/opt/ynx/releases/financial-owner-reads/ynx-financial-owner-reads-443286487e05/quant'
FIXED_FILES = {
 '/etc/systemd/system/ynx-quant.service': 'ecf68b38cd1e14fc900e21d9bf86823c99b538382081585e2005a2a925709dd1',
 '/etc/ynx/ynx-quant.env': 'd65a972203f51c8d78e789dfd010708310d47a93445c7bc9315bae40d856257e',
 '/etc/caddy/conf.d/ynx-quant.caddy': 'fe86b1178f5f27b2fe225aaee1704e3ca8b083a30f1f6b25fbaf999b4b68ddb9',
 '/opt/ynx/releases/financial-owner-reads/ynx-financial-owner-reads-443286487e05/quant/ynx-quant': 'ae0d9d632eccca0b44cc92534e595a989a29fb3801f02bbba84feda8214553fb',
}
OLD_HTTP = {'/': (19299, '7030c610e5830b3c69b831caa8bdd5ff5bc3559ac83d340db6d40a9914802763'), '/api/version': (108, '6451c911ec4ef12cf7c47f5611f7c5fcce1f319c81a69427941c65b78b563556'), '/api/health': (296, '3ddf5e35912c65a9e0565b35a6fa5d4b295602a2054d6d9cea9fefff17f414c1')}
BASES = ('http://127.0.0.1:18444', 'https://quant.ynxweb4.com')

def digest(data): return hashlib.sha256(data).hexdigest()
def require(ok, code):
 if not ok: raise RuntimeError(code)
def identity(path):
 s = path.lstat()
 return (s.st_dev, s.st_ino, s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode), s.st_nlink)
def regular(path):
 s = path.lstat()
 require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and not path.is_symlink(), 'REGULAR_SINGLE_LINK_REQUIRED')
 return path.read_bytes()
def absent(path): require(not os.path.lexists(path), 'NEW_PATH_ALREADY_EXISTS')
def run(argv):
 result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
 require(result.returncode == 0, 'COMMAND_FAILED_' + Path(argv[0]).name)
 return result.stdout.decode().strip()
def service(name='ynx-quant.service'):
 result = run(['/usr/bin/systemctl', 'show', name, '-p', 'ActiveState', '-p', 'SubState', '-p', 'MainPID', '-p', 'NRestarts'])
 return dict(line.split('=', 1) for line in result.splitlines())
def http(url):
 try: response = urllib.request.urlopen(urllib.request.Request(url, headers={'Accept-Encoding':'identity'}), timeout=10)
 except urllib.error.HTTPError as error: response = error
 with response:
  body = response.read(400001)
  require(len(body) <= 400000, 'HTTP_BODY_LIMIT')
  return {'url':url,'status':response.status,'bytes':len(body),'sha256':digest(body),'mime':response.headers.get('Content-Type','')}, body
def unchanged():
 require(CURRENT.is_symlink() and os.readlink(CURRENT) == OLD_CURRENT, 'SHARED_CURRENT_CHANGED')
 for path, expected in FIXED_FILES.items(): require(digest(regular(Path(path))) == expected, 'FIXED_FILE_CHANGED')
def old_http():
 receipts = []
 for base in BASES:
  for route, (size, sha) in OLD_HTTP.items():
   receipt, _ = http(base + route)
   require(receipt['status'] == 200 and receipt['bytes'] == size and receipt['sha256'] == sha, 'OLD_HTTP_MISMATCH')
   receipts.append(receipt)
 return receipts

def validate_archive(data, source=SOURCE, tree=TREE, release=RELEASE_NAME):
 result = {}
 with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
  for member in archive.getmembers():
   p = PurePosixPath(member.name)
   require(member.isfile() and not member.issym() and not member.islnk(), 'ARCHIVE_TYPE')
   require(str(p) == member.name and not p.is_absolute() and '..' not in p.parts and p.parts[0] == release and len(p.parts) > 1, 'ARCHIVE_PATH')
   require(member.name not in result and member.size <= 20000000 and member.mode in (0o644,0o755), 'ARCHIVE_DUPLICATE_MODE_SIZE')
   result[member.name] = (archive.extractfile(member).read(), member.mode)
 manifest = json.loads(result[release+'/BUNDLE_MANIFEST.json'][0])
 require(manifest['sourceCommit'] == source and manifest['sourceTree'] == tree and manifest['release'] == release, 'MANIFEST_SOURCE')
 inventory = manifest['entries']
 require(len({entry['path'] for entry in inventory}) == len(inventory), 'INVENTORY_DUPLICATE')
 require(set(result) == {entry['path'] for entry in inventory} | {release+'/BUNDLE_MANIFEST.json',release+'/SHA256SUMS'}, 'INVENTORY_SET')
 for entry in inventory:
  body, mode = result[entry['path']]
  require(len(body) == entry['bytes'] and digest(body) == entry['sha256'] and int(entry['mode'],8) == mode, 'INVENTORY_HASH_BYTES_MODE')
 checksum_names = set()
 for line in result[release+'/SHA256SUMS'][0].decode().splitlines():
  sha, name = line.split('  ',1)
  full = release+'/'+name
  require(full not in checksum_names and full in result and full != release+'/SHA256SUMS', 'CHECKSUM_SET')
  require(digest(result[full][0]) == sha, 'CHECKSUM_DIGEST')
  checksum_names.add(full)
 require(checksum_names == set(result)-{release+'/SHA256SUMS'}, 'CHECKSUM_COVERAGE')
 binary = result[release+'/ynx-quantd'][0]
 require(binary[:6] == b'\x7fELF\x02\x01' and binary[18:20] == b'\x3e\x00', 'ELF_AMD64_REQUIRED')
 return result, manifest

def candidate_http(base, manifest):
 receipts = []
 receipt, body = http(base+'/api/version')
 require(receipt['status'] == 200 and json.loads(body)['commit'] == SOURCE, 'CANDIDATE_SOURCE')
 receipts.append(receipt)
 for route in ['/api/health','/api/ready']:
  receipt, _ = http(base+route)
  require(receipt['status'] == (503 if route.endswith('/ready') else 200), 'CANDIDATE_HEALTH_OR_SINGLE_WRITER_TRUTH')
  receipts.append(receipt)
 for entry in manifest['entries']:
  prefix = RELEASE_NAME+'/apps/quant-lab/web/'
  if not entry['path'].startswith(prefix): continue
  relative = entry['path'][len(prefix):]
  receipt, _ = http(base+('/' if relative == 'index.html' else '/'+relative))
  require(receipt['status'] == 200 and receipt['bytes'] == entry['bytes'] and receipt['sha256'] == entry['sha256'], 'CANDIDATE_ASSET')
  receipts.append(receipt)
 return receipts

def wait_candidate_http():
 # systemd Type=simple becomes active before Go ListenAndServe binds. Read-only
 # bounded polling proves actual source readiness before asset verification.
 deadline=time.monotonic()+8
 while True:
  try:
   receipt,body=http('http://127.0.0.1:18444/api/version')
   if receipt['status']==200 and json.loads(body).get('commit')==SOURCE:return
  except (urllib.error.URLError,OSError,ValueError):pass
  if time.monotonic()>=deadline:raise RuntimeError('CANDIDATE_HTTP_SOURCE_READINESS_TIMEOUT')
  time.sleep(0.1)

def verify_retained_release(entries):
 require(identity(RELEASE)[:5]==RETAINED_RELEASE_ID and not RELEASE.is_symlink(), 'RETAINED_RELEASE_IDENTITY')
 expected_files={str(PurePosixPath(name).relative_to(RELEASE_NAME)) for name in entries}
 actual_files=set()
 expected_dirs=set()
 for relative in expected_files:
  p=PurePosixPath(relative).parent
  while str(p)!='.':expected_dirs.add(str(p));p=p.parent
 actual_dirs=set()
 for parent,dirs,files in os.walk(RELEASE,followlinks=False):
  for name in dirs:
   p=Path(parent)/name;require(not p.is_symlink() and (p.lstat().st_uid,p.lstat().st_gid)==RELEASE_OWNER and stat.S_IMODE(p.lstat().st_mode)==0o755,'RETAINED_DIRECTORY')
   actual_dirs.add(str(p.relative_to(RELEASE)))
  for name in files:actual_files.add(str((Path(parent)/name).relative_to(RELEASE)))
 require(actual_files==expected_files and actual_dirs==expected_dirs,'RETAINED_INVENTORY_SET')
 for full,(body,mode) in entries.items():
  p=RELEASE/PurePosixPath(full).relative_to(RELEASE_NAME)
  require(identity(p)[2:5]==RELEASE_OWNER+(mode,) and regular(p)==body,'RETAINED_FILE_CHANGED')

def isolated_start(manifest, uid, gid):
 absent(VALIDATION)
 VALIDATION.mkdir(mode=0o700)
 os.chown(VALIDATION,uid,gid)
 validation_identity = identity(VALIDATION)[:4]
 copied = VALIDATION/'state.json'
 copied.write_bytes(regular(STATE)); copied.chmod(0o600); os.chown(copied,uid,gid)
 original = digest(regular(copied))
 with socket.socket() as reserve:
  reserve.bind(('127.0.0.1',0)); port=reserve.getsockname()[1]
 def demote():
  os.setgroups([gid]); os.setgid(gid); os.setuid(uid)
 proc = subprocess.Popen([str(RELEASE/'ynx-quantd')], cwd=RELEASE, env={'PATH':'/usr/bin:/bin','YNX_QUANT_HTTP_ADDR':f'127.0.0.1:{port}','YNX_QUANT_STATE_PATH':str(copied)}, preexec_fn=demote, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
 try:
  for attempt in range(50):
   require(proc.poll() is None, 'ISOLATED_CANDIDATE_EXITED')
   try:
    receipt, body = http(f'http://127.0.0.1:{port}/api/version')
    if receipt['status']==200 and json.loads(body)['commit']==SOURCE: break
   except (urllib.error.URLError, OSError): pass
   time.sleep(0.1)
  else: raise RuntimeError('ISOLATED_START_TIMEOUT')
  result = candidate_http(f'http://127.0.0.1:{port}', manifest)
  require(digest(regular(copied)) == original, 'ISOLATED_STATE_MUTATED_BY_READ')
  return result
 finally:
  proc.terminate()
  try: proc.wait(timeout=10)
  except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=5)
  require(identity(VALIDATION)[:4] == validation_identity, 'VALIDATION_SUBSTITUTED')
  allowed={'state.json','state.json.lock','state.json.tenants'}
  require({p.name for p in VALIDATION.iterdir()} <= allowed, 'VALIDATION_FOREIGN_ENTRY')
  for p in VALIDATION.iterdir():
   require(not p.is_symlink() and p.lstat().st_uid==uid and p.lstat().st_gid==gid, 'VALIDATION_FOREIGN_OWNER')
   if p.name=='state.json.tenants': require(p.is_dir() and not any(p.iterdir()), 'VALIDATION_TENANTS_NONEMPTY'); p.rmdir()
   else: regular(p); p.unlink()
  VALIDATION.rmdir()

def main():
 require(os.geteuid()==0, 'ROOT_REQUIRED')
 require(len(sys.argv)==2 and sys.argv[1]=='--activate-owned-quant-e022589fbd11-http-ready', 'EXPLICIT_COMMAND_REQUIRED')
 data=sys.stdin.buffer.read(ARCHIVE_BYTES+1)
 require(len(data)==ARCHIVE_BYTES and digest(data)==ARCHIVE_SHA, 'ARCHIVE_TRANSPORT_MISMATCH')
 entries,manifest=validate_archive(data)
 require(identity(RELEASE.parent)[:5]==RELEASE_PARENT_ID[:5] and not RELEASE.parent.is_symlink(), 'RELEASE_PARENT_DRIFT')
 verify_retained_release(entries)
 for p in (DROP_DIR,VALIDATION): absent(p)
 unchanged()
 old=service(); require(old=={'MainPID':EXPECTED_OLD_PID,'NRestarts':'0','ActiveState':'active','SubState':'running'}, 'OLD_SERVICE_DRIFT')
 sibling=service('ynx-quant-exchange.service')
 require(sibling['MainPID']=='2275763' and sibling['NRestarts']=='0', 'SIBLING_SERVICE_DRIFT')
 baseline=old_http()
 before_state=digest(regular(STATE))
 require(before_state==EXPECTED_STATE_SHA, 'STATE_DRIFT')
 user=pwd.getpwnam('ynx'); require((user.pw_uid,user.pw_gid)==(995,986), 'SERVICE_USER_DRIFT')
 isolated=isolated_start(manifest,user.pw_uid,user.pw_gid)
 unchanged(); require(digest(regular(STATE))==before_state and service()==old, 'PRE_SWITCH_DRIFT')
 drop_bytes=f'[Service]\nExecStart=\nExecStart={RELEASE}/ynx-quantd\nWorkingDirectory={RELEASE}\nEnvironment=YNX_QUANT_PRIVATE_SESSION_V2_ENABLED=1\n'.encode()
 drop_identity=None
 switched=False
 try:
  DROP_DIR.mkdir(mode=0o755)
  with DROP_FILE.open('xb') as out: out.write(drop_bytes); out.flush(); os.fsync(out.fileno())
  DROP_FILE.chmod(0o644); drop_identity=identity(DROP_FILE)
  run(['/usr/bin/systemctl','daemon-reload'])
  switched=True
  run(['/usr/bin/systemctl','restart','ynx-quant.service'])
  for attempt in range(30):
   current=service()
   if current['ActiveState']=='active' and current['SubState']=='running' and int(current['MainPID'])>0: break
   time.sleep(0.2)
  require(current['MainPID']!=old['MainPID'] and current['NRestarts']=='0', 'CANDIDATE_SERVICE')
  wait_candidate_http()
  receipts=[]
  for base in BASES: receipts.extend(candidate_http(base,manifest))
  unchanged()
  require(service('ynx-quant-exchange.service')==sibling, 'SIBLING_CHANGED')
  require(digest(regular(STATE))==before_state, 'BASE_STATE_CHANGED')
  print(json.dumps({'result':'QUANT_OWNED_RUNTIME_DEPLOYED','source':SOURCE,'tree':TREE,'archiveSha256':ARCHIVE_SHA,'release':str(RELEASE),'dropIn':str(DROP_FILE),'dropInTuple':drop_identity,'dropInSha256':digest(drop_bytes),'service':current,'previousService':old,'publicAndLoopback':receipts,'isolatedLinuxStart':isolated,'baseStateSha256':before_state,'baseStateUnchanged':True,'sharedCurrentUnchanged':True,'siblingServiceUnchanged':True,'automaticRollback':False,'privateApproval':False,'sign':False,'transactions':False,'installed':False,'readiness':'503 filesystem single-writer; not PostgreSQL/multi-instance ready'}),flush=True)
 except BaseException as error:
  rollback=False
  if drop_identity is not None:
   require(identity(DROP_FILE)==drop_identity and digest(regular(DROP_FILE))==digest(drop_bytes), 'ROLLBACK_DROPIN_SUBSTITUTED')
   DROP_FILE.unlink(); require(not any(DROP_DIR.iterdir()), 'ROLLBACK_FOREIGN_DROPIN'); DROP_DIR.rmdir()
   run(['/usr/bin/systemctl','daemon-reload'])
   if switched: run(['/usr/bin/systemctl','restart','ynx-quant.service'])
   for attempt in range(30):
    try: old_http(); rollback=True; break
    except Exception: time.sleep(0.2)
   unchanged()
  print(json.dumps({'result':'QUANT_DEPLOY_FAILED','failureClass':type(error).__name__,'code':str(error) if isinstance(error,RuntimeError) else 'UNEXPECTED_FAILURE_NO_DETAILS','automaticRollbackVerified':rollback,'releaseRetained':str(RELEASE),'stateOverwritten':False}),flush=True)
  raise SystemExit(1)

if __name__=='__main__':
 try: main()
 except Exception as error:
  print(json.dumps({'result':'QUANT_EXECUTION_FAILED_OUTSIDE_VERIFIED_TERMINAL','failureClass':type(error).__name__,'code':str(error) if isinstance(error,RuntimeError) else 'UNEXPECTED_FAILURE_NO_DETAILS','runtimeState':'requires read-only receipt; never infer success','stateOverwrittenByExecutor':False}),flush=True)
  raise SystemExit(1)
