#!/usr/bin/env bash
# Normal hosted CI only. Compile a new normal native entrypoint from the
# already materialized exact clean Git source; never relabel the offline ELF.
set -euo pipefail
umask 077
python3 -B - "$@" <<'PY'
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def hex40(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{40}', value) is not None and value != '0' * 40


args = sys.argv[1:]
names = {'--source-directory', '--source-commit', '--source-tree', '--output-directory'}
require(len(args) == 8 and set(args[::2]) == names and len(set(args[::2])) == 4,
        'exactly four distinct named native producer inputs required')
options = dict(zip(args[::2], args[1::2]))
commit, tree = options['--source-commit'], options['--source-tree']
require(hex40(commit) and hex40(tree), 'exact nonzero lowercase full commit and tree required')
require(os.environ.get('GITHUB_SHA') == commit, 'native candidate must use the actual controller CI source')
controller = dict(commit=commit, runId=os.environ.get('GITHUB_RUN_ID', ''), runAttempt=os.environ.get('GITHUB_RUN_ATTEMPT', ''))
require(all(re.fullmatch(r'[1-9][0-9]{0,19}', controller[k]) and int(controller[k]) <= (1 << 64)-1
            for k in ('runId', 'runAttempt')), 'actual bounded controller CI run and attempt required')


def canonical(value, existing):
    require(isinstance(value, str) and 0 < len(os.fsencode(value)) <= 4096 and
            not any(ord(c) < 32 or ord(c) == 127 for c in value) and
            os.path.isabs(value) and os.path.normpath(value) == value, 'canonical bounded absolute directory required')
    path = Path(value)
    if existing:
        require(path.resolve(strict=True) == path and path.is_dir(), 'canonical existing source directory required')
    else:
        require(not os.path.lexists(path), 'original output or UNKNOWN retained; refusing reuse')
        require(path.parent.resolve(strict=True) == path.parent and path.parent.is_dir() and
                path.parent.stat().st_mode & 0o022 == 0, 'new output requires protected canonical parent')
    return path


source = canonical(options['--source-directory'], True)
output = canonical(options['--output-directory'], False)
require(source != output and source not in output.parents and output not in source.parents,
        'source and new output must be distinct nonnested directories')
require((source / '.git').is_dir() and not (source / '.git').is_symlink() and
        not os.path.lexists(source / '.git/objects/info/alternates'), 'independent real Git source without alternates required')
if os.environ.get('GITHUB_WORKSPACE'):
    caller = Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
    require(caller != source and caller not in source.parents, 'use the independently materialized source, not the caller checkout')
environment = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
environment.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0', GIT_OPTIONAL_LOCKS='0',
                   GIT_NO_REPLACE_OBJECTS='1', CGO_ENABLED='0', GOOS='linux', GOARCH='amd64', GOAMD64='v1',
                   GOFLAGS='', GOENV='off', GOWORK='off', GOTOOLCHAIN='local')
git = ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never']


def command(argv, limit=128 << 10, timeout=30, env=None, empty_stderr=False):
    result = subprocess.run(argv, cwd=source, env=env or environment, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    require(len(result.stdout) <= limit and len(result.stderr) <= limit, 'native producer command exceeded bounded output')
    if result.returncode:
        sys.stderr.buffer.write(result.stderr)
        raise RuntimeError('native producer command failed: ' + argv[0])
    require(not empty_stderr or not result.stderr, 'native informational exit wrote unexpected stderr')
    return result.stdout


def source_observation():
    def read(*args):
        return command(git + list(args)).decode('utf8').strip()
    require(read('rev-parse', '--show-toplevel') == str(source), 'exact native source root required')
    require(not os.path.lexists(source / '.git/objects/info/alternates'), 'source alternates appeared')
    observed = dict(head=read('rev-parse', 'HEAD'), tree=read('rev-parse', 'HEAD^{tree}'),
                    status=read('status', '--porcelain=v1', '--untracked-files=all'))
    require(observed == dict(head=commit, tree=tree, status=''), 'native source must remain exact and clean')
    return observed


before = source_observation()
require(command(['go', 'version']).strip() == b'go version go1.26.10 linux/amd64', 'normal pinned Linux Go1.26.10 required')
output.mkdir(mode=0o700)
binary = output / 'ynx-chaind'
build = dict(commit=commit, release='ynx-chain-' + commit[:12],
             buildTime=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
flags = '-s -w -X main.buildCommit=' + build['commit'] + ' -X main.buildRelease=' + build['release'] + ' -X main.buildTime=' + build['buildTime']
command(['go', 'build', '-p', '1', '-trimpath', '-buildvcs=true', '-ldflags', flags, '-o', str(binary), './cmd/ynx-chaind'], timeout=300)
raw = command(['go', 'version', '-m', str(binary)]).decode('utf8', errors='strict')
lines = raw.splitlines()
require(lines and lines[0] == str(binary) + ': go1.26.10', 'actual native ELF Go version differs')
settings, main_path = {}, None
for line in lines[1:]:
    if line.startswith('\tbuild\t'):
        key, equal, value = line[len('\tbuild\t'):].partition('=')
        require(equal and key not in settings, 'duplicate or malformed actual native build setting')
        settings[key] = json.loads(value) if value.startswith('"') else value
    elif line.startswith('\tpath\t'):
        require(main_path is None, 'duplicate native main package')
        main_path = line[len('\tpath\t'):]
require(main_path is not None and main_path.endswith('/cmd/ynx-chaind'), 'actual normal native main package required')
for key, expected in {'-buildmode': 'exe', '-trimpath': 'true', 'CGO_ENABLED': '0', 'GOOS': 'linux', 'GOARCH': 'amd64',
                      'vcs': 'git', 'vcs.revision': commit, 'vcs.modified': 'false'}.items():
    require(settings.get(key) == expected, 'actual native build setting mismatch: ' + key)
require('-ldflags' not in settings, 'unexpected ldflags metadata under pinned trimpath toolchain')


def pin(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'regular single-link native material required')
    with path.open('rb') as original:
        digest = hashlib.file_digest(original, 'sha256').hexdigest()
    return dict(bytes=info.st_size, sha256=digest)


require(1 << 20 < binary.stat().st_size <= 128 << 20, 'bounded real native ELF required')
with binary.open('rb') as original:
    magic = original.read(20)
require(magic[:6] == b'\x7fELF\x02\x01' and magic[18:20] == b'\x3e\x00', 'actual Linux amd64 native ELF required')
identity_env = dict(environment, YNX_FAUCET_CORE_AUTH_TOKEN_FILE=str(output / 'must-not-read-token'))
identity = command([str(binary), '--build-info', '--network', 'invalid-network', '--http', 'invalid-address',
                    '--data-dir', str(output / 'must-not-create-data'), '--export-consensus-state', str(output / 'must-not-export'),
                    '--check-config', '--pq-admission-height', 'invalid-height'], limit=1024, timeout=5, env=identity_env, empty_stderr=True)


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate native build identity field')
        result[key] = value
    return result


require(json.loads(identity, object_pairs_hook=unique) == build and identity.endswith(b'\n'),
        'actual normal native informational exit differs from independently selected build identity')
require(sorted(p.name for p in output.iterdir()) == ['ynx-chaind'], 'informational exit touched startup resources')
after = source_observation()
require(after == before, 'native original source changed during compilation or informational exit')
record = dict(version='YNX-NATIVE-TRANSITION-CANDIDATE/v1', commit=commit, tree=tree,
              controllerCI=controller, platform='linux/amd64', sourceBefore=before, sourceAfter=after,
              binaries={'ynx-chaind': dict(**pin(binary), goInfo=dict(goVersion='go1.26.10', path=main_path, settings=settings, raw=raw))},
              buildIdentity=build, buildIdentityReadback=dict(bytes=len(identity), sha256=hashlib.sha256(identity).hexdigest(), raw=identity.decode('utf8')),
              informationalExitExecuted=True, runtimeStarted=False, publicDeployment=False, pqActivation=False,
              authorityGranted=False, deploymentReady=False,
              purpose='normal native node candidate for the original-chain account-admission and consensus transition; not an offline-validation ELF or a deployment authorization')
encoded = (json.dumps(record, sort_keys=True, separators=(',', ':')) + '\n').encode('ascii')
require(len(encoded) <= 256 << 10, 'bounded native SOURCE metadata required')
manifest = output / 'SOURCE.json'
with manifest.open('xb') as sink:
    os.chmod(manifest, 0o600)
    require(sink.write(encoded) == len(encoded), 'partial native SOURCE retained')
    sink.flush()
    os.fsync(sink.fileno())
require(manifest.read_bytes() == encoded and manifest.stat().st_nlink == 1, 'original native SOURCE readback differs')
directory_fd = os.open(output, os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
require(sorted(p.name for p in output.iterdir()) == ['SOURCE.json', 'ynx-chaind'], 'closed native two-file catalog differs')
sys.stdout.write('YNX_NATIVE_TRANSITION_SOURCE ' + encoded.decode('ascii'))
sys.stdout.write('YNX_NATIVE_TRANSITION_SOURCE_PIN bytes=' + str(len(encoded)) + ' sha256=' + hashlib.sha256(encoded).hexdigest() + '\n')
PY
