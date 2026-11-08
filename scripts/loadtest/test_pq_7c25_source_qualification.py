"""Future profile controls are synthetic metadata, never source/chain evidence."""
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import mock


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


m=module('future7c25_controls','pq-7c25-source-qualification.py')
d=module('future7c25_driver','pq-independent-load.py')


def options(**changes):
    args=dict(commit=m.SOURCE,source='/NOT-READ',mode='online',rate=100,seconds=5,accounts=500,
              per_account=1,tail_seconds=30,proof_timeout=30,execute=True,staged_publication=True,
              initialize_before_load=True,initialization_only=False,first_trial_profile='7c25',
              sender_backend='public-owner',startup_timings=True,wire_observation=True,
              commit_observation=True,network_accounting=True,owned_storage_accounting=True,header_hop_capture=False)
    args.update(changes);return SimpleNamespace(**args)


class FutureSourceControls(unittest.TestCase):
    def test_missing_exact_source_or_semantic_pins_blocks_before_source_window_or_process(self):
        with mock.patch.object(d.lab,'check_source') as source,mock.patch.object(d.lab,'Window') as window,\
             mock.patch.object(d.subprocess,'Popen') as process,\
             mock.patch.object(d.first_trial_7c25_source,'SEMANTIC_RECEIPT_SHA256',None):
            with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):d.run(options())
        source.assert_not_called();window.assert_not_called();process.assert_not_called()
        self.assertEqual(m.NORMAL_RECEIPT_SHA256,'c4cb8cfcf87b6ff4f6de2f91af656f93cd7c663487c02e733e7448554a45fab9')

    def test_semantic_receipt_cannot_omit_raw_cold_or_use_old_execution_trees(self):
        fake=dict(schema='YNX-PERF-7C25-LINUX-SEMANTIC-ORIGINAL-READBACK/v1',afterCommit=m.SOURCE,afterTree=m.TREE,
                  toolsCommit='478bf2ee60c19dcbdb67872184f9e1f500511746',
                  beforeExecutionTree='0397f75ec55db6a89b46e2e6d051ce960c36827d',afterExecutionTree='96d91aed6a015f7243bb18b5d7a375bddf51483a',
                  traceSHA256='11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6',heights=9)
        for k in ('limitedOriginalTrajectoryQualified','completePerHeightTxResultsEqual','completePerHeightBalanceNonceStateEqual',
                  'completePerHeightAppHashEqual','completePerHeightRawStateBytesEqual','coldReconstructionProducerRecordsVerified','cleanupComplete'):fake[k]=True
        fake['afterSourceGoHeightTests']=dict(topCases=2,childCases=15,packagePassed=True,failed=0,skipped=0)
        fake['perHeightEvidence']=dict(heights=list(map(str,range(4,13))),completePerHeightRawStateBytesEqual=True,
            coldReconstructionProducerRecordsVerified=True,coldStageObservedNanoseconds={arm:[dict(height=str(h)) for h in range(4,13)] for arm in ('before','after')})
        # Synthetic contract metadata only; no sealed receipt or execution grant.
        m.require_semantic(fake)
        for delta in [dict(heights=8),dict(completePerHeightRawStateBytesEqual=False),dict(coldReconstructionProducerRecordsVerified=False),
                      dict(afterExecutionTree=m.TREE),dict(schema='old'),dict(perHeightEvidence={}),dict(afterSourceGoHeightTests={})]:
            with self.subTest(delta=delta),self.assertRaises(RuntimeError):m.require_semantic(dict(fake,**delta))

    def test_actual_sealed_normal_and_same_window_semantic_data_qualify_source_only(self):
        q=m.qualification()
        self.assertEqual((q['source'],q['sourceTree'],q['heights']),(m.SOURCE,m.TREE,9))
        self.assertTrue(q['semanticPairConsumed'])
        self.assertFalse(q['runtimePermissionGranted'])
        self.assertFalse(q['pressureAuthorized'])
        self.assertFalse(q['actual500InitializedOwnersQualified'])
        self.assertIsNone(q['businessTPS'])
        self.assertIsNone(q['finalityLatency'])

    def test_future_requires_own_profile_source_backend_and_same_demand(self):
        self.assertEqual(d.validate_options(options()),500)
        self.assertEqual(d.sender_backend_kind(options()),'public-owner')
        for change in [dict(commit=d.PUBLIC_OWNER_ABI_SOURCE),dict(sender_backend='auto'),
                       dict(initialize_before_load=False),dict(rate=500),dict(accounts=499)]:
            with self.subTest(change=change),self.assertRaises(RuntimeError):d.validate_options(options(**change))
        with self.assertRaises(RuntimeError):d.sender_backend_kind(options(first_trial_profile='1695'))

    def test_old_conditions_do_not_inherit_observation(self):
        old=options(commit=d.PUBLIC_OWNER_ABI_SOURCE,first_trial_profile='1695')
        self.assertNotIn('requestStageObservation',d.load_conditions(old))
        self.assertTrue(d.load_conditions(options())['requestStageObservation'])
        self.assertEqual(d.PUBLIC_OWNER_ABI_SOURCE,'1695aafd351b3cac7860d3452c555a02498e8350')

    def test_complete_original_cli_tops_and_children_required(self):
        package='github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-pq-lab'
        rows=[dict(Action='start',Package=package)]
        for name in sorted(m.CLI_REQUIRED):
            for test,action in [(name,'run'),(name+'/closed','run'),(name+'/closed','pass'),(name,'pass')]:
                rows.append(dict(Action=action,Package=package,Test=test))
        rows.append(dict(Action='pass',Package=package))
        def raw(events):return b'\n'.join(json.dumps(e).encode() for e in events)
        result=m.original_go_frames(raw(rows),package,m.CLI_REQUIRED)
        self.assertEqual((result['topCases'],result['childCases']),(14,14))
        for bad in [rows[:-1],rows+rows,rows[:3]+rows[4:]]:
            with self.assertRaises(RuntimeError):m.original_go_frames(raw(bad),package,m.CLI_REQUIRED)
        for action in ['skip','fail','build-fail']:
            changed=copy.deepcopy(rows);changed[3]['Action']=action
            with self.assertRaises(RuntimeError):m.original_go_frames(raw(changed),package,m.CLI_REQUIRED)

    def test_go_literal_slash_label_uses_the_nearest_real_active_parent(self):
        package='github.com/JiahaoAlbus/YNX-Chain/internal/consensus'
        top='TestBlockJournalVersionUpgradeFailurePreservesEvidence'
        label=top+'/v12/compaction_synced'
        def event(action,name=None):return dict(Action=action,Package=package,**({} if name is None else dict(Test=name)))
        def raw(rows):return b'\n'.join(json.dumps(row).encode() for row in rows)
        rows=[event('start'),event('run',top),event('run',label),event('pass',label),event('pass',top),event('pass')]
        self.assertEqual(m.original_go_frames(raw(rows),package,{top})['childCases'],1)
        closed=[event('start'),event('run',top),event('run',top+'/v12'),event('pass',top+'/v12'),
                event('run',label),event('pass',label),event('pass',top),event('pass')]
        with self.assertRaises(RuntimeError):m.original_go_frames(raw(closed),package,{top})

    def test_source_ci_cannot_borrow_integration_release_or_inflight_green(self):
        # A matching-looking in-flight record still cannot qualify this source.
        run=dict(id=m.CI_RUN,head_sha=m.SOURCE,head_branch=m.CI_REF,event='push',run_attempt=1,
                 path='.github/workflows/resource-market-ci.yml',status='in_progress',conclusion=None)
        with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):m.identity(run,{}, {})
        for branch in ['codex/ynx-pq-perf-integration','codex/final-chain-core']:
            with self.assertRaises(RuntimeError):m.identity(dict(run,head_branch=branch,status='completed',conclusion='success'),{}, {})

    def test_v2_source_snapshot_requires_actual_ref_and_four_completed_steps(self):
        repo=dict(full_name=m.REPOSITORY,fork=False)
        run=dict(id=m.CI_RUN,head_sha=m.SOURCE,head_branch=m.CI_REF,event='push',run_attempt=1,
                 path='.github/workflows/resource-market-ci.yml',status='completed',conclusion='success',
                 repository=repo,head_repository=dict(repo))
        names=['Exercise original lab callee readiness and actual cold costs',
               'Verify complete state bridge and sponsor continuity',
               'Retain exact public test streams and same-job source identity',
               'Upload only original focused public test streams']
        job=dict(id=m.CI_JOB,run_id=m.CI_RUN,head_sha=m.SOURCE,name='focused-go',status='completed',
                 conclusion='success',steps=[dict(name=n,status='completed',conclusion='success') for n in names])
        source=dict(version='YNX-FOCUSED-PUBLIC-TEST-STREAMS/v2',commit=m.SOURCE,sourceTree=m.TREE,
                    cometForkTree=m.FORK,runId=str(m.CI_RUN),runAttempt='1',job='focused-go',
                    repository=m.REPOSITORY,captureComplete=True,errors=[],testQualification='not-evaluated',
                    nativeGrant=False,nodeStartAuthorized=False,publicDeployment=False)
        m.identity(run,job,source) # Synthetic identity metadata grants no sealed evidence or runtime authority.
        for key,value in [('version','YNX-FOCUSED-PUBLIC-TEST-STREAMS/v1'),('commit',d.PUBLIC_OWNER_ABI_SOURCE),
                          ('captureComplete',False),('nativeGrant',True)]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):m.identity(run,job,dict(source,**{key:value}))
        changed=copy.deepcopy(job);changed['steps'][0]['conclusion']='skipped'
        with self.assertRaises(RuntimeError):m.identity(run,changed,source)
        with mock.patch.object(m,'SEMANTIC_RECEIPT_SHA256',None),self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):m.qualification()


if __name__=='__main__':unittest.main(verbosity=2)
