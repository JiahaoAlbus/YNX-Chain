#!/usr/bin/env python3
"""Build a frozen Developer Git source archive with verified Linux dependencies.

Arguments: fresh-output-dir source-freeze.json source.tar.gz dependency-runtime.tar.gz
The freeze lists each Git source file, its digest/size, and the dependency digest.
Only the three dependency roots are reused. No running state is read or packaged.
"""
from pathlib import Path, PurePosixPath
import hashlib, json, os, subprocess, sys, tarfile, time

out, freeze_path, source, dependencies = map(lambda p: Path(p).resolve(), sys.argv[1:])
out.mkdir(mode=0o755)
freeze = json.loads(freeze_path.read_text())
commands = []
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''): h.update(chunk)
    return h.hexdigest()
def extract(archive, root, deps=False):
    allowed = ['apps/developer/node_modules', 'apps/developer/.ynx-debugpy', 'apps/developer/.ynx-js-debug']
    with tarfile.open(archive, 'r:gz') as tar:
        members = []
        for member in tar.getmembers():
            p = PurePosixPath(member.name)
            normalized = str(p)
            if deps and not any(normalized == x or normalized.startswith(x + '/') for x in allowed): continue
            assert not p.is_absolute() and '..' not in p.parts
            assert member.isfile() or member.isdir() or member.issym() or member.islnk()
            if member.issym() or member.islnk():
                target = root/p.parent/member.linkname if member.issym() else root/member.linkname
                assert target.resolve().is_relative_to(root), member.name
            members.append(member)
        tar.extractall(root, members=members, filter='data')
    return len(members)
def run(argv, cwd, env=None):
    started = time.time()
    result = subprocess.run(argv, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = 'command-%02d.log' % (len(commands) + 1)
    (out/log).write_text(result.stdout)
    record = dict(argv=argv, exitCode=result.returncode, seconds=round(time.time()-started, 3), log=log)
    commands.append(record); print(json.dumps(record), flush=True)
    if result.returncode: raise RuntimeError(result.stdout[-6000:])
    return result.stdout
def verify_sources(root):
    for item in freeze['sourceFiles']:
        p = root/item['path']
        assert p.is_file() and not p.is_symlink() and p.stat().st_size == item['bytes'] and digest(p) == item['sha256'], item['path']
    return len(freeze['sourceFiles'])

assert sys.platform == 'linux'
assert digest(source) == freeze['sourceArchiveSHA256']
assert digest(dependencies) == freeze['dependencyRuntimeSHA256']
node = json.loads(subprocess.check_output(['node', '-p', 'JSON.stringify({version:process.version,abi:process.versions.modules,arch:process.arch})'], text=True))
assert node == {'version': 'v22.23.1', 'abi': '127', 'arch': 'x64'}, node
candidate = out/'candidate'; candidate.mkdir()
source_entries = extract(source, candidate)
dependency_entries = extract(dependencies, candidate, True)
assert not (candidate/'apps/developer/frontend/dist').exists(), 'Old frontend included'
assert not (candidate/'apps/developer/protocol/dist').exists(), 'Old protocol included'
before = verify_sources(candidate)
app = candidate/'apps/developer'
env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'NODE_OPTIONS': '--max-old-space-size=1024',
       'NODE_ENV': 'production', 'YNX_CODE_SOURCE_COMMIT': freeze['sourceCommit'],
       'YNX_CODE_SOURCE_TREE': freeze['sourceTree'], 'YNX_CODE_RELEASE': freeze['release']}
run(['nice', '-n', '10', 'npm', 'run', 'code:build'], app, env)
run(['nice', '-n', '10', 'node', '--test', '--test-concurrency=1',
     'services/runtime-profile-service/test/recovery-copies.test.mjs',
     'services/runtime-profile-service/test/terminal-recovery.test.mjs',
     'services/runtime-profile-service/test/ssh-workspace-isolation.test.mjs',
     'services/gateway/test/server-maintenance.test.mjs'], app, env)
run(['nice', '-n', '10', 'node', '--test', '--test-name-pattern=installed (debugpy|js-debug)',
     'services/debug-service/test/service.test.mjs'], app, env)
run(['node', '--input-type=module', '-e', "import pty from 'node-pty'; const t=pty.spawn('/usr/bin/printf',['ynx-native-pty-abi127'],{cwd:'/tmp',env:{PATH:'/usr/bin:/bin'}});let out='';const timeout=setTimeout(()=>{t.kill();process.exit(1)},5000);t.onData(x=>out+=x);t.onExit(({exitCode})=>{clearTimeout(timeout);if(exitCode!==0||out!=='ynx-native-pty-abi127')process.exit(1);console.log('PTY ABI127 PASS')});"], app, env)
after = verify_sources(candidate)
files = []
for parent, dirs, names in os.walk(candidate, followlinks=False):
    dirs.sort()
    for name in sorted(dirs+names):
        path = Path(parent)/name
        if path.is_symlink():
            assert path.resolve().is_relative_to(candidate)
            files.append({'path': str(path.relative_to(candidate)), 'symlink': os.readlink(path)})
        elif path.is_file(): files.append({'path': str(path.relative_to(candidate)), 'bytes': path.stat().st_size, 'sha256': digest(path)})
manifest = {key: freeze[key] for key in ['sourceCommit', 'sourceTree', 'release', 'sourceArchiveSHA256', 'dependencyRuntimeSHA256']}
manifest.update(schemaVersion=1, product='ynx-developer-web', node=node, files=files,
                workspaceStateIncluded=False, operatorEnvironmentIncluded=False,
                staticFiles=[{'url': '/'+f['path'].split('/frontend/dist/', 1)[1], 'bytes': f['bytes'], 'sha256': f['sha256']} for f in files if '/frontend/dist/' in f['path'] and 'sha256' in f])
manifest_path = out/'package-manifest.json'; manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
fixture = app/'scripts/linux-release-fixture.mjs'
run(['node', str(fixture), str(candidate), str(manifest_path), str(out/'fixture-state')], app, env)
archive = out/'runtime-linux-x64.tar.gz'
with archive.open('wb') as stream:
    tar = subprocess.Popen(['tar', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-C', str(candidate), '-cf', '-', '.'], stdout=subprocess.PIPE)
    gzip = subprocess.Popen(['gzip', '-n', '-6'], stdin=tar.stdout, stdout=stream); tar.stdout.close()
    assert gzip.wait() == 0 and tar.wait() == 0
extracted = out/'extracted'; extracted.mkdir(); extract(archive, extracted)
expected = {item['path'] for item in files}
for item in files:
    path = extracted/item['path']
    if 'symlink' in item: assert path.is_symlink() and os.readlink(path) == item['symlink'] and path.resolve().is_relative_to(extracted)
    else: assert path.is_file() and not path.is_symlink() and path.stat().st_size == item['bytes'] and digest(path) == item['sha256']
actual = {str((Path(parent)/name).relative_to(extracted)) for parent, dirs, names in os.walk(extracted, followlinks=False) for name in dirs+names if (Path(parent)/name).is_file() or (Path(parent)/name).is_symlink()}
assert expected == actual
run(['node', str(extracted/'apps/developer/scripts/linux-release-fixture.mjs'), str(extracted), str(manifest_path), str(out/'extracted-fixture-state')], extracted/'apps/developer', env)
receipt = dict(sourceCommit=freeze['sourceCommit'], sourceTree=freeze['sourceTree'], packageSHA256=digest(archive),
    packageBytes=archive.stat().st_size, manifestSHA256=digest(manifest_path), sourceEntries=source_entries,
    dependencyEntries=dependency_entries, sourceFilesBeforeAndAfterBuild=[before, after], packageFiles=len(files),
    node=node, commands=commands, extractedManifestReplayed=True, realStateAccessed=False, publicDeployment=False)
(out/'build-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
print(json.dumps(receipt), flush=True)
