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


def _finalize_summary(observation, denominator=None):
    successful = [row for row in observation['samples'] if row['success']]
    if denominator is None:
        denominator = len(successful)
    return dict(retainedSuccessfulAttempts=len(successful),
                elapsed=stages.samples([row['elapsedNs'] for row in successful], denominator),
                parentStages={name: stages.samples([row['phaseNs'].get(name) for row in successful], denominator)
                              for name in finalize.PHASES},
                children={name: stages.samples([row['childrenNs'].get(name) for row in successful], denominator)
                          for name in sorted(finalize.CHILDREN)})


def _fee_history_materialization(records):
    stage = 'seal.fee_materialize'
    rows = []
    for row in records:
        sample = row['finalize']
        elapsed, count = None, None
        if sample is not None:
            elapsed = sample['childrenNs'].get(stage)
            counts = sample.get('counts', {})
            require(type(counts) is dict, 'original fee materialization counts map required')
            if stage in counts:
                count = counts[stage]
                require(type(count) is int and 0 <= count < 1 << 64,
                        'original fee materialization count must be uint64')
        rows.append(dict(height=row['height'], elapsedNs=elapsed, materializedEventCount=count))
    counts = [row['materializedEventCount'] for row in rows if row['materializedEventCount'] is not None]
    return dict(stage=stage, records=rows,
                timing=stages.samples([row['elapsedNs'] for row in rows], len(rows)),
                eventCounts=dict(denominator=len(rows), observed=len(counts), missing=len(rows)-len(counts),
                                 minEvents=min(counts) if counts else None, maxEvents=max(counts) if counts else None),
                pairedObservationCount=sum(row['elapsedNs'] is not None and row['materializedEventCount'] is not None for row in rows),
                copyOnlyElapsedNs=None, allocationOnlyElapsedNs=None, instrumentationOverheadNs=None,
                overheadSubtracted=False, perEventCostInferred=False,
                meaning='Original seal materialization span includes allocation, committed-base copy and pending-chain materialization. '
                        'Count is full returned history length, not incremental fee work. Copy/allocation components and measurement '
                        'overhead were not separately timed; this span is already inside seal, never added to it.')


def business_stage_costs(commit_snapshot, finalize_observation, heights):
    """Reduce already validated originals for one node and selected business heights.

    The enclosing reader owns file/process/source pins. This reducer grants no
    evidence authority. Whole-block costs cannot be divided into transfer costs;
    retained history counts are original inventories, not added work or rates.
    """
    heights = list(heights)
    require(all(type(h) is int and h > 0 for h in heights) and len(set(heights)) == len(heights),
            'unique positive original business heights required')
    heights.sort()
    commit_samples = commit_snapshot['samples'] if commit_snapshot is not None else []
    committed = {row['height']: row for row in commit_samples if row['height'] in heights}
    observation = finalize_observation if finalize_observation is not None else dict(samples=[], dropped=0)
    joined = finalize.business_heights(observation, set(heights), commit_samples)['samples']
    records = [dict(height=height, commit=copy.deepcopy(committed.get(height)),
                    finalize=copy.deepcopy(joined.get(height))) for height in heights]
    return dict(heightDenominator=len(heights), heights=heights, records=records,
                observedCommitHeights=sorted(committed), missingCommitHeights=sorted(set(heights)-committed.keys()),
                observedFinalizeCommitHeights=sorted(joined), missingFinalizeCommitHeights=sorted(set(heights)-joined.keys()),
                finalizeStages=_finalize_summary(dict(samples=list(joined.values())), len(heights)),
                feeHistoryMaterialization=_fee_history_materialization(records),
                denominatorMeaning='Original distinct business block heights, not transaction demand; missing joins censor stage percentiles.',
                commitStorageMeaning='Each original persistence storage is retained per height; no pooling across storage or nodes.',
                countsMeaning='Original per-block inventories/attempt counters; fee history count is not incremental work or a per-fee timing.',
                stagesAdded=False, childrenOverlapParentPhases=True,
                perTransactionCostsInferred=False, independentFinality=False)


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
    heights = set()
    for row in receipt.get('functionalCohort', []):
        height = row['height']
        require(type(height) is str and re.fullmatch('[1-9][0-9]*', height), 'original business height required')
        heights.add(int(height))
    out['businessHeights'] = sorted(heights)
    out['originalBusinessCohort'] = copy.deepcopy(receipt.get('functionalCohort'))
    for value in out['nodes'].values():
        value['businessStageCosts'] = business_stage_costs(None, None, heights)
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
    require(type(receipt.get('functionalCohort')) is list, 'original functional cohort required')
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
    for value in out['nodes'].values():
        c, f = value['commit'], value['finalize']
        snapshot = c.get('originalSnapshot') if c['status'] == 'ORIGINAL_SAMPLES_VERIFIED' else None
        observation = f['originalSnapshot']['observation'] if f['status'] == 'ORIGINAL_SAMPLES_VERIFIED' else None
        value['businessStageCosts'] = business_stage_costs(snapshot, observation, heights)
    out.update(status='ORIGINAL_REFERENCED_STAGE_DATA',
               commitCheckpoints=finalize.four_node_checkpoints(commit_checkpoints),
               finalizeCommitCheckpoints=finalize.four_node_checkpoints(joined))
    # Detach derived joins too: consumers may annotate one arm without changing
    # another arm, original receipt snapshots, or a subsequent readback.
    return copy.deepcopy(out)
