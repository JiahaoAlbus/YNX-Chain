#!/usr/bin/env python3
"""Same-source complete native stream checker in one short-lived process.
No nodes/RPC/submissions. The owning case must count this process and all its
work inside its original active/case/aggregate resource budgets.
"""
import argparse,hashlib,importlib.util,json,os,re,stat,sys,time
from pathlib import Path

MARKER='YNX_NATIVE_STREAM_VERIFIER_TERMINAL '
NAME='native-stream-verifier.json'
MAX_RESULT=4<<20
MAX_PUBLIC=128<<20  # Hash-only inventory; original64MiB stream validator still applies.
CONFIG={'pacing','expected_input_reuse','expected_canonical_certificate','expected_native_suffix','expected_block_tip_hint'}

def need(value,message):
    if not value:raise RuntimeError(message)

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()+b'\n'
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def source_identity(controller):return dict(controller=sha(controller.__file__),verifier=sha(__file__))
def fields(s):return [s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns]

def file_identity(path):
    before=path.lstat();need(stat.S_ISREG(before.st_mode) and 0<=before.st_size<=16<<20,'verifier public member type/size differs')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);digest=hashlib.sha256();size=0
    with os.fdopen(fd,'rb') as handle:
        opened=os.fstat(handle.fileno());need(fields(opened)==fields(before),'verifier member replaced before open')
        while raw:=handle.read(65536):size+=len(raw);digest.update(raw)
        after=os.fstat(handle.fileno())
    need(fields(before)==fields(after)==fields(path.lstat()) and size==before.st_size,'verifier public member changed')
    return dict(bytes=size,sha256=digest.hexdigest(),stat=fields(before))

def public_snapshot(network):
    network=Path(network).absolute();need(network.resolve()==network,'verifier root symlink differs')
    paths=['network-manifest.json','transactions.json','transactions-result.json','transactions-result.json.streaming-plan.json'];directories=[]
    for dirname,prefix in [('sender-ready-intents','intent'),('transactions-result.json.terminal-stream','terminal')]:
        directory=network/dirname;before=directory.lstat();need(stat.S_ISDIR(before.st_mode) and not directory.is_symlink(),'verifier evidence directory differs')
        names=sorted(os.listdir(directory));need(0<len(names)<=8192,'verifier public inventory bound')
        need(all(re.fullmatch(prefix+r'-\d{6}\.jsonl',n) for n in names),'verifier evidence inventory differs')
        paths.extend(dirname+'/'+n for n in names);directories.append(dict(path=dirname,names=names,stat=fields(before)))
    members=[];total=0
    for relative in paths:
        value=file_identity(network/relative);total+=value['bytes'];need(total<=MAX_PUBLIC,'verifier public hash inventory bound')
        members.append(dict(path=relative,**value))
    for directory in directories:need(fields((network/directory['path']).lstat())==directory['stat'],'verifier directory changed during hash')
    return dict(files=members,directories=directories,bytes=total)

def content_only(snapshot):
    return dict(files=[{k:v for k,v in row.items() if k!='stat'} for row in snapshot['files']],directories=[{k:v for k,v in row.items() if k!='stat'} for row in snapshot['directories']],bytes=snapshot['bytes'])

def check_selection(controller,selection):
    need(type(selection) is dict and set(selection)==CONFIG,'verifier explicit selection missing')
    need(all(type(selection[k]) is bool for k in CONFIG-{'pacing'}),'verifier selected booleans differ')
    controller.recipe('grpc',controller.STREAM_PROFILE,selection['pacing'],True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,current_input_reuse=selection['expected_input_reuse'],canonical_certificate=selection['expected_canonical_certificate'],native_suffix_setup=selection['expected_native_suffix'],block_tip_hint=selection['expected_block_tip_hint'])

def produce(controller,case,selection,runtime_network=None):
    check_selection(controller,selection);case=Path(case).absolute();need(case.resolve()==case,'verifier case symlink differs');network=case/'network'
    phases_ns={};start=time.monotonic_ns();before=public_snapshot(network);phases_ns['publicHashBeforeNs']=time.monotonic_ns()-start
    start=time.monotonic_ns();report,digest=controller.read_native_stream_report(network/'transactions-result.json');phases_ns['reportCaptureDecodeNs']=time.monotonic_ns()-start
    args=dict(selection)
    if runtime_network is not None:args['runtime_network']=Path(runtime_network)
    start=time.monotonic_ns();measured=controller.validate_native_stream_report(report,network,**args);phases=controller.validate_observer_phases(report,selection['expected_block_tip_hint']);phases_ns['firstCompleteCheckNs']=time.monotonic_ns()-start
    # Preserve both original complete case and pair readbacks, now charged to
    # this same case before its post-fsync qualification or next activation.
    start=time.monotonic_ns();again=controller.validate_native_stream_report(report,network,**args);again_phases=controller.validate_observer_phases(report,selection['expected_block_tip_hint']);phases_ns['secondCompleteCheckNs']=time.monotonic_ns()-start
    need(measured==again and phases==again_phases,'verifier repeated full readback differs')
    start=time.monotonic_ns();after=public_snapshot(network);phases_ns['publicHashAfterNs']=time.monotonic_ns()-start;need(before==after,'verifier complete evidence changed during checks')
    need(next(r['sha256'] for r in after['files'] if r['path']=='transactions-result.json')==digest,'verifier report bytes changed')
    need(measured['summary']['input']==8192 and measured['summary']['finalSubmitted']==8192,'verifier incomplete business records')
    result=dict(schema=1,kind='complete-native-stream-case-verifier-v1',pid=os.getpid(),parentPID=os.getppid(),case=str(case),selection=selection,sourceIdentity=source_identity(controller),checkerPasses=2,phaseTotalsNs=phases_ns,clientSHA256=digest,measurement=measured,observerPhases=phases,publicSnapshot=after,networkQualified=False,sustainedTPSQualified=False)
    output=case/NAME
    receipt_start=time.monotonic_ns();fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as handle:json.dump(result,handle,indent=2);handle.write('\n');handle.flush();os.fsync(handle.fileno())
    need(output.stat().st_size<=MAX_RESULT,'verifier result byte bound')
    terminal=dict(receiptWriteAndFsyncNs=time.monotonic_ns()-receipt_start,schema=1,complete=True,pid=result['pid'],parentPID=result['parentPID'],resultSHA256=sha(output),clientSHA256=digest,checkerPasses=2,networkQualified=False,sustainedTPSQualified=False)
    print(MARKER+json.dumps(terminal),flush=True)
    return result

def load_result(controller,case,selection,pid,parent,expected_sha=None,strict_filesystem=True,runtime_case=None):
    check_selection(controller,selection);case=Path(case).absolute();e=controller.stream_evidence
    need(type(pid) is int and pid>0 and type(parent) is int and parent>0,'verifier process identity invalid')
    raw=e.capture(case/NAME,min(MAX_RESULT,(case/NAME).lstat().st_size));digest=hashlib.sha256(raw).hexdigest()
    need(expected_sha is None or digest==expected_sha,'verifier receipt SHA differs');text=raw.decode('utf-8');del raw;value=e.strict_json(text)
    log=e.capture(case/'verifier.log',65536).decode('utf-8');lines=[e.strict_json(line[len(MARKER):]) for line in log.splitlines() if line.startswith(MARKER)]
    need(len(lines)==1,'verifier terminal missing/repeated');term=lines[0]
    need(term.get('complete') is True and term.get('resultSHA256')==digest and term.get('pid')==pid and term.get('parentPID')==parent and term.get('checkerPasses')==2,'verifier terminal/identity/receipt differs')
    need(value.get('schema')==1 and value.get('kind')=='complete-native-stream-case-verifier-v1' and value.get('pid')==pid and value.get('parentPID')==parent and value.get('checkerPasses')==2,'verifier full checker identity differs')
    need(type(value.get('schema')) is int and type(value.get('checkerPasses')) is int and type(term.get('checkerPasses')) is int,'verifier schema/count type differs')
    times=value.get('phaseTotalsNs',{});need(set(times)=={'publicHashBeforeNs','reportCaptureDecodeNs','firstCompleteCheckNs','secondCompleteCheckNs','publicHashAfterNs'} and all(type(n) is int and n>0 for n in times.values()),'verifier actual phase timing missing')
    need(value.get('case')==str(Path(runtime_case or case).absolute()),'verifier case identity differs')
    need(value.get('selection')==selection and value.get('sourceIdentity')==source_identity(controller),'verifier selected source differs')
    need(value.get('clientSHA256')==term.get('clientSHA256') and value.get('networkQualified') is False and value.get('sustainedTPSQualified') is False,'verifier scope/report binding differs')
    current=public_snapshot(case/'network');previous=value['publicSnapshot']
    need((current==previous if strict_filesystem else content_only(current)==content_only(previous)),'verifier evidence changed after complete checks')
    need(next(r['sha256'] for r in current['files'] if r['path']=='transactions-result.json')==value['clientSHA256'],'verifier client bytes differ')
    need(type(term.get('receiptWriteAndFsyncNs')) is int and term['receiptWriteAndFsyncNs']>0,'verifier receipt timing missing')
    meta=dict(schema=1,pid=pid,parentPID=parent,path=NAME,sha256=digest,clientSHA256=value['clientSHA256'],sourceIdentity=value['sourceIdentity'],checkerPasses=2,phaseTotalsNs=value['phaseTotalsNs'],receiptWriteAndFsyncNs=term['receiptWriteAndFsyncNs'])
    return value,meta

def after_client_exit(client,spawn,wait,command,log_path):
    state=client.poll();need(type(state) is int and state==0,'verifier requires known successful client exit')
    worker=spawn('verifier',command)
    try:wait(worker)
    except Exception as error:
        # Preserve resource/deadline first causes. Only enrich an actual failed
        # child exit with its own complete-checker diagnostic, never retry it.
        if worker.poll() is not None and worker.returncode!=0 and str(error).startswith('child failed:'):
            try:
                with Path(log_path).open('rb') as handle:raw=handle.read(65537)
                need(len(raw)<=65536,'verifier log bound')
                entries=[json.loads(line[len(MARKER):]) for line in raw.decode('utf-8').splitlines() if line.startswith(MARKER)]
                if len(entries)==1 and entries[0].get('complete') is False:raise RuntimeError('native verifier: '+str(entries[0].get('firstCause','UNKNOWN')))
            except (OSError,ValueError,UnicodeError):pass
        raise
    need(worker.poll()==0,'verifier child terminal UNKNOWN/nonzero')
    return worker

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--case',type=Path,required=True);p.add_argument('--selection',required=True);p.add_argument('--runtime-network',type=Path);a=p.parse_args()
    spec=importlib.util.spec_from_file_location('same_source_supply_verifier',Path(__file__).with_name('supply-linux-window.py'));controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
    try:produce(controller,a.case,controller.stream_evidence.strict_json(a.selection),a.runtime_network)
    except Exception as error:
        cause=str(error) if isinstance(error,(RuntimeError,OSError)) else type(error).__name__
        print(MARKER+json.dumps(dict(schema=1,complete=False,pid=os.getpid(),parentPID=os.getppid(),firstCause=cause,networkQualified=False,sustainedTPSQualified=False)),flush=True);raise SystemExit(1)

if __name__=='__main__':main()
