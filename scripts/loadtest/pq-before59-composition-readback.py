"""Bound same-run source-only build evidence; never authorize a running node."""
import hashlib
import importlib.util
from pathlib import Path,PurePosixPath
import re

SOURCE='de54c52b669ad56ebc702a484e2eaca51d0efc2e'
TREE='d22b51801073930a4715dcea20b0320259d27fb4'
FORK='5a128880d14bfc73de4334cba23218859ad3473c'
JOB='Before59 original Linux source composition and build'
STEPS=('Execute exact source-only original composition and normal build',
       'Retain only the original before59 source-build evidence')
MEMBERS=('SOURCE-SELECTION.json','SOURCE-NATIVE-DEPENDENCIES.json','GO-BUILD-INFO.txt',
         'SYNTHETIC-BUILD-IDENTITY.json','COMPOSITION-RECEIPT.json')
spec=importlib.util.spec_from_file_location('original_before59_archive',Path(__file__).with_name('pq-source-evidence-archive.py'))
archive=importlib.util.module_from_spec(spec);spec.loader.exec_module(archive)
spec=importlib.util.spec_from_file_location('original_before59_native',Path(__file__).with_name('pq-7c25-native-source-dependencies.py'))
native_source=importlib.util.module_from_spec(spec);spec.loader.exec_module(native_source)
SUPPLIER='5a49f5c91452604dffb910df736702b3b9df2562'
SUPPLIER_TREE='08747364c24c065bf2b13527c210625d7ec95fba'
COMPOSER='e35ff39c10090e9200bdabf7b265c1fd211fd2ae4d227ffaae52054c6dbc2fac'

def require(ok,message):
    if not ok:raise RuntimeError(message)

def validate_build_info(raw,binary_path,go_env):
    require(type(raw) is bytes and type(binary_path) is str and type(go_env) is dict,
            'original build-info bytes and environment required')
    try:lines=raw.decode('utf-8','strict').splitlines()
    except UnicodeDecodeError as error:raise RuntimeError('original build-info is not UTF-8') from error
    require(lines and lines[0]==binary_path+': '+go_env['GOVERSION'],
            'original build-info binary path or Go version differs')
    paths=[line for line in lines if line.startswith('\tpath\t')]
    require(paths==['\tpath\tgithub.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'],
            'original build-info package path differs')
    settings={}
    for line in lines:
        if not line.startswith('\tbuild\t'):continue
        body=line[len('\tbuild\t'):]
        require('=' in body,'original build-info setting malformed')
        key,value=body.split('=',1)
        require(key and key not in settings,'original build-info setting duplicate')
        settings[key]=value
    for key,value in (('-tags','ynx_live_wire_observation'),('-trimpath','true'),
                      ('CGO_ENABLED',go_env['CGO_ENABLED']),('GOOS',go_env['GOOS']),('GOARCH',go_env['GOARCH'])):
        require(settings.get(key)==value,'original build-info setting differs: '+key)
    require(not any(key.startswith('vcs') for key in settings),'original build-info contains unexpected VCS identity')

def validate_binding(binding):
    fields={'source','tools','run','job','artifact','archiveSHA256','members','path'}
    require(type(binding) is dict and set(binding)==fields and binding['source']==SOURCE
        and type(binding['tools']) is str and re.fullmatch('[0-9a-f]{40}',binding['tools'])
        and all(type(binding[k]) is int and binding[k]>0 for k in ('run','job','artifact'))
        and type(binding['archiveSHA256']) is str and re.fullmatch('[0-9a-f]{64}',binding['archiveSHA256'])
        and type(binding['members']) is dict and set(binding['members'])==set(MEMBERS)
        and all(type(value) is str and re.fullmatch('[0-9a-f]{64}',value) for value in binding['members'].values())
        and type(binding['path']) is str and Path(binding['path']).is_absolute() and '..' not in Path(binding['path']).parts,
        'frozen original before59 source-build identity required')

def validate_metadata(binding,job,inventory):
    validate_binding(binding)
    require(type(job) is dict and type(job.get('id')) is int and job['id']==binding['job']
        and type(job.get('run_id')) is int and job['run_id']==binding['run']
        and type(job.get('run_attempt')) is int and job['run_attempt']==1 and job.get('head_sha')==binding['tools']
        and job.get('run_url')=='https://api.github.com/repos/JiahaoAlbus/YNX-Chain/actions/runs/%d'%binding['run']
        and job.get('name')==JOB and job.get('status')=='completed' and job.get('conclusion')=='success'
        and type(job.get('steps')) is list,'original before59 source-build job differs')
    for name in STEPS:
        steps=[v for v in job['steps'] if type(v) is dict and v.get('name')==name]
        require(len(steps)==1 and steps[0].get('status')=='completed' and steps[0].get('conclusion')=='success',
                'original before59 source-build step incomplete')
    require(type(inventory) is dict and type(inventory.get('total_count')) is int
        and type(inventory.get('artifacts')) is list and inventory['total_count']==len(inventory['artifacts'])<=100,
        'complete original Tools artifact inventory required')
    matches=[v for v in inventory['artifacts'] if type(v) is dict and type(v.get('id')) is int and v['id']==binding['artifact']]
    name='before59-source-build-%s-%d-1'%(binding['tools'],binding['run'])
    require(len(matches)==1 and sum(v.get('name')==name for v in inventory['artifacts'] if type(v) is dict)==1,
            'unique original same-run before59 source-build artifact required')
    artifact=matches[0];run=artifact.get('workflow_run')
    require(artifact.get('name')==name and artifact.get('expired') is False
        and artifact.get('digest')=='sha256:'+binding['archiveSHA256']
        and type(run) is dict and type(run.get('id')) is int and run['id']==binding['run'] and run.get('head_sha')==binding['tools'],
        'original before59 source-build artifact identity differs')

def inspect(binding,job,inventory,raw,*,strict):
    validate_metadata(binding,job,inventory)
    members=archive.read_original_archive(raw,expected_sha256=binding['archiveSHA256'],
        expected_members=binding['members'],member_limit=1<<20,total_limit=4<<20)
    receipt=strict(members['COMPOSITION-RECEIPT.json']);selection=strict(members['SOURCE-SELECTION.json'])
    native=strict(members['SOURCE-NATIVE-DEPENDENCIES.json']);declaration=strict(members['SYNTHETIC-BUILD-IDENTITY.json'])
    tools_run=receipt.get('originalToolsRun') if type(receipt) is dict else None
    require(type(receipt) is dict and receipt.get('schema')=='YNX-BEFORE59-ORIGINAL-COMPOSITION-CI/v1'
        and (receipt.get('source'),receipt.get('tree'),receipt.get('fork'))==(SOURCE,TREE,FORK)
        and receipt.get('platform')=='linux' and receipt.get('goVersion')=='go1.26.11'
        and receipt.get('goEnv')==dict(GOVERSION='go1.26.11',GOOS='linux',GOARCH='amd64',CGO_ENABLED='1')
        and receipt.get('sourceOnly') is True and receipt.get('sourceCIQualified') is False
        and receipt.get('runtimeAuthorized') is False and receipt.get('pressureAuthorized') is False
        and receipt.get('nodeStarted') is False and receipt.get('nativeDependencyFiles')==11
        and (receipt.get('supplier'),receipt.get('supplierTree'),receipt.get('composerSHA256'))==(SUPPLIER,SUPPLIER_TREE,COMPOSER)
        and type(tools_run) is dict and type(tools_run.get('run')) is int and type(tools_run.get('attempt')) is int
        and tools_run==dict(toolSource=binding['tools'],run=binding['run'],attempt=1,job='before59-original-composition')
        and receipt.get('binaryDeclaration')==declaration,
        'original source-only before59 composition receipt differs')
    digest=lambda name:hashlib.sha256(members[name]).hexdigest()
    require(receipt.get('sourceSelectionSHA256')==digest('SOURCE-SELECTION.json')
        and receipt.get('nativeDependenciesSHA256')==digest('SOURCE-NATIVE-DEPENDENCIES.json')
        and receipt.get('buildInfoSHA256')==digest('GO-BUILD-INFO.txt'),
        'original before59 source-build receipt bytes differ')
    require(type(selection) is dict and (selection.get('originalSourceCommit'),selection.get('originalSourceTree'),
        selection.get('originalProductionForkTree'))==(SOURCE,TREE,FORK)
        and selection.get('sourceOnly') is True and selection.get('nodeStarted') is False
        and selection.get('buildTags')==['ynx_live_wire_observation'] and selection.get('carrierEnabled') is False
        and (selection.get('selectedOptionalForkCommit'),selection.get('selectedOptionalForkTree'))==(SUPPLIER,SUPPLIER_TREE)
        and selection.get('fakeVCSIdentity') is False and selection.get('originalCheckoutWritten') is False
        and selection.get('originalModuleDescriptorsChanged') is False and selection.get('publicActivation') is False
        and type(native) is dict and native.get('source')==SOURCE and native.get('sourceTree')==TREE
        and native.get('fileCount')==11 and type(native.get('files')) is list and len(native['files'])==11
        and native.get('sourceOnly') is True and native.get('nodeStarted') is False
        and native.get('authorityGranted') is False and native.get('pressureAuthorized') is False
        and native.get('sourceBytesChanged') is False,
        'original before59 source selection or native closure differs')
    cwd=receipt.get('buildCwd')
    require(type(cwd) is str and PurePosixPath(cwd).is_absolute() and not cwd.startswith('//') and PurePosixPath(cwd).as_posix()==cwd
        and '..' not in PurePosixPath(cwd).parts and cwd.endswith('/composed/source')
        and selection.get('sourceDirectory')==cwd and native.get('buildSource')==cwd,
        'original composed source build directory differs')
    wanted=native_source.FILES
    require(all(type(item) is dict and type(item.get('path')) is str for item in native['files'])
        and {item['path'] for item in native['files']}==set(wanted),
        'original eleven native dependency paths differ')
    for item in native['files']:
        expected=wanted[item['path']]
        require(all(item.get(k)==expected[k] for k in ('mode','gitBlob','bytes','sha256','includes')),
                'original native source blob differs')
    binary=receipt.get('binary');argv=receipt.get('buildArgv')
    require(type(binary) is dict and set(binary)=={'bytes','sha256'} and type(binary['bytes']) is int and binary['bytes']>0
        and type(binary['sha256']) is str and re.fullmatch('[0-9a-f]{64}',binary['sha256'])
        and type(argv) is list and len(argv)==14 and all(type(x) is str for x in argv)
        and argv[1:9]==['build','-mod=readonly','-p','1','-trimpath','-buildvcs=false','-ldflags','-X main.operatorCommitBuildSource='+SOURCE]
        and argv[9:11]==['-tags','ynx_live_wire_observation'] and argv[11]=='-o' and argv[-1]=='./cmd/ynx-comet'
        and argv[12]==str(PurePosixPath(cwd).parent.parent/'ynx-comet')
        and type(declaration) is dict and declaration.get('version')=='YNX-COMET-COMMIT-CLOCK-BUILD/v1'
        and declaration.get('sourceBinding')=='linker-declared-requires-original-manifest-build-binary-and-process-proof'
        and declaration.get('sourceRevision')==SOURCE and declaration.get('status')=='DECLARED'
        and declaration.get('syntheticOnly') is True and declaration.get('nodeStarted') is False
        and declaration.get('runtimeAuthorized') is False,
        'original before59 normal build flags or binary declaration differs')
    validate_build_info(members['GO-BUILD-INFO.txt'],argv[12],receipt['goEnv'])
    return dict(source=SOURCE,tools=binding['tools'],run=binding['run'],job=binding['job'],artifact=binding['artifact'],
        archiveSHA256=binding['archiveSHA256'],sourceOnlyEvidence=True,runtimePermissionGranted=False,
        binaryProcessIndependentlyVerified=False,independentFinality=False)
