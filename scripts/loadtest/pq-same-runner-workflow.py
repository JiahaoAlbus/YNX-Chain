"""Original pair workflow boundary: frozen checkouts and official upload bindings.

The adjacent YAML is an inactive installable candidate for the original
controller owner. This module cannot populate QUALIFIED_PAIR_BINDING, dispatch,
retry, sign, resume an operation, or replace terminal original-ZIP readback.
"""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import stat


spec = importlib.util.spec_from_file_location('same_runner_workflow_controller',
    Path(__file__).with_name('pq-same-runner-controller.py'))
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
p, r, require = c.producer, c.reader, c.require
PROFILE = c.PROFILE
ORIGINAL_CONTROLLER = 'd77856ad408434ffce03277bee76d0c330c2cc62'
JOB_MINUTES = 45
EXECUTION_MINUTES = 35
ARM_SECONDS = 900
ORIGINAL_WORKFLOW_SHA256 = '90141a02cf15fc96a2513198b428d0ea1c403bffa74623bf6f1e68187b3d5f6d'


spec = importlib.util.spec_from_file_location('same_runner_workflow_legacy',
    Path(__file__).with_name('pq-same-runner-workflow-legacy.py'))
legacy = importlib.util.module_from_spec(spec); spec.loader.exec_module(legacy)
original_workflow = legacy.original_workflow


def context(environment=None):
    environment = os.environ if environment is None else environment
    binding = c.bridge.QUALIFIED_PAIR_BINDING
    require(binding is not None, 'original pair source/Tools/CI binding NOT_SUPPLIED')
    require(legacy.WORKFLOW_PAIR_ENABLED is True, 'source-frozen pair workflow is disabled')
    binding = copy.deepcopy(binding)
    configurations = c.validate_binding(binding)
    token = environment.get('GH_TOKEN') or environment.get('GITHUB_TOKEN')
    environment.pop('GH_TOKEN', None); environment.pop('GITHUB_TOKEN', None)
    os.environ.pop('GH_TOKEN', None); os.environ.pop('GITHUB_TOKEN', None)
    api = c.ActionsMetadata(token)
    pair = c.active_pair(environment, api, configurations)
    root = Path(environment['GITHUB_WORKSPACE']).resolve(strict=True)/'controller'
    require(c.controller_root(__file__) == root, 'original workflow controller checkout differs')
    c.checkout(root, pair['controllerCommit'])
    parent = Path(environment['RUNNER_TEMP']).resolve(strict=True)
    output = parent/('pq-same-runner-pair-%d-%d' % (pair['runID'],pair['jobID']))
    return dict(binding=binding, pair=pair, api=api, output=output, parent=parent)


def checkout_values(value):
    """Only immutable source-frozen values may reach checkout action outputs."""
    binding = value['binding']; c.validate_binding(binding)
    result = {'output':str(value['output'])}
    for arm in r.ARMS:
        frozen = binding['arms'][arm]
        for name in ('source','tools','supplier'):
            result[arm+'_'+name] = r.pin(frozen[name],40)
    go = binding['arms']['before']['go']
    require(re.fullmatch(r'go[1-9][0-9]*\.[0-9]+\.[0-9]+',go), 'exact release Go version required')
    result['go'] = go[2:]
    require(all(type(v) is str and v and '\n' not in v and '\r' not in v for v in result.values()),
            'single-line original action outputs required')
    return result


def action_outputs(values, filename, parent):
    path = p.absolute_path(filename)
    require(path.is_relative_to(parent) and path != parent, 'original runner output file required')
    with p.directory_fd(path.parent) as directory:
        fd = os.open(path.name,os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=directory)
        try:
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == 0,
                    'empty single-use original runner output file required')
            raw = ''.join(k+'='+v+'\n' for k,v in values.items()).encode()
            require(len(raw) <= 8192, 'bounded original action outputs required')
            offset = 0
            while offset < len(raw):
                count = os.write(fd,raw[offset:]); require(count > 0,'action output write stopped'); offset += count
            os.fsync(fd)
            after = os.fstat(fd)
            require(p.file_identity(after) == p.file_identity(os.stat(path.name,dir_fd=directory,follow_symlinks=False))
                    and after.st_nlink == 1 and after.st_size == len(raw), 'runner output file replaced')
        finally:
            os.close(fd)


def state_for(value):
    state = r.strict(p.public_bytes(value['output']/'PRODUCER.json'))
    for key in ('controllerCommit','runID','jobID','runAttempt','runnerID','runnerName'):
        require(type(state['pair'][key]) is type(value['pair'][key])
                and state['pair'][key] == value['pair'][key], 'original producer run/job/runner differs')
    require(state.get('unknownReplayed') is False, 'original operation replay refused')
    return state


def artifact_outputs(environment, label):
    prefix = 'YNX_'+label.upper()+'_ARTIFACT_'
    identifier = environment.get(prefix+'ID','')
    digest = environment.get(prefix+'DIGEST','')
    require(type(identifier) is str and re.fullmatch(r'[1-9][0-9]*',identifier),
            'original upload action artifact ID missing')
    if digest.startswith('sha256:'): digest = digest[7:]
    return r.positive(int(identifier)),r.pin(digest)


def metadata(value, labels, environment):
    api, pair = value['api'],value['pair']
    run = api.read('runs/'+str(pair['runID']))
    job = api.read('jobs/'+str(pair['jobID']))
    artifacts = api.read('runs/'+str(pair['runID'])+'/artifacts?per_page=100')
    require(type(artifacts) is dict and type(artifacts.get('total_count')) is int
            and type(artifacts.get('artifacts')) is list
            and artifacts['total_count'] == len(artifacts['artifacts']) <= 100,
            'complete bounded original artifact inventory required')
    require(run.get('status') == 'in_progress' and type(run.get('id')) is int and run['id'] == pair['runID']
            and run.get('head_sha') == pair['controllerCommit'] and run.get('head_branch') == r.BRANCH
            and run.get('event') == 'workflow_dispatch' and type(run.get('run_attempt')) is int
            and run['run_attempt'] == 1 and run.get('path') == c.WORKFLOW
            and run.get('repository',{}).get('full_name') == c.REPOSITORY,
            'original active upload run differs')
    require(type(job.get('id')) is int and job['id'] == pair['jobID']
            and type(job.get('run_id')) is int and job['run_id'] == pair['runID']
            and type(job.get('run_attempt')) is int and job['run_attempt'] == 1
            and job.get('head_sha') == pair['controllerCommit'] and job.get('name') == r.JOB
            and job.get('status') == 'in_progress' and type(job.get('runner_id')) is int
            and job['runner_id'] == pair['runnerID']
            and job.get('runner_name') == pair['runnerName'], 'original active upload job/runner differs')
    seen, hashes = set(),set()
    for label in labels:
        identifier,digest = artifact_outputs(environment,label)
        name = 'pq-first100-same-runner-%d-1-%s' % (pair['runID'],label)
        matches = [a for a in artifacts['artifacts'] if a.get('name') == name]
        steps = [s for s in job.get('steps',[]) if s.get('name') == 'Preserve same-runner '+label+' originals']
        require(len(matches) == len(steps) == 1 and steps[0].get('status') == 'completed'
                and steps[0].get('conclusion') == 'success', 'original successful upload step missing')
        item = matches[0]
        require(type(item.get('id')) is int and item['id'] == identifier and identifier not in seen
                and digest not in hashes and item.get('digest') == 'sha256:'+digest
                and item.get('expired') is False and type(item.get('size_in_bytes')) is int
                and 0 < item['size_in_bytes'] <= (1<<20 if label == 'manifest' else 128<<20)
                and type(item.get('workflow_run',{}).get('id')) is int
                and item['workflow_run']['id'] == pair['runID']
                and item['workflow_run'].get('head_sha') == pair['controllerCommit']
                and item['workflow_run'].get('head_branch') == r.BRANCH,
                'original official artifact/action digest or identity differs')
        seen.add(identifier);hashes.add(digest)
    return run,job,artifacts


def preserve_failure(value, error):
    """Publish existing first cause without manufacturing an absent arm/marker."""
    state = state_for(value)
    destination = value['output']/'manifest'
    if not destination.exists(): p.mkdir_new(destination)
    p.write_new(destination/'INCOMPLETE.json',dict(schema='YNX-PERF-PAIR-PUBLICATION-INCOMPLETE/v1',
        originalProducer=state, publicationFailure=p.failure(error),
        runtimeQualified=False, originalOperationsReplayed=False))


def seal(value, environment):
    try:
        state = state_for(value)
        require(state['status'] == 'PAYLOADS_SEALED_AWAITING_ORIGINAL_ACTIONS_UPLOADS'
                and state['firstCause'] is None, 'original first cause blocks complete pair upload')
        originals = metadata(value,r.ARMS,environment)
        pair = p.seal_manifest(value['output'],originals)
        raw = p.public_bytes(value['output']/'manifest/same-runner-pair.json')
        p.write_new(value['output']/'MANIFEST-SEALED.json',dict(bytes=len(raw),sha256=r.digest(raw)))
        return pair
    except BaseException as error:
        # Preservation errors must never replace the initial upload/source error.
        try: preserve_failure(value,error)
        except BaseException as secondary:
            error.add_note('Original publication preservation also failed: '+str(p.failure(secondary)))
        raise


def verify(value, environment):
    state = state_for(value)
    require(state['status'] == 'PAYLOADS_SEALED_AWAITING_ORIGINAL_ACTIONS_UPLOADS'
            and state['firstCause'] is None, 'original incomplete arms cannot qualify uploads')
    originals = metadata(value,('before','after','manifest'),environment)
    files = p.snapshot_tree(value['output']/'manifest')
    require(set(files) == {'same-runner-pair.json'}, 'original complete manifest only; retain failure evidence')
    raw = files['same-runner-pair.json']
    require(r.strict(p.public_bytes(value['output']/'MANIFEST-SEALED.json')) == dict(bytes=len(raw),sha256=r.digest(raw)),
            'sealed manifest changed after upload')
    pair = r.strict(raw)
    require(all(pair[k] == state['pair'][k] for k in state['pair'] if k != 'arms') and
            [a['arm'] for a in pair['arms']] == list(r.ARMS), 'uploaded manifest producer identity differs')
    for arm in state['arms']:
        label = arm['arm'];require(p.inventory(p.snapshot_tree(value['output']/label)) == arm['payloadFiles'],
                                 'original arm payload changed after upload')
        name = 'pq-first100-same-runner-%d-1-%s' % (pair['runID'],label)
        item = next(a for a in originals[2]['artifacts'] if a['name'] == name)
        declaration = next(a for a in pair['arms'] if a['arm'] == label)
        require(declaration['archive'] == dict(bytes=item['size_in_bytes'],sha256=item['digest'][7:]),
                'manifest arm archive differs from official original metadata')
    return dict(schema='YNX-PERF-PAIR-UPLOAD-BINDING/v1',status='OFFICIAL_UPLOADS_BOUND_AWAITING_TERMINAL_ORIGINAL_READBACK',
        runID=pair['runID'],jobID=pair['jobID'],configuredDemandPerArm=500,
        terminalOriginalZIPReadback=False,runtimeQualified=False,originalOperationsReplayed=False)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('phase',choices=('checkouts','seal','verify'))
    args = parser.parse_args(argv)
    value = context()
    if args.phase == 'checkouts':
        result = checkout_values(value)
        action_outputs(result,os.environ['GITHUB_OUTPUT'],value['parent'])
        return dict(status='FROZEN_CHECKOUTS_ONLY',runtimeQualified=False)
    return seal(value,os.environ) if args.phase == 'seal' else verify(value,os.environ)


if __name__ == '__main__': print(json.dumps(main(),sort_keys=True))
