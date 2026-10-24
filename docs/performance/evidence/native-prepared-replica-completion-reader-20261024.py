"""Offline replica durability observations from qualified original run400919.

Arguments: exact original qualified verdict JSON, NEW output JSON.
Never starts nodes or changes admission; third-of-four durability is NOT the
earliest BFT quorum formation instant or a voting-power quorum calculation.
"""
import copy
import hashlib
import importlib.util
import json
import math
import subprocess
import sys
from array import array
from pathlib import Path


def pin(path):
    raw = path.read_bytes()
    return dict(path=str(path), bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def replica_join_type(evidence):
    class ReplicaJoin(evidence.NodeCompletionJoin):
        labels = ('offerToFirstReplicaDurableCommit', 'offerToThirdReplicaDurableCommit', 'offerToAllReplicaDurableCommit', 'replicaDurableCommitSpread')

        def __init__(self, endpoints, phases, timeline):
            super().__init__(endpoints, phases, timeline, 8192)
            self.histograms = [array('Q', [0]) * 60001 for _ in self.labels]
            self.minimum = [None] * 4
            self.maximum = [0] * 4
            self.width = [0] * 4
            self.first_row = None

        def add(self, row):
            super().add(row)  # Original endpoint/publication/clock checks stay mandatory.
            height, _, _ = evidence.qualified_terminal_publication(row)
            offered = evidence.utc_nanoseconds(row['offeredAt'])
            lows, highs, clock_lows, clock_highs = [], [], [], []
            reference = None
            for indexed, drift in self.nodes.values():
                evidence.need(height in indexed, 'replica business height absent')
                point, (_, committed) = indexed[height]
                identity = tuple(point[k] for k in ('blockHash', 'appHash', 'transactions', 'codeZeroTransactions'))
                evidence.need(point['transactions'] > 0 and point['transactions'] == point['codeZeroTransactions'], 'replica business block coverage differs')
                evidence.need(reference is None or reference == identity, 'replica block or post-state identity differs')
                reference = identity
                error = drift + self.clock['maximumAbsWallDriftNs']
                evidence.need(offered <= committed + error, 'replica commit precedes offer beyond calibration')
                lows.append(max(0, committed - offered - error))
                highs.append(max(0, committed - offered + error))
                clock_lows.append(committed - drift)
                clock_highs.append(committed + drift)
            lows.sort()
            highs.sort()
            bounds = [(lows[i], highs[i]) for i in (0, 2, 3)]
            # The same offered timestamp cancels in replica-to-replica spread.
            bounds.append((max(0, max(clock_lows) - min(clock_highs)), max(clock_highs) - min(clock_lows)))
            for i, (low, high) in enumerate(bounds):
                evidence.need(0 <= low <= high < 2**63, 'invalid replica completion interval')
                self.histograms[i][min(high // 1000000, 60000)] += 1
                self.minimum[i] = low if self.minimum[i] is None else min(self.minimum[i], low)
                self.maximum[i] = max(self.maximum[i], high)
                self.width[i] = max(self.width[i], high - low)
            if self.first_row is None:
                self.first_row = dict(row)

        def replica_result(self):
            evidence.need(self.records == 8192, 'replica full signed record coverage differs')
            distributions = {}
            for i, label in enumerate(self.labels):
                ranks = [math.ceil(self.records * q / 100) for q in (50, 95, 99)]
                seen, rank = 0, 0
                dist = dict(samples=self.records, resolutionNs=1000000, overflowSamples=self.histograms[i][-1], maximumIntervalWidthNs=self.width[i])
                for bucket, count in enumerate(self.histograms[i]):
                    seen += count
                    while rank < 3 and seen >= ranks[rank]:
                        dist[('p50', 'p95', 'p99')[rank]] = dict(lowerNs=max(self.minimum[i], bucket * 1000000 - self.width[i]), upperNs=min(self.maximum[i], (bucket + 1) * 1000000 - 1) if bucket < 60000 else self.maximum[i])
                        rank += 1
                    if rank == 3:
                        break
                distributions[label] = dist
            return distributions

    return ReplicaJoin


def run(source, output):
    raw = source.read_bytes()
    assert len(raw) == 495446 and hashlib.sha256(raw).hexdigest() == 'a7a3c65a1a21aa5eb3a869b9e1442b2da38bf6382539d27934ca3581443d304a'
    qualified = json.loads(raw)
    assert qualified['runId'] == 40091935654 and qualified['sourceCommit'] == '142dc802458590ce20e809089cb794897cb3fe91'
    assert qualified['nativePairQualified'] is True and qualified['slotReturned'] is True
    readers = {x['repositoryPath']: x for x in qualified['frozenReaders']}
    for item in readers.values():
        assert pin(Path(item['path'])) == {k: item[k] for k in ('path', 'bytes', 'sha256')}
    evidence = load('original_replica_evidence', Path(readers['scripts/loadtest/native-stream-evidence.py']['path']))
    controller = load('original_replica_controller', Path(readers['scripts/loadtest/supply-linux-window.py']['path']))

    ReplicaJoin = replica_join_type(evidence)

    cases = []
    for case in qualified['cases']:
        receipt_path = Path(case['receipt']['path'])
        assert pin(receipt_path) == case['receipt']
        receipt = evidence.strict_json(evidence.capture(receipt_path, 16 << 20))
        root = receipt_path.parent.parent
        network = root / 'network'
        report_raw = evidence.capture(network / 'transactions-result.json', 16 << 20)
        assert evidence.digest(report_raw) == receipt['resultSHA256']
        report = evidence.strict_json(report_raw)
        measurement = controller.validate_native_stream_report(report, network, runtime_network=Path(receipt['case']) / 'network', pacing='bounded-cadence', expected_input_reuse=True, expected_prepared_certificate=receipt.get('nativePreparedCertificate', False))
        assert measurement == receipt['measurement']
        logs = [root / ('abci-' + str(i) + '.log') for i in range(4)]
        parser = readers['scripts/loadtest/node-phase-timing.mjs']['path']
        code = "import fs from 'node:fs';import{pathToFileURL}from'node:url';const{readNodePhaseTiming:r}=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify(process.argv.slice(2).map(p=>r(fs.readFileSync(p,'utf8')))));"
        phases = json.loads(subprocess.check_output(['/opt/homebrew/bin/node', '--input-type=module', '-e', code, parser] + list(map(str, logs)), timeout=10))
        assert phases == receipt['nodePhases']
        manifest_raw = evidence.capture(network / 'network-manifest.json', 1 << 20)
        manifest = evidence.strict_json(manifest_raw)
        endpoints = [n['rpcUrl'] for n in manifest['nodes']]
        initial = evidence.strict_json(evidence.capture(network / 'transactions.json', 16 << 20))['transactions']
        join = ReplicaJoin(endpoints, phases, measurement['timeSeries'])
        proof = evidence.verify_streams(network, str(Path(receipt['case']) / 'network'), str(Path(receipt['case']) / 'network/transactions-result.json'), manifest_raw, initial, report['readySenders']['intentSegments'], report['terminalStream'], report['transactions'], 4, 64 << 20, node_completion_join=join)
        negatives = []
        for mutation in ('missing_height', 'block_hash', 'post_state_hash', 'transaction_count'):
            broken = ReplicaJoin(endpoints, phases, measurement['timeSeries'])
            height, _, _ = evidence.qualified_terminal_publication(join.first_row)
            indexed, _ = broken.nodes[endpoints[-1]]
            point, times = copy.deepcopy(indexed[height])
            if mutation == 'missing_height':
                del indexed[height]
            else:
                point[{'block_hash': 'blockHash', 'post_state_hash': 'appHash', 'transaction_count': 'transactions'}[mutation]] = '0' * 64 if mutation != 'transaction_count' else point['transactions'] + 1
                indexed[height] = (point, times)
            try:
                broken.add(join.first_row)
            except (RuntimeError, AssertionError) as error:
                negatives.append(dict(mutation=mutation, rejected=True, firstCause=str(error)))
            else:
                raise RuntimeError('replica mutation accepted: ' + mutation)
        cases.append(dict(label=case['label'], receipt=pin(receipt_path), originalNodeLogs=[pin(p) for p in logs], originalSignedMemberIdentity=proof['originalPublicMemberManifest'], joinedTransactions=join.records, replicaCompletionIntervalsNs=join.replica_result(), negativeChecks=negatives))
    result = dict(schema=1, runId=qualified['runId'], sourceCommit=qualified['sourceCommit'], originalQualifiedVerdict=pin(source), consumer=pin(Path(__file__)), cases=cases, networkQualificationAdded=False, sustainedTPSQualified=False, bftQuorumFormationInstantMeasured=False, interpretation='Four original same-block/post-state durable Commit returns, joined to every original signed transaction and calibrated client offer. First/third/all are replica order statistics, not voting-power quorum or earliest BFT formation. Source/BFT/resource admission comes exclusively from the pinned original qualified verdict. No new run or network request.')
    with output.open('x') as handle:
        json.dump(result, handle, indent=2)
        handle.write('\n')
    print(json.dumps({case['label']: case['replicaCompletionIntervalsNs'] for case in cases}))


if __name__ == '__main__':
    run(Path(sys.argv[1]).absolute(), Path(sys.argv[2]).absolute())
