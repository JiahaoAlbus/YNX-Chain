"""Verify the fixed Linux job before opening the held-session performance window."""
import json
import os
import urllib.request

SOURCE = '8e0e6b94254a2ae8c1508e1b55014b4d845b4dc2'
TREE = '1db9efadc9c1d12dc21890bd6bf0614cf81e6fd9'
RUN = 43425913496
JOB = 131887160214
REPOSITORY = 'JiahaoAlbus/YNX-Chain'
BRANCH = 'codex/ynx-pq-perf-source-20261108'
REQUIRED_STEPS = (
    'Check reachable vulnerabilities in the eight production runtime commands',
    'Verify Linux window controls without starting a node',
    'Verify prepared signing and held proof sessions on original inputs',
    'Retain original held session public test evidence',
    'Verify exact optional live getter composition without enabling a carrier',
    'Preserve only public optional live source evidence',
)


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
    for endpoint in (f'runs/{RUN}', f'jobs/{JOB}'):
        url = f'https://api.github.com/repos/{REPOSITORY}/actions/{endpoint}'
        with opener.open(urllib.request.Request(url, headers=headers), timeout=15) as response:
            raw = response.read((1 << 20) + 1)
            if response.status != 200 or response.url != url or len(raw) > 1 << 20:
                raise RuntimeError('bounded original held first100 CI metadata required')
            values.append(json.loads(raw))
    return validate(*values)
