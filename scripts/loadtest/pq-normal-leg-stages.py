"""Read receipt-pinned normal-node stage DATA; never run or qualify a window.

Reuse the original producer validators and first100 reducers. Each node retains
its exact snapshot, including failures, dropped attempts and latest-only data.
Finalize children overlap their parents; missing children are not elapsed zero.
"""
import copy
import hashlib
import importlib.util
from pathlib import Path
import re


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


commit = module('pq-commit-observation')
finalize = module('pq-finalize-observation')
stages = module('pq-first100-stage-summary')
require = commit.require


def _references(observation, field, kind):
    if observation is None:
        return {}
    require(type(observation) is dict and type(observation.get(field)) is list
            and len(observation[field]) <= 4, 'bounded original ' + kind + ' references required')
    result = {}
    for ref in observation[field]:
        node = ref.get('node')
        require(type(node) is int and 0 <= node < 4 and node not in result
                and ref.get('path') == f'{kind}-observation-node-{node}-original.json',
                'unique original ' + kind + ' node reference required')
        require(type(ref.get('bytes')) is int and 0 < ref['bytes'] <= commit.MAX_BYTES
                and type(ref.get('sha256')) is str and re.fullmatch('[0-9a-f]{64}', ref['sha256']),
                'bounded pinned original ' + kind + ' file required')
        result[node] = ref
    return result


def _summary(node, ref, snapshot, selected=None):
    snapshot = copy.deepcopy(snapshot)
    if selected is not None:
        snapshot['samples'] = [row for row in snapshot['samples'] if row['height'] in selected]
    record = dict(node=node, sha256=ref['sha256'], producerReportedUsable=True,
                  originalSnapshot=snapshot)
    return stages.commit_stages(dict(originalCommitCopies=dict(records=[record])))['nodes'][str(node)]


def _finalize_summary(observation):
    successful = [row for row in observation['samples'] if row['success']]
    return dict(retainedSuccessfulAttempts=len(successful),
                elapsed=stages.samples([row['elapsedNs'] for row in successful], len(successful)),
                parentStages={name: stages.samples([row['phaseNs'].get(name) for row in successful], len(successful))
                              for name in finalize.PHASES},
                children={name: stages.samples([row['childrenNs'].get(name) for row in successful], len(successful))
                          for name in sorted(finalize.CHILDREN)})


def read(receipt, original, binding):
    """Called only after the owning reader pins the receipt/controller/source.

    original(name, limit) uses the existing bounded original-file reader and
    records every read in the enclosing leg's provenance. No fallback scan may
    adopt an unreferenced file, including a stale file from another run.
    """
    commit_report = receipt.get('normalCommitObservation')
    finalize_report = receipt.get('normalFinalizeObservation')
    commits = _references(commit_report, 'originalSnapshots', 'commit')
    finalizes = _references(finalize_report, 'records', 'finalize')
    out = dict(schema='YNX-PERF-NORMAL-LEG-STAGES/v1', status='NOT_SUPPLIED',
               binding=copy.deepcopy(binding), firstCause=copy.deepcopy(receipt.get('firstCause')),
               expectedNodes=4, nodes={str(n): dict(commit=dict(status='NOT_SUPPLIED'),
                                                  finalize=dict(status='NOT_SUPPLIED')) for n in range(4)},
               originalCommitReadback=copy.deepcopy(commit_report),
               originalFinalizeReadback=copy.deepcopy(finalize_report),
               pooledAcrossNodes=False, pooledAcrossSources=False, stagesAdded=False,
               childrenOverlapParentPhases=True, allCommitAttemptsMeasured=False,
               independentFinality=False, performanceComparisonQualified=False,
               configuredBusinessDenominator=receipt.get('configuredFunctionalDenominator'))
    if not commits and not finalizes:
        return out
    created_raw = original('create-original.log', 1 << 20)
    created = commit.strict(created_raw)
    require(created['planSHA256'] == receipt['originalPlanSHA256'], 'original stage plan binding differs')
    chain_id, genesis = created['plan']['chainId'], created['plan']['originalGenesisHash']
    require(type(chain_id) is str and bool(chain_id) and type(genesis) is str
            and re.fullmatch('[0-9a-f]{64}', genesis), 'original stage chain/genesis required')
    out['originalCreate'] = dict(path='create-original.log', bytes=len(created_raw),
                                sha256=hashlib.sha256(created_raw).hexdigest(),
                                planSHA256=created['planSHA256'], chainID=chain_id, originalGenesisHash=genesis)
    heights = set()
    for row in receipt['functionalCohort']:
        height = row['height']
        require(type(height) is str and re.fullmatch('[1-9][0-9]*', height), 'original business height required')
        heights.add(int(height))
    out['businessHeights'] = sorted(heights)
    out['originalBusinessCohort'] = copy.deepcopy(receipt['functionalCohort'])
    producers, pids = {}, set()
    for node in sorted(commits.keys() | finalizes.keys()):
        matches = [row for row in receipt['processes'] if row['name'] == f'pq-node-{node}']
        require(len(matches) == 1, 'one original node process required')
        proc = matches[0]
        require(type(proc.get('pid')) is int and proc['pid'] > 0 and proc['pid'] not in pids
                and type(proc.get('startTicks')) is int and proc['startTicks'] > 0
                and proc.get('exited') is True and type(proc.get('rawReturnCode')) is int,
                'original stopped stage producer identity differs')
        pids.add(proc['pid']); producers[node] = proc
        out['nodes'][str(node)]['producer'] = copy.deepcopy(proc)

    def read_snapshot(node, ref, kind):
        proc = producers[node]
        require(type(ref.get('pid')) is int and ref['pid'] == proc['pid'], 'original stage reference PID differs')
        if kind == 'commit':
            require(ref.get('processName') == proc['name'] and ref.get('sourceStopped') is True,
                    'original Commit stopped reference differs')
        raw = original(ref['path'], commit.MAX_BYTES)
        require(len(raw) == ref['bytes'] and hashlib.sha256(raw).hexdigest() == ref['sha256'],
                'original stage file pin differs')
        return commit.strict(raw)

    commit_checkpoints, joined = {}, {}
    for node, ref in commits.items():
        snapshot = read_snapshot(node, ref, 'commit')
        value = dict(status='PRODUCER_UNUSABLE', originalFile=copy.deepcopy(ref),
                     originalSnapshot=copy.deepcopy(snapshot))
        out['nodes'][str(node)]['commit'] = value
        if ref.get('usable') is not True:
            continue
        require(snapshot == ref.get('rawOriginalObservation'), 'original Commit receipt/file copies differ')
        commit.validate_declared_contract(snapshot, producers[node]['pid'], chain_id, genesis)
        value.update(status='ORIGINAL_SAMPLES_VERIFIED', allRetained=_summary(node, ref, snapshot),
                     business=_summary(node, ref, snapshot, heights),
                     missingBusinessHeights=sorted(heights-{row['height'] for row in snapshot['samples']}))
        commit_checkpoints[str(node)] = dict(committed=dict(samples={row['height']: row for row in snapshot['samples']}))
    for node, ref in finalizes.items():
        snapshot = read_snapshot(node, ref, 'finalize')
        observed = finalize.validate(snapshot, pid=producers[node]['pid'], chain_id=chain_id, genesis_hash=genesis)
        require(type(ref.get('complete')) is bool and ref['complete'] is snapshot['captureComplete'],
                'original Finalize receipt coverage differs')
        value = dict(status='ORIGINAL_SAMPLES_VERIFIED', originalFile=copy.deepcopy(ref),
                     originalSnapshot=copy.deepcopy(snapshot), retainedSuccessStages=_finalize_summary(observed))
        out['nodes'][str(node)]['finalize'] = value
        known = commit_checkpoints.get(str(node), {}).get('committed', {}).get('samples', {})
        value['committed'] = finalize.business_heights(observed, set(known), list(known.values()))
        value['business'] = finalize.business_heights(observed, heights, list(known.values()))
        joined[str(node)] = value
    out.update(status='ORIGINAL_REFERENCED_STAGE_DATA',
               commitCheckpoints=finalize.four_node_checkpoints(commit_checkpoints),
               finalizeCommitCheckpoints=finalize.four_node_checkpoints(joined))
    # Detach derived joins too: consumers may annotate one arm without changing
    # another arm, original receipt snapshots, or a subsequent readback.
    return copy.deepcopy(out)
