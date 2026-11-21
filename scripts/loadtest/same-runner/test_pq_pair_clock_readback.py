"""Original paired public clock DATA controls; no network, nodes or authority."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest import mock
import zipfile


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

r=module('pq-commit-clock-readback')
held=module('pq-first100-held-readback')
legacy=module('test_pq_first100_held_readback')
pair=module('pq-same-runner-pair-readback')

def raw(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def descriptor(value):return dict(bytes=len(value),sha256=hashlib.sha256(value).hexdigest())

class PairedClockReadbackControls(unittest.TestCase):
    def fixture(self):
        source='a'*40; binary='b'*64; transaction=b'synthetic-original-transaction';tx=r.sha(transaction); app='d'*64; binary_path='/synthetic/ynx-comet'
        identity=dict(commit=source,tree='e'*40,forkTree='f'*40)
        selection=raw(dict(originalSourceCommit=source,originalSourceTree=identity['tree'],originalProductionForkTree=identity['forkTree'],
                           originalCheckoutWritten=False,fakeVCSIdentity=False,sourceDirectory='/synthetic/source',selectedOptionalForkTree='e'*40))
        deps=raw(dict(synthetic='controlled'))
        network=raw(dict(version='YNX-PQ-LOOPBACK-NETWORK/v1',syntheticOnly=True,publicNetwork=False,createEmptyBlocks=False,
                         nodes=[dict(index=i) for i in range(4)],chainId='ynx_642399-1',originalGenesisHash='e'*64,rootDir='/synthetic/private'))
        declaration=raw(dict(version='YNX-COMET-COMMIT-CLOCK-BUILD/v1',status='DECLARED',sourceRevision=source,
                             sourceBinding=r.SOURCE_BINDING,syntheticOnly=True,runtimeAuthorized=False,nodeStarted=False))
        argv=['go','build','-mod=readonly','-p','1','-trimpath','-buildvcs=false','-ldflags',
              '-X main.operatorCommitBuildSource='+source,'-tags','ynx_live_wire_observation','-o',binary_path,'./cmd/ynx-comet']
        parent=dict(processID=100,bootID='00000000-0000-0000-0000-000000000000',timeNamespace='1:2',clock='CLOCK_MONOTONIC',observedStartNs='800',observedEndNs='900')
        receipt=dict(source=identity,configuredDemand=1,binaries={'ynx-comet':binary},commitClockParent=parent,sameHost=True,physicalFaultDomains=1,
            normalLiveBuildProvenance={'ynx-comet':dict(binarySHA256=binary,originalSource=identity,sourceSelectionSHA256=r.sha(selection),
                sourceDependenciesReceiptSHA256=r.sha(deps),buildArgv=argv,buildCwd='/synthetic/source',selectedOptionalForkTree='e'*40)},
            normalLiveSourceDependencies={'sourceDependencies':json.loads(deps)},commitClockBuildIdentity=dict(path='commit-clock-build-identity.log',pid=99,**descriptor(declaration)),
            commitClockBuiltBinary=dict(path=binary_path,sha256=binary,device=1,inode=44,size=1024),
            activation=dict(syntheticOnly=True,networkPlanSHA256=r.sha(network)),loadResult=dict(originProcessID=100,originMonotonicNs='1000',observationCutoffNs=700,rows=[dict(index=0,id='9'*64,operationId='8'*64,ownerIndex=4,nonce=2,hash=tx,submittedNs=100,includedNs=550)]),
            normalCommitObservation=dict(originalSnapshots=[]),commitMonotonicObservation=dict(originalSnapshots=[]),
            commitClockProcessProbes=[],processes=[dict(name='commit-clock-build-identity',pid=99,exitCode=0,rawReturnCode=0,exited=True,signal=None,command=[binary_path,'synthetic-commit-clock-build-identity','--synthetic'])],commitClockInclusions=[])
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
            common=dict(node=node,pid=pid,processName='pq-node-%d'%node,sourceStopped=True,usable=True)
            receipt['normalCommitObservation']['originalSnapshots'].append(dict(common,path='commit-observation-node-%d-original.json'%node,**descriptor(commit)))
            receipt['commitMonotonicObservation']['originalSnapshots'].append(dict(common,path='commit-monotonic-node-%d-original.json'%node,**descriptor(clock)))
            receipt['commitClockProcessProbes'].append(dict(node=node,probe=probe))
            receipt['processes'].append(dict(name='pq-node-%d'%node,pid=pid,startTicks=19,exited=True,rawReturnCode=0,exitCode=0,signal=None,command=['original-shim',binary_path]))
            evidence.append(dict(processProbe=probe,commitOriginal=commit,clockOriginal=clock))
        inclusion=raw(dict(observedMonotonicNs=1500,qualifiedFinal=False,rows=[dict(hash=tx.upper(),height='5',tx=base64.b64encode(transaction).decode(),tx_result=dict(code=0)) for _ in range(4)]))
        intent=raw(dict(id='9'*64,operationId='8'*64,owner=4,nonce='2',transactionHash=tx,submissionAttempts=1,qualifiedFinal=False))
        receipt['commitClockInclusions'].append(dict(index=0,path='load-operations/00000/four-node-inclusion.json',**descriptor(inclusion),intent=descriptor(intent),transaction=descriptor(transaction)))
        kwargs=dict(expected_source=source,parent=parent,node_evidence=evidence,inclusion={0:inclusion},selection_raw=selection,
                    dependencies_raw=deps,build_identity_raw=declaration,network_plan_raw=network,original_operations={0:dict(intent=intent,transaction=transaction)})
        return receipt,kwargs

    def public_originals(self):
        receipt,kwargs=self.fixture()
        network=json.loads(kwargs['network_plan_raw'])
        root=network['rootDir']
        receipt['binaries']['ynx-consensus-pq-lab']='1'*64
        receipt['normalLiveBuildProvenance']['ynx-consensus-pq-lab']=dict(
            binarySHA256='1'*64,originalSource=receipt['source'],sourceSelectionSHA256=r.sha(kwargs['selection_raw']),
            sourceDependenciesReceiptSHA256=r.sha(kwargs['dependencies_raw']),selectedOptionalForkTree='e'*40,
            buildCwd='/synthetic/source',buildArgv=['go','build','-mod=readonly','-p','1','-trimpath',
                '-buildvcs=false','-o','/synthetic/ynx-consensus-pq-lab','./cmd/ynx-consensus-pq-lab'])
        receipt['processes'].append(dict(name='create-original',pid=99,startTicks=17,exitCode=0,rawReturnCode=0,
            exited=True,signal=None,command=['/synthetic/ynx-consensus-pq-lab','create','--synthetic','--root',root]))
        receipt['commitClockBuiltCreator']=dict(path='/synthetic/ynx-consensus-pq-lab',sha256='1'*64,device=1,inode=45,size=1024)
        receipt['commitClockCreatorProbe']=dict(pid=99,startTicks='17',binarySHA256='1'*64,
            binaryPath='/synthetic/ynx-consensus-pq-lab',device=1,inode=45,size=1024,timeNamespace='1:2',
            observedStartNs='750',observedEndNs='790',identity='original-unpublished-pidfd-and-live-proc-exe')
        with mock.patch.object(r,'COMMIT_CLOCK_SOURCES',('a'*40,'2'*40)):
            measured=r.reduce(receipt,**kwargs)
        self.assertEqual((measured['observed'],measured['rows'][0]['fourNodeUpperBoundNs']),(1,203))
        measured.update(createProcessLiveExecutableObserved=True,createProcessExecutableIndependentlyVerified=False)
        receipt['commitClockReadback']=measured
        files={'normal-live-source-selection.json':kwargs['selection_raw'],
            'normal-live-source-dependencies.json':kwargs['dependencies_raw'],
            'commit-clock-build-identity.log':kwargs['build_identity_raw'],
            'create-original.log':raw(dict(version='YNX-PQ-LAB-CREATED/v1',nodeStarted=False,
                planSHA256=r.sha(kwargs['network_plan_raw']),planFile=root+'/network-plan.json',plan=network)),
            'load-operations/00000/four-node-inclusion.json':kwargs['inclusion'][0],
            'load-operations/00000/submission-intent.json':kwargs['original_operations'][0]['intent'],
            'load-operations/00000/transaction.abci':kwargs['original_operations'][0]['transaction'],
            'receipt.json':raw(receipt)}
        for index,node in enumerate(kwargs['node_evidence']):
            files['commit-observation-node-%d-original.json'%index]=node['commitOriginal']
            files['commit-monotonic-node-%d-original.json'%index]=node['clockOriginal']
        return {'archive/public/'+name:data for name,data in files.items()},receipt

    def test_frozen_two_sources_recompute_original_upper_bounds_and_censor_tampering(self):
        files,receipt=self.public_originals();source=receipt['source'];tools=dict(commit='c'*40,tree='d'*40)
        binding=dict(before=dict(source='a'*40,sourceTree='e'*40,forkTree='f'*40,tools='c'*40,toolsTree='d'*40),
                     after=dict(source='2'*40,sourceTree='3'*40,forkTree='4'*40,tools='5'*40,toolsTree='6'*40))
        with mock.patch.object(held,'CLOCK_PUBLIC_READBACK_BINDINGS',binding), \
             mock.patch.object(held,'module',return_value=r),mock.patch.object(r,'COMMIT_CLOCK_SOURCES',('a'*40,'2'*40)):
            result=held.original_commit_clock_readback(files,'archive/public/',source,tools)
            self.assertEqual((result['observed'],result['censored'],result['rows'][0]['fourNodeUpperBoundNs']),(1,0,203))
            self.assertFalse(result['archiveOriginIndependentlyVerified'] or result['sourceCIIndependentlyVerified']
                             or result['runtimeAuthorized'] or result['independentFinality'])
            for bad in (dict(source,commit='2'*40),dict(source,forkTree='4'*40)):
                result=held.original_commit_clock_readback(files,'archive/public/',bad,tools)
                self.assertEqual((result['status'],result['observed'],result['censored']),('NOT_SUPPLIED',0,1))
            altered=dict(files);altered['archive/public/load-operations/00000/transaction.abci']=b'changed'
            result=held.original_commit_clock_readback(altered,'archive/public/',source,tools)
            self.assertEqual((result['observed'],result['censored']),(0,1))
            altered=dict(files);del altered['archive/public/commit-monotonic-node-1-original.json']
            result=held.original_commit_clock_readback(altered,'archive/public/',source,tools)
            self.assertEqual((result['observed'],result['censored']),(0,1))
            changed=copy.deepcopy(receipt);changed['commitClockProcessProbes'][0]['probe']['pid']=777
            altered=dict(files);altered['archive/public/receipt.json']=raw(changed)
            result=held.original_commit_clock_readback(altered,'archive/public/',source,tools)
            self.assertEqual((result['observed'],result['censored']),(0,1))
            changed=copy.deepcopy(receipt);changed['binaries']['ynx-comet']='7'*64
            altered=dict(files);altered['archive/public/receipt.json']=raw(changed)
            result=held.original_commit_clock_readback(altered,'archive/public/',source,tools)
            self.assertEqual((result['observed'],result['censored']),(0,1))
            changed=copy.deepcopy(receipt);del changed['commitClockReadback']
            altered=dict(files);altered['archive/public/receipt.json']=raw(changed)
            result=held.original_commit_clock_readback(altered,'archive/public/',source,tools)
            self.assertEqual((result['status'],result['observed'],result['censored']),('NOT_SUPPLIED',0,1))
            changed=copy.deepcopy(receipt);changed['commitClockProcessProbes'][0]['probe']['timeNamespace']='8:9'
            altered=dict(files);altered['archive/public/receipt.json']=raw(changed)
            result=held.original_commit_clock_readback(altered,'archive/public/',source,tools)
            self.assertEqual((result['observed'],result['censored']),(0,1))
            altered=dict(files);altered['archive/public/normal-live-source-selection.json']=b'{}'
            result=held.original_commit_clock_readback(altered,'archive/public/',source,tools)
            self.assertEqual((result['observed'],result['censored']),(0,1))

    def test_actual_held_archive_enabled_missing_clock_cannot_fall_back(self):
        case=legacy.HeldReadbackTests();original,pin=case.fixture()
        old=held.inspect(original,r.sha(original),case.controller,pin)
        self.assertNotIn('originalCommitClockReadback',old)
        with zipfile.ZipFile(io.BytesIO(original)) as archive:
            files={name:archive.read(name) for name in archive.namelist()}
        plan=json.loads(files['pq-first100-held-plan.json'])
        plan['configuration'].setdefault('options',{})['commit_clock_observation']=True
        plan['configurationSHA256']=r.sha(raw(plan['configuration']))
        files['pq-first100-held-plan.json']=raw(plan)
        key='fixture/public/FIRST100-HELD-CI.json';adapter=json.loads(files[key])
        adapter.update(plan);files[key]=raw(adapter)
        key='fixture/public/receipt.json';receipt=json.loads(files[key]);receipt['configuredDemand']=500;files[key]=raw(receipt)
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as archive:
            for name,data in files.items():archive.writestr(name,data)
        modified=stream.getvalue()
        report=held.inspect(modified,r.sha(modified),case.controller,plan['configurationSHA256'])
        clock=report['originalCommitClockReadback']
        self.assertEqual((clock['status'],clock['configuredDemand'],clock['observed'],clock['censored']),('NOT_SUPPLIED',500,0,500))
        self.assertTrue(report['commitClockReadbackConfigured'])
        self.assertFalse(clock['runtimeAuthorized'] or clock['independentFinality'])

    def test_static_two_arm_gate_never_uses_caller_or_cross_arm_source(self):
        self.assertIsNone(held.CLOCK_PUBLIC_READBACK_BINDINGS)
        self.assertIsNone(r.COMMIT_CLOCK_SOURCE);self.assertIsNone(r.COMMIT_CLOCK_SOURCES)
        files,receipt=self.public_originals();source=receipt['source'];tools=dict(commit='c'*40,tree='d'*40)
        result=held.original_commit_clock_readback(files,'archive/public/',source,tools)
        self.assertEqual((result['status'],result['observed'],result['censored']),('NOT_SUPPLIED',0,1))
        self.assertIsNone(r.COMMIT_CLOCK_SOURCE);self.assertIsNone(r.COMMIT_CLOCK_SOURCES)

    def test_missing_runtime_receipt_with_clock_enabled_remains_not_supplied(self):
        case=legacy.HeldReadbackTests();original,_=case.fixture(with_receipt=False)
        with zipfile.ZipFile(io.BytesIO(original)) as archive:
            files={name:archive.read(name) for name in archive.namelist()}
        plan=json.loads(files['pq-first100-held-plan.json'])
        plan['configuration'].setdefault('options',{})['commit_clock_observation']=True
        plan['configurationSHA256']=r.sha(raw(plan['configuration']))
        files['pq-first100-held-plan.json']=raw(plan)
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as archive:
            for name,data in files.items():archive.writestr(name,data)
        modified=stream.getvalue()
        result=held.inspect(modified,r.sha(modified),case.controller,plan['configurationSHA256'])
        self.assertEqual(result['status'],'NO_RUNTIME_RECEIPT')
        clock=result['originalCommitClockReadback']
        self.assertEqual((clock['status'],clock['configuredDemand'],clock['observed'],clock['censored']),('NOT_SUPPLIED',500,0,500))
        self.assertFalse(clock['runtimeAuthorized'] or clock['independentFinality'])

    def test_disabled_original_clock_cannot_be_forged_into_legacy_receipt(self):
        case=legacy.HeldReadbackTests();original,pin=case.fixture()
        with zipfile.ZipFile(io.BytesIO(original)) as archive:
            files={name:archive.read(name) for name in archive.namelist()}
        key='fixture/public/receipt.json';receipt=json.loads(files[key])
        receipt['commitClockReadback']=dict(status='OBSERVED_OR_CENSORED',observed=500,censored=0)
        files[key]=raw(receipt);stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as archive:
            for name,data in files.items():archive.writestr(name,data)
        modified=stream.getvalue()
        with self.assertRaisesRegex(RuntimeError,'disabled original clock'):
            held.inspect(modified,r.sha(modified),case.controller,pin)

    def test_pair_completeness_requires_both_original_clock_cohorts(self):
        self.assertEqual(pair.clock_projection([dict(report={}),dict(report={})]),{})
        good=dict(status='OBSERVED_OR_CENSORED',configuredDemand=500,observed=500,censored=0)
        def arm(clock=None,configured=True):
            report=dict(commitClockReadbackConfigured=configured)
            if clock is not None:report['originalCommitClockReadback']=clock
            return dict(report=report)
        self.assertTrue(pair.clock_projection([arm(good),arm(good)])['completeOriginalCommitClockDataPerArm'])
        for changed in (None,dict(good,status='NOT_SUPPLIED'),dict(good,observed=499,censored=1),
                        dict(good,observed=True),dict(good,configuredDemand=0),
                        dict(good,configuredDemand=1,observed=1)):
            with self.subTest(clock=changed):
                result=pair.clock_projection([arm(good),arm(changed)])
                self.assertFalse(result['completeOriginalCommitClockDataPerArm'])
        self.assertFalse(pair.clock_projection([arm(good),arm(good,False)])['completeOriginalCommitClockDataPerArm'])

    def test_two_frozen_arm_sources_are_selected_without_mutating_reader_gate(self):
        binding=dict(before=dict(source='a'*40,sourceTree='b'*40,forkTree='c'*40,tools='d'*40,toolsTree='e'*40),
                     after=dict(source='1'*40,sourceTree='2'*40,forkTree='3'*40,tools='4'*40,toolsTree='5'*40))
        reader=mock.Mock();reader.COMMIT_CLOCK_SOURCES=('a'*40,'1'*40);reader.COMMIT_CLOCK_SOURCE=None
        with mock.patch.object(held,'CLOCK_PUBLIC_READBACK_BINDINGS',binding),mock.patch.object(held,'module',return_value=reader):
            for label in ('before','after'):
                row=binding[label]
                held.original_commit_clock_readback({},'',dict(commit=row['source'],tree=row['sourceTree'],forkTree=row['forkTree']),
                    dict(commit=row['tools'],tree=row['toolsTree']))
                self.assertEqual(reader.readback_public_originals.call_args.kwargs['expected_source'],row['source'])
            before,after=binding['before'],binding['after']
            held.original_commit_clock_readback({},'',dict(commit=before['source'],tree=before['sourceTree'],forkTree=before['forkTree']),
                dict(commit=after['tools'],tree=after['toolsTree']))
            self.assertIsNone(reader.readback_public_originals.call_args.kwargs['expected_source'])
            self.assertIsNone(reader.COMMIT_CLOCK_SOURCE)
            self.assertEqual(reader.COMMIT_CLOCK_SOURCES,('a'*40,'1'*40))

    def test_actual_pair_rebinds_archives_and_censors_wrong_after_arm(self):
        fixtures=module('test_pq_same_runner_pair_readback');case=fixtures.PairFixture()
        for declaration in case.pair['arms']:
            label=declaration['arm'];plan=json.loads(case.files[label]['pq-first100-held-plan.json'])
            plan['configuration']['options']['commit_clock_observation']=True
            plan['configurationSHA256']=r.sha(raw(plan['configuration']))
            case.files[label]['pq-first100-held-plan.json']=raw(plan)
            adapter=case.get(label,'FIRST100-HELD-CI.json');adapter.update(plan);case.put(label,'FIRST100-HELD-CI.json',adapter)
            receipt=case.get(label,'receipt.json');receipt['configuredDemand']=500;case.put(label,'receipt.json',receipt)
            case.expected[label]['configurationSHA256']=plan['configurationSHA256']
            declaration['configurationSHA256']=plan['configurationSHA256']
        originals,metadata=case.package() # Rebuild all marker, ZIP and metadata digests.
        binding=dict(before=dict(source='1'*40,sourceTree='3'*40,forkTree='a'*40,tools='5'*40,toolsTree='7'*40),
                     after=dict(source='2'*40,sourceTree='4'*40,forkTree='a'*40,tools='9'*40,toolsTree='8'*40))
        with mock.patch.object(pair.held,'CLOCK_PUBLIC_READBACK_BINDINGS',binding), \
             mock.patch.object(pair.held,'module',return_value=r),mock.patch.object(r,'COMMIT_CLOCK_SOURCES',('1'*40,'2'*40)), \
             mock.patch.object(r,'readback_public_originals',wraps=r.readback_public_originals) as original:
            result=pair.inspect(originals['manifest'],originals['before'],originals['after'],metadata=metadata,
                controller=case.controller,manifest_sha256=r.sha(originals['manifest']),expected=case.expected)
        self.assertEqual([call.kwargs['expected_source'] for call in original.call_args_list],['1'*40,None])
        self.assertEqual(result['clockObservationConfiguredPerArm'],[True,True])
        self.assertFalse(result['completeOriginalCommitClockDataPerArm'] or result['clockObservationQualified'])
        for label in ('before','after'):
            clock=result[label]['originalCommitClockReadback']
            self.assertEqual((clock['status'],clock['observed'],clock['censored']),('NOT_SUPPLIED',0,500))
            self.assertFalse(clock['independentFinality'] or clock['runtimeAuthorized'])

    def test_nested_pair_rebound_selection_tampering_reaches_original_source_check(self):
        fixtures=module('test_pq_same_runner_pair_readback');case=fixtures.PairFixture()
        source=dict(commit='a'*40,tree='e'*40,forkTree='f'*40)
        tools=dict(commit='c'*40,tree='d'*40,driverSHA256='b'*64,resourceGuardSHA256='c'*64)
        public,support=self.public_originals();label='before';prefix=case.prefixes[label]
        plan=json.loads(case.files[label]['pq-first100-held-plan.json'])
        plan['configuration'].update(source=source['commit'],sourceTree=source['tree'],tools=tools['commit'],toolsTree=tools['tree'])
        plan['configuration']['options'].update(commit=source['commit'],commit_clock_observation=True)
        plan['configurationSHA256']=r.sha(raw(plan['configuration']));case.files[label]['pq-first100-held-plan.json']=raw(plan)
        adapter=case.get(label,'FIRST100-HELD-CI.json');adapter.update(plan);adapter['toolsCI']['source']=tools['commit'];case.put(label,'FIRST100-HELD-CI.json',adapter)
        receipt=case.get(label,'receipt.json');receipt.update(source=source,toolIdentity=tools,configuredDemand=500)
        receipt['loadResult']['originProcessID']=100
        for name in ('sameHost','physicalFaultDomains','binaries','normalLiveBuildProvenance','normalLiveSourceDependencies','commitClockParent',
                     'commitClockBuildIdentity','commitClockBuiltBinary','activation','commitClockBuiltCreator','commitClockCreatorProbe'):
            receipt[name]=copy.deepcopy(support[name])
        receipt['commitClockBuildIdentity']['pid']=98
        for item in support['processes']:
            if item['name'] not in ('create-original','commit-clock-build-identity'):continue
            process=copy.deepcopy(item)
            if item['name']=='commit-clock-build-identity':process.update(pid=98,startTicks=18)
            receipt['processes'].append(process)
        case.put(label,'receipt.json',receipt)
        request=case.get(label,'requested-load.json');request['source']=source;case.put(label,'requested-load.json',request)
        for name in ('normal-live-source-selection.json','normal-live-source-dependencies.json',
                     'commit-clock-build-identity.log','create-original.log'):
            case.files[label][prefix+name]=public['archive/public/'+name]
        case.expected[label].update(source=source['commit'],tools=tools['commit'],configurationSHA256=plan['configurationSHA256'])
        case.pair['arms'][0].update(source=source,tools=tools,configurationSHA256=plan['configurationSHA256'])
        binding=dict(before=dict(source='a'*40,sourceTree='e'*40,forkTree='f'*40,tools='c'*40,toolsTree='d'*40),
                     after=dict(source='2'*40,sourceTree='4'*40,forkTree='a'*40,tools='6'*40,toolsTree='8'*40))
        outcomes=[];check_original=r._source_binding
        def audited_source_binding(*args):
            try:
                result=check_original(*args)
            except Exception as error:
                outcomes.append(('REJECTED',str(error)));raise
            outcomes.append(('ACCEPTED',None));return result
        with mock.patch.object(pair.held,'CLOCK_PUBLIC_READBACK_BINDINGS',binding), \
             mock.patch.object(pair.held,'module',return_value=r),mock.patch.object(r,'COMMIT_CLOCK_SOURCES',('a'*40,'2'*40)), \
             mock.patch.object(r,'_source_binding',side_effect=audited_source_binding) as check:
            for corrupt in (False,True):
                case.files[label][prefix+'normal-live-source-selection.json']=(b'{}' if corrupt else public['archive/public/normal-live-source-selection.json'])
                originals,metadata=case.package() # Recompute all outer marker, artifact and ZIP hashes.
                result=pair.inspect(originals['manifest'],originals['before'],originals['after'],metadata=metadata,
                    controller=case.controller,manifest_sha256=r.sha(originals['manifest']),expected=case.expected)
                self.assertEqual(result['before']['originalCommitClockReadback']['status'],'NOT_SUPPLIED')
                self.assertEqual(result['before']['originalCommitClockReadback']['censored'],500)
                self.assertFalse(result['clockObservationQualified'] or result['completeOriginalCommitClockDataPerArm'])
                self.assertEqual(check.call_args.args[2],b'{}' if corrupt else public['archive/public/normal-live-source-selection.json'])
        self.assertEqual(outcomes,[('ACCEPTED',None),('REJECTED','original source manifest digest differs')])

if __name__ == '__main__':unittest.main()
