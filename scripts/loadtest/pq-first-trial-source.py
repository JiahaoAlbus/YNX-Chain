"""Exact1b own normal CI originals. Source DATA only, never dispatch permission."""
import hashlib
import importlib.util
import io
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

SOURCE='1b0ea548aca6b5260a9824d0edd3012d52e53521'
TREE='7c8f6cd8af01b366ea31ffc9f58659e6ca0099e6'
H_SHA='610c4c4a85be1755f488aaa31c6e3b630af0f36230e0c206786fd168c236e147'
s=importlib.util.spec_from_file_location('first_trial_named_source',Path(__file__).with_name('pq-lossless-source-data.py'));named=importlib.util.module_from_spec(s);s.loader.exec_module(named)
require=named.require

def qualification(directory=None):
    directory=Path(directory) if directory is not None else Path(__file__).with_name('fixtures')/'1b-source'
    def read(name,size,pin):
        path=directory/name;require(not path.is_symlink(),'original source fixture may not redirect')
        with path.open('rb') as stream:raw=stream.read(size+1)
        require(len(raw)==size and hashlib.sha256(raw).hexdigest()==pin,'exact own1b source original differs: '+name);return raw
    h=named.strict(read('H.json',12186,H_SHA))
    require(h['sourceCommit']==SOURCE and h['sourceTree']==TREE and h['productionCometTree']=='54e88e6aba735eaceeb2d00bb40731248c673bd7' and h['sourceOnlyQualified'] is True and h['freshRuntimePermissionGranted'] is False and h['actual500InitializationQualified'] is False,'own1b source-only scope differs')
    def ref(value):return read(Path(value['path']).name,value['bytes'],value['sha256'])
    chain=named.strict(ref(h['normalCI']['chain']));resource=named.strict(ref(h['normalCI']['resourceSnapshot']))
    require(chain['headSha']==resource['headSha']==SOURCE and chain['databaseId']==42345664402 and resource['databaseId']==42345664409 and chain['conclusion']=='success','own source CI identity/conclusion differs')
    jobs={j['databaseId']:j for j in chain['jobs']+resource['jobs']}
    for job in (128322733458,128322783141,128322733111,128322783149,128322783174,128322783106):require(jobs[job]['status']=='completed' and jobs[job]['conclusion']=='success','own source normal job not successful')
    require(any(step['name']=='Check reachable vulnerabilities in the eight production runtime commands' and step['conclusion']=='success' for step in jobs[128322733458]['steps']),'own eight runtime vulnerability check missing')
    archives={}
    for archive in h['sourceArchives']:
        identifier=int(Path(archive['path']).stem);files={}
        with zipfile.ZipFile(io.BytesIO(ref(archive))) as z:
            require(0<len(z.infolist())<=32,'bounded source original inventory required')
            for entry in z.infolist():
                path=PurePosixPath(entry.filename)
                require(str(path)==entry.filename and not path.is_absolute() and '..' not in path.parts and '\\' not in entry.filename and not stat.S_ISLNK(entry.external_attr>>16) and entry.filename not in files and 0<=entry.file_size<=128<<10,'unsafe original source ZIP entry')
                raw=z.read(entry);require(len(raw)==entry.file_size,'original source ZIP length differs');files[entry.filename]=raw
        archives[identifier]=files
    require(len(archives)==4,'four original source ZIPs required')
    flows=[]
    for check in h['rawJSONLChecks']:
        identifier=check['artifactId'];reference=check['file']
        matches=[raw for name,raw in archives[identifier].items() if Path(name).name==Path(reference['path']).name];require(len(matches)==1,'unique original source JSONL required');raw=matches[0]
        require(len(raw)==reference['bytes'] and hashlib.sha256(raw).hexdigest()==reference['sha256'],'original source JSONL pin differs')
        named.require_named_run_pass(raw,check['uniqueRunPass']);events=[named.strict(line) for line in raw.splitlines()]
        require(all(e.get('Package')==check['package'] for e in events),'original source package identity differs')
        flows.append(dict(artifact=identifier,file=Path(reference['path']).name,actualNamedRunPass=len(check['uniqueRunPass'])))
    require(len(flows)==7,'seven separate original source flows required')
    for identifier in (13564005459,13563183469):
        source=next(named.strict(raw) for name,raw in archives[identifier].items() if name.endswith('/SOURCE.json'))
        require(source['sourceCommit']==SOURCE and source['sourceTree']==TREE and source['nodeProcessesStarted']==0 and source['sourceOnly'] is True,'original prepared source differs')
        selection=source['preparedSourceSelection'];body=next(raw for name,raw in archives[identifier].items() if name.endswith('/SOURCE-SELECTION.json'))
        require(hashlib.sha256(body).hexdigest()==selection['receiptSHA256'] and len(body)==selection['receiptBytes'] and named.strict(body)==selection['sourceSelection'],'own original source selection differs')
    startup=h['startup6'];original=ref(startup['originalJobLog']);collector=named.strict(ref(startup['result']));actual=[]
    for item in collector['receipts']:
        marker=item['marker'];matches=[]
        for line in original.decode().splitlines():
            found=re.fullmatch(r'\d{4}-\d\d-\d\dT[^ ]+Z '+re.escape(marker)+r' (\{.*\})',line)
            if found:matches.append(named.strict(found.group(1)))
        require(len(matches)==1 and matches[0]==item['receipt'] and matches[0]['commit']==SOURCE,'unique original startup collector output differs')
        actual+=matches[0]['requiredPassed']
    require(len(startup['requiredPassed'])==6 and all(actual.count(name)==1 for name in startup['requiredPassed']) and collector['rawGoReexecuted'] is False,'six original startup collector assertions missing or duplicated')
    return dict(source=SOURCE,sourceTree=TREE,sourceH_SHA256=H_SHA,sourceOnlyQualified=True,separateOriginalJSONLFlows=flows,startupCollectorCases=6,startupRawJSONLCasesReRead=0,sourceQualificationType='own original ZIP JSONL plus original workflow collector for startup6',actual500InitializedOwnersQualified=False,wholeResourceCIQualified=False,runtimePermissionGranted=False,pressureAuthorized=False)
