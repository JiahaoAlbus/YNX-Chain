"""Exact legacy byte preservation for the additive, default-closed pair workflow.

Only declared pair additions are reversed. The complete original d778 workflow
must still hash identically; no generalized route normalization is permitted.
Standalone stdlib keeps original controller byte guards usable in sparse CI.
"""
import hashlib
import re

PROFILE = 'first100-held-public-owner-sequential-pair'
ORIGINAL_WORKFLOW_SHA256 = '90141a02cf15fc96a2513198b428d0ea1c403bffa74623bf6f1e68187b3d5f6d'
# Source-owned only; the original controller must bind both exact arms and CI.
# There is deliberately no environment, CLI or caller-provided enable switch.
WORKFLOW_PAIR_ENABLED = True
PAIR_JOBS = ('first100-held-controller-controls', 'first100-held-public-owner')


def remove_pair_job_guards(candidate):
    """Accept only the declared source state, including all eleven old routes."""
    if type(WORKFLOW_PAIR_ENABLED) is not bool:
        raise RuntimeError('source-frozen pair workflow state must be boolean')
    prefix, jobs = candidate.split('jobs:\n', 1)
    current = None
    observed = []
    output = []
    for line in jobs.splitlines(keepends=True):
        match = re.fullmatch(r'  ([a-z0-9-]+):\n', line)
        if match:
            current = match[1]
        if line.startswith('    if:'):
            enabled = WORKFLOW_PAIR_ENABLED and current in PAIR_JOBS
            suffix = " && (inputs.load_profile != '"+PROFILE+"' || "+str(enabled).lower()+")\n"
            if current in observed or not line.endswith(suffix):
                raise RuntimeError('exact pair job isolation differs: '+str(current))
            observed.append(current)
            line = line[:-len(suffix)]+'\n'
        output.append(line)
    if len(observed) != 13 or not set(PAIR_JOBS) <= set(observed):
        raise RuntimeError('all original job routes must retain pair isolation')
    return prefix+'jobs:\n'+''.join(output)


def original_workflow(candidate):
    """Reverse only declared pair edits; hash proves old single-arm bytes remain."""
    yes,no = "inputs.load_profile == '"+PROFILE+"'", "inputs.load_profile != '"+PROFILE+"'"
    candidate = remove_pair_job_guards(candidate)
    candidate = candidate.replace('            /scripts/loadtest/same-runner/pq-same-runner-workflow-legacy.py\n','')
    # The original inline controls compare complete route strings. Undo only
    # their declared pair suffixes too; the final hash still protects all bytes.
    candidate = candidate.replace(' && '+no+' && ('+no+' || false)\":\n','\":\n')
    candidate = candidate.replace(' && ('+no+' || false)\"]:\n','\"]:\n')
    text = re.sub(r'      # BEGIN YNX_PAIR_PURE_CONTROLS\n.*?      # END YNX_PAIR_PURE_CONTROLS\n\n','',candidate,flags=re.S)
    text = re.sub(r'      # BEGIN YNX_PAIR_RUNTIME_STEPS\n.*?      # END YNX_PAIR_RUNTIME_STEPS\n','',text,flags=re.S)
    text = text.replace(PROFILE+', first100-held-public-owner, first100-held-public-owner-business]',
                        'first100-held-public-owner, first100-held-public-owner-business]',1)
    text = text.replace(' && '+no+'\n    name: Normal original','\n    name: Normal original',1)
    prefix,job = text.split('  first100-held-public-owner:\n',1)
    job = job.replace("name: ${{ "+yes+" && 'Held public-owner normal504 sequential pair' || ",'name: ${{ ',1)
    job = job.replace("inputs.load_profile == 'first100-held-public-owner-business' || "+yes+')',
                      "inputs.load_profile == 'first100-held-public-owner-business')",1)
    job = job.replace('timeout-minutes: ${{ '+yes+' && 45 || 18 }}','timeout-minutes: 18',1)
    job = job.replace("sparse-checkout: ${{ "+yes+" && '/scripts/loadtest/same-runner/' || '/scripts/loadtest/pq-first100-held-ci.py' }}",
                      'sparse-checkout: /scripts/loadtest/pq-first100-held-ci.py',1)
    job = job.replace('        if: '+no+'\n','').replace('        if: always() && '+no+'\n','        if: always()\n')
    original = prefix+'  first100-held-public-owner:\n'+job
    if hashlib.sha256(original.encode()).hexdigest() != ORIGINAL_WORKFLOW_SHA256:
        raise RuntimeError('original single-arm workflow bytes or pair isolation changed')
    return original
