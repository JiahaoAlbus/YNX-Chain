"""1695 cold identity controls; synthetic receipts grant no runtime authority."""
import copy
import importlib.util
from pathlib import Path
import unittest


def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


m=module('cold1695_readback','pq-first100-1695-cold-readback.py')
legacy=module('cold1695_old_controls','test_pq_first100_d24_readback.py')


def records():
    adapter,receipt=legacy.D24IdentityControls().records()
    adapter.update(controllerCommit=m.CONTROLLER,controllerSourceSHA256='717b88d20d76941150dbf6ea8c942bd608f4eade41e9e3dc7792d4478085dfac',
        profile='first100-1695-bounded-cold',senderBackend='bounded-cold',goSource=m.SOURCE,goTree=m.TREE,tools=m.TOOLS,toolsTree=m.TOOLS_TREE,
        sourceFunctionalPrerequisite=m.source_qualification(),sourceAndSemanticHandoff=dict(semanticReadbackSHA256='1c1b52cef5ae2ea7a7b71b0670d35c5bdae7cc0a909ee2ab14028511f1aeffb3',semanticArtifactID=13579202583,retainedHeights=9,semanticReplayReexecuted=False,actual500InitializationQualified=False,runtimePermissionGranted=False,pressureAuthorized=False))
    receipt.update(source=dict(commit=m.SOURCE,tree=m.TREE),toolIdentity=dict(commit=m.TOOLS,tree=m.TOOLS_TREE),
        sameWindowInitializationSourceFunctionalData=m.source_qualification(),loadConditions=dict(firstTrialProfile='1695',senderBackend='bounded-cold'))
    ci=adapter['toolsCI'];ci.update(runID=42388018370,jobID=128449445231,head=m.TOOLS)
    run,job=[v['original'] for v in ci['metadata']]
    run.update(id=42388018370,head_sha=m.TOOLS)
    job.update(id=128449445231,run_id=42388018370,head_sha=m.TOOLS)
    names=['Execute original Linux worker affinity limits stdin and cleanup case','Verify fixed1695 semantic original transport and process controls','Verify fixed1695 own source originals with explicit opt-in skips','Verify normal public owner stream isolation and lost acknowledgements','Verify full first100 cohort counts and censored latency readback','Verify original bounded sender and post-ready checkpoint ordering']
    job['steps']=[dict(name=n,status='completed',conclusion='success') for n in names]
    return adapter,receipt


class Cold1695Controls(unittest.TestCase):
    def test_exact_source_semantic_and_cold_identities(self):
        adapter,receipt=records();m.identities(adapter,receipt)
        self.assertEqual(adapter['sourceFunctionalPrerequisite']['requiredNamedCases'],130)
        self.assertFalse(adapter['sourceFunctionalPrerequisite']['runtimePermissionGranted'])

    def test_old_source_controller_tools_and_public_backend_are_rejected(self):
        for key,value in [('goSource',legacy.m.SOURCE),('controllerCommit',legacy.m.CONTROLLER),
                          ('tools',legacy.m.TOOLS),('senderBackend','public-owner'),
                          ('profile','first100-1695-public-owner')]:
            adapter,receipt=records();adapter[key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):m.identities(adapter,receipt)
        adapter,receipt=records();receipt['normalPublicOwnerTransport']={}
        with self.assertRaises(RuntimeError):m.identities(adapter,receipt)

    def test_receipt_source_data_and_backend_must_match_actual_qualification(self):
        for key,value in [('firstTrialProfile','d24'),('senderBackend','public-owner')]:
            adapter,receipt=records();receipt['loadConditions'][key]=value
            with self.assertRaises(RuntimeError):m.identities(adapter,receipt)
        adapter,receipt=records();receipt['sameWindowInitializationSourceFunctionalData']['requiredNamedCases']=129
        with self.assertRaises(RuntimeError):m.identities(adapter,receipt)

    def test_missing_own_ci_step_or_semantic_change_cannot_migrate(self):
        adapter,receipt=records();adapter['toolsCI']['metadata'][1]['original']['steps'].pop()
        with self.assertRaises(RuntimeError):m.identities(adapter,receipt)
        adapter,receipt=records();adapter['sourceAndSemanticHandoff']['runtimePermissionGranted']=True
        with self.assertRaises(RuntimeError):m.identities(adapter,receipt)
        adapter,receipt=records();adapter['toolsCI']['head']=legacy.m.TOOLS
        with self.assertRaises(RuntimeError):m.identities(adapter,receipt)

    def test_same_full500_conditions_and_observers_remain_required(self):
        caps=dict(totalSeconds=900,cleanupSeconds=15,rssBytes=4<<30,newBytes=8<<30,initialMemoryBytes=6<<30,initialDiskBytes=16<<30,logBytes=4<<20,cpus=2)
        conditions=dict(mode='online',accounts=500,perAccountCapacity=1,seconds=5,tailSeconds=30,proofTimeout=30,header_hop_capture=False,
            **{k:True for k in ('staged_publication','wire_observation','network_accounting','commit_observation','owned_storage_accounting','startup_timings','initialize_before_load')})
        adapter=dict(caps=caps);receipt=dict(caps=caps,loadConditions=conditions);m.conditions(adapter,receipt)
        for key,value in [('accounts',499),('seconds',10),('commit_observation',False),('startup_timings',False)]:
            changed=copy.deepcopy(receipt);changed['loadConditions'][key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):m.conditions(adapter,changed)

    def test_complete_denominator_and_censored_finality_use_original_reducer(self):
        fixture=legacy.First100ReadbackControls()
        result=m.cohort(fixture.original_rows(499))
        for distribution in result['latencies'].values():
            self.assertEqual(distribution['censored'],1)
            self.assertTrue(all(distribution['p%dMs'%p] is None for p in (50,95,99)))
        self.assertFalse(result['sustainedTPSQualified'])

    def test_archive_size_and_digest_fail_before_source_promotion(self):
        for raw,size in [(b'',0),(b'not-a-zip',1),(b'x',True),(b'x',129<<20)]:
            with self.subTest(size=size),self.assertRaises(RuntimeError):m.read_archive(raw,'0'*64,size)
        with self.assertRaises(RuntimeError):m.read_archive(b'not-a-zip','0'*64,9)


if __name__=='__main__':unittest.main(verbosity=2)
