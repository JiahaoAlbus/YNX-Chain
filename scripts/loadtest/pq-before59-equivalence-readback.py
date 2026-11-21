"""Validate the exact before59 source-only step from its pinned original job log.

This is DATA, not source/runtime authority or a substitute for the original
same-run job metadata, frozen job-log SHA, held source gate, or finality.
"""
import datetime
import io
import json
import re

STEP='Verify before59 original transfer and height equivalence'
NAMES=('TestBefore59ObserverAllStagesPreserveOriginalStateEveryHeight',
       'TestBefore59AllObserverStagesPreserveOriginalBlockExecutor')
PACKAGE='github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'
PREFIX=re.compile(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z) (.*)$')
STAMP=re.compile(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z')
ANSI=re.compile(r'\x1b\[[0-9;]*m')
COMMAND="go test -mod=readonly -json -p 1 -count=1 -timeout=90s -run '^TestBefore59(AllObserverStagesPreserveOriginalBlockExecutor|ObserverAllStagesPreserveOriginalStateEveryHeight)$' ./cmd/ynx-comet > \"$RUNNER_TEMP/ynx-before59-observer-equivalence.jsonl\""

def require(ok,message):
    if not ok:raise ValueError(message)

def timestamp(value):
    match=STAMP.fullmatch(value) if type(value) is str else None
    require(match is not None,'original CI step time malformed')
    try:point=datetime.datetime.strptime(match.group(1),'%Y-%m-%dT%H:%M:%S')
    except ValueError as exc:raise ValueError('original CI step time invalid') from exc
    elapsed=point-datetime.datetime(1970,1,1)
    require(elapsed.days>=0,'original CI step time predates epoch')
    return (elapsed.days*86400+elapsed.seconds)*1_000_000_000+int((match.group(2) or '').ljust(9,'0'))

def strict(raw):
    def pairs(items):
        result={}
        for key,value in items:
            require(key not in result,'duplicate before59 event field');result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite before59 event')))

def inspect_before59(binding,focused,raw):
    require(type(binding) is dict and type(binding.get('source')) is str and type(binding.get('run')) is int
            and type(binding.get('focusedJob')) is int and type(focused) is dict
            and type(focused.get('id')) is int and focused['id']==binding['focusedJob']
            and type(focused.get('run_id')) is int and focused['run_id']==binding['run']
            and focused.get('head_sha')==binding['source'] and type(raw) is bytes and 0<len(raw)<=32<<20,
            'before59 focused source/job identity differs')
    matches=[s for s in focused.get('steps',[]) if type(s) is dict and s.get('name')==STEP]
    require(len(matches)==1 and matches[0].get('status')=='completed' and matches[0].get('conclusion')=='success',
            'before59 original equivalence step incomplete')
    require(all(type(matches[0].get(k)) is str and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ',matches[0][k]) for k in ('started_at','completed_at')),
            'before59 original step metadata precision differs')
    start=timestamp(matches[0].get('started_at'));end=timestamp(matches[0].get('completed_at'))
    require(start<=end,'before59 original step clock reversed')
    # Actions job metadata times have second precision while runner lines have
    # finer precision. Exclusive next second includes that final metadata second.
    end_exclusive=end+1_000_000_000
    summary='YNX_BEFORE59_OBSERVER_EQUIVALENCE_DATA_ONLY tests=2 skipped=0 source='+binding['source']+' nodeStarted=false runtimeAuthorized=false'
    rows=[];summaries=[];anchors=[]
    for raw_line in io.BytesIO(raw):
        try:line=raw_line.decode('utf-8','strict').rstrip('\r\n')
        except UnicodeError as exc:raise ValueError('before59 original log is not UTF-8') from exc
        m=PREFIX.match(line)
        if not m:continue
        when=timestamp(m.group(1));content=m.group(2);within=start<=when<end_exclusive
        if ANSI.sub('',content)==COMMAND:
            require(within and not anchors,'before59 original go command duplicated or outside step')
            anchors.append(when);continue
        if content.startswith('YNX_BEFORE59_OBSERVER_EQUIVALENCE_DATA_ONLY'):
            summaries.append((within,content,len(rows)))
            require(len(summaries)<=1,'before59 original summary repeated')
            continue
        if not within or not content.startswith('{'):continue
        try:event=strict(content)
        except (ValueError,json.JSONDecodeError):
            raise ValueError('malformed before59 original Go event') from None
        if type(event) is not dict:continue
        action=event.get('Action')
        if within:
            require(action not in ('skip','fail','build-fail'),'before59 original event failed or skipped')
            test=event.get('Test')
            require(test is None or test in NAMES,'unexpected original before59 test or child')
            if action in ('start','run','pass') and type(event.get('Package')) is str:
                event_time=timestamp(event.get('Time'))
                require(len(anchors)==1,'before59 original go command missing')
                require(anchors[0]<=event_time<end_exclusive and event_time<=when,
                        'before59 original Go event time differs from same-run step')
                rows.append(event)
                require(len(rows)<=256,'before59 original lifecycle event bound exceeded')
    require(len(anchors)==1,'before59 original go command missing')
    require(len(summaries)==1 and summaries[0][:2]==(True,summary),'before59 original source summary missing, repeated or outside step')
    require(all(e.get('Package')==PACKAGE for e in rows),'foreign package in before59 equivalence step')
    require({e['Test'].split('/')[0] for e in rows if type(e.get('Test')) is str}==set(NAMES),
            'before59 original top-level test inventory differs')
    package=[(i,e.get('Action')) for i,e in enumerate(rows) if e.get('Package')==PACKAGE and not e.get('Test') and e.get('Action') in ('start','pass','fail','skip')]
    require(len(package)==2 and [action for _,action in package]==['start','pass'],'before59 original package lifecycle differs')
    begin,finish=package[0][0],package[1][0]
    require(summaries[0][2]>finish,'before59 original summary precedes package completion')
    for name in NAMES:
        events=[(i,e) for i,e in enumerate(rows) if e.get('Test')==name and e.get('Action') in ('run','pass','fail','skip')]
        require(len(events)==2 and [e.get('Action') for _,e in events]==['run','pass']
            and all(e.get('Package')==PACKAGE for _,e in events) and begin<events[0][0]<events[1][0]<finish,
            'before59 original equivalence test lifecycle differs: '+name)
    return dict(source=binding['source'],run=binding['run'],job=binding['focusedJob'],tests=2,skipped=0,
                originalStep=STEP,sourceOnly=True,runtimePermissionGranted=False,independentFinality=False)
