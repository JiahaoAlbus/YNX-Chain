"""Source-bound readback refusals only; no business window or fabricated result."""
import base64,copy,hashlib,importlib.util,io,json,zipfile
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('current7c_business_readback',Path(__file__).with_name('pq-first100-7c25-readback.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class CurrentBusinessReadback(unittest.TestCase):
    def control(self):
        # A synthetic header used solely to exercise rejection boundaries.
        return dict(controllerCommit='a'*40,controllerSourceSHA256=r.ADAPTER_SHA256,
            profile='first100-7c25-public-owner',senderBackend='public-owner',
            goSource=r.SOURCE,goTree=r.TREE,tools=r.TOOLS,toolsTree=r.TOOLS_TREE)
    def test_normal_controller_must_be_supplied_separately(self):
        for value in (None,'','latest','a'*39):
            with self.subTest(controller=value),self.assertRaisesRegex(RuntimeError,'controller required'):
                r.identities(self.control(),{},value)
    def test_old_source_tools_or_adapter_cannot_migrate(self):
        for key,value in [('goSource','1695aafd351b3cac7860d3452c555a02498e8350'),
                          ('profile','first100-1695-public-owner'),('tools','5edcc63b746a2f1c66d8d74e61d0fca1748c2441'),
                          ('controllerSourceSHA256','0'*64),('controllerCommit','b'*40)]:
            with self.subTest(key=key),self.assertRaisesRegex(RuntimeError,'adapter tuple differs'):
                r.identities(dict(self.control(),**{key:value}),{},'a'*40)
    def test_empty_archive_is_missing_evidence_not_zero_tps(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w'):pass
        raw=stream.getvalue()
        with self.assertRaisesRegex(RuntimeError,'bounded original ZIP entry count required'):
            r.read_archive(raw,hashlib.sha256(raw).hexdigest(),len(raw),controller='a'*40)
        with self.assertRaisesRegex(RuntimeError,'archive size differs'):
            r.read_archive(raw[:-1],hashlib.sha256(raw).hexdigest(),len(raw),controller='a'*40)

    def test_actual_once01_build_failure_keeps_full_unreleased_demand_unmeasured(self):
        raw=(Path(__file__).with_name('fixtures')/'7c25-first100-once01/ORIGINAL.zip').read_bytes()
        result=r.read_archive(raw,'cbee78ef929a46cbf674ebf0b38b0e2c37511de0c0a44b2522c277d9739515cf',21098,
            controller='34a796ecf1f62cd660bdd06347d48b9da3230b39')
        self.assertFalse(result['loadExecuted']);self.assertIsNone(result['observedBusiness'])
        self.assertEqual(result['businessObservationStatus'],'BUSINESS_WINDOW_NOT_RELEASED')
        accounting=result['originalPreparationOnlyDemandAccounting']
        self.assertTrue(all(accounting[k]==500 for k in ('configuredDemand','notReleased','notSubmitted','notQualified')))
        self.assertEqual(result['originalReportedBusinessMeasurements']['stableFinalTPS'],'UNMEASURED')
        self.assertEqual(result['normalNodeCleanExit']['observedNodes'],0)
        self.assertFalse(result['normalNodeCleanExit']['allEightExitZero'])
        nodes=result['measuredStages']['nodeStartup']['nodes'];self.assertEqual(len(nodes),8)
        self.assertTrue(all(n['status']=='PROCESS_IDENTITY_NOT_SUPPLIED' and not n['stages'] for n in nodes.values()))
        observed=result['measuredStages']['initialization']['records']
        self.assertEqual([(row['stage'],row['elapsedNs']) for row in observed],
            [('prepare_normal_live_source',9975520251),('build',7851825375)])
        self.assertIn('build-ynx-consensus-pq-lab',result['originalFirstCause'])
        self.assertTrue(result['cleanupComplete']);self.assertFalse(result['stable1000TPSQualified'])
    def inclusion_control(self):
        tx=b'controlled transaction bytes';digest=hashlib.sha256(tx).hexdigest()
        row=dict(index=0,id='control-only',operationId='control-op',ownerIndex=0,nonce=1,hash=digest,includedNs=8)
        reply=dict(height='12',hash=digest.upper(),tx_result=dict(code=0),tx=base64.b64encode(tx).decode())
        base='load-operations/00000/'
        intent=dict(id=row['id'],operationId=row['operationId'],owner=0,nonce='1',transactionHash=digest,submissionAttempts=1,qualifiedFinal=False)
        files={base+'transaction.abci':tx,base+'submission-intent.json':json.dumps(intent).encode(),
            base+'four-node-inclusion.json':json.dumps(dict(rows=[copy.deepcopy(reply) for _ in range(4)],qualifiedFinal=False)).encode()}
        return files,dict(configuredDemand=1,rows=[row])
    def test_inclusion_is_bound_to_all_four_original_code0_byte_replies(self):
        files,load=self.inclusion_control();result=r.inclusion_replies(files,'',load)
        self.assertEqual(result['observed'],1);self.assertFalse(result['independentFinality'])
        path='load-operations/00000/four-node-inclusion.json'
        for field,value in [('hash','0'*64),('height','13'),('tx_result',dict(code=1)),('tx_result',dict(code=False)),('tx',base64.b64encode(b'other').decode())]:
            changed=dict(files);record=json.loads(files[path]);record['rows'][0][field]=value;changed[path]=json.dumps(record).encode()
            with self.subTest(field=field,value=value),self.assertRaises(RuntimeError):r.inclusion_replies(changed,'',load)
    def test_business_commit_blocks_exclude_preparation_and_keep_missing_heights_unknown(self):
        rows=[dict(height=h,persistence=dict(height=h,storage='atomic-json',elapsedNs=10,
            stagesNs=dict(json_encode=4,file_sync=3))) for h in (11,12)]
        readback=dict(originalCommitCopies=dict(records=[dict(node=0,sha256='a'*64,
            producerReportedUsable=True,originalSnapshot=dict(processID=101,samples=rows))]))
        stages=r.module('controlled_commit_reducer','pq-first100-stage-summary.py')
        result=r.business_commit_stages(readback,dict(records=[dict(height='12'),dict(height='13')]),stages)
        group=result['nodes']['0']['byStorage']['atomic-json']
        self.assertEqual(group['heights'],[12]);self.assertEqual(group['retainedSuccessCount'],1)
        self.assertEqual(group['stages']['json_encode']['observedMedianNs'],4)
        self.assertEqual(result['coverageByNode']['0']['missingOrUnusableIncludedHeights'],[13])
        self.assertEqual(result['nodesWithoutCommitCopies'],[1,2,3])
        self.assertEqual([row['height'] for row in readback['originalCommitCopies']['records'][0]['originalSnapshot']['samples']],[11,12])
        self.assertFalse(result['perTransactionCostInferred'] or result['pooledAcrossNodes'])
    def test_late_availability_preserves_unknown_without_promoting_counts(self):
        row=dict(index=0,includedNs=None,terminalNs=10,status='unknown')
        load=dict(configuredDemand=1,originMonotonicNs='100',rows=[row],qualified=0)
        path='load-operations/00000/successor-availability.json'
        raw=json.dumps(dict(observedMonotonicNs=120,qualifiedFinal=False)).encode()
        result=r.successor_availability({path:raw},'',dict(loadResult=load))
        self.assertEqual((result['observed'],result['notObserved'],result['lateRawCount']),(0,1,1))
        self.assertFalse(result['lateRawPromoted']);self.assertFalse(result['lateRawRecords'][0]['latencyQualified'])
        self.assertEqual(result['lateRawRecords'][0]['originalCohortRow']['status'],'unknown')
        self.assertEqual(result['lateRawRecords'][0]['sourceSHA256'],hashlib.sha256(raw).hexdigest())

if __name__=='__main__':unittest.main(verbosity=2)
