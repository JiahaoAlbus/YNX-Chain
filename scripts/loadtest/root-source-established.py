#!/usr/bin/env python3
"""Reuse the successful B8 job; prepare only a disposable hosted source VM."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

RUN = 41219562471
WORKFLOW = '5a1480f021ace226d4c0e6eacaba67225ae91c63'
CONTROLLER = dict(artifactId=13049223712, runId=RUN, name='pq-source-b8-controller-' + str(RUN),
                  digest='363063f16d07b9d7bb0829b8d798f62d230c7ea8a6cca80ab969369646873f39', size=19958,
                  workflowCommit=WORKFLOW)
AFTER = dict(artifactId=13049084193, runId=RUN, name='pq-source-b8-after-' + str(RUN),
             digest='696777ad0888a7679b65a9ff0c25d822dacbbaed990d5a6134bc1d7cf06b985f', size=139152869,
             workflowCommit=WORKFLOW)
CATALOG = {'HOST-MACHINE.json', 'SOURCE-COMPARE-CONTROLLER.json', 'actual-go-version.log',
           'original-full-state-compare.log', 'original-source-entry.log', 'prepare-original-source.log',
           'verify-actual-source-public.log', 'verify-original-eight-public.log'}
DISPOSABLE_PREINSTALLED = (Path('/usr/share/dotnet'), Path('/usr/local/lib/android'))


def base_module():
    p = Path(__file__).with_name('root-source-admission.py')
    spec = importlib.util.spec_from_file_location('root_source_gate_loader', p)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.load_original(p.with_name(module.BASE_NAME))


def verified_b8(base, files):
    base.require(set(files) == CATALOG, 'exact established B8 controller catalog required')
    record = json.loads(files['SOURCE-COMPARE-CONTROLLER.json'], object_pairs_hook=base.strict_pairs)
    result = json.loads(files['verify-actual-source-public.log'], object_pairs_hook=base.strict_pairs)
    receipt = result['receipt']
    base.require(record.get('scope') == 'b8' and record.get('runId') == str(RUN) and record.get('workflowCommit') == WORKFLOW,
                 'established B8 original run/workflow differs')
    base.require(record.get('sourceCommit') == base.B and record.get('toolsCommit') == base.B8_TOOLS and
                 record.get('comparisonComplete') is True and record.get('cleanupComplete') is True and record.get('firstCause') is None,
                 'established B8 complete comparison and cleanup required')
    required = {'actual-go-version', 'prepare-original-source', 'verify-original-eight-public',
                'original-source-entry', 'verify-actual-source-public', 'original-full-state-compare'}
    processes = record.get('processes', [])
    base.require(len(processes) == len(required) and {p['name'] for p in processes} == required and
                 all(p.get('exited') is True and p.get('exitCode') == 0 and p.get('rawReturnCode') == 0 and p.get('signal') is None for p in processes),
                 'all actual B8 source/verification/complete-diff processes must have succeeded')
    base.require(receipt.get('sourceCommit') == base.B and receipt.get('inputSha256') == base.B8_INPUT and
                 receipt.get('sourceMatrixComplete') is True and receipt.get('cleanupComplete') is True and
                 receipt.get('testExitCode') == 0 and receipt.get('firstCause') is None and
                 receipt.get('completedCases') == base.cases('original') and result.get('inputSha256') == base.B8_INPUT,
                 'established B8 same original input and full eight-case matrix required')
    return dict(status='REUSED_ACTUAL_SUCCESS_NO_B8_REPLAY', actualRun=RUN, controllerArtifact=CONTROLLER,
                fullAfterArtifact=AFTER, inputSha256=base.B8_INPUT, comparisonComplete=True, cleanupComplete=True,
                configuration=record['configuration'], chainMetrics='UNMEASURED')


def gate_b8(base, output):
    output.mkdir(mode=0o700)
    metadata = {}
    for key, expected in [('controller', CONTROLLER), ('after', AFTER)]:
        request = base.api_request('/repos/' + base.REPOSITORY + '/actions/artifacts/' + str(expected['artifactId']))
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read((1 << 20) + 1)
        base.require(len(raw) <= 1 << 20, 'bounded established artifact metadata required')
        metadata[key] = base.validate_artifact_metadata(json.loads(raw, object_pairs_hook=base.strict_pairs), expected)
    opener = urllib.request.build_opener(base.NoRedirect())
    try:
        opener.open(base.api_request('/repos/' + base.REPOSITORY + '/actions/artifacts/' + str(CONTROLLER['artifactId']) + '/zip'), timeout=15)
        raise RuntimeError('normal signed established-artifact redirect required')
    except urllib.error.HTTPError as redirect:
        base.require(redirect.code in (302, 303, 307), 'established artifact redirect status differs')
        location = redirect.headers.get('Location', '')
    parsed = urllib.parse.urlsplit(location)
    base.require(parsed.scheme == 'https' and parsed.port in (None, 443) and parsed.username is None and parsed.password is None and
                 parsed.hostname is not None and (parsed.hostname.endswith('.blob.core.windows.net') or parsed.hostname.endswith('.actions.githubusercontent.com')),
                 'normal established artifact storage host required')
    # New request deliberately contains no authorization. Never log the SAS URL.
    with urllib.request.urlopen(urllib.request.Request(location, headers={'User-Agent': 'YNX-established-source-intake'}), timeout=15) as response:
        raw = response.read(CONTROLLER['size'] + 1)
    base.require(len(raw) == CONTROLLER['size'] and hashlib.sha256(raw).hexdigest() == CONTROLLER['digest'],
                 'complete established controller ZIP bytes/SHA256 differ')
    archive = output / 'established-b8.zip'; archive.write_bytes(raw)
    with zipfile.ZipFile(archive) as z:
        infos = z.infolist()
        base.require(len(infos) == len(CATALOG) and {i.filename for i in infos} == CATALOG and
                     all(stat.S_IFMT(i.external_attr >> 16) in (0, stat.S_IFREG) and i.file_size <= 4 << 20 and not i.flag_bits & 1 for i in infos),
                     'closed bounded established controller ZIP required')
        base.require(z.testzip() is None, 'established controller CRC differs')
        files = {i.filename: z.read(i) for i in infos}
    result = verified_b8(base, files)
    base.write_new(output / 'GATE.json', result)
    base.write_new(output / 'OFFICIAL-METADATA.json', metadata)
    print(json.dumps(result, separators=(',', ':')))


def disposable_references(target):
    for process in Path('/proc').iterdir():
        if not process.name.isdecimal():
            continue
        candidates = [process / 'exe']
        try:
            candidates += list((process / 'fd').iterdir())
            for link in candidates:
                try:
                    value = Path(os.readlink(link).removesuffix(' (deleted)'))
                except FileNotFoundError:
                    continue
                if value == target or target in value.parents:
                    return int(process.name)
            with (process / 'maps').open('rb') as maps:
                raw = maps.read((16 << 20) + 1)
            if len(raw) > 16 << 20:
                raise RuntimeError('bounded live process mapping inventory exceeded')
            if (str(target) + '/').encode() in raw:
                return int(process.name)
        except FileNotFoundError:
            continue
    return None


def freshen(output):
    # Never performs a local desktop or general toolcache cleanup.
    if not (sys.platform == 'linux' and os.geteuid() == 0 and os.environ.get('GITHUB_ACTIONS') == 'true' and
            os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted' and os.environ.get('RUNNER_OS') == 'Linux' and
            os.environ.get('ImageOS') == 'ubuntu24'):
        raise RuntimeError('only the disposable Ubuntu24 GitHub-hosted source VM can be prepared')
    output.parent.mkdir(parents=True, exist_ok=True)
    target_disk = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    record = dict(atUnix=int(time.time()), imageOS=os.environ['ImageOS'], imageVersion=os.environ.get('ImageVersion'),
                  runnerEnvironment=os.environ['RUNNER_ENVIRONMENT'], runnerName=os.environ.get('RUNNER_NAME'),
                  diskBefore=shutil.disk_usage(target_disk)._asdict(), removed=[], skipped=[], initialDiskFloor=16 << 30)
    try:
        for target in DISPOSABLE_PREINSTALLED:
            if shutil.disk_usage(target_disk).free >= 16 << 30:
                break
            if not target.exists() or target.is_symlink() or not target.is_dir() or target.resolve(strict=True) != target or target.stat().st_uid != 0:
                record['skipped'].append(dict(path=str(target), reason='not the fixed real root-owned preinstalled directory'))
                continue
            user = disposable_references(target)
            if user is not None:
                raise RuntimeError('preinstalled directory is in use by actual PID ' + str(user))
            shutil.rmtree(target)
            record['removed'].append(dict(path=str(target), diskAfter=shutil.disk_usage(target_disk)._asdict()))
        record['diskAfter'] = shutil.disk_usage(target_disk)._asdict()
        if record['diskAfter']['free'] < 16 << 30:
            raise RuntimeError('prepared hosted VM still has less than original 16GiB floor')
    except BaseException as error:
        record['firstCause'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        with output.open('x') as out:
            json.dump(record, out, sort_keys=True); out.write('\n')
        os.chmod(output, 0o644)
    print(json.dumps(record, separators=(',', ':')))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('mode', choices=('gate-b8', 'freshen'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.mode == 'gate-b8':
        gate_b8(base_module(), args.output)
    else:
        freshen(args.output)
