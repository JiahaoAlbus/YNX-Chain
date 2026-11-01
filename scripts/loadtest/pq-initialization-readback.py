"""Read only original public initialization artifacts and durable stage events.

No API, source build, node, signer, collector, dispatch or replay. A verified ZIP
or an observed original initialization receipt never grants pressure permission.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path,PurePosixPath
import re
import stat
import zipfile


def require(ok,message):
    if not ok:raise RuntimeError(message)

def strict(raw):
    def pairs(items):
        result={}
        for key,value in items:
            require(key not in result,'duplicate original artifact JSON field');result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=pairs)

def journals(files,prefix,receipt):
    segments=receipt.get('initializationJournalSegments')
    if segments is None:return dict(status='NOT_SUPPLIED',missingDurationsAreUnknown=True,requested=0,returned=0,unfinished=[],errors=[],events=[])
    require(type(segments) is list and len(segments)<=16,'bounded original initialization journals required')
    requested={};returned={};events=[];errors=[];seen=set()
    for segment in segments:
        name=segment.get('path','')
        require(re.fullmatch(r'initialization-events-\d{5}\.jsonl',name) and name not in seen,'closed unique original initialization journal path required');seen.add(name)
        raw=files.get(prefix+name)
        require(raw is not None and len(raw)==segment.get('bytes') and hashlib.sha256(raw).hexdigest()==segment.get('sha256'),'original initialization journal bytes differ')
        for line_number,line in enumerate(raw.splitlines(),1):
            require(len(events)<4096 and len(line)<=64<<10,'bounded original initialization events required')
            try:
                event=strict(line);index=event['index'];kind=event['kind'];require(type(index) is int and 0<=index<2048 and type(event.get('stage')) is str,'original stage identity differs')
                table=requested if kind=='initialization_stage_requested' else returned if kind=='initialization_stage_returned' else None
                require(table is not None and index not in table,'unknown/duplicate original initialization boundary')
                if kind=='initialization_stage_requested':require(type(event.get('requestedMonotonicNs')) is int and event.get('elapsedNs') is None and event.get('completed') is False,'request boundary cannot fabricate a completed duration')
                else:
                    start=event.get('startedMonotonicNs');end=event.get('returnedMonotonicNs');elapsed=event.get('elapsedNs')
                    require(type(end) is int and ((start is None and elapsed is None and event.get('completed') is False) or (type(start) is int and type(elapsed) is int and 0<=elapsed==end-start and event.get('completed') is True)),'original return interval differs')
                table[index]=event;events.append(event)
            except (RuntimeError,ValueError,KeyError,TypeError) as error:errors.append(dict(segment=name,line=line_number,errorType=type(error).__name__));break
    for index,end in returned.items():
        begin=requested.get(index)
        if begin is None:errors.append(dict(index=index,reason='return without durable request; original failure remains unknown'))
        elif any(begin.get(key)!=end.get(key) for key in ('stage','identity','requestedMonotonicNs')):errors.append(dict(index=index,reason='original request/return identity differs'))
    unfinished=[dict(index=index,stage=event['stage'],identity=event.get('identity'),requestedMonotonicNs=event['requestedMonotonicNs'],elapsedNs=None,status='RETURN_NOT_SUPPLIED') for index,event in sorted(requested.items()) if index not in returned]
    original=receipt.get('initializationStages',{}).get('records',[])
    original_indexes={row['index'] for row in original}
    for index in returned:
        if index not in original_indexes:errors.append(dict(index=index,reason='journal return not retained in original receipt span list'))
    for row in original:
        event=returned.get(row['index'])
        if event is None:errors.append(dict(index=row['index'],reason='receipt span has no retained original return boundary'))
        elif any(row.get(k)!=event.get(k) for k in row):errors.append(dict(index=row['index'],reason='original receipt and journal span differ'))
    return dict(status='COMPLETE_OBSERVED_BOUNDARIES' if not errors and not unfinished else 'PARTIAL_OR_FAILED',requested=len(requested),returned=len(returned),unfinished=unfinished,errors=errors,events=events,missingDurationsAreUnknown=True,noBackfill=True)

def commit_original_copies(files,prefix,receipt):
    """Verify receipt-to-file Commit copies; never upgrade producer coverage."""
    original=receipt.get('normalCommitObservation')
    if original is None:return dict(status='NOT_SUPPLIED',records=[],missingStagesAreUnknown=True)
    rows=original.get('originalSnapshots');require(type(rows) is list and len(rows)<=4,'bounded original Commit node copies required')
    seen=set();records=[]
    for row in rows:
        node=row.get('node');name=row.get('path')
        require(type(node) is int and 0<=node<4 and node not in seen and name=='commit-observation-node-%d-original.json'%node,'unique original Commit node file required');seen.add(node)
        raw=files.get(prefix+name)
        require(raw is not None and len(raw)==row.get('bytes') and hashlib.sha256(raw).hexdigest()==row.get('sha256'),'original Commit file pin differs')
        snapshot=strict(raw)
        # Invalid original producer outputs can be retained by the runtime;
        # their bytes remain useful without being promoted into valid timings.
        if row.get('usable') is True:
            require(snapshot==row.get('rawOriginalObservation'),'original Commit receipt/file copies differ')
            matches=[p for p in receipt.get('processes',[]) if p.get('name')=='pq-node-%d'%node]
            require(len(matches)==1 and matches[0].get('pid')==row.get('pid')==snapshot.get('processID') and matches[0].get('exited') is True and matches[0].get('rawReturnCode') is not None,'original Commit producer stopped identity differs')
        records.append(dict(node=node,path=name,bytes=len(raw),sha256=row['sha256'],producerReportedUsable=row.get('usable') is True,originalSnapshot=snapshot,producerRetainedStageSummary=row.get('retainedPersistenceStages')))
    return dict(status='ORIGINAL_COPIES_VERIFIED',records=records,originalReadback=original,missingStagesAreUnknown=True,
        independentSourceOrGenesisValidation=False,businessTPS=None,inclusionLatency=None,finalConfirmationLatency=None,
        meaning='Whole archive and original receipt bind these stopped producer copies. Producer usability/coverage and stage summaries are preserved, not independently upgraded to source, all-Commit or finality qualification.')

def inspect(raw,pin,controller,source,source_tree,tools):
    require(type(raw) is bytes and 0<len(raw)<=128<<20 and re.fullmatch('[0-9a-f]{64}',pin) and hashlib.sha256(raw).hexdigest()==pin,'whole original ZIP digest or bound differs')
    files={};manifest={};seen=set();total=0
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos=archive.infolist();require(0<len(infos)<=1024,'bounded original ZIP entry count required')
        for entry in infos:
            name=PurePosixPath(entry.filename);mode=entry.external_attr>>16
            require(not name.is_absolute() and '..' not in name.parts and '\\' not in entry.filename and str(name)==entry.filename.rstrip('/') and entry.filename not in seen and not stat.S_ISLNK(mode),'unsafe/duplicate original ZIP entry');seen.add(entry.filename)
            if entry.is_dir():continue
            total+=entry.file_size;require(entry.file_size<=8<<20 and total<=256<<20,'bounded original public ZIP files required')
            body=archive.read(entry);require(len(body)==entry.file_size,'original ZIP entry length differs')
            files[entry.filename]=body;manifest[entry.filename]=dict(bytes=len(body),crc32=entry.CRC,sha256=hashlib.sha256(body).hexdigest())
    matches=[name for name in files if name=='receipt.json' or name=='public/receipt.json' or name.endswith('/public/receipt.json')];require(len(matches)==1,'one original initialization receipt required')
    name=matches[0];prefix=name.removesuffix('receipt.json');receipt=strict(files[name]);adapter=strict(files[prefix+'CURRENT703-BASELINE-CI.json']);request=strict(files[prefix+'requested-load.json'])
    require(adapter.get('controllerCommit')==controller and adapter.get('goSource')==source and adapter.get('tools')==tools and adapter.get('measurementScope')=='normal-initialization-only','original controller/source/tools binding differs')
    require(receipt.get('source',{}).get('commit')==source and receipt['source'].get('tree')==source_tree and request.get('source')==receipt['source'] and request.get('accounts')==500 and request.get('perAccountCapacity')==1 and request.get('configuredDemand')==500,'exact original source and full500 demand required')
    require(receipt.get('initializationOnlyRequested') is True and receipt.get('loadExecuted') is False and 'loadResult' not in receipt,'business load cannot become initialization-only DATA')
    fresh=strict(files[prefix+'fresh-resource-admission.json']);require(fresh==receipt.get('freshResourceAdmission'),'original admission copies differ')
    census=receipt.get('initializedAccountReadback')
    if census is not None:require(census==strict(files[prefix+'initialized-account-readback.json']),'original census copies differ')
    journal=journals(files,prefix,receipt)
    commits=commit_original_copies(files,prefix,receipt)
    original_ok=receipt.get('initializationDataValidation',{}).get('completeNormalInitializationObserved') is True
    full=bool(original_ok and receipt.get('firstCause') is None and receipt.get('cleanupComplete') is True and census and census.get('configuredLoadAccounts')==500 and census.get('completeFourNodeAccountReadback') is True and len(census.get('nodes',[]))==4 and [n.get('node') for n in census['nodes']]==list(range(4)) and len({(n.get('height'),n.get('appHash')) for n in census['nodes']})==1 and all(n.get('matchingOriginalLoadAccounts')==500 for n in census['nodes']) and journal['status']=='COMPLETE_OBSERVED_BOUNDARIES')
    return dict(schema='YNX-PERF-ORIGINAL-INITIALIZATION-READBACK/v1',archiveSHA256=pin,verifiedFiles=len(manifest),verifiedUncompressedBytes=total,receiptSHA256=manifest[name]['sha256'],controller=controller,source=source,sourceTree=source_tree,tools=tools,originalFirstCause=receipt.get('firstCause'),cleanupComplete=receipt.get('cleanupComplete'),originalInitializationValidation=receipt.get('initializationDataValidation'),completeInitializationDataObserved=full,originalCensus=census,originalStages=receipt.get('initializationStages'),originalCommitCopies=commits,resourceGuardStageElapsed=receipt.get('resourceGuardStageElapsed'),normalCalleeMeasurements=receipt.get('normalCalleeMeasurements'),normalNodeCleanExit=receipt.get('normalNodeCleanExit'),originalReadinessObservations=receipt.get('originalReadinessObservations'),coldReadinessBudget=receipt.get('coldBootstrapReadinessBudget'),originalFailedCalleeMeasurements=receipt.get('failedCalleeMeasurements'),originalPreparationSenderMeasurements=receipt.get('preparationSenderMeasurements'),freshResourceAdmission=fresh,elapsedSeconds=receipt.get('elapsedSeconds'),peakObservedRSSBytes=receipt.get('peakRSSBytes'),peakNewBytes=receipt.get('peakNewBytes'),allBusinessDemand=receipt.get('preparationOnlyDemandAccounting'),journals=journal,files=manifest,businessLoadExecuted=False,businessTPS=None,inclusionLatency=None,finalConfirmationLatency=None,pressureAuthorized=False,sourceGrant=False,originalsModified=False,scope='Original artifact/readback DATA only; source normal initialization and normal verifier retain authority. No omitted/unfinished interval is filled or replayed.')

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False);p.add_argument('--read',action='store_true')
    for name in ('archive','sha256','controller','source','source-tree','tools','output'):p.add_argument('--'+name)
    args=p.parse_args(argv)
    if not args.read:print(json.dumps(dict(executed=False,archiveRead=False,pressureAuthorized=False)));return 0
    require(all(getattr(args,k) for k in ('archive','sha256','controller','source','source_tree','tools','output')),'explicit original archive and identities required')
    result=inspect(Path(args.archive).read_bytes(),args.sha256,args.controller,args.source,args.source_tree,args.tools)
    with Path(args.output).open('x') as out:json.dump(result,out,indent=2);out.write('\n')
    print(json.dumps(dict(verifiedFiles=result['verifiedFiles'],originalFirstCause=result['originalFirstCause'],completeInitializationDataObserved=result['completeInitializationDataObserved'],pressureAuthorized=False)));return 0

if __name__=='__main__':raise SystemExit(main())
