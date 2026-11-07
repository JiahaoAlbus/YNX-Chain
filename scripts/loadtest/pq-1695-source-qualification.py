"""Fixed1695 source CI originals. No runtime, package intake or activation grant."""
import collections
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import zipfile


spec=importlib.util.spec_from_file_location('own1695_original_io',Path(__file__).with_name('pq-initialization-readback.py'))
original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
require,strict=original.require,original.strict
SOURCE='1695aafd351b3cac7860d3452c555a02498e8350'
TREE='9a172a0a4b07aecc6365bbd05b58726f1214806c'
FORK='5a128880d14bfc73de4334cba23218859ad3473c'
H_SHA='43e407cef326575939b39109b4b0deeb48f3d8ce89e07163bef1ab6b5f2c4659'
ZIP_SHA='c6db205db0509fbdc89fb92e1311a9416fca0d19205e082a402478b5c9542d92'
REQUIRED_JOBS=(128435511057,128435510812,128435557569,128435557580,128435557638,128435557652,128435510924,128435510959,128442300495)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def qualification(directory=None):
    directory=Path(directory) if directory is not None else Path(__file__).with_name('fixtures')/'1695-source'
    def read(name,size,pin):
        require(Path(name).name==name and type(size) is int and 0<size<=4<<20,'bounded original leaf required')
        path=directory/name;require(not path.is_symlink(),'source original may not redirect')
        with path.open('rb') as stream:raw=stream.read(size+1)
        require(len(raw)==size and sha(raw)==pin,'fixed1695 original bytes differ: '+name);return raw
    h=strict(read('HANDOFF.json',48403,H_SHA))
    require(h['version']=='YNX-1695-NORMAL-CI-ORIGINAL-READBACK/v1'
            and (h['source']['head'],h['source']['tree'],h['source']['fork'])==(SOURCE,TREE,FORK),
            'fixed1695 source tuple differs')
    require({r['id'] for r in h['runs']}=={42383371915,42383371982}
            and all(r['status']=='completed' and r['conclusion']=='success' and r['attempt']==1 for r in h['runs']),
            'actual own-source CI completion required')
    def ref(r):return read(Path(r['path']).name,r['bytes'],r['sha256'])
    jobs={}
    for group in h['jobMetadata']:
        snapshot=strict(ref(group['evidence']))
        for j in snapshot['jobs']:
            require(j['head_sha']==SOURCE and j['run_id']==group['runId'],'original CI job source/run differs')
            require(j['id'] not in jobs,'duplicate original CI job');jobs[j['id']]=j
    for identifier in REQUIRED_JOBS:
        require(jobs[identifier]['status']=='completed' and jobs[identifier]['conclusion']=='success',
                'required own-source original job did not pass')
    artifact=h['originalPublicArtifact']
    require(artifact['artifactId']==13578159436 and artifact['archive']['bytes']==169508
            and artifact['archive']['sha256']==ZIP_SHA,'original focused artifact identity differs')
    raw=ref(artifact['archive']);files={}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        require(len(z.infolist())==5 and sum(v.file_size for v in z.infolist())<=4<<20,'original focused ZIP inventory differs')
        for entry in z.infolist():
            require(Path(entry.filename).name==entry.filename and entry.filename not in files
                    and not entry.is_dir() and (entry.external_attr>>16)&0o170000!=0o120000,
                    'unsafe original focused ZIP entry')
            files[entry.filename]=z.read(entry) # Verifies CRC; no partial merge.
    source=strict(files['SOURCE.json'])
    require(source['commit']==SOURCE and source['sourceTree']==TREE and source['cometForkTree']==FORK
            and source['captureComplete'] is True and source['errors']==[]
            and source['runId']=='42383371982' and source['runAttempt']=='1'
            and all(source[k] is False for k in ('nativeGrant','nodeStartAuthorized','publicDeployment')),
            'original focused source/scope differs')
    counts=collections.Counter();packages=collections.defaultdict(set);flows=[];all_skips=[]
    for item in source['files']:
        body=files[item['path']]
        require(len(body)==item['bytes'] and sha(body)==item['sha256'],'original focused JSONL pin differs')
        rows=[strict(line) for line in body.splitlines()];active=None;blocks=0;skips=[]
        for event in rows:
            action=event.get('Action');package=event.get('Package');name=event.get('Test')
            require(action!='fail','original Go failure cannot qualify')
            if action=='start':
                require(active is None,'overlapping original Go package frames');active=package;blocks+=1
            require(active==package and type(package) is str,'unframed original Go event')
            if name:
                packages[name].add(package);counts[item['path'],package,name,action]+=1
                if action=='skip':skips.append(name)
            elif action in ('pass','skip'):
                require(action=='pass','original package skipped');active=None
        require(active is None,'truncated original Go package stream')
        expected=5 if item['path']=='ynx-initial-cache-state-tests.jsonl' else 1
        require(blocks==expected,'complete original package frame count differs')
        if item['path']=='ynx-initial-cache-state-tests.jsonl':
            require(sorted(skips)==h['qualification']['fiveStateGroups']['optInSkipped'] and len(skips)==10,
                    'original explicit opt-in skips changed')
        else:require(not skips,'unexpected skip in required source flow')
        all_skips+=skips;flows.append(dict(file=item['path'],bytes=len(body),sha256=sha(body),packageInvocations=blocks,originalSkipped=skips))
    require(len(flows)==4 and set(files)=={'SOURCE.json',*(r['path'] for r in source['files'])},'four original source streams required')
    required=set();collector_count=0
    collector_stream={0:'ynx-lab-callee-tests.jsonl',1:'ynx-native-history-chain-tests.jsonl',
                      2:'ynx-initial-cache-state-tests.jsonl',3:'ynx-initial-cache-state-tests.jsonl',
                      4:'ynx-initial-cache-state-tests.jsonl',5:'ynx-current4-wire-tests.jsonl'}
    for item in h['originalCollectors']['programs']:
        require(item['exitCode']==0,'original source collector failed')
        stream=collector_stream[item['index']]
        output=ref(item['stdout']).decode();collector_count+=1
        for line in output.splitlines():
            marker,separator,body=line.partition(' ')
            require(separator and marker.startswith('YNX_'),'original collector output framing differs')
            receipt=strict(body)
            require(receipt['sourceCommit']==SOURCE,'original collector source differs')
            if marker=='YNX_PQ_OBSERVER_CORE_TESTS':
                require(set(receipt)=={'sourceCommit','requiredPassed','nativeGrant','nodeStarted','independentFinalityVerified','liveSyncVerified'}
                        and all(receipt[k] is False for k in ('nativeGrant','nodeStarted','independentFinalityVerified','liveSyncVerified')),
                        'original observer collector closed scope differs')
            else:require(receipt.get('suitePassed') is True,'original collector did not report its required pass')
            for value in receipt.get('requiredPassed',[]):
                if type(value) is list:package,name=value
                else:
                    name=value;require(len(packages[name])==1,'ambiguous original named case');package=next(iter(packages[name]))
                require(counts[stream,package,name,'run']==counts[stream,package,name,'pass']==1,
                        'unique required original stream/run/pass missing')
                required.add((package,name))
    require(collector_count==6,'six original collectors required')
    return dict(schema='YNX-PERF-1695-OWN-SOURCE-QUALIFICATION/v1',source=SOURCE,sourceTree=TREE,
                productionForkTree=FORK,sourceH_SHA256=H_SHA,sourceOnlyQualified=True,flows=flows,
                requiredNamedCases=len(required),originalCollectorsRead=collector_count,originalOptInSkips=sorted(all_skips),
                originalJobConclusions={str(k):v['conclusion'] for k,v in jobs.items()},
                skippedJobs=[v['name'] for v in jobs.values() if v['conclusion']=='skipped'],
                runtimeOrExporterBytesIntaken=False,actual500InitializedOwnersQualified=False,semanticPairConsumed=False,
                runtimePermissionGranted=False,pressureAuthorized=False,sourceParentAuthorityGranted=False,
                businessTPS=None,finalityLatency=None)
