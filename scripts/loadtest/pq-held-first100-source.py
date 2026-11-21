"""Verify the fixed Linux job before opening the held-session performance window."""
import json
import os
import urllib.request

PREVIOUS_SOURCE = '429028220e2f56d4bceb70f4cc0d50a49acfde1b'
PREVIOUS_TREE = '515dfa5024ea8d15ad48f3193822800145b30317'
STREAM_SOURCE = '763b7f8f422f38f39e747a4f7f6cfb6405a0b96d'
STREAM_TREE = 'f083502be012d84b3cd50e383c3bf2a922d8c2dd'
PREPARED_SOURCE = '0b515124bda8ff7efaf3ec03456d69dee2c6ad18'
PREPARED_TREE = 'd2cf1d0620a2157ef2660331eaf1a166049549b9'
FINAL_FENCE_SOURCE = '59f7885d11bd3eeb5d27dce7232779aae480a806'
FINAL_FENCE_TREE = 'f7d7cf8f6df57d931b2f15bb622405764de27d6b'
SOURCE = 'c697abae262c3be7859f235f45e9e8447bbccf63'
TREE = 'da151a9140c50e93379abaa3894b254ea44e4547'
RUN = 44880037485
JOB = 136773095628
REPOSITORY = 'JiahaoAlbus/YNX-Chain'
BRANCH = 'codex/ynx-pq-perf-source-20261108'
REQUIRED_STEPS = (
    'Check reachable vulnerabilities in the eight production runtime commands',
    'Verify Linux window controls without starting a node',
    'Verify complete state bridge and sponsor continuity',
    'Qualify original Finalize phase observation tests',
    'Verify prepared signing and held proof sessions on original inputs',
    'Retain original held session public test evidence',
    'Verify exact optional live getter composition without enabling a carrier',
    'Preserve only public optional live source evidence',
)

# These fixtures run in the producer's delivery job, not in focused-go.  This
# additional contract is intentionally separate from the frozen 59f gate: it
# cannot qualify a successor until its exact source and CI are bound by the
# owning controller.
DELIVERY_STEPS = (
    'Verify initial registration and funded transfer through the original proof CLI',
    'Verify exact transaction Host selection and original acquire-current',
    'Verify normal Host source producer with original signed transaction fixture',
)
# This commit's three steps explicitly assert the corresponding fixture PASS.
# A successful same-named step in another revision need not reject a Go skip.
DELIVERY_SOURCE = 'c697abae262c3be7859f235f45e9e8447bbccf63'
DELIVERY_BRANCH = 'codex/ynx-pq-perf-source-20261108'


def validate_delivery(run, jobs, *, source, branch):
    """Check the original same-run delivery job; grant no runtime permission."""
    import re
    if not (type(source) is str and re.fullmatch(r'[0-9a-f]{40}', source)
            and source == DELIVERY_SOURCE and branch == DELIVERY_BRANCH
            and type(run) is dict and type(run.get('id')) is int and run['id'] > 0
            and run.get('head_sha') == source and run.get('head_branch') == branch
            and run.get('event') == 'push' and run.get('run_attempt') == 1
            and run.get('workflow_id') == 322643672
            and run.get('repository', {}).get('full_name') == REPOSITORY
            and run.get('path') == '.github/workflows/resource-market-ci.yml'
            and run.get('status') == 'completed' and run.get('conclusion') == 'success'):
        raise RuntimeError('exact successful original push run required for delivery')
    if not (type(jobs) is list and len(jobs) <= 100):
        raise RuntimeError('bounded original same-run job inventory required')
    matches = [job for job in jobs if type(job) is dict and job.get('name') == 'protocol-delivery']
    if len(matches) != 1:
        raise RuntimeError('unique original protocol-delivery job required')
    job = matches[0]
    if not (type(job.get('id')) is int and job['id'] > 0 and job.get('run_id') == run['id']
            and job.get('run_attempt') == 1 and job.get('head_sha') == source
            and job.get('head_branch') == branch and job.get('status') == 'completed'
            and job.get('conclusion') == 'success' and type(job.get('steps')) is list):
        raise RuntimeError('original same-run delivery identity or outcome differs')
    for name in DELIVERY_STEPS:
        steps = [step for step in job['steps'] if type(step) is dict and step.get('name') == name]
        if len(steps) != 1 or (steps[0].get('status'), steps[0].get('conclusion')) != ('completed', 'success'):
            raise RuntimeError('original delivery fixture step incomplete: ' + name)
    return dict(source=source, run=run['id'], job=job['id'], requiredSteps=list(DELIVERY_STEPS),
                runtimePermissionGranted=False, independentFinality=False)


def validate(run, job):
    def succeeded(value):
        return (value.get('head_sha') == SOURCE and value.get('head_branch') == BRANCH
                and value.get('status') == 'completed' and value.get('conclusion') == 'success')

    if not (run.get('id') == RUN and run.get('event') == 'push'
            and run.get('run_attempt') == 1 and run.get('workflow_id') == 322643672
            and run.get('repository', {}).get('full_name') == REPOSITORY
            and run.get('path') == '.github/workflows/resource-market-ci.yml'
            and succeeded(run) and job.get('id') == JOB and job.get('run_id') == RUN
            and job.get('name') == 'focused-go' and succeeded(job)):
        raise RuntimeError('held first100 requires its fixed Linux and tagged live getter evidence')
    for name in REQUIRED_STEPS:
        steps = [step for step in job['steps'] if step['name'] == name]
        if len(steps) != 1 or (steps[0]['status'], steps[0]['conclusion']) != ('completed', 'success'):
            raise RuntimeError('held first100 CI step incomplete: ' + name)
    return dict(source=SOURCE, sourceTree=TREE, run=RUN, job=JOB, requiredSteps=list(REQUIRED_STEPS),
                sourceOnlyQualified=True, runtimePermissionGranted=False)


def validate_successor(run, focused_job, jobs):
    """Both original jobs must pass for a future exact successor qualification."""
    focused = validate(run, focused_job)
    if not (type(jobs) is list and len(jobs) <= 100):
        raise RuntimeError('bounded original same-run job inventory required')
    matches = [job for job in jobs if type(job) is dict and job.get('name') == 'focused-go']
    if not (len(matches) == 1 and all(matches[0].get(key) == focused_job.get(key) for key in
                                      ('id', 'run_id', 'run_attempt', 'head_sha', 'head_branch', 'status', 'conclusion'))):
        raise RuntimeError('focused job differs from original same-run inventory')
    delivery = validate_delivery(run, jobs, source=SOURCE, branch=BRANCH)
    return dict(focused, delivery=delivery)


def qualification():
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise RuntimeError('held first100 CI metadata redirect refused')

    opener = urllib.request.build_opener(NoRedirect)
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'ynx-held-first100'}
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    values = []
    for endpoint in (f'runs/{RUN}', f'jobs/{JOB}', f'runs/{RUN}/jobs?per_page=100'):
        url = f'https://api.github.com/repos/{REPOSITORY}/actions/{endpoint}'
        with opener.open(urllib.request.Request(url, headers=headers), timeout=15) as response:
            raw = response.read((1 << 20) + 1)
            if response.status != 200 or response.url != url or len(raw) > 1 << 20:
                raise RuntimeError('bounded original held first100 CI metadata required')
            values.append(json.loads(raw))
    inventory = values[2]
    if not (type(inventory) is dict and type(inventory.get('total_count')) is int
            and type(inventory.get('jobs')) is list and inventory['total_count'] == len(inventory['jobs'])
            and len(inventory['jobs']) <= 100):
        raise RuntimeError('complete bounded original delivery job inventory required')
    return validate_successor(values[0], values[1], inventory['jobs'])
