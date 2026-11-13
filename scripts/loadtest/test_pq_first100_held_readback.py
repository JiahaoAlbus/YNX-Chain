"""Readback controls with synthetic archive metadata only."""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('held_readback', Path(__file__).with_name('pq-first100-held-readback.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class HeldReadbackTests(unittest.TestCase):
    controller = 'e' * 40

    def test_peak_rss_preserves_overage_and_missing_process_samples(self):
        receipt = dict(peakRSSBytes=12, caps=dict(rssBytes=10), peakRSSSample=dict(rssBytes=12, processes=[
            dict(pid=1, startTicks=10, rssBytes=12), dict(pid=2, startTicks=11, rssBytes=None)]))
        resources = reader.readiness_resources(receipt)
        self.assertEqual(resources['rssHeadroomBytes'], -2)
        self.assertEqual(resources['unmeasuredProcessCount'], 1)
        receipt['peakRSSSample']['rssBytes'] = 13
        with self.assertRaisesRegex(RuntimeError, 'do not reconcile'):
            reader.readiness_resources(receipt)

    def test_resource_comparison_keeps_host_identity_and_business_scope_separate(self):
        hardware = dict(status='OBSERVED', system='Linux', machine='x86_64', cpuModels=['fixture'],
                        kernelRelease='fixture', effectiveAffinity=[0, 1], filesystem=dict(type='ext4'))
        before = dict(status='LOAD_RESULT_MISSING', fullCohort=None, toolchain='go1.26.11',
                      caps=dict(rssBytes=10), conditions=dict(accounts=500), hardware=hardware,
                      readinessResources=dict(readyProofLaneCount=3, peakRSSBytes=12))
        after = dict(before, status='READY_ONLY_OBSERVED',
                     readinessResources=dict(readyProofLaneCount=4, peakRSSBytes=8))
        comparison = reader.compare_readiness(before, after)
        self.assertEqual(comparison['observedPeakDifferenceBytes'], -4)
        self.assertTrue(comparison['sameReportedHostClass'])
        self.assertFalse(comparison['identicalPhysicalHostProven'])
        self.assertFalse(comparison['successfulBusinessComparison'])
        with self.assertRaisesRegex(RuntimeError, 'conditions differ'):
            reader.compare_readiness(before, dict(after, caps=dict(rssBytes=20)))

    def fixture(self, with_receipt=True, accounts=500, prefix='fixture/public/', confirmed=None, ready_lanes=None):
        source = dict(commit='a' * 40, tree='b' * 40)
        tools = dict(commit='c' * 40, tree='d' * 40)
        config = dict(profile='first100-held-public-owner', nodeCount=4, pressureLevel=1,
                      source=source['commit'], sourceTree=source['tree'],
                      tools=tools['commit'], toolsTree=tools['tree'])
        if ready_lanes is not None:
            config['options'] = dict(held_ready_only=True)
        pin = sha(encode(config))
        plan = dict(configuration=config, configurationSHA256=pin, runtimePlanSHA256=None)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('pq-first100-held-plan.json', encode(plan))
            if with_receipt:
                archive.writestr(prefix + 'FIRST100-HELD-CI.json', encode(dict(plan, controllerCommit=self.controller)))
                receipt = dict(source=source, toolIdentity=tools, loadExecuted=False, firstCause='stopped before release')
                if ready_lanes is not None:
                    census = dict(schema='YNX-PERF-ORIGINAL-INITIALIZED-ACCOUNT-CENSUS/v1',
                                  configuredLoadAccounts=500, completeFourNodeAccountReadback=True,
                                  normalGoStaticOrCryptoQualification=False, signCommandsIssued=0,
                                  businessPOSTsIssued=0, sourceGrant=False,
                                  nodes=[dict(node=i, height=18, appHash='a'*64,
                                              matchingOriginalLoadAccounts=500, snapshotBytes=1,
                                              snapshotSHA256='b'*64) for i in range(4)])
                    processes = [dict(name=f'{phase}-node-{i}', pid=10+j*4+i, startTicks=100+i,
                                      exited=j == 0, rawReturnCode=0 if j == 0 else None,
                                      exitCode=0 if j == 0 else None, signal=None)
                                 for j, phase in enumerate(('bootstrap', 'pq')) for i in range(4)]
                    boundary = reader.preload.validate(census, processes, [], 100, 5, 30)
                    signer = dict(syntheticOnly=True)
                    archive.writestr(prefix + 'initialized-account-readback.json', encode(census))
                    archive.writestr(prefix + 'preload-initialization.json', encode(boundary))
                    archive.writestr(prefix + 'load-public-owners-ready.json', encode(signer))
                    receipt.update(heldReadyOnlyComplete=True, firstCause=None,
                                   initializedAccountReadback=census, preloadInitialization=boundary,
                                   preparationUnconfirmedOwners=[], normalPublicOwnerTransport=dict(attempted=0),
                                   preparationOnlyDemandAccounting=dict(configuredDemand=500, notReleased=500,
                                                                        notSubmitted=500, notQualified=500),
                                   senderPoolPreparation=dict(bootstrapLoaded=True, signed=False,
                                       nonceReserved=False, loadClockStarted=False, publicScopeReady=signer,
                                       sourcePreparation=dict(sourceReply='load-public-owners-ready.json',
                                                              sourceReplySHA256=sha(encode(signer))),
                                       liveMaterialsPreparation=[dict(node=node) for node in ready_lanes]))
                if confirmed is not None:
                    extra, load = confirmed
                    receipt.update(loadExecuted=True, firstCause=None, planSHA256=sha(extra['load-plan.json']),
                                   loadResult=load, journalSegments=[dict(path='load-events-00000.jsonl',
                                       bytes=len(extra['load-events-00000.jsonl']), sha256=sha(extra['load-events-00000.jsonl']))])
                    for name, data in extra.items():
                        archive.writestr(prefix + name, data)
                archive.writestr(prefix + 'receipt.json', encode(receipt))
                archive.writestr(prefix + 'requested-load.json', encode(dict(source=source, mode='online',
                    rate=100, seconds=5, accounts=accounts, tailSeconds=30, perAccountCapacity=1, configuredDemand=500)))
        return output.getvalue(), pin

    def test_stopped_before_release_preserves_missing_data(self):
        for has_receipt, status in [(False, 'NO_RUNTIME_RECEIPT'), (True, 'LOAD_RESULT_MISSING')]:
            raw, pin = self.fixture(with_receipt=has_receipt)
            report = reader.inspect(raw, sha(raw), self.controller, pin)
            self.assertEqual(report['status'], status)
            self.assertIsNone(report['fullCohort'])
            if has_receipt:
                self.assertEqual(report['firstCause'], 'stopped before release')

    def test_ready_requires_four_lanes_and_preserves_unreleased_demand(self):
        raw, pin = self.fixture(ready_lanes=range(4))
        report = reader.inspect(raw, sha(raw), self.controller, pin)
        self.assertEqual(report['status'], 'READY_ONLY_OBSERVED')
        self.assertEqual(report['preparationOnlyDemandAccounting']['notReleased'], 500)
        self.assertIsNone(report['fullCohort'])
        raw, pin = self.fixture(ready_lanes=range(3))
        with self.assertRaisesRegex(RuntimeError, 'READY-only boundary'):
            reader.inspect(raw, sha(raw), self.controller, pin)

    def test_full_cohort_counts_one_confirmed_and_rejects_substituted_reply(self):
        fixture = reader.module('test_pq_observed_throughput.py').ObservedThroughputControls()
        ledger = fixture.ledger(500)
        row, _ = ledger.reserve(ledger.plan['windowNs'])
        tx = b'original transaction fixture'
        fixture.event(ledger, row, 'signed', 4_999_999_995, hash=sha(tx), nativeHash='b'*64)
        fixture.event(ledger, row, 'submitted', 4_999_999_996)
        fixture.event(ledger, row, 'ack', 4_999_999_997)
        fixture.event(ledger, row, 'included', 5_000_000_001)
        base = 'load-operations/%05d/' % row['index']
        fixture.event(ledger, row, 'qualified', 5_000_000_002, hash=row['hash'], nativeHash=row['nativeHash'],
                      normalVerifierCode='VERIFIED_TRANSACTION_DATA', executionSuccessful=True, executionCode='0',
                      transactionType='pq_transfer', members=1, nativeGrant=False,
                      normalConfirmCode='PROOF_CONFIRMED_DATA', proofReference=base+'qualified-receipt.json')
        load = ledger.report(5_000_000_003)
        result = dict(transactionHash='0x'+row['hash'], nativeWireHash=row['nativeHash'], included=True,
                      finalized=True, executionSuccessful=True, executionCode='0', nativeGrant=False)
        verifier = dict(code='VERIFIED_TRANSACTION_DATA', result=result)
        confirm = dict(code='PROOF_CONFIRMED_DATA', result=dict(result=result))
        proof = dict(sequence='1')
        stem = 'load-%05d' % row['index']
        originals = {
            'load-plan.json': encode(ledger.plan),
            'load-events-00000.jsonl': b'{}\n',
            base+'transaction.abci': tx,
            base+'submission-intent.json': encode(dict(id=row['id'], operationId=row['operationId'],
                owner=row['ownerIndex'], nonce=str(row['nonce']), transactionHash=sha(tx),
                submissionAttempts=1, qualifiedFinal=False)),
            base+'four-node-inclusion.json': encode(dict(qualifiedFinal=False, rows=[dict(height='19',
                hash=sha(tx), tx=base64.b64encode(tx).decode(), tx_result=dict(code=0))]*4)),
            base+'qualified-receipt.json': encode(dict(id=row['id'], operationId=row['operationId'], mode='online',
                normalConfirm=confirm, normalVerifier=verifier, normalLiveResult=proof)),
            base+'original-confirm-reply.json': encode(confirm),
            stem+'-normal-verifier.log': encode(verifier),
            stem+'-live-result.log': encode(dict(version='YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1',
                outcome='original_result_read', result=proof)),
        }
        raw, pin = self.fixture(confirmed=(originals, load))
        cohort = reader.inspect(raw, sha(raw), self.controller, pin)['fullCohort']
        self.assertEqual(cohort['submissionAttemptWindowTPS'], 0.2)
        self.assertEqual(cohort['originalCohort']['counts']['qualifiedReceipt']['inTail'], 1)
        self.assertEqual(cohort['unresolvedRate'], 499/500)
        self.assertIsNone(cohort['originalCohort']['latencies']['submitToQualifiedReceiptObserved']['p95Ms'])
        originals[base+'original-confirm-reply.json'] = encode(dict(confirm, code='REFUSED'))
        raw, pin = self.fixture(confirmed=(originals, load))
        with self.assertRaisesRegex(RuntimeError, 'original held proof'):
            reader.inspect(raw, sha(raw), self.controller, pin)

    def test_original_configuration_and_full_demand_are_required(self):
        raw, pin = self.fixture(prefix='public/')
        self.assertEqual(reader.inspect(raw, sha(raw), self.controller, pin)['status'], 'LOAD_RESULT_MISSING')
        raw, pin = self.fixture(accounts=499)
        with self.assertRaisesRegex(RuntimeError, 'original demand differs'):
            reader.inspect(raw, sha(raw), self.controller, pin)
        with self.assertRaisesRegex(RuntimeError, 'configuration digest differs'):
            reader.inspect(raw, sha(raw), self.controller, '0' * 64)


if __name__ == '__main__':
    unittest.main()
