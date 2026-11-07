"""Read original optional Go startup stderr events retained in owned node logs.

No source selection, argument injection, retry, node readiness or authority.
Relative producer durations and parent readiness observations stay separate.
"""
import hashlib,json,re

VERSION='YNX-COMET-STARTUP-TIMING/v1'
MAX_LOG_BYTES=4<<20
MAX_EVENTS=256
FIELDS={'version','clock','stage','event','outcome','elapsedNs','startupElapsedNs'}

def strict(raw):
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise ValueError('duplicate startup event field')
            result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=pairs)

def parse(raw,requested=True):
    if type(raw) is not bytes or len(raw)>MAX_LOG_BYTES:raise RuntimeError('original startup node log exceeds unchanged4MiB bound')
    events=[];records=[];pending={};errors=[];ignored=0;overflow=0;last_clock=None
    def error(line,reason):
        if len(errors)<64:errors.append(dict(line=line,reason=reason))
    for line_number,line in enumerate(raw.splitlines(),1):
        if VERSION.encode() not in line:ignored+=1;continue
        try:
            event=strict(line)
            if type(event) is not dict or event.get('version')!=VERSION:ignored+=1;continue
            if len(events)>=MAX_EVENTS:overflow+=1;continue
            if set(event)!=FIELDS or event['clock']!='monotonic_elapsed_wall_ns' or type(event['stage']) is not str or re.fullmatch('[A-Za-z][A-Za-z0-9_.]{0,127}',event['stage']) is None:raise ValueError('startup event identity/schema differs')
            for key in ('elapsedNs','startupElapsedNs'):
                if type(event[key]) is not int or not 0<=event[key]<1<<63:raise ValueError('startup event clock value differs')
            if last_clock is not None and event['startupElapsedNs']<last_clock:raise ValueError('producer relative startup clock regressed')
            last_clock=event['startupElapsedNs'];kind=event['event'];stage=event['stage'];event=dict(event,line=line_number);events.append(event)
            if kind=='begin':
                if event['outcome']!='RUNNING' or event['elapsedNs']!=0:raise ValueError('begin cannot claim a completed duration')
                row=dict(index=len(records),stage=stage,beginLine=line_number,beginStartupElapsedNs=event['startupElapsedNs'],endLine=None,endStartupElapsedNs=None,elapsedNs=None,outcome='RETURN_NOT_OBSERVED',pairingAmbiguous=False)
                records.append(row)
                active=pending.setdefault(stage,[])
                if active:
                    error(line_number,'overlapping same-stage events have no invocation identity')
                    for old in active:old['pairingAmbiguous']=True
                    row['pairingAmbiguous']=True
                active.append(row)
            elif kind=='end':
                if event['outcome'] not in ('SUCCEEDED','REFUSED_OR_UNKNOWN') or event['elapsedNs']>event['startupElapsedNs']:raise ValueError('end cannot invent outcome or time before process startup')
                active=pending.get(stage,[])
                if not active:error(line_number,'return has no retained original begin');continue
                row=active.pop(0);row.update(endLine=line_number,endStartupElapsedNs=event['startupElapsedNs'])
                if not row['pairingAmbiguous']:row.update(elapsedNs=event['elapsedNs'],outcome=event['outcome'])
                else:row['outcome']='AMBIGUOUS_ORIGINAL_RETURN'
            else:raise ValueError('unknown startup event boundary')
        except (ValueError,KeyError,TypeError) as caught:error(line_number,str(caught))
    unfinished=[r['index'] for r in records if r['endLine'] is None]
    complete=bool(requested is True and events and not errors and not overflow and not unfinished)
    return dict(schema='YNX-PERF-ORIGINAL-NODE-STARTUP-STAGES/v1',version=VERSION,requested=requested,status='COMPLETE_OBSERVED_BOUNDARIES' if complete else 'NOT_REQUESTED' if requested is False and not events and not errors else 'PARTIAL_OR_UNKNOWN',logBytes=len(raw),logSHA256=hashlib.sha256(raw).hexdigest(),events=events,records=records,unfinishedRecordIndexes=unfinished,errors=errors,eventOverflow=overflow,ignoredNonTimingLines=ignored,intervalsOverlap=True,unmatchedBeginElapsedNs=None,missingStagesAreUnknown=True,relativeProducerClockOnly=True,readinessOrNodeStartSuccessInferred=False,sourceQualified=False,businessTPS=None,finalityLatency=None,meaning='Producer elapsed wall spans only. An end SUCCEEDED means that call returned; begin elapsed0 never means zero completed time. Nested spans are not added, aligned to another process clock or substituted for parent RPC readiness.')

def original_nodes(files,prefix,processes):
    rows=[]
    for phase in ('bootstrap','pq'):
        for node in range(4):
            name=phase+'-node-'+str(node);matches=[p for p in processes if p.get('name')==name];raw=files.get(prefix+name+'.log')
            if len(matches)!=1:
                row=dict(name=name,status='PROCESS_IDENTITY_NOT_SUPPLIED',elapsedNs=None,processIdentityBound=False)
                if raw is not None:
                    try:row['originalStages']=parse(raw,requested=None)
                    except (RuntimeError,ValueError,TypeError) as error:row['originalStages']=dict(status='INVALID_OR_UNKNOWN_DIAGNOSTIC',errorType=type(error).__name__,elapsedNs=None,missingStagesAreUnknown=True)
                rows.append(row);continue
            process=matches[0];argv=process.get('command',[]);flags=[v for v in argv if v=='--startup-timings' or v.startswith('--startup-timings=')]
            requested=(True if flags[0] in ('--startup-timings','--startup-timings=true') else False if flags[0]=='--startup-timings=false' else None) if len(flags)==1 else False if not flags else None
            record=dict(name=name,processIdentityBound=(type(process.get('pid')) is int and process['pid']>0 and type(process.get('startTicks')) is int and process['startTicks']>0),pid=process.get('pid'),startTicks=process.get('startTicks'),rawReturnCode=process.get('rawReturnCode'),startupTimingFlags=flags)
            if raw is None:record.update(status='ORIGINAL_LOG_NOT_SUPPLIED',elapsedNs=None)
            else:
                try:stages=parse(raw,requested)
                except (RuntimeError,ValueError,TypeError) as error:
                    stages=dict(status='INVALID_OR_UNKNOWN_DIAGNOSTIC',errorType=type(error).__name__,logBytes=len(raw),logSHA256=hashlib.sha256(raw).hexdigest(),elapsedNs=None,missingStagesAreUnknown=True,sourceQualified=False)
                record.update(status='ORIGINAL_LOG_READ',originalStages=stages)
            rows.append(record)
    return dict(schema='YNX-PERF-EIGHT-ORIGINAL-NODE-STARTUP-READBACK/v1',nodes=rows,allEightOriginalLogsObserved=all('originalStages' in r for r in rows),allEightProcessIdentitiesBound=all(r.get('processIdentityBound') is True for r in rows),allEightRequestedBoundariesComplete=all(r.get('originalStages',{}).get('status')=='COMPLETE_OBSERVED_BOUNDARIES' for r in rows),sourceQualified=False,readinessOrFinalityInferred=False,meaning='Original process identities and archive node-log bytes only; diagnostic coverage remains separate from the original first cause, normal exit0 and initialization validity.')
