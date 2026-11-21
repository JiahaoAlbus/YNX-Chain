"""Read selected d24 own-CI public originals, never an execution permission.

Each raw Go stream stays separate, including distinct production and optional
fork identities. Package and nested failures/skips cannot become named passes.
"""
import hashlib
import argparse
import importlib.util
import json
import re
from pathlib import Path

spec=importlib.util.spec_from_file_location('d24_source_archive',Path(__file__).with_name('pq-initialization-readback.py'))
archive=importlib.util.module_from_spec(spec);spec.loader.exec_module(archive)
require,strict=archive.require,archive.strict
SOURCE='d24ad7e422583906d9823789b049ef2251a09e2c'
TREE='a28f61f83be9a6e11d0121ea0f40f9bdd3de3b59'
PRODUCTION='5a128880d14bfc73de4334cba23218859ad3473c'
OPTIONAL_COMMIT='5a49f5c91452604dffb910df736702b3b9df2562'
OPTIONAL_TREE='08747364c24c065bf2b13527c210625d7ec95fba'
STARTUP_CASES=(
    'TestPQLabStartupMeasuredRegistrationActivationPreserveFreshState',
    'TestPQLabStartupHeldInputsRejectReplacementAndWrongPin',
    'TestPQLabStartupTimingNormalRegistrationAndUnknown',
    'TestPQLabStartupTimingFlagsAndMissingSourcesFailClosed',
    'TestOperatorStartupTimingDefaultAndOriginalError',
    'TestOperatorStartupTimingActualColdConstructorWithoutStart',
)
SELECTED={
    13569501647:(5709,'4a6294d636f5f7da20da79c5777a147feff998e8d26fdd686679a4392c8c349e'),
    13569173444:(12341,'28baad460ea06a5f159de4fee3487e2a85e281eb335aba0726341a93d67a777e'),
    13568854112:(4962,'8f100165f144b4cc6ed69693c75bd7c9659f72b937237baceaff16bb0e6662d5'),
    13568784007:(1454,'6fcabdf62ef3c31c538ca73c79227dbd142d2d1d308d8b23d688060484b256de'),
    13568519289:(13359,'a2835443d37f4e009e54fd1c94f436827e83b011b34a7ae9094fffc7b040a743'),
}
METADATA_PINS={
    'CHAIN-RUN.json':(12409,'c50660ec4c056f66c914547c613bf74d62549e7283fe0310eae941fc2747d758'),
    'RESOURCE-RUN.json':(12438,'73662a0685662c54af155e4fc9744b1be67b93813803d704dc6aaa0e81d694e1'),
    'CHAIN-JOBS.json':(21155,'26b2d233e8c1b083dcc813f500599d692150c982f40a65fa08b2db78adee48ec'),
    'RESOURCE-JOBS.json':(70827,'aa1196b8196abef04af08f646b8479a80723eadf50ea56bb4e1a40bf0bc75438'),
    'CLIENT128365907200.log':(91291,'44b12ca914f9d8c493e2053e17dddfacf981038853cb4cc2d75c9daa68b3650c'),
}


def sha(raw):return hashlib.sha256(raw).hexdigest()


def startup_collectors(raw):
    """Consume original workflow assertions, never call these raw Go JSONL."""
    receipts=[];cases=[]
    for marker in ('YNX_PQ_LAB_CALLEES_EXECUTED','YNX_ORIGINAL_WIRE_OBSERVATION_CALLEES_EXECUTED'):
        matches=[]
        for line in raw.decode().splitlines():
            found=re.fullmatch(r'\d{4}-\d\d-\d\dT[^ ]+Z '+marker+r' (\{.*\})',line)
            if found:matches.append(strict(found.group(1)))
        require(len(matches)==1,'unique actual original collector required')
        receipt=matches[0]
        require(receipt['commit']==SOURCE and receipt['nodeProcessesStarted']==0,'startup collector source/scope differs')
        require(type(receipt['requiredPassed']) is list and len(set(receipt['requiredPassed']))==len(receipt['requiredPassed']),'distinct original collector assertions required')
        cases+=receipt['requiredPassed'];receipts.append(dict(marker=marker,receipt=receipt))
    require(all(cases.count(name)==1 for name in STARTUP_CASES),'six startup assertions required exactly once')
    return dict(originalLogBytes=len(raw),originalLogSHA256=sha(raw),receipts=receipts,requiredPassed=list(STARTUP_CASES),startupCollectorCases=6,startupRawJSONLCasesReRead=0,rawGoReexecuted=False)


def named_stream(raw,expected,packages):
    require(type(expected) is list and expected and len(set(expected))==len(expected),'distinct declared original cases required')
    rows=[strict(line) for line in raw.splitlines()]
    require(rows and not any(r.get('Action') in ('fail','skip') for r in rows),'original failed/skipped stream cannot qualify')
    require(set(r.get('Package') for r in rows)==set(packages),'original package set differs')
    for name in expected:
        runs=[r for r in rows if r.get('Test')==name and r.get('Action')=='run']
        ends=[r for r in rows if r.get('Test')==name and r.get('Action') in ('pass','fail','skip')]
        require(len(runs)==len(ends)==1 and ends[0]['Action']=='pass' and runs[0]['Package']==ends[0]['Package'],'unique original named run/pass required')
        require(rows.index(runs[0])<rows.index(ends[0]),'original run/pass order differs')
    for package in packages:
        require([r['Action'] for r in rows if r.get('Package')==package and not r.get('Test') and r.get('Action') in ('pass','fail','skip')]==['pass'],'one complete original package pass required')
    return dict(namedCases=len(expected),requiredPassed=expected,packages=packages,bytes=len(raw),sha256=sha(raw),nestedFailureOrSkip=False)


def read(directory):
    files={};manifests={}
    for identifier,(size,pin) in SELECTED.items():
        path=Path(directory)/(str(identifier)+'.zip')
        require(not path.is_symlink(),'original selected ZIP may not redirect')
        with path.open('rb') as stream:raw=stream.read(size+1)
        require(len(raw)==size and sha(raw)==pin,'selected own-d24 artifact pin differs')
        original,manifest,_=archive.public_archive(raw,pin)
        files[identifier]=original;manifests[identifier]=manifest
    return files,manifests


def inspect(files):
    flows=[];sources=[]
    def by_name(members,name):
        matches=[raw for path,raw in members.items() if Path(path).name==name]
        require(len(matches)==1,'one complete original file required: '+name)
        return matches[0]
    def pinned(members,ref):
        raw=by_name(members,Path(ref['path']).name)
        require(len(raw)==ref['bytes'] and sha(raw)==ref['sha256'],'original file/result pin differs')
        return raw
    def wire_flow(identifier,members,stem,packages):
        result=strict(by_name(members,stem+'.result.json'))
        require(result['version']=='YNX-WIRE-LIVE-GO-RESULT/v1' and type(result['returnCode']) is int and result['returnCode']==0 and result['timedOut'] is False and result['validationPassed'] is True and result['firstFailure'] is None,'original command outcome differs')
        raw=pinned(members,result['stdout']);pinned(members,result['stderr'])
        flows.append(dict(artifact=identifier,file=stem+'.jsonl',**named_stream(raw,result['requiredPassed'],packages)))
        return result
    cmd='github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'
    for identifier in (13569173444,13568519289):
        members=files[identifier];source=strict(by_name(members,'SOURCE.json'))
        require((source['sourceCommit'],source['sourceTree'],source['productionForkTree'],source['optionalForkCommit'],source['optionalForkTree'])==(SOURCE,TREE,PRODUCTION,OPTIONAL_COMMIT,OPTIONAL_TREE),'exact production/optional source tuple differs')
        require(source['sourceOnly'] is True and source['nodeProcessesStarted']==0 and source['actualRunningWindow'] is False and source['carrierEnabled'] is False,'original source-only scope differs')
        require(source['buildTags']==(['ynx_live_wire_observation'] if identifier==13569173444 else ['ynx_live_wire_observation','ynx_lossless_hex']),'exact original build tags differ')
        selection=source['preparedSourceSelection'];body=by_name(members,'SOURCE-SELECTION.json')
        require(len(body)==selection['receiptBytes'] and sha(body)==selection['receiptSHA256'] and strict(body)==selection['sourceSelection'],'original prepared source selection copy differs')
        selected=strict(body)
        require(selected['originalSourceCommit']==SOURCE and selected['originalSourceTree']==TREE and selected['originalProductionForkTree']==PRODUCTION and selected['selectedOptionalForkCommit']==OPTIONAL_COMMIT and selected['selectedOptionalForkTree']==OPTIONAL_TREE,'composed source identities differ')
        require(all(selected[k] is False for k in ('fakeVCSIdentity','originalCheckoutWritten','originalModuleDescriptorsChanged','nodeStarted','carrierEnabled','publicActivation')),'source selection scope expanded')
        for key in ('normalProducer','originalSupplierBudget'):
            ref=source[key];stem=Path(ref['path']).stem
            result=wire_flow(identifier,members,stem,[cmd] if key=='normalProducer' else ['github.com/cometbft/cometbft/mempool'])
            require(result['requiredPassed']==ref['requiredPassed'] and pinned(members,ref)==pinned(members,result['stdout']),'producer/declared flow differs')
            pinned(members,ref['result']);pinned(members,ref['stderr'])
        if identifier==13568519289:
            wire_flow(identifier,members,'retained-observer',['github.com/cometbft/cometbft/node','github.com/cometbft/cometbft/rpc/core'])
        sources.append(source)
    wire_flow(13568784007,files[13568784007],'normal-lossless-default-caller',[cmd])
    members=files[13569501647];distributed=strict(by_name(members,'distributed-pq-source-result.json'))
    require(distributed['commit']==SOURCE and distributed['authorityGranted'] is False and distributed['nodeProcessesStarted']==0 and distributed['physicalHostsExecuted'] is False and distributed['publicActivation'] is False,'original distributed source scope differs')
    for ref in distributed['evidence']:
        raw=by_name(members,ref['name']);require(len(raw)==int(ref['bytes']) and sha(raw)==ref['sha256'],'original distributed evidence pin differs')
    covered=[]
    for stem,package in [('distributed-pq-core','github.com/JiahaoAlbus/YNX-Chain/internal/consensus'),('distributed-pq-command','github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-pq-lab')]:
        raw=by_name(members,stem+'.jsonl');rows=[strict(line) for line in raw.splitlines()]
        names=[name for name in distributed['requiredPassed'] if any(r.get('Test')==name for r in rows)]
        covered.extend(names)
        flows.append(dict(artifact=13569501647,file=stem+'.jsonl',**named_stream(raw,names,[package])))
    require(set(covered)==set(distributed['requiredPassed']) and len(covered)==len(distributed['requiredPassed']),'complete distinct distributed case denominator required')
    members=files[13568854112];source=strict(by_name(members,'commit-consumer-source.json'));result=strict(by_name(members,'commit-consumer-result.json'));raw=by_name(members,'commit-consumer-tests.jsonl')
    require(source['actualCalleeSHA']==result['actualCalleeSHA']==SOURCE and source['actualCalleeTree']==result['actualCalleeTree']==TREE and result['runId']=='42359895403' and result['runAttempt']=='1' and result['skipped']==0,'own original Commit source/job differs')
    require(len(raw)==result['testJSONBytes'] and sha(raw)==result['testJSONSHA256'],'Commit raw stream pin differs')
    require(all(result[k] is False for k in ('actualFourNodeWindow','dualPQ500CrossSourceEquality','normalRuntimeBuilt','authorityGranted','publicActivation')),'Commit source-only scope differs')
    flows.append(dict(artifact=13568854112,file='commit-consumer-tests.jsonl',**named_stream(raw,result['requiredPassed'],[cmd])))
    return dict(schema='YNX-PERF-D24-OWN-SOURCE-RAW-STREAMS/v1',source=SOURCE,tree=TREE,productionForkTree=PRODUCTION,optionalForkCommit=OPTIONAL_COMMIT,optionalForkTree=OPTIONAL_TREE,flows=flows,composedSelections=sources,rawFlowsRead=len(flows),sourceOnlyQualified=False,startupOriginalCollectorRead=False,eightRuntimeGovulncheckConsumed=False,semanticPairConsumed=False,runtimePermissionGranted=False,nodeStarted=False,businessTPS=None,finalityLatency=None)


def ci_jobs(chain, resource, chain_jobs, resource_jobs):
    require(chain['id']==42359895403 and resource['id']==42359895427 and chain['head_sha']==resource['head_sha']==SOURCE,'own original CI identity differs')
    require(chain['status']=='completed' and chain['conclusion']=='success','own Chain CI not completed successfully')
    jobs={j['id']:j for j in chain_jobs['jobs']+resource_jobs['jobs']}
    required=(128365867070,128365866560,128365907200,128365907202,128365907209,128365907249)
    for identifier in required:
        j=jobs[identifier]
        require(j['head_sha']==SOURCE and j['run_id']==(42359895427 if identifier==128365867070 else 42359895403) and j['status']=='completed' and j['conclusion']=='success','actual own-source required job not successful')
    matches=[s for s in jobs[128365867070]['steps'] if s['name']=='Check reachable vulnerabilities in the eight production runtime commands']
    require(len(matches)==1 and matches[0]['status']=='completed' and matches[0]['conclusion']=='success','original eight runtime step not successful')
    return dict(requiredJobs=list(required),eightRuntimeGovulncheckConsumed=True,govulncheckEvidence='original job step outcome; raw scanner output not re-read',wholeResourceCIQualified=False)


def qualification(directory=None):
    directory=Path(directory) if directory is not None else Path(__file__).with_name('fixtures')/'d24-source'
    for name,(size,pin) in METADATA_PINS.items():
        path=directory/name
        require(not path.is_symlink(),'original metadata may not redirect')
        with path.open('rb') as stream:raw=stream.read(size+1)
        require(len(raw)==size and sha(raw)==pin,'selected original metadata size/SHA differs')
    files,manifests=read(directory);report=inspect(files)
    report['archives']=manifests
    report['startup']=startup_collectors((directory/'CLIENT128365907200.log').read_bytes())
    metadata=[strict((directory/name).read_bytes()) for name in ('CHAIN-RUN.json','RESOURCE-RUN.json','CHAIN-JOBS.json','RESOURCE-JOBS.json')]
    report['normalCI']=ci_jobs(*metadata)
    report.update(sourceOnlyQualified=True,sourceTree=TREE,startupOriginalCollectorRead=True,eightRuntimeGovulncheckConsumed=True,actual500InitializedOwnersQualified=False,pressureAuthorized=False)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args()
    report=qualification(args.directory)
    with Path(args.output).open('x') as out:
        json.dump(report,out,indent=2,sort_keys=True);out.write('\n')
