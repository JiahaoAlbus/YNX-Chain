"""Normal backend admission/assembly only; no Go, node or signer is executed."""
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock


spec=importlib.util.spec_from_file_location('sender_backend_driver',Path(__file__).with_name('pq-independent-load.py'))
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)


def args(**changes):
    value=dict(mode='online',rate=100,accounts=500,per_account=1,seconds=5,tail_seconds=30,
               proof_timeout=30,staged_publication=True,execute=True,commit=d.PUBLIC_OWNER_ABI_SOURCE,
               source='/SOURCE-NOT-READ',network_accounting=False,wire_observation=False,sender_backend='public-owner')
    value.update(changes);return SimpleNamespace(**value)


class BackendSelection(unittest.TestCase):
    def test_legacy_auto_and_explicit_public_capacity_keep_original_caps(self):
        self.assertEqual(d.sender_backend_kind(args(sender_backend='auto')),'bounded-cold')
        self.assertEqual(d.sender_backend_kind(args(sender_backend='auto',staged_publication=False)),'per-account')
        public=d.process_capacity(args());cold=d.process_capacity(args(sender_backend='bounded-cold'))
        self.assertEqual((public['maximumRuntimePIDs'],public['maximumSignSenderProcesses']),(9,1))
        self.assertEqual((cold['maximumRuntimePIDs'],cold['maximumSignSenderProcesses']),(10,2))
        self.assertEqual(public['originalOwnedPIDLimit'],d.lab.guard.CAPS['ownedProcesses'])
        self.assertFalse(public['normalLargeOwnerInputQualified'])

    def test_wrong_source_mode_or_backend_fails_before_any_window(self):
        for a in (args(commit=d.first_trial_d24_source.SOURCE),args(mode='pre-signed'),
                  args(staged_publication=False),args(sender_backend='fallback')):
            with self.subTest(args=a),mock.patch.object(d.lab,'Window') as window:
                with self.assertRaises(RuntimeError):d.sender_backend_kind(a)
                window.assert_not_called()

    def test_public_abi_option_cannot_bypass_source_qualification(self):
        with mock.patch.object(d.lab,'check_source') as source,mock.patch.object(d.lab,'Window') as window:
            with self.assertRaisesRegex(RuntimeError,'exact staged normal consumer source required'):d.run(args())
        source.assert_not_called();window.assert_not_called()

    def test_factory_assembles_one_real_transport_with_private_fd_not_secret_flags(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);private=root/'workload/private-senders';private.mkdir(parents=True)
            credential=private/'recovery.raw';credential.write_bytes(b'x'*32);os.chmod(credential,0o600)
            calls=[];process=SimpleNamespace(stdin=io.BytesIO(),poll=lambda:None)
            window=SimpleNamespace(work=root)
            window.launch=lambda *a,**kw:(calls.append((a,kw)) or process)
            ceremony=SimpleNamespace(mode='online',workload=dict(transactions=None),live=[],w=window,
                                     consumer_source=d.PUBLIC_OWNER_ABI_SOURCE,root=root,bins=root/'bin',
                                     pin='a'*64,activation_pin='b'*64,workload_pin='c'*64)
            backend=d.make_sender_backend(ceremony,[dict(ownerIndex=4),dict(ownerIndex=5)],threading.Event(),'public-owner')
            self.assertEqual(len(calls),1);self.assertEqual(len(backend.sessions),1)
            self.assertEqual(backend.public_session.owners,(4,5))
            command=calls[0][0][1]
            self.assertIn('sender-owners',command);self.assertNotIn('x'*32,command)
            self.assertEqual(len(calls[0][1]['pass_fds']),1)

    def test_prepared_backend_records_separate_parent_and_callee_intervals(self):
        backend_module = d.module('prepared_public_owner_backend', 'pq-public-owner-backend.py')
        timings = dict(intervalsOverlap=True, stages={'checkpoint.prepareStaticTotal': dict(calls=1, elapsedNs=400)})
        class Session:
            def __init__(self, ceremony, owners, *, prepare_source):
                self.owners = owners
                self.prepare_source = prepare_source
                self.name = 'load-public-owners'
                self.launched_ns = 100
            def wait_ready(self, stop, deadline, check):
                return dict(bootstrapLoaded=True, startupElapsedNs=450, preparationTimings=timings)
        backend_type = backend_module.backend_class(d.NormalBackend, Session, d.normal, d.lab)
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            (work / 'public').mkdir()
            ready_path = work / 'public' / 'load-public-owners-ready.json'
            ready_path.write_bytes(b'original prepared reply')
            sha256 = d.lab.guard.digest(ready_path)
            ceremony = SimpleNamespace(mode='online', workload=dict(transactions=None), live=[],
                                       w=SimpleNamespace(work=work), proof_timeout=30)
            with mock.patch.object(backend_module.time, 'monotonic_ns', return_value=750):
                backend = backend_type(ceremony, [dict(ownerIndex=4)], threading.Event(), prepare_source=True)
                report = backend.prepare(lambda: None)
        self.assertTrue(backend.public_session.prepare_source)
        self.assertEqual(report['readyMode'], 'ORIGINAL_PUBLIC_STATIC_SOURCE_PREPARED')
        self.assertTrue(report['bootstrapLoaded'])
        self.assertFalse(report['signed'] or report['nonceReserved'] or report['loadClockStarted'])
        self.assertFalse(report['coldValidationIncludedInFirstCommand'])
        self.assertEqual(report['sourcePreparation'], dict(
            sourceReply='load-public-owners-ready.json', sourceReplySHA256=sha256,
            parentLaunchToReadyNs=650, calleeStartupElapsedNs=450, calleePreparationTimings=timings,
            parentClock='parent_monotonic_ns', intervalsOverlap=True, addedToPerCommand=False,
            checkpointValidated=False))

    def test_backend_identity_is_part_of_escalation_conditions(self):
        a=args(sender_backend='bounded-cold');b=args()
        self.assertNotEqual(d.load_conditions(a)['senderBackend'],d.load_conditions(b)['senderBackend'])

    def test_1695_prepare_consumes_own_ci_and_semantic_without_creating_window(self):
        a=args(execute=False,first_trial_profile='1695',initialize_before_load=True,
               startup_timings=True,wire_observation=True,network_accounting=True,
               commit_observation=True,owned_storage_accounting=True,header_hop_capture=False)
        identity=dict(commit=d.first_trial_1695_source.SOURCE,tree=d.first_trial_1695_source.TREE)
        with mock.patch.object(d.lab,'check_source',return_value=identity),mock.patch.object(d.lab,'git'),\
             mock.patch.object(d.subprocess,'check_output',return_value=b'live-materials'),mock.patch.object(d.lab,'Window') as window:
            result=d.run(a)
        window.assert_not_called();self.assertFalse(result['actualLoadExecuted'])
        self.assertTrue(result['sourceFunctionalData']['semanticPairConsumed'])
        self.assertEqual(result['sourceFunctionalData']['source'],d.PUBLIC_OWNER_ABI_SOURCE)


if __name__=='__main__':unittest.main()
