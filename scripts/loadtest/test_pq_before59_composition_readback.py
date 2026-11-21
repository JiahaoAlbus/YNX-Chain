"""Original Tools artifact evidence controls; never a runtime grant."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

r=module('pq-before59-composition-readback')
strict=module('pq-initialization-readback').strict
def encode(value):return (json.dumps(value,sort_keys=True)+'\n').encode()

def fixture():
    tools='a'*40;run=101;job=102;artifact=103
    cwd='/tmp/CONTROL/composed/source';binary='/tmp/CONTROL/ynx-comet'
    selection=dict(originalSourceCommit=r.SOURCE,originalSourceTree=r.TREE,originalProductionForkTree=r.FORK,
        selectedOptionalForkCommit=r.SUPPLIER,selectedOptionalForkTree=r.SUPPLIER_TREE,sourceOnly=True,nodeStarted=False,
        sourceDirectory=cwd,buildTags=['ynx_live_wire_observation'],carrierEnabled=False,
        moduleDescriptorSHA256=dict(r.MODULE_DESCRIPTORS),retainedProductionSHA256=dict(r.RETAINED_PRODUCTION),
        fakeVCSIdentity=False,originalCheckoutWritten=False,originalModuleDescriptorsChanged=False,publicActivation=False)
    native=dict(source=r.SOURCE,sourceTree=r.TREE,fileCount=11,sourceOnly=True,nodeStarted=False,authorityGranted=False,
        sourceBytesChanged=False,pressureAuthorized=False,buildSource=cwd,moduleDescriptorSHA256=dict(r.MODULE_DESCRIPTORS),
        files=[dict(path=path,**value) for path,value in r.native_source.FILES.items()])
    declaration=dict(version='YNX-COMET-COMMIT-CLOCK-BUILD/v1',
        sourceBinding='linker-declared-requires-original-manifest-build-binary-and-process-proof',
        sourceRevision=r.SOURCE,status='DECLARED',syntheticOnly=True,nodeStarted=False,runtimeAuthorized=False)
    build_info=(b'/tmp/CONTROL/ynx-comet: go1.26.11\n\tpath\tgithub.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet\n'
                b'\tbuild\t-tags=ynx_live_wire_observation\n\tbuild\t-trimpath=true\n\tbuild\tGOOS=linux\n'
                b'\tbuild\tGOARCH=amd64\n\tbuild\tCGO_ENABLED=1\n')
    members={'SOURCE-SELECTION.json':encode(selection),'SOURCE-NATIVE-DEPENDENCIES.json':encode(native),
             'GO-BUILD-INFO.txt':build_info,'SYNTHETIC-BUILD-IDENTITY.json':encode(declaration)}
    sha=lambda name:hashlib.sha256(members[name]).hexdigest()
    receipt=dict(schema='YNX-BEFORE59-ORIGINAL-COMPOSITION-CI/v1',source=r.SOURCE,tree=r.TREE,fork=r.FORK,
        platform='linux',goVersion='go1.26.11',goEnv=dict(GOVERSION='go1.26.11',GOOS='linux',GOARCH='amd64',CGO_ENABLED='1'),sourceOnly=True,sourceCIQualified=False,runtimeAuthorized=False,
        pressureAuthorized=False,nodeStarted=False,nativeDependencyFiles=11,supplier=r.SUPPLIER,supplierTree=r.SUPPLIER_TREE,
        composerSHA256=r.COMPOSER,originalToolsRun=dict(toolSource=tools,run=run,attempt=1,job='before59-original-composition'),
        binaryDeclaration=declaration,sourceSelectionSHA256=sha('SOURCE-SELECTION.json'),
        nativeDependenciesSHA256=sha('SOURCE-NATIVE-DEPENDENCIES.json'),buildInfoSHA256=sha('GO-BUILD-INFO.txt'),
        binary=dict(bytes=10,sha256='b'*64),buildCwd=cwd,buildArgv=['/go/bin/go','build','-mod=readonly','-p','1','-trimpath',
            '-buildvcs=false','-ldflags','-X main.operatorCommitBuildSource='+r.SOURCE,'-tags','ynx_live_wire_observation',
            '-o',binary,'./cmd/ynx-comet'])
    members['COMPOSITION-RECEIPT.json']=encode(receipt)
    return build(tools,run,job,artifact,members)

def build(tools,run,job,artifact,members):
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w') as z:
        for name,raw in members.items():z.writestr(name,raw)
    raw=buffer.getvalue();sha=hashlib.sha256(raw).hexdigest()
    binding=dict(source=r.SOURCE,tools=tools,run=run,job=job,artifact=artifact,archiveBytes=len(raw),archiveSHA256=sha,
        members={name:hashlib.sha256(value).hexdigest() for name,value in members.items()},path='/CONTROL/official.zip')
    job_data=dict(id=job,run_id=run,run_attempt=1,head_sha=tools,run_url='https://api.github.com/repos/JiahaoAlbus/YNX-Chain/actions/runs/%d'%run,
        name=r.JOB,status='completed',conclusion='success',steps=[dict(name=n,status='completed',conclusion='success') for n in r.STEPS])
    entry=dict(id=artifact,name='before59-source-build-%s-%d-1'%(tools,run),expired=False,digest='sha256:'+sha,size_in_bytes=len(raw),
               workflow_run=dict(id=run,head_sha=tools))
    return binding,job_data,dict(total_count=1,artifacts=[entry]),raw,members

class Before59CompositionReadbackControls(unittest.TestCase):
    def test_original_five_leaves_and_build_are_data_only(self):
        binding,job,inventory,raw,_=fixture();result=r.inspect(binding,job,inventory,raw,strict=strict)
        self.assertTrue(result['sourceOnlyEvidence']);self.assertFalse(result['runtimePermissionGranted'] or result['binaryProcessIndependentlyVerified'] or result['independentFinality'])

    def test_cross_run_attempt_source_and_missing_steps_refused(self):
        binding,job,inventory,raw,_=fixture()
        for key,value in (('run_id',999),('run_attempt',2),('head_sha','f'*40),('id',999),('name','other'),('conclusion','failure')):
            with self.subTest(key=key),self.assertRaises(RuntimeError):r.inspect(binding,dict(job,**{key:value}),inventory,raw,strict=strict)
        changed=copy.deepcopy(job);changed['steps'].pop()
        with self.assertRaises(RuntimeError):r.inspect(binding,changed,inventory,raw,strict=strict)

    def test_missing_duplicate_cross_run_and_wrong_sha_artifacts_refused(self):
        binding,job,inventory,raw,_=fixture()
        for mode in ('missing','duplicate','cross_run','sha','size','expired'):
            value=copy.deepcopy(inventory)
            if mode=='missing':value=dict(total_count=0,artifacts=[])
            if mode=='duplicate':value['artifacts'].append(copy.deepcopy(value['artifacts'][0]));value['total_count']=2
            if mode=='cross_run':value['artifacts'][0]['workflow_run']['id']=999
            if mode=='sha':value['artifacts'][0]['digest']='sha256:'+'f'*64
            if mode=='size':value['artifacts'][0]['size_in_bytes']+=1
            if mode=='expired':value['artifacts'][0]['expired']=True
            with self.subTest(mode=mode),self.assertRaises(RuntimeError):r.inspect(binding,job,value,raw,strict=strict)

    def test_missing_changed_or_unsafe_original_archive_rejected(self):
        binding,job,inventory,raw,members=fixture()
        with self.assertRaises(RuntimeError):r.inspect(binding,job,inventory,raw+b'x',strict=strict)
        with self.assertRaises(ValueError):r.inspect(binding,job,inventory,raw[:-1]+bytes([raw[-1]^1]),strict=strict)
        changed=dict(members);del changed['GO-BUILD-INFO.txt']
        b,j,i,z,_=build(binding['tools'],binding['run'],binding['job'],binding['artifact'],changed)
        with self.assertRaises(RuntimeError):r.inspect(b,j,i,z,strict=strict)

    def test_forged_receipt_source_run_platform_or_flags_refused(self):
        binding,_,_,_,members=fixture();receipt=json.loads(members['COMPOSITION-RECEIPT.json'])
        for mode in ('source','run','platform','arch','cgo','flags','runtime','native'):
            changed=copy.deepcopy(receipt)
            if mode=='source':changed['source']='f'*40
            if mode=='run':changed['originalToolsRun']['run']=999
            if mode=='platform':changed['platform']='darwin'
            if mode=='arch':changed['goEnv']['GOARCH']='arm64'
            if mode=='cgo':changed['goEnv']['CGO_ENABLED']='0'
            if mode=='flags':changed['buildArgv'][6]='-buildvcs=true'
            if mode=='runtime':changed['runtimeAuthorized']=True
            if mode=='native':changed['nativeDependencyFiles']=10
            value=dict(members,**{'COMPOSITION-RECEIPT.json':encode(changed)})
            b,j,i,z,_=build(binding['tools'],binding['run'],binding['job'],binding['artifact'],value)
            with self.subTest(mode=mode),self.assertRaises(RuntimeError):r.inspect(b,j,i,z,strict=strict)

    def test_original_cwd_tags_native_scope_and_structured_buildinfo_refused_on_difference(self):
        binding,_,_,_,members=fixture()
        modes=('selection_cwd','native_cwd','missing_cwd','noncanonical_cwd','tags','carrier','native_pressure',
               'selection_descriptor','native_descriptor','missing_descriptor','extra_descriptor','invalid_descriptor',
               'both_descriptors','duplicate_descriptor','retained_source','retained_missing','retained_extra',
               'info_version','info_path','info_arch','info_cgo','info_fake_linux','info_duplicate','info_vcs','declaration_authority')
        for mode in modes:
            value=dict(members);receipt=json.loads(value['COMPOSITION-RECEIPT.json'])
            if mode in ('selection_cwd','tags','carrier','selection_descriptor','retained_source','retained_missing','retained_extra'):
                selection=json.loads(value['SOURCE-SELECTION.json'])
                if mode=='selection_cwd':selection['sourceDirectory']='/tmp/other/composed/source'
                if mode=='tags':selection['buildTags']=[]
                if mode=='carrier':selection['carrierEnabled']=True
                if mode=='selection_descriptor':selection['moduleDescriptorSHA256']['go.mod']='f'*64
                if mode=='retained_source':selection['retainedProductionSHA256']['rpc/core/status.go']='f'*64
                if mode=='retained_missing':del selection['retainedProductionSHA256']['rpc/core/status.go']
                if mode=='retained_extra':selection['retainedProductionSHA256']['rpc/core/extra.go']='f'*64
                value['SOURCE-SELECTION.json']=encode(selection)
                receipt['sourceSelectionSHA256']=hashlib.sha256(value['SOURCE-SELECTION.json']).hexdigest()
            elif mode in ('native_cwd','native_pressure','native_descriptor','missing_descriptor','extra_descriptor','invalid_descriptor'):
                native=json.loads(value['SOURCE-NATIVE-DEPENDENCIES.json'])
                if mode=='native_cwd':native['buildSource']='/tmp/other/composed/source'
                if mode=='native_pressure':native['pressureAuthorized']=True
                if mode=='native_descriptor':native['moduleDescriptorSHA256']['go.mod']='f'*64
                if mode=='missing_descriptor':del native['moduleDescriptorSHA256']['go.sum']
                if mode=='extra_descriptor':native['moduleDescriptorSHA256']['other.mod']='f'*64
                if mode=='invalid_descriptor':native['moduleDescriptorSHA256']['go.mod']='z'*64
                value['SOURCE-NATIVE-DEPENDENCIES.json']=encode(native)
                receipt['nativeDependenciesSHA256']=hashlib.sha256(value['SOURCE-NATIVE-DEPENDENCIES.json']).hexdigest()
            elif mode=='both_descriptors':
                selection=json.loads(value['SOURCE-SELECTION.json']);native=json.loads(value['SOURCE-NATIVE-DEPENDENCIES.json'])
                selection['moduleDescriptorSHA256']['go.mod']=native['moduleDescriptorSHA256']['go.mod']='f'*64
                value['SOURCE-SELECTION.json']=encode(selection);value['SOURCE-NATIVE-DEPENDENCIES.json']=encode(native)
                receipt['sourceSelectionSHA256']=hashlib.sha256(value['SOURCE-SELECTION.json']).hexdigest()
                receipt['nativeDependenciesSHA256']=hashlib.sha256(value['SOURCE-NATIVE-DEPENDENCIES.json']).hexdigest()
            elif mode=='duplicate_descriptor':
                original=value['SOURCE-SELECTION.json'];needle=b'"moduleDescriptorSHA256": {'
                value['SOURCE-SELECTION.json']=original.replace(needle,needle+b'"go.mod": "'+b'f'*64+b'", ',1)
                self.assertNotEqual(value['SOURCE-SELECTION.json'],original)
                receipt['sourceSelectionSHA256']=hashlib.sha256(value['SOURCE-SELECTION.json']).hexdigest()
            elif mode=='missing_cwd':del receipt['buildCwd']
            elif mode=='noncanonical_cwd':receipt['buildCwd']='/tmp/CONTROL/../CONTROL/composed/source'
            elif mode=='declaration_authority':
                declaration=json.loads(value['SYNTHETIC-BUILD-IDENTITY.json']);declaration['sourceBinding']='self-attested'
                value['SYNTHETIC-BUILD-IDENTITY.json']=encode(declaration);receipt['binaryDeclaration']=declaration
            else:
                info=value['GO-BUILD-INFO.txt']
                if mode=='info_version':info=info.replace(b': go1.26.11\n',b': go1.26.11-fake\n')
                if mode=='info_path':info=info.replace(b'\tpath\tgithub.com/',b'\tpath\tother/github.com/')
                if mode=='info_arch':info=info.replace(b'\tbuild\tGOARCH=amd64',b'\tbuild\tGOARCH=arm64')
                if mode=='info_cgo':info=info.replace(b'\tbuild\tCGO_ENABLED=1',b'\tbuild\tCGO_ENABLED=0')
                if mode=='info_fake_linux':info=info.replace(b'\tbuild\tGOOS=linux',b'\tother\tGOOS=linux')
                if mode=='info_duplicate':info+=b'\tbuild\tGOOS=darwin\n'
                if mode=='info_vcs':info+=b'\tbuild\tvcs.revision=pretend\n'
                value['GO-BUILD-INFO.txt']=info;receipt['buildInfoSHA256']=hashlib.sha256(info).hexdigest()
            value['COMPOSITION-RECEIPT.json']=encode(receipt)
            b,j,i,z,_=build(binding['tools'],binding['run'],binding['job'],binding['artifact'],value)
            with self.subTest(mode=mode),self.assertRaises(RuntimeError):r.inspect(b,j,i,z,strict=strict)

if __name__=='__main__':unittest.main()
