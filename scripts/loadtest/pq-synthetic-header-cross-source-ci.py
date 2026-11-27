"""Same-runner original Go synthetic writer and Tools DATA reader control.

No real nodes, keys, accounts, signing, or runtime authority. The Go output and
receipt remain in the original private directory and are never uploaded.
"""
import ctypes
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import threading

PRODUCERS={
    'edf5b12deb65f94e6e731708f336ca1af23bcfe1':('a2348dc67ee627fcfc3021c513315acd7b9abc7b','aadf0831c6b65559065ca82228bab30811d36c67'),
    'bbe860e8744a479e1838db9b7ae26b8d9a8bb34e':('7f70fd791e1706ad151b2e3d6e68a16c586650aa','5a128880d14bfc73de4334cba23218859ad3473c'),
}
SUPPLIERS={
    'edf5b12deb65f94e6e731708f336ca1af23bcfe1':('28a769cc934ea5bffe971214cabe7285b30d80d2','d1614fd27dedde42da4142648ae7201aeb988036'),
    'bbe860e8744a479e1838db9b7ae26b8d9a8bb34e':('5a49f5c91452604dffb910df736702b3b9df2562','08747364c24c065bf2b13527c210625d7ec95fba'),
}
STREAM_SHA='21d50d6b8ef5fa49d713af2b0be75bc0fc5f017d63e274127aa9f3a2724cc7f8'
RECEIPT_SHA='c9d3cb83a6a0aa8f6916bbcc373cd2e162a4e6683d96dc6fd6a10841c0abd543'
PACKAGE='github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'
TEST='TestSyntheticHeaderPortableSyntheticFixture'
ROOT=Path(__file__).resolve().parent

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file)
    result=importlib.util.module_from_spec(spec);sys.modules[name]=result;spec.loader.exec_module(result)
    return result

lab=module('header_cross_original_cohort','consensus-linux-cohort.py')
driver=module('header_cross_original_driver','pq-independent-load.py')
reader=module('header_cross_original_reader','pq-synthetic-header-stream-data.py')

def producer_identity(value):
    lab.require(type(value) is str and value in PRODUCERS,'exact original writer source required')
    return value,*PRODUCERS[value]


def original_go_events(raw):
    """Retain only complete original test2json lines, never private Go logs."""
    lab.require(type(raw) is bytes and 0<len(raw)<=lab.CAPS['logBytes'],'original Go test stream unavailable')
    events=[];raw_lines=[];downloads=0
    for line in raw.splitlines(keepends=True):
        lab.require(line.endswith(b'\n') and len(line)<=65536,'truncated or oversized original Go test line')
        if line.startswith(b'go: downloading '):
            downloads+=1;continue
        try:event=reader._original.strict(line,65536)
        except (ValueError,UnicodeError):raise RuntimeError('unexpected original Go test output') from None
        lab.require(type(event) is dict and set(event)<= {'Time','Action','Package','Test','Elapsed','Output'}
                    and type(event.get('Time')) is str and re.fullmatch(r'[0-9T:.+Z-]{1,64}',event['Time']) is not None
                    and event.get('Package')==PACKAGE and event.get('Action') in ('start','run','output','pass')
                    and ('Elapsed' not in event or type(event['Elapsed']) in (int,float) and math.isfinite(event['Elapsed']) and 0<=event['Elapsed']<=900),
                    'wrong original Go package, event or outcome')
        name=event.get('Test')
        lab.require(name is None or name==TEST,'unexpected original Go test name')
        if event['Action']=='output':
            output=event.get('Output')
            allowed=(output=='=== RUN   '+TEST+'\n' or
                     re.fullmatch(r'--- PASS: '+TEST+r' \([0-9.]+s\)\n',output or '') or
                     output=='PASS\n' or re.fullmatch(r'ok\s+'+re.escape(PACKAGE)+r'\s+[0-9.]+s\n',output or ''))
            lab.require(bool(allowed),'unexpected original Go test output text')
        events.append(event);raw_lines.append(line)
    roles=[(x['Action'],x.get('Test')) for x in events]
    lab.require(roles==[('start',None),('run',TEST),('output',TEST),('output',TEST),('pass',TEST),
                        ('output',None),('output',None),('pass',None)]
                and events[2]['Output']=='=== RUN   '+TEST+'\n'
                and re.fullmatch(r'--- PASS: '+TEST+r' \([0-9.]+s\)\n',events[3]['Output']) is not None
                and events[5]['Output']=='PASS\n'
                and re.fullmatch(r'ok\s+'+re.escape(PACKAGE)+r'\s+[0-9.]+s\n',events[6]['Output']) is not None,
                'original Go test lifecycle incomplete')
    return b''.join(raw_lines),downloads


def run_owned(window,monitor,operation):
    """Always attempt original monitor and Window retirement; never hide a caught error."""
    primary=None;secondary=[];value=None;retired=False;clean=False;snapshot=None
    try:
        monitor.thread.start()
        value=operation()
    except BaseException as error:
        primary=error
    try:monitor.close()
    except BaseException as error:secondary.append(('monitorClose',type(error).__name__))
    try:retired=monitor.thread.ident is not None and not monitor.thread.is_alive()
    except BaseException as error:secondary.append(('monitorRetirement',type(error).__name__))
    try:clean=window.stop() is True
    except BaseException as error:secondary.append(('windowStop',type(error).__name__))
    if retired:
        try:snapshot=monitor.failure_snapshot()
        except BaseException as error:secondary.append(('monitorSnapshot',type(error).__name__))
    primary_before_resource=primary is not None
    if snapshot is not None and primary is None:primary=RuntimeError('original resource guard failure')
    if primary is not None or secondary or not retired or not clean:
        detail=dict(firstCaughtErrorType=type(primary).__name__ if primary is not None else None,
                    resourceFailureType=snapshot.get('errorType') if type(snapshot) is dict else None,
                    resourceFailureObservedMonotonicNs=snapshot.get('observedMonotonicNs') if type(snapshot) is dict else None,
                    firstCauseOrder=(('UNKNOWN' if primary_before_resource else 'RESOURCE_OBSERVED') if snapshot is not None
                                     else 'FIRST_CAUGHT_ONLY' if primary is not None else 'CLEANUP_FAILURE_ONLY'),
                    monitorRetired=retired,windowStopCompleted=clean,secondary=secondary,
                    runtimeAuthorized=False)
        print('YNX_SYNTHETIC_HEADER_CROSS_SOURCE_FAILURE '+json.dumps(detail,sort_keys=True,separators=(',',':')))
        if primary is not None:raise primary
        raise RuntimeError('original monitor/Window cleanup UNKNOWN')
    return value


def wait_original(window,proc,monitor,stop):
    """Observe the original guard while the owned original Go child runs."""
    while proc.poll() is None:
        monitor.check();window.sample();monitor.check()
        stop.wait(.2)
    monitor.check();window.wait(proc);monitor.check()


def main():
    lab.require(sys.platform=='linux' and os.environ.get('GITHUB_ACTIONS')=='true'
                and os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted','hosted Linux source-only control required')
    producer_commit,producer_tree,fork_tree=producer_identity(os.environ.get('YNX_PRODUCER_COMMIT'))
    tools=Path(os.environ['YNX_TOOLS_SOURCE'])
    producer=Path(os.environ['YNX_PRODUCER_SOURCE'])
    work=Path(os.environ['YNX_PRIVATE_WORK'])
    public=Path(os.environ['YNX_PUBLIC_OUTPUT'])
    runner_temp=Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    lab.require(tools.is_absolute() and tools.resolve(strict=True)==tools
                and producer.is_absolute() and producer.resolve(strict=True)==producer
                and work.is_absolute() and work.parent==runner_temp and public.parent==runner_temp
                and producer not in work.parents and tools not in work.parents,
                'canonical distinct job-local paths required')
    lab.require(lab.git(tools,'rev-parse','HEAD')==os.environ['GITHUB_SHA'] and os.environ['GITHUB_SHA']!=producer_commit,
                'original Tools source identity differs')
    tools_tree=lab.git(tools,'rev-parse','HEAD^{tree}')
    tools_fork=lab.git(tools,'rev-parse','HEAD:third_party/cometbft')
    lab.require(not lab.git(tools,'status','--porcelain','--untracked-files=all')
                and not lab.git(tools,'ls-files','--others','--ignored','--exclude-standard'),
                'original Tools checkout must be clean')
    identity=lab.check_source(producer,producer_commit)
    lab.require(not lab.git(producer,'ls-files','--others','--ignored','--exclude-standard'),
                'ignored producer inputs are not admitted')
    lab.require(identity['tree']==producer_tree and identity['forkTree']==fork_tree,
                'original producer tree/fork identity differs')
    lab.require(lab.git(producer,'rev-parse','HEAD:cmd/ynx-comet/synthetic_header_stream.go')=='43020a6b9e376f477336dc6bcb56b57c0f1f1c82'
                and lab.git(producer,'rev-parse','HEAD:cmd/ynx-comet/synthetic_header_stream_test.go')=='74db626b7e4d896ec632cab8a2f663f7b2ecac21',
                'original writer/test blobs differ')
    rows,_=lab.guard.proc_inventory()
    lab.admit(lab.guard.memory_available(),shutil.disk_usage(work.parent).free,lab.heavy_processes(rows))
    lab.require(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,'original Linux subreaper required')
    info=work.lstat()
    lab.require(work.resolve(strict=True)==work and stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode)==0o700
                and info.st_uid==os.geteuid() and not any(work.iterdir()),'fresh private work required')
    (work/'.private').mkdir(mode=0o700);(work/'public').mkdir(mode=0o700)
    window=lab.Window(producer,work)
    fixture=work/'.private/fixture';fixture.mkdir(mode=0o700)
    window.env['YNX_SYNTHETIC_HEADER_FIXTURE_DIR']=str(fixture)
    stop=threading.Event();monitor=driver.Monitor(window,stop)
    def run_original():
        composition=work/'.private/composition'
        compose_command=[sys.executable,'-B',str(ROOT/'pq-synthetic-header-compose-control.py'),str(producer),str(composition),producer_commit]
        composed=window.launch('original-header-source-composition',compose_command,thread_safe=True,private_log=True,stop=stop)
        wait_original(window,composed,monitor,stop);window.retire_log(composed)
        compose_raw=driver.commit_clock.read_original(work/'.private/composition-control.json',65536)
        compose=reader._original.strict(compose_raw,65536)
        required={'version','source','sourceTree','forkTree','supplierCommit','supplierTree','selectionBytes','selectionSHA256','nativeBytes','nativeSHA256',
                  'sourceCompositionOnly','sourceCIQualified','runtimeAuthorized','pressureAuthorized','actualNetworkWindow'}
        lab.require(type(compose) is dict and set(compose)==required and compose['version']=='YNX-SYNTHETIC-HEADER-COMPOSE-CONTROL/v1'
                    and (compose['source'],compose['sourceTree'],compose['forkTree'])==(producer_commit,producer_tree,fork_tree)
                    and (compose['supplierCommit'],compose['supplierTree'])==SUPPLIERS[producer_commit]
                    and compose['sourceCompositionOnly'] is True
                    and all(compose[k] is False for k in ('sourceCIQualified','runtimeAuthorized','pressureAuthorized','actualNetworkWindow'))
                    and all(type(compose[k]) is int and 0<compose[k]<=65536 for k in ('selectionBytes','nativeBytes'))
                    and all(type(compose[k]) is str and re.fullmatch(r'[0-9a-f]{64}',compose[k]) for k in ('selectionSHA256','nativeSHA256')),
                    'original same-runner source composition evidence differs')
        go=shutil.which('go');lab.require(go is not None,'original configured Go unavailable')
        command=[go,'test','-mod=readonly','-json','-p','1','-count=1','-timeout=90s','-run','^'+TEST+'$','./cmd/ynx-comet']
        proc=window.launch('original-go-synthetic-header',command,thread_safe=True,private_log=True,stop=stop)
        wait_original(window,proc,monitor,stop);window.retire_log(proc)
        path=work/'.private/original-go-synthetic-header.log'
        raw=driver.commit_clock.read_original(path,lab.CAPS['logBytes'])
        events,downloads=original_go_events(raw)
        observed=reader.inspect_paths(fixture/'synthetic-header-fixture.jsonl',fixture/'synthetic-header-fixture.jsonl.receipt.json',
                                      stream_sha256=STREAM_SHA,receipt_sha256=RECEIPT_SHA,selected_heights=[1,2])
        lab.require(observed['events']==2 and observed['classification']=='DATA_ONLY' and observed['runtimeAuthorized'] is False
                    and observed['independentFinality'] is False and len(observed['selected'])==2,'original producer/reader DATA differs')
        monitor.check();lab.require(lab.check_source(producer,producer_commit)==identity
                                    and not lab.git(producer,'ls-files','--others','--ignored','--exclude-standard'),
                                    'producer source changed')
        lab.require(lab.git(tools,'rev-parse','HEAD')==os.environ['GITHUB_SHA']
                    and lab.git(tools,'rev-parse','HEAD^{tree}')==tools_tree
                    and lab.git(tools,'rev-parse','HEAD:third_party/cometbft')==tools_fork
                    and not lab.git(tools,'status','--porcelain','--untracked-files=all')
                    and not lab.git(tools,'ls-files','--others','--ignored','--exclude-standard'),
                    'original Tools source changed')
        record=dict(version='YNX-SYNTHETIC-HEADER-CROSS-SOURCE/v1',classification='DATA_ONLY',
                    toolsSource=os.environ['GITHUB_SHA'],toolsTree=tools_tree,toolsForkTree=tools_fork,
                    producerSource=producer_commit,producerTree=producer_tree,producerForkTree=fork_tree,
                    runId=os.environ['GITHUB_RUN_ID'],attempt=os.environ['GITHUB_RUN_ATTEMPT'],
                    producerTest=TEST,goEventsBytes=len(events),goEventsSHA256=hashlib.sha256(events).hexdigest(),
                    originalPrivateGoLogSHA256=hashlib.sha256(raw).hexdigest(),downloadNoticeCount=downloads,
                    sourceComposition=compose,
                    streamSHA256=STREAM_SHA,receiptSHA256=RECEIPT_SHA,events=2,sourceQualified=False,
                    nodeBindingVerified=False,startupCoverageComplete=False,walReplayExcluded=False,
                    runtimeAuthorized=False,independentFinality=False,receiptPublicationVerified=False)
        return events,record
    events,record=run_owned(window,monitor,run_original)
    public.mkdir(mode=0o700)
    with open(public/'go-events.jsonl','xb') as f:f.write(events)
    with open(public/'metadata.json','x') as f:json.dump(record,f,sort_keys=True,separators=(',',':'));f.write('\n')
    print('YNX_SYNTHETIC_HEADER_CROSS_SOURCE_DATA_ONLY events=2 runtimeAuthorized=false independentFinality=false')

if __name__=='__main__':main()
