"""Synthetic controls only; no node, network, finality or throughput grant."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('commit_clock_reader',Path(__file__).with_name('pq-commit-clock-readback.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
spec=importlib.util.spec_from_file_location('clock_window',Path(__file__).with_name('consensus-linux-cohort.py'))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)


def raw(value): return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def descriptor(value): return dict(bytes=len(value),sha256=hashlib.sha256(value).hexdigest())


class CommitClockReadbackControls(unittest.TestCase):
    def setUp(self):
        self.source_gate=mock.patch.object(r,'COMMIT_CLOCK_SOURCE','a'*40);self.source_gate.start();self.addCleanup(self.source_gate.stop)
    def fixture(self):
        source='a'*40; binary='b'*64; tx='c'*64; app='d'*64; binary_path='/synthetic/ynx-comet'
        identity=dict(commit=source,tree='e'*40,forkTree='f'*40)
        selection=raw(dict(originalSourceCommit=source,originalSourceTree=identity['tree'],originalProductionForkTree=identity['forkTree'],
                           originalCheckoutWritten=False,fakeVCSIdentity=False,sourceDirectory='/synthetic/source',selectedOptionalForkTree='e'*40))
        deps=raw(dict(synthetic='controlled'))
        network=raw(dict(chainId='ynx_642399-1',originalGenesisHash='e'*64))
        declaration=raw(dict(version='YNX-COMET-COMMIT-CLOCK-BUILD/v1',status='DECLARED',sourceRevision=source,
                             sourceBinding=r.SOURCE_BINDING,syntheticOnly=True,runtimeAuthorized=False,nodeStarted=False))
        argv=['go','build','-mod=readonly','-p','1','-trimpath','-buildvcs=false','-ldflags',
              '-X main.operatorCommitBuildSource='+source,'-tags','ynx_live_wire_observation','-o',binary_path,'./cmd/ynx-comet']
        parent=dict(processID=100,bootID='00000000-0000-0000-0000-000000000000',timeNamespace='1:2',clock='CLOCK_MONOTONIC',observedStartNs='800',observedEndNs='900')
        receipt=dict(source=identity,configuredDemand=1,binaries={'ynx-comet':binary},commitClockParent=parent,
            normalLiveBuildProvenance={'ynx-comet':dict(binarySHA256=binary,originalSource=identity,sourceSelectionSHA256=r.sha(selection),
                sourceDependenciesReceiptSHA256=r.sha(deps),buildArgv=argv,buildCwd='/synthetic/source',selectedOptionalForkTree='e'*40)},
            normalLiveSourceDependencies={'sourceDependencies':json.loads(deps)},commitClockBuildIdentity=dict(pid=99,**descriptor(declaration)),
            commitClockBuiltBinary=dict(path=binary_path,sha256=binary,device=1,inode=44,size=1024),
            activation=dict(networkPlanSHA256=r.sha(network)),loadResult=dict(originProcessID=100,originMonotonicNs='1000',rows=[dict(index=0,id='9'*64,hash=tx,submittedNs=100)]),
            normalCommitObservation=dict(originalSnapshots=[]),commitMonotonicObservation=dict(originalSnapshots=[]),
            commitClockProcessProbes=[],processes=[dict(name='commit-clock-build-identity',pid=99,exitCode=0,command=[binary_path,'synthetic-commit-clock-build-identity','--synthetic'])],commitClockInclusions=[])
        evidence=[]
        original_fixture=json.loads((Path(__file__).with_name('fixtures')/'commit-observation-public-schema.json').read_bytes())['cases']['gap-and-overflow']
        for node in range(4):
            pid=200+node
            snapshot=copy.deepcopy(original_fixture)
            snapshot.update(processID=pid,chainID='ynx_642399-1',originalGenesisHash='e'*64,
                captureBoundary=r._commit.CAPTURE_BOUNDARY,independentFinality=False,successNotifications=1,errorNotifications=0,
                droppedSuccessSamples=0,sampleOverflow=False,latestTimingAvailable=True,lastFailure=None,unobservedLatest=None,
                finalCheckpoint=dict(height=5,appHash=app),rejectedNotifications={})
            snapshot['coverage'].update(notificationCaptureComplete=True,observedHeightGaps=[])
            snapshot['samples'][0].update(height=5,appHash=app);snapshot['samples'][0]['persistence']['height']=5
            commit=raw(snapshot)
            clock=raw(dict(version='YNX-COMET-COMMIT-MONOTONIC/v1',status='OBSERVED',scope='synthetic-loopback-lab/v1',processID=pid,
                chainID='ynx_642399-1',originalGenesisHash='e'*64,independentFinality=False,sourceRevision=source,
                sourceBinding=r.SOURCE_BINDING,clock='CLOCK_MONOTONIC',bootID=parent['bootID'],timeNamespace=parent['timeNamespace'],
                captureBoundary=r.BOUNDARY,samples=[dict(height=5,appHash=app,monotonicNs=str(1300+node))]))
            probe=dict(pid=pid,startTicks='19',binarySHA256=binary,binaryPath=binary_path,device=1,inode=44,size=1024,timeNamespace='1:2',observedStartNs='940',observedEndNs='950',
                       identity='original-unpublished-pidfd-and-live-proc-exe')
            receipt['normalCommitObservation']['originalSnapshots'].append(dict(node=node,pid=pid,**descriptor(commit)))
            receipt['commitMonotonicObservation']['originalSnapshots'].append(dict(node=node,pid=pid,**descriptor(clock)))
            receipt['commitClockProcessProbes'].append(dict(node=node,probe=probe))
            receipt['processes'].append(dict(name='pq-node-%d'%node,pid=pid,startTicks=19,command=['original-shim',binary_path]))
            evidence.append(dict(processProbe=probe,commitOriginal=commit,clockOriginal=clock))
        inclusion=raw(dict(observedMonotonicNs=1500,rows=[dict(hash=tx.upper(),height='5',tx_result=dict(code=0)) for _ in range(4)]))
        receipt['commitClockInclusions'].append(dict(index=0,**descriptor(inclusion)))
        kwargs=dict(expected_source=source,parent=parent,node_evidence=evidence,inclusion={0:inclusion},selection_raw=selection,
                    dependencies_raw=deps,build_identity_raw=declaration,network_plan_raw=network)
        return receipt,kwargs

    def test_exact_original_joins_four_individual_upper_bounds(self):
        receipt,kwargs=self.fixture(); result=r.reduce(receipt,**kwargs)
        self.assertEqual((result['observed'],result['censored']),(1,0))
        self.assertEqual(result['rows'][0]['nodesNs'],[200,201,202,203])
        self.assertEqual(result['rows'][0]['fourNodeUpperBoundNs'],203)
        self.assertFalse(result['independentFinality'] or result['runtimeAuthorized'])

    def test_old_missing_source_or_parent_remains_not_supplied(self):
        receipt,kwargs=self.fixture()
        for mutate in ('source','parent','manifest','build_argv'):
            with self.subTest(mutate=mutate):
                item=copy.deepcopy(receipt); options=copy.deepcopy(kwargs)
                if mutate=='source':options['expected_source']='1'*40
                elif mutate=='parent':item.pop('commitClockParent')
                elif mutate=='manifest':options['selection_raw']+=b' '
                else:item['normalLiveBuildProvenance']['ynx-comet']['buildArgv'].remove('-buildvcs=false')
                result=r.reduce(item,**options)
                self.assertEqual((result['status'],result['observed'],result['censored']),('NOT_SUPPLIED',0,1))

    def test_caller_cannot_supply_an_unqualified_source(self):
        receipt,kwargs=self.fixture()
        with mock.patch.object(r,'COMMIT_CLOCK_SOURCE',None):
            result=r.reduce(receipt,**kwargs)
        self.assertEqual((result['status'],result['observed'],result['censored']),('NOT_SUPPLIED',0,1))

    def test_each_unbound_node_makes_the_transaction_censored(self):
        for kind in ('pid','executable','inode','namespace','clock_order','wrong_height_hash','duplicate_height','duplicate_json','duplicate_node_descriptor','future_clock','inclusion_bytes'):
            with self.subTest(kind=kind):
                receipt,kwargs=self.fixture(); item=kwargs['node_evidence'][1]
                if kind in ('pid','executable','inode','namespace'):
                    if kind=='pid':item['processProbe']['pid']+=1
                    elif kind=='executable':item['processProbe']['binarySHA256']='1'*64
                    elif kind=='inode':item['processProbe']['inode']+=1
                    else:item['processProbe']['timeNamespace']='9:9'
                elif kind=='inclusion_bytes':kwargs['inclusion'][0]+=b' '
                elif kind=='duplicate_node_descriptor':receipt['commitMonotonicObservation']['originalSnapshots'].append(copy.deepcopy(receipt['commitMonotonicObservation']['originalSnapshots'][1]))
                elif kind=='duplicate_json':
                    item['clockOriginal']=item['clockOriginal'].replace(b'{',b'{"status":"OBSERVED",',1)
                    receipt['commitMonotonicObservation']['originalSnapshots'][1].update(descriptor(item['clockOriginal']))
                else:
                    clock=json.loads(item['clockOriginal'])
                    if kind=='clock_order':clock['samples'].append(dict(height=6,appHash='d'*64,monotonicNs='1'))
                    elif kind=='wrong_height_hash':clock['samples'][0]['appHash']='1'*64
                    elif kind=='duplicate_height':clock['samples'].append(clock['samples'][0])
                    else:clock['samples'][0]['monotonicNs']='1600'
                    item['clockOriginal']=raw(clock)
                    receipt['commitMonotonicObservation']['originalSnapshots'][1].update(descriptor(item['clockOriginal']))
                result=r.reduce(receipt,**kwargs)
                self.assertEqual((result['observed'],result['censored']),(0,1))
                self.assertIsNone(result['rows'][0]['fourNodeUpperBoundNs'])

    def test_original_full_demand_indices_and_ids_are_mandatory(self):
        receipt,kwargs=self.fixture();receipt['loadResult']['rows'][0]['index']=1
        with self.assertRaisesRegex(ValueError,'unique full demand'):r.reduce(receipt,**kwargs)

    def test_original_transaction_hash_cannot_fill_two_demand_rows(self):
        receipt,kwargs=self.fixture();receipt['configuredDemand']=2
        other=copy.deepcopy(receipt['loadResult']['rows'][0]);other.update(index=1,id='8'*64)
        receipt['loadResult']['rows'].append(other)
        with self.assertRaisesRegex(ValueError,'hashes cannot be reused'):r.reduce(receipt,**kwargs)

    def test_original_rpc_height_requires_canonical_decimal_string(self):
        for value in (True,5,5.0,'05','+5','5.0'):
            with self.subTest(value=value):
                receipt,kwargs=self.fixture();payload=json.loads(kwargs['inclusion'][0]);payload['rows'][1]['height']=value
                kwargs['inclusion'][0]=raw(payload);receipt['commitClockInclusions'][0].update(descriptor(kwargs['inclusion'][0]))
                self.assertEqual(r.reduce(receipt,**kwargs)['censored'],1)

    def test_boolean_pid_cannot_alias_original_pid_one(self):
        receipt,kwargs=self.fixture();item=kwargs['node_evidence'][0]
        receipt['processes'][1]['pid']=1;item['processProbe']['pid']=1
        for field,key in (('commitOriginal','normalCommitObservation'),('clockOriginal','commitMonotonicObservation')):
            payload=json.loads(item[field]);payload['processID']=1;item[field]=raw(payload)
            receipt[key]['originalSnapshots'][0].update(pid=1,**descriptor(item[field]))
        receipt['normalCommitObservation']['originalSnapshots'][0]['pid']=True
        result=r.reduce(receipt,**kwargs)
        self.assertEqual((result['observed'],result['censored']),(0,1))

    def test_one_original_process_cannot_impersonate_four_nodes(self):
        receipt,kwargs=self.fixture();first=copy.deepcopy(kwargs['node_evidence'][0])
        first_process=receipt['processes'][1]
        for node in range(1,4):
            kwargs['node_evidence'][node]=copy.deepcopy(first)
            receipt['commitClockProcessProbes'][node]['probe']=copy.deepcopy(first['processProbe'])
            receipt['processes'][node+1].update(pid=first_process['pid'],startTicks=first_process['startTicks'])
            for key,raw_key in (('normalCommitObservation','commitOriginal'),('commitMonotonicObservation','clockOriginal')):
                receipt[key]['originalSnapshots'][node].update(pid=first_process['pid'],**descriptor(first[raw_key]))
        result=r.reduce(receipt,**kwargs)
        self.assertEqual((result['status'],result['observed'],result['censored']),('NOT_SUPPLIED',0,1))

    def test_same_node_self_consistency_cannot_hide_another_network(self):
        receipt,kwargs=self.fixture();item=kwargs['node_evidence'][1]
        for key,receipt_key in (('commitOriginal','normalCommitObservation'),('clockOriginal','commitMonotonicObservation')):
            value=json.loads(item[key]);value['originalGenesisHash']='f'*64;item[key]=raw(value)
            receipt[receipt_key]['originalSnapshots'][1].update(descriptor(item[key]))
        result=r.reduce(receipt,**kwargs)
        self.assertEqual((result['observed'],result['censored']),(0,1))
        self.assertIsNone(result['rows'][0]['fourNodeUpperBoundNs'])

    def test_node_pidfd_is_bound_before_original_child_publication(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            window=lab.Window.__new__(lab.Window)
            window.lock=threading.RLock();window.children=[];window.known={};window.logs=[];window.work=root;window.source=root;window.env={};window.cpus=[0];window.sample=lambda:None
            child=SimpleNamespace(pid=12345,returncode=None);anchor=mock.Mock()
            def bind(process):
                self.assertIs(process,child);self.assertEqual(window.children,[])
                self.assertTrue(process._ynx_clock_pidfd_required)
                return anchor
            spec=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module:None))
            module=SimpleNamespace(OriginalOwnerPidfd=bind)
            with mock.patch.object(lab.subprocess,'Popen',return_value=child),mock.patch.object(lab.guard,'bounded',return_value=b''), \
                 mock.patch.object(lab.guard,'parse_stat',return_value=dict(startTicks=123)), \
                 mock.patch.object(lab.importlib.util,'spec_from_file_location',return_value=spec), \
                 mock.patch.object(lab.importlib.util,'module_from_spec',return_value=module):
                try:
                    self.assertIs(window.launch('pq-node-0',['original-node'],True,original_pidfd_node=True),child)
                    self.assertIs(child._ynx_clock_pidfd,anchor);self.assertEqual(len(window.children),1)
                    self.assertFalse(hasattr(child,'_ynx_original_pidfd')) # group retirement stays original
                finally:
                    for _,log in window.logs:log.close()

    def test_original_node_pidfd_close_requires_original_process_retirement(self):
        for retired in (False,True):
            with self.subTest(retired=retired):
                window=lab.Window.__new__(lab.Window);window.lock=threading.RLock()
                anchor=mock.Mock();anchor.close_bounded.return_value=True;child=SimpleNamespace(returncode=0 if retired else None,_ynx_clock_pidfd=anchor)
                window.children=[dict(name='pq-node-0',process=child)];window._stop_locked=lambda:True
                result=window.stop()
                self.assertEqual(result,retired)
                self.assertEqual(window.commit_clock_cleanup_debt,[] if retired else ['pq-node-0'])
                self.assertEqual(anchor.close_bounded.call_count,1 if retired else 0)

    def test_failed_original_node_pidfd_binding_retains_original_child(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            window=lab.Window.__new__(lab.Window);window.lock=threading.RLock();window.children=[];window.known={};window.logs=[]
            window.work=root;window.source=root;window.env={};window.cpus=[0];window.sample=lambda:None
            child=SimpleNamespace(pid=12345,returncode=None)
            spec=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module:None))
            def refused(process):raise OSError('original pidfd unavailable')
            module=SimpleNamespace(OriginalOwnerPidfd=refused)
            with mock.patch.object(lab.subprocess,'Popen',return_value=child),mock.patch.object(lab.guard,'bounded',return_value=b''), \
                 mock.patch.object(lab.guard,'parse_stat',return_value=dict(startTicks=123)), \
                 mock.patch.object(lab.importlib.util,'spec_from_file_location',return_value=spec), \
                 mock.patch.object(lab.importlib.util,'module_from_spec',return_value=module):
                try:
                    with self.assertRaisesRegex(OSError,'original pidfd unavailable'):
                        window.launch('pq-node-0',['original-node'],True,original_pidfd_node=True)
                    self.assertEqual(len(window.children),1);self.assertIs(window.children[0]['process'],child)
                    self.assertTrue(child._ynx_clock_pidfd_required)
                finally:
                    for _,log in window.logs:log.close()

    def test_node_anchor_close_failure_never_replaces_original_stop_error(self):
        window=lab.Window.__new__(lab.Window);window.lock=threading.RLock()
        anchor=mock.Mock();anchor.close_bounded.side_effect=OSError('secondary identity close')
        window.children=[dict(name='pq-node-0',process=SimpleNamespace(returncode=0,_ynx_clock_pidfd=anchor))]
        def original_failure():raise RuntimeError('original stop failure')
        window._stop_locked=original_failure
        with self.assertRaisesRegex(RuntimeError,'original stop failure'):window.stop()
        self.assertEqual(window.commit_clock_cleanup_debt,['pq-node-0'])

    def test_busy_original_pidfd_lock_returns_cleanup_debt(self):
        spec=importlib.util.spec_from_file_location('bounded_clock_pidfd',Path(__file__).with_name('pq-experimental-owner-pidfd.py'))
        identity=importlib.util.module_from_spec(spec);spec.loader.exec_module(identity)
        anchor=identity.OriginalOwnerPidfd.__new__(identity.OriginalOwnerPidfd)
        anchor.lock=threading.Lock();anchor.fd=os.open(os.devnull,os.O_RDONLY);anchor.pid=123
        anchor.lock.acquire()
        try:
            started=__import__('time').monotonic();self.assertFalse(anchor.close_bounded(timeout=.01))
            self.assertLess(__import__('time').monotonic()-started,1);self.assertIsNotNone(anchor.fd)
        finally:anchor.lock.release();anchor.close()

    @unittest.skipUnless(sys.platform=='linux','real original pidfd and /proc require Linux')
    def test_real_linux_parent_clock_and_original_process_executable(self):
        domain=r.parent_domain();self.assertEqual(domain['processID'],os.getpid())
        binary=os.path.realpath('/bin/sleep');digest=hashlib.sha256(Path(binary).read_bytes()).hexdigest()
        built=r.capture_built_binary(binary);self.assertEqual((built['path'],built['sha256']),(binary,digest))
        child=subprocess.Popen([binary,'30'])
        try:
            fd=r.bind_unpublished_process(child)
            try:
                probe=r.capture_owned_executable(child,fd,binary,digest)
                self.assertEqual((probe['pid'],probe['binarySHA256'],probe['timeNamespace']),(child.pid,digest,domain['timeNamespace']))
                self.assertEqual(tuple(probe[key] for key in ('device','inode','size')),tuple(built[key] for key in ('device','inode','size')))
                with self.assertRaises(ValueError):r.capture_owned_executable(child,fd,binary,'0'*64)
            finally:fd.close()
        finally:child.terminate();child.wait(timeout=5)

    @unittest.skipUnless(sys.platform=='linux','real original Window and pidfd require Linux')
    def test_real_linux_window_binds_and_retires_exact_original_node(self):
        binary=os.path.realpath('/bin/sleep');digest=hashlib.sha256(Path(binary).read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            window=lab.Window.__new__(lab.Window);window.lock=threading.RLock();window.children=[];window.known={};window.logs=[]
            window.work=root;window.source=root;window.env=dict(os.environ);window.cpus=sorted(os.sched_getaffinity(0));window.sample=lambda:None
            child=window.launch('pq-node-0',[binary,'30'],True,original_pidfd_node=True)
            try:
                probe=window.capture_clock_node(child,binary,digest)
                self.assertEqual(probe['pid'],child.pid);self.assertEqual(probe['binarySHA256'],digest)
                with self.assertRaisesRegex(RuntimeError,'one original node clock probe'):
                    window.capture_clock_node(child,binary,digest)
                def retire():child.terminate();child.wait(timeout=5);return True
                window._stop_locked=retire
                self.assertTrue(window.stop());self.assertEqual(window.commit_clock_cleanup_debt,[])
                self.assertIsNone(child._ynx_clock_pidfd.fd)
            finally:
                if child.poll() is None:child.terminate();child.wait(timeout=5)
                for _,log in window.logs:log.close()


if __name__=='__main__':unittest.main(verbosity=2)
