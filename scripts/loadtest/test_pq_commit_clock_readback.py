"""Synthetic controls only; no node, network, finality or throughput grant."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

spec=importlib.util.spec_from_file_location('commit_clock_reader',Path(__file__).with_name('pq-commit-clock-readback.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)


def raw(value): return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def descriptor(value): return dict(bytes=len(value),sha256=hashlib.sha256(value).hexdigest())


class CommitClockReadbackControls(unittest.TestCase):
    def fixture(self):
        source='a'*40; binary='b'*64; tx='c'*64; app='d'*64; binary_path='/synthetic/ynx-comet'
        identity=dict(commit=source,tree='e'*40,forkTree='f'*40)
        selection=raw(dict(originalSourceCommit=source,originalSourceTree=identity['tree'],originalProductionForkTree=identity['forkTree'],
                           originalCheckoutWritten=False,fakeVCSIdentity=False,sourceDirectory='/synthetic/source',selectedOptionalForkTree='e'*40))
        deps=raw(dict(synthetic='controlled'))
        declaration=raw(dict(version='YNX-COMET-COMMIT-CLOCK-BUILD/v1',status='DECLARED',sourceRevision=source,
                             sourceBinding=r.SOURCE_BINDING,syntheticOnly=True,runtimeAuthorized=False,nodeStarted=False))
        argv=['go','build','-mod=readonly','-p','1','-trimpath','-buildvcs=false','-ldflags',
              '-X main.operatorCommitBuildSource='+source,'-tags','ynx_live_wire_observation','-o',binary_path,'./cmd/ynx-comet']
        parent=dict(processID=100,bootID='00000000-0000-0000-0000-000000000000',timeNamespace='1:2',clock='CLOCK_MONOTONIC',observedStartNs='800',observedEndNs='900')
        receipt=dict(source=identity,configuredDemand=1,binaries={'ynx-comet':binary},commitClockParent=parent,
            normalLiveBuildProvenance={'ynx-comet':dict(binarySHA256=binary,originalSource=identity,sourceSelectionSHA256=r.sha(selection),
                sourceDependenciesReceiptSHA256=r.sha(deps),buildArgv=argv,buildCwd='/synthetic/source',selectedOptionalForkTree='e'*40)},
            normalLiveSourceDependencies={'sourceDependencies':json.loads(deps)},commitClockBuildIdentity=dict(pid=99,**descriptor(declaration)),
            loadResult=dict(originMonotonicNs='1000',rows=[dict(index=0,id='logical-0',hash=tx,submittedNs=100)]),
            normalCommitObservation=dict(originalSnapshots=[]),commitMonotonicObservation=dict(originalSnapshots=[]),
            commitClockProcessProbes=[],processes=[dict(name='commit-clock-build-identity',pid=99,exitCode=0,command=[binary_path,'synthetic-commit-clock-build-identity','--synthetic'])],commitClockInclusions=[])
        evidence=[]
        for node in range(4):
            pid=200+node
            commit=raw(dict(version='YNX-COMET-COMMIT-OBSERVATION/v1',scope='synthetic-loopback-lab/v1',processID=pid,
                chainID='synthetic-chain',originalGenesisHash='g'*64,independentFinality=False,
                coverage=dict(notificationCaptureComplete=True),samples=[dict(height=5,appHash=app,persistence=dict(height=5,durable=True))]))
            clock=raw(dict(version='YNX-COMET-COMMIT-MONOTONIC/v1',status='OBSERVED',scope='synthetic-loopback-lab/v1',processID=pid,
                chainID='synthetic-chain',originalGenesisHash='g'*64,independentFinality=False,sourceRevision=source,
                sourceBinding=r.SOURCE_BINDING,clock='CLOCK_MONOTONIC',bootID=parent['bootID'],timeNamespace=parent['timeNamespace'],
                captureBoundary=r.BOUNDARY,samples=[dict(height=5,appHash=app,monotonicNs=str(1300+node))]))
            probe=dict(pid=pid,startTicks='19',binarySHA256=binary,binaryPath=binary_path,timeNamespace='1:2',observedEndNs='950',
                       identity='original-unpublished-pidfd-and-live-proc-exe')
            receipt['normalCommitObservation']['originalSnapshots'].append(dict(node=node,pid=pid,**descriptor(commit)))
            receipt['commitMonotonicObservation']['originalSnapshots'].append(dict(node=node,pid=pid,**descriptor(clock)))
            receipt['commitClockProcessProbes'].append(dict(node=node,probe=probe))
            receipt['processes'].append(dict(name='pq-node-%d'%node,pid=pid,startTicks='19',command=['original-shim',binary_path]))
            evidence.append(dict(processProbe=probe,commitOriginal=commit,clockOriginal=clock))
        inclusion=raw(dict(observedMonotonicNs=1500,rows=[dict(hash=tx.upper(),height='5',tx_result=dict(code=0)) for _ in range(4)]))
        receipt['commitClockInclusions'].append(dict(index=0,**descriptor(inclusion)))
        kwargs=dict(expected_source=source,parent=parent,node_evidence=evidence,inclusion={0:inclusion},selection_raw=selection,
                    dependencies_raw=deps,build_identity_raw=declaration)
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

    def test_each_unbound_node_makes_the_transaction_censored(self):
        for kind in ('pid','executable','namespace','clock_order','wrong_height_hash','duplicate_height','future_clock','inclusion_bytes'):
            with self.subTest(kind=kind):
                receipt,kwargs=self.fixture(); item=kwargs['node_evidence'][1]
                if kind in ('pid','executable','namespace'):
                    if kind=='pid':item['processProbe']['pid']+=1
                    elif kind=='executable':item['processProbe']['binarySHA256']='1'*64
                    else:item['processProbe']['timeNamespace']='9:9'
                elif kind=='inclusion_bytes':kwargs['inclusion'][0]+=b' '
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

    @unittest.skipUnless(sys.platform=='linux','real original pidfd and /proc require Linux')
    def test_real_linux_parent_clock_and_original_process_executable(self):
        domain=r.parent_domain();self.assertEqual(domain['processID'],os.getpid())
        binary=os.path.realpath('/bin/sleep');digest=hashlib.sha256(Path(binary).read_bytes()).hexdigest()
        child=subprocess.Popen([binary,'30'])
        try:
            fd=r.bind_unpublished_process(child)
            try:
                probe=r.capture_owned_executable(child,fd,binary,digest)
                self.assertEqual((probe['pid'],probe['binarySHA256'],probe['timeNamespace']),(child.pid,digest,domain['timeNamespace']))
                with self.assertRaises(ValueError):r.capture_owned_executable(child,fd,binary,'0'*64)
            finally:os.close(fd)
        finally:child.terminate();child.wait(timeout=5)


if __name__=='__main__':unittest.main(verbosity=2)
