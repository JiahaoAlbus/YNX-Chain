#!/usr/bin/env bash
# Normal CI producer only. This never starts either output program. Failures
# retain the exclusive work/output directories and all partial original bytes.
set -euo pipefail
umask 077
python3 -B - "$@" <<'PY'
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
    return re.fullmatch(r'[0-9a-f]{40}', value) is not None and value != '0' * 40


def canonical(path, exists):
    require(path and '\x00' not in path and not any(ord(c) < 32 or ord(c) == 127 for c in path), 'exact bounded absolute path required')
    require(len(os.fsencode(path)) <= 4096 and os.path.isabs(path) and os.path.normpath(path) == path, 'canonical absolute path required')
    value = Path(path)
    if exists:
        require(value.resolve(strict=True) == value and value.is_dir(), 'existing canonical directory required')
    else:
        require(not os.path.lexists(value), 'existing output/work/partial material retained; refusing reuse')
        parent = value.parent
        require(parent.resolve(strict=True) == parent and parent.is_dir() and parent.stat().st_mode & 0o022 == 0, 'new directory requires an existing non-writable canonical parent')
    return value


def command(argv, cwd, environment, limit=256 << 10, timeout=180):
    result = subprocess.run(argv, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    require(len(result.stdout) <= limit and len(result.stderr) <= limit, 'producer command output exceeded its bound')
    if result.returncode != 0:
        # These commands receive public source/path arguments only. Preserve the
        # real build first cause, never retry or delete a partial destination.
        sys.stderr.buffer.write(result.stderr)
        raise RuntimeError('producer command failed: ' + argv[0])
    return result.stdout


args = sys.argv[1:]
names = {'--repository', '--source-commit', '--source-tree', '--work-directory', '--output-directory'}
require(len(args) == 10 and set(args[::2]) == names and len(set(args[::2])) == 5, 'exactly five distinct named producer inputs required')
options = dict(zip(args[::2], args[1::2]))
commit, tree = options['--source-commit'], options['--source-tree']
require(hex40(commit) and hex40(tree), 'explicit nonzero lowercase full source commit and tree required')
controller = {name: os.environ.get(env, '') for name, env in
              [('commit', 'GITHUB_SHA'), ('runId', 'GITHUB_RUN_ID'), ('runAttempt', 'GITHUB_RUN_ATTEMPT')]}
require(hex40(controller['commit']), 'actual controller CI full commit required')
for name in ('runId', 'runAttempt'):
    require(re.fullmatch(r'[1-9][0-9]{0,19}', controller[name]) is not None and int(controller[name]) <= (1 << 64)-1,
            'actual canonical controller CI run/attempt required')
repository = canonical(options['--repository'], True)
work = canonical(options['--work-directory'], False)
output = canonical(options['--output-directory'], False)
require(work != output and work not in output.parents and output not in work.parents,
        'source and output must be distinct non-nested new directories')
require(repository not in work.parents and repository not in output.parents,
        'new source and output must be outside the original caller repository')

# Neither inherited Git routing nor a global URL rewrite can turn this exact
# local-object transfer into a network fetch or an alternate-object checkout.
environment = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
environment.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0', GIT_NO_REPLACE_OBJECTS='1')
git = ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always']


def git_read(directory, *arguments):
    return command(git + ['-C', str(directory)] + list(arguments), repository, environment).decode('utf8').strip()


require(git_read(repository, 'rev-parse', '--show-toplevel') == str(repository), 'repository must be the exact original worktree root')
require(git_read(repository, 'rev-parse', '--verify', commit + '^{commit}') == commit, 'requested original commit object missing')
require(git_read(repository, 'rev-parse', '--verify', commit + '^{tree}') == tree, 'independent source tree differs from original commit')
work.mkdir(mode=0o700)
output.mkdir(mode=0o700)
command(git + ['init', '--quiet', '--template=', str(work)], repository, environment)
command(git + ['-C', str(work), 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--depth=1', str(repository), commit], repository, environment)
command(git + ['-C', str(work), 'checkout', '--quiet', '--detach', commit], repository, environment)
require((work / '.git').is_dir() and not (work / '.git').is_symlink(), 'independent real Git directory required for Go VCS stamping')
require(not os.path.lexists(work / '.git/objects/info/alternates'), 'alternate object store forbidden')


def source_observation():
    observation = dict(head=git_read(work, 'rev-parse', 'HEAD'), tree=git_read(work, 'rev-parse', 'HEAD^{tree}'),
                       status=git_read(work, 'status', '--porcelain=v1', '--untracked-files=all'))
    require(observation == dict(head=commit, tree=tree, status=''), 'actual build source HEAD/tree/porcelain is not exactly clean')
    require(not os.path.lexists(work / '.git/objects/info/alternates'), 'alternate object store appeared')
    return observation


before = source_observation()
environment.update(CGO_ENABLED='0', GOOS='linux', GOARCH='amd64', GOAMD64='v1', GOFLAGS='', GOENV='off', GOWORK='off', GOTOOLCHAIN='local')
require(command(['go', 'version'], work, environment).strip() == b'go version go1.26.10 linux/amd64', 'normal Linux Go1.26.10 compiler required')
native_flags = '-s -w -X main.buildCommit=' + commit + ' -X main.buildRelease=pq-offline-validation'
binaries = {}
for name in ('ynx-chaind', 'ynx-consensus-package'):
    path = output / name
    command(['go', 'build', '-p', '1', '-trimpath', '-buildvcs=true', '-ldflags', native_flags if name == 'ynx-chaind' else '-s -w',
             '-o', str(path), './cmd/' + name], work, environment, timeout=300)
    require(path.is_file() and not path.is_symlink(), 'actual regular compiled ELF required')
    raw = command(['go', 'version', '-m', str(path)], work, environment, 128 << 10).decode('utf8')
    lines = raw.splitlines()
    require(lines and lines[0] == str(path) + ': go1.26.10', 'actual ELF Go version differs')
    settings, main_path = {}, None
    for line in lines[1:]:
        if line.startswith('\tbuild\t'):
            key, equal, value = line[len('\tbuild\t'):].partition('=')
            require(equal and key not in settings, 'duplicate or invalid actual Go build setting')
            if value.startswith('"'):
                # go version quotes whitespace-bearing settings (the fixed
                # public ldflags are ASCII); retain raw output as observed too.
                value = json.loads(value)
                require(isinstance(value, str), 'invalid quoted Go build setting')
            settings[key] = value
        elif line.startswith('\tpath\t'):
            require(main_path is None, 'duplicate actual Go main package')
            main_path = line[len('\tpath\t'):]
    require(main_path is not None and main_path.endswith('/cmd/' + name), 'actual main package differs from fixed producer command')
    for key, expected in {'-buildmode': 'exe', '-trimpath': 'true', 'CGO_ENABLED': '0', 'GOOS': 'linux', 'GOARCH': 'amd64',
                          'vcs': 'git', 'vcs.revision': commit, 'vcs.modified': 'false'}.items():
        require(settings.get(key) == expected, 'actual ELF build setting mismatch: ' + name + ':' + key)
    # Go1.26.10 load/pkg.go deliberately omits -ldflags under -trimpath
    # (issue 52372), even though those flags still reach the linker. Preserve
    # that actual absence, not the requested flags in an observed metadata slot.
    require('-ldflags' not in settings, 'unexpected ldflags metadata under fixed trimpath toolchain')
    with path.open('rb') as source:
        magic = source.read(20)
        source.seek(0)
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    require(magic[:6] == b'\x7fELF\x02\x01' and magic[18:20] == b'\x3e\x00', 'actual Linux amd64 ELF required')
    binaries[name] = dict(bytes=path.stat().st_size, sha256=digest,
                          goInfo=dict(goVersion=lines[0].rsplit(': ', 1)[1], path=main_path, settings=settings, raw=raw))
after = source_observation()
require(sorted(p.name for p in output.iterdir()) == ['ynx-chaind', 'ynx-consensus-package'], 'unexpected or partial output catalog')
record = dict(version='YNX-PQ-OFFLINE-MIGRATION-TOOLS/v2', commit=after['head'], tree=after['tree'],
              runId=controller['runId'], runAttempt=controller['runAttempt'], platform='linux/amd64', controllerCI=controller,
              sourceBefore=before, sourceAfter=after, binaries=binaries,
              purpose='offline copied-state validation; not installed or activated', runtimeStarted=False,
              deploymentReady=False, authorityGranted=False, executionReady=False)
encoded = (json.dumps(record, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode('ascii')
require(len(encoded) <= 256 << 10, 'bounded public SOURCE metadata exceeded')
source_path = output / 'SOURCE.json'
with source_path.open('xb') as sink:
    os.chmod(source_path, 0o600)
    require(sink.write(encoded) == len(encoded), 'partial SOURCE retained')
    sink.flush()
    os.fsync(sink.fileno())
with source_path.open('rb') as source:
    info = os.fstat(source.fileno())
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1 and source.read() == encoded,
            'exclusive SOURCE readback differs')
directory_fd = os.open(output, os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
require(sorted(p.name for p in output.iterdir()) == ['SOURCE.json', 'ynx-chaind', 'ynx-consensus-package'], 'closed three-file output differs')
sys.stdout.write('YNX_PQ_OFFLINE_MIGRATION_SOURCE ' + encoded.decode('ascii'))
sys.stdout.write('YNX_PQ_OFFLINE_MIGRATION_SOURCE_PIN bytes=' + str(len(encoded)) + ' sha256=' + hashlib.sha256(encoded).hexdigest() + '\n')
PY
