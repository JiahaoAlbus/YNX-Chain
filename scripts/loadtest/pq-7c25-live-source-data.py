"""Exact current7c tagged normal getter source evidence; never a runtime grant.

The original source and CI-only route head are separate identities. Missing
actual tagged CI originals remain NOT_SUPPLIED; legacy9081 is not inherited.
"""
import hashlib,importlib.util,io,json,stat,zipfile
from pathlib import Path,PurePosixPath
SOURCE='7c25cbcc7d31b10743e26ae1ddca745085ee1b0b'
TREE='8a90d4ceb86a3a9460648e011bfed9f2e3ac1f4a'
PRODUCTION_FORK='5a128880d14bfc73de4334cba23218859ad3473c'
SUPPLIER='5a49f5c91452604dffb910df736702b3b9df2562'
SUPPLIER_FORK='08747364c24c065bf2b13527c210625d7ec95fba'
COMPOSED_TREE='3cae5a04f26e17cffcfb9c253ea9013231881725'
# Filled only from this exact new source/module's real tagged CI originals.
QUALIFICATION=None
EXPECTED=None
ARCHIVE_SHA256=None
ARCHIVE_BYTES=None
CI_ORIGINALS=None
FIXTURE=Path(__file__).with_name('fixtures')/'7c25-live-source-original.zip'

def require(ok,message):
    if not ok:raise RuntimeError(message)

def strict(raw):
    def pairs(items):
        out={}
        for key,value in items:
            require(key not in out,'duplicate original source field');out[key]=value
        return out
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda value:(_ for _ in ()).throw(RuntimeError('nonfinite original source JSON')))

def qualify_ci(run,job,q):
    """The CI-only head is distinct from the frozen tested Go source."""
    ci=q['sourceCI']
    require(run.get('id')==ci['run'] and run.get('run_attempt')==1
            and run.get('head_sha')==q['ciHead'] and run.get('event')=='push'
            and run.get('head_branch')==q['ciBranch']
            and run.get('path')=='.github/workflows/chain-core.yml'
            and run.get('repository',{}).get('full_name')=='JiahaoAlbus/YNX-Chain'
            and run.get('status')=='completed' and run.get('conclusion')=='success',
            'exact current tagged CI run must complete successfully')
    require(job.get('id')==ci['job'] and job.get('run_id')==ci['run']
            and job.get('head_sha')==q['ciHead'] and job.get('run_attempt')==1
            and job.get('name')=='Original client observations and cohort readback'
            and job.get('status')=='completed' and job.get('conclusion')=='success',
            'exact current tagged CI job must complete successfully')
    for name in ('Verify exact optional live getter composition without enabling a carrier',
                 'Bind actual tagged evidence to the unchanged 7c25 Go roots',
                 'Preserve exact 7c25 qualification with original tagged streams'):
        found=[step for step in job.get('steps',[]) if step.get('name')==name]
        require(len(found)==1 and found[0].get('status')=='completed' and found[0].get('conclusion')=='success',
                'exact tagged source qualification step incomplete: '+name)
    return True

def original_stream(raw,key,required):
    """Reuse original complete Go framing, including all started children."""
    spec=importlib.util.spec_from_file_location('current7c_original_frames',Path(__file__).with_name('pq-7c25-source-qualification.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    package={'normalProducer':'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet',
             'originalSupplierBudget':'github.com/cometbft/cometbft/mempool'}[key]
    summary=module.original_go_frames(raw,package,required)
    require(summary['topCases']==len(required),'extra original source test top scope')
    return summary

def qualification(raw=None):
    require(QUALIFICATION is not None and EXPECTED is not None and ARCHIVE_SHA256 is not None and ARCHIVE_BYTES is not None and CI_ORIGINALS is not None, 'current7c exact normal getter source/module/tagged CI NOT_SUPPLIED')
    metadata={}
    for kind in ('run','job'):
        ref=CI_ORIGINALS[kind]
        require(PurePosixPath(ref['name']).name==ref['name'],'original CI metadata filename required')
        payload=FIXTURE.with_name(ref['name']).read_bytes()
        require(len(payload)==ref['bytes'] and hashlib.sha256(payload).hexdigest()==ref['sha256'],
                'exact current tagged CI metadata pin differs')
        metadata[kind]=strict(payload)
    qualify_ci(metadata['run'],metadata['job'],QUALIFICATION)
    raw=FIXTURE.read_bytes() if raw is None else raw
    require(type(raw) is bytes and len(raw)==ARCHIVE_BYTES and hashlib.sha256(raw).hexdigest()==ARCHIVE_SHA256,'original source-CI archive pin differs')
    files={}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(len(archive.infolist())==8,'exact original public source files required')
        for entry in archive.infolist():
            name=PurePosixPath(entry.filename)
            require(not name.is_absolute() and '..' not in name.parts and not entry.is_dir() and not stat.S_ISLNK(entry.external_attr>>16) and entry.file_size<=1<<20 and str(name) not in files,'bounded unique original source file required')
            files[str(name)]=archive.read(entry)  # Original ZIP CRC is checked.
    names=[name for name in files if name.endswith('/SOURCE.json')]
    require(len(names)==1,'one original source record required');name=names[0];prefix=name[:-len('SOURCE.json')]
    record=strict(files[name]);q=QUALIFICATION
    require((q['commit'],q['tree'],q['forkTree'],q['optionalForkCommit'],q['optionalForkTree'])==(SOURCE,TREE,PRODUCTION_FORK,SUPPLIER,SUPPLIER_FORK), 'current7c live source graph differs')
    require(hashlib.sha256(files[name]).hexdigest()==q['ciEvidenceSHA256'],'original source record pin differs')
    require(record['sourceCommit']==q['commit'] and record['sourceTree']==q['tree'] and record['productionForkTree']==q['forkTree'] and record['optionalForkCommit']==q['optionalForkCommit'] and record['optionalForkTree']==q['optionalForkTree'] and record['buildTags']==[q['buildTag']],'original source graph differs')
    require(record['sourceOnly'] is True and record['actualKernelAndPrivateControlTests'] is True and record['actualPreStartNodeGetter'] is True and record['nodeProcessesStarted']==0 and all(record[k] is False for k in ('actualRunningWindow','carrierEnabled','productionForkModified','publicActivation','physicalBytesMeasured')),'source tests cannot become runtime or pressure evidence')
    def pinned(name,ref):
        payload=files[prefix+name]
        require(len(payload)==ref['bytes'] and hashlib.sha256(payload).hexdigest()==ref['sha256'] and PurePosixPath(ref['path']).name==PurePosixPath(name).name,'original source file pin differs')
        return payload
    for key,stem in (('normalProducer','normal-live-caller'),('originalSupplierBudget','original-peer-budget')):
        original=record[key];events=pinned(stem+'.jsonl',original);pinned(stem+'.stderr.log',original['stderr'])
        result=strict(pinned(stem+'.result.json',original['result']))
        require(result['version']=='YNX-WIRE-LIVE-GO-RESULT/v1' and result['returnCode']==0 and result['timedOut'] is False and result['validationPassed'] is True and result['firstFailure'] is None,'original source test command did not pass')
        require(original['requiredPassed']==result['requiredPassed']==list(EXPECTED[key]),'original named case set differs')
        require(result['stdout']=={k:original[k] for k in ('path','bytes','sha256')} and result['stderr']==original['stderr'],'original result log binding differs')
        original_stream(events,key,EXPECTED[key])
    selection=record['preparedSourceSelection'];payload=files[prefix+'composition/SOURCE-SELECTION.json']
    require(len(payload)==selection['receiptBytes'] and hashlib.sha256(payload).hexdigest()==selection['receiptSHA256'] and strict(payload)==selection['sourceSelection'],'original Core preparation receipt differs')
    return dict(q)
