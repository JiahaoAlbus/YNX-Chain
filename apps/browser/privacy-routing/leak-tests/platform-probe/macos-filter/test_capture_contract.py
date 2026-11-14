#!/usr/bin/env python3
"""Only new capture/HOME/EOF delta, exact owned helper+synthetic child; no vendor/NE/GUI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import selectors
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

HERE=Path(__file__).resolve().parent
DEFAULT=131072; MAXIMUM=16777216
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def expected(length,home=False):
    prefix=b'{"synthetic":"YNX_CAPTURE","homeVerified":'+(b'true' if home else b'false')+b',"padding":"'
    tail=b'","tail":"YNX_CAPTURE_TAIL"}\n'
    return prefix+b'x'*(length-len(prefix)-len(tail))+tail

class Run:
    def __init__(self,helper,fixture,directory,length,cap='missing',environment=None,policy='boundedCapture',arguments=None):
        directory.mkdir(mode=0o700);self.directory=directory;self.spool=directory/'backend.output';self.config=directory/'start.json'
        value={'schema':'P05_BACKEND_START_GATE_V1','runID':'capture-'+uuid.uuid4().hex[:12],'epoch':str(uuid.uuid4()),'target':str(fixture),'sha256':sha(fixture),'requirement':'identifier "GateCaptureFixture"','arguments':arguments if arguments is not None else [str(length)],'environment':environment or {},'keepStandardInputOpen':True,'output':'standardOutput','outputPolicy':policy,'spool':str(self.spool)}
        if cap!='missing':value['outputCaptureLimit']=cap
        self.config.write_text(json.dumps(value));self.config.chmod(0o600)
        self.process=subprocess.Popen([str(helper),str(self.config)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin'})
        self.selector=selectors.DefaultSelector();self.selector.register(self.process.stdout,selectors.EVENT_READ)
        self.pending=b'';self.frames=[];self.reader=None;self.child=None;self.exit=None
        self.record=None;self.flush=lambda:None
    def command(self,value):self.process.stdin.write((value+'\n').encode());self.process.stdin.flush()
    def frame(self,kind,timeout=15):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            for i,value in enumerate(self.frames):
                if value.get('kind')==kind:return self.frames.pop(i)
            if self.selector.select(.05):
                data=os.read(self.process.stdout.fileno(),8192)
                if not data:raise AssertionError('helperEOF before '+kind)
                self.pending+=data
                if len(self.pending)>65536:raise AssertionError('bounded control frame exceeded')
                while b'\n' in self.pending:
                    line,self.pending=self.pending.split(b'\n',1);self.frames.append(json.loads(line))
        raise AssertionError('timeout '+kind)
    def resume(self,cap,legacy=False):
        prepared=self.frame('prepared');self.child=prepared['pid']
        assert self.child>1 and prepared['state']=='post-exec-suspended'
        assert prepared['processPin']['pid']==self.child and prepared['processPin']['sha256']==self.fixture_sha
        if not legacy:assert type(prepared['outputCaptureLimit']) is int and prepared['outputCaptureLimit']==cap
        self.reader=self.spool.open('rb',buffering=0);self.spool.unlink()
        self.command('RESUME');self.frame('resumed')
        return prepared
    @property
    def fixture_sha(self):return self._fixture_sha
    @fixture_sha.setter
    def fixture_sha(self,value):self._fixture_sha=value
    def finish(self):
        self.exit=self.frame('exit',timeout=30);self.process.wait(timeout=5)
        assert self.exit['pid']==self.child and self.exit['childReaped'] is True and self.process.returncode==0
        body=self.reader.read();return body,self.exit
    def reject(self):
        stdout,stderr=self.process.communicate(timeout=8)
        assert self.process.returncode==78 and b'"prepared"' not in stdout
        assert not self.spool.exists() or self.spool.stat().st_size==0
        return {'helperPID':self.process.pid,'exit':78,'preparedObserved':False,'spoolBytes':self.spool.stat().st_size if self.spool.exists() else 0,'stderrBytes':len(stderr)}
    def cleanup(self):
        original_failure=sys.exc_info()[1]
        if original_failure is not None and self.record is not None:
            self.record.setdefault('firstCaseFailure',repr(original_failure));self.flush()
        try:
            if self.process.poll() is None:
                if self.process.stdin and not self.process.stdin.closed:self.process.stdin.close()
                try:self.process.wait(timeout=6)
                except subprocess.TimeoutExpired:
                    self.process.terminate() # Exact owned wrapper; its handler reaps its own child.
                    try:self.process.wait(timeout=6)
                    except subprocess.TimeoutExpired:raise RuntimeError('UNKNOWN exact owned helper '+str(self.process.pid)+' still live; wrapper not SIGKILLed')
            if self.child is not None and self.exit is None:
                # A failed case still owns the helper's real exit receipt. Drain
                # only after this exact wrapper exited; never signal child PIDs.
                remaining=self.pending+(self.process.stdout.read() if not self.process.stdout.closed else b'')
                candidates=list(self.frames)
                for line in remaining.splitlines():
                    try:candidates.append(json.loads(line))
                    except (ValueError,UnicodeDecodeError):pass
                self.exit=next((frame for frame in candidates if frame.get('kind')=='exit' and frame.get('pid')==self.child),None)
            if self.reader:self.reader.close()
            for pipe in [self.process.stdin,self.process.stdout,self.process.stderr]:
                if pipe and not pipe.closed:pipe.close()
            self.selector.close()
        finally:
            if self.record is not None:
                reaped=self.exit is not None and self.exit.get('pid')==self.child and self.exit.get('childReaped') is True
                self.record.update(helperExit=self.process.poll(),helperReaped=self.process.poll() is not None,
                    observedChildPID=self.child,childReapedReceipt=reaped if self.child is not None else None,
                    cleanupUnknown=self.process.poll() is None or (self.child is not None and not reaped))
                self.flush()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--old-helper',type=Path,help='Optional exact immutable old20 artifact; absent baseline is NOT_SUPPLIED, not PASS');args=parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():parser.error('Fresh absolute external output required')
    if args.old_helper and (not args.old_helper.is_absolute() or not args.old_helper.is_file()):parser.error('Actual old20 helper path required when supplied')
    machine=platform.machine()
    if platform.system()!='Darwin' or machine not in ('arm64','x86_64'):parser.error('Native macOS required')
    output=args.output;output.mkdir(mode=0o700)
    alias=Path(tempfile.mkdtemp(prefix='ynx-capture-',dir='/private/tmp'));alias.rmdir();alias.symlink_to(output,target_is_directory=True)
    home=str(Path(pwd.getpwuid(os.getuid()).pw_dir).resolve()) # Directory identity only, never list/read user files.
    st=os.stat(home)
    if st.st_uid!=os.getuid() or st.st_mode&0o022:raise RuntimeError('Actual own HOME directory fails helper policy; no permission change permitted')
    source=[HERE/n for n in ['BackendStartGate.m','IdentityBridge.c','IdentityBridge.h','OwnedBackendStartGate.swift','GateCaptureFixture.c','CaptureSpecSelfTest.swift','test_capture_contract.py']]
    inputs={str(p):sha(p) for p in source}
    snapshot=output/'source';snapshot.mkdir()
    for p in source:shutil.copy2(p,snapshot/p.name)
    receipt={'schema':'P05_CAPTURE_CONTRACT_DELTA_V1','inputs':inputs,'oldHelper':str(args.old_helper) if args.old_helper else None,'oldHelperSHA256':sha(args.old_helper) if args.old_helper else None,'oldHelperBytes':args.old_helper.stat().st_size if args.old_helper else None,'baselineStatus':'SUPPLIED_FOR_ACTUAL_NEGATIVES' if args.old_helper else 'NOT_SUPPLIED','commands':[],'cases':[],'ownedRuns':[],'scope':'Exact Popen-owned helpers and generated synthetic stdout children only; HOME path metadata only; no HOME contents/env dump/user files/network/vendor/NE/GUI','actualNE':'NOT_RUN','productionRouteAdmission':False,'old7OrQualification8Rerun':False}
    def save():(output/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
    def command(argv,label):
        receipt['commands'].append(argv);save()
        r=subprocess.run(argv,text=True,capture_output=True,timeout=90)
        (output/(label+'.stdout')).write_text(r.stdout);(output/(label+'.stderr')).write_text(r.stderr);receipt[label+'Exit']=r.returncode;save();r.check_returncode()
    def child(helper,name,length,cap='missing',environment=None,policy='boundedCapture',arguments=None):
        r=Run(helper,(output/'GateCaptureFixture').resolve(),output/name,length,cap,environment,policy,arguments);r.fixture_sha=sha(output/'GateCaptureFixture')
        r.record={'case':name,'helperPID':r.process.pid,'helperReaped':False,'cleanupUnknown':True}
        receipt['ownedRuns'].append(r.record);r.flush=save;save();return r
    def reject(helper,name,**kw):
        r=child(helper,name,128,**kw)
        try:row=r.reject();row['case']=name;receipt['cases'].append(row);save()
        finally:r.cleanup()
    def capture(helper,name,length,cap,home_set=False,legacy=False,overflow=False):
        r=child(helper,name,length,cap,{'HOME':home} if home_set else {})
        try:
            prepared=r.resume(cap if cap!='missing' else DEFAULT,legacy=legacy);body,end=r.finish()
            row={'case':name,'helperPID':r.process.pid,'childPID':r.child,'childReaped':end['childReaped'],'helperExit':r.process.returncode,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'exitReceipt':end,'preparedCap':prepared.get('outputCaptureLimit','legacy-missing')}
            if overflow:
                assert any(f.get('kind')=='refused' and f.get('operation')=='bounded-backend-output' for f in r.frames)
                assert len(body)<=DEFAULT and not body.endswith(b'YNX_CAPTURE_TAIL"}\n')
                if not legacy:assert end['outputCaptureComplete'] is False
                row['expectedOverflowRefusal']=True
            else:
                assert body==expected(length,home_set) and json.loads(body)['tail']=='YNX_CAPTURE_TAIL'
                assert end['outputCaptureComplete'] is True and type(end['outputCaptureLimit']) is int and end['outputCaptureLimit']==cap and type(end['capturedBytes']) is int and end['capturedBytes']==length
                row['exactSyntheticJSONTail']=True;row['normalEOFComplete']=True
            receipt['cases'].append(row);save()
        finally:r.cleanup()
    try:
        sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip();receipt['sdk']=sdk
        command(['xcrun','clang','-isysroot',sdk,str(alias/'source/GateCaptureFixture.c'),'-o',str(alias/'GateCaptureFixture')],'compile-fixture')
        # Actual immutable old20 bytes: retain both defects before testing successor.
        if args.old_helper:
            reject(args.old_helper,'old20-HOME-refused',environment={'HOME':home})
            capture(args.old_helper,'old20-raised-ignored-truncates',1048576,MAXIMUM,legacy=True,overflow=True)
            receipt['baselineStatus']='ACTUAL_OLD20_NEGATIVES_RETAINED'
        command(['xcrun','clang','-isysroot',sdk,'-mmacosx-version-min=14.0','-Wno-deprecated-declarations','-c',str(alias/'source/IdentityBridge.c'),'-o',str(alias/'IdentityBridge.o')],'compile-identity')
        command(['xcrun','clang','-fobjc-arc','-isysroot',sdk,'-mmacosx-version-min=14.0','-Wno-deprecated-declarations',str(alias/'source/BackendStartGate.m'),str(alias/'IdentityBridge.o'),'-framework','Foundation','-framework','Security','-lbsm','-o',str(alias/'YNXBackendStartGate')],'compile-current-helper')
        helper=alias/'YNXBackendStartGate'
        capture(helper,'new-default-overflow-refused',1048576,'missing',overflow=True)
        capture(helper,'new-one-MiB-HOME-complete',1048576,1048576,home_set=True)
        capture(helper,'new-directory-shape-complete',2721227,MAXIMUM,home_set=True)
        reject(helper,'new-fake-HOME-refused',environment={'HOME':'/PUBLIC-NOT-OWN-HOME'})
        reject(helper,'new-unknown-env-refused',environment={'UNREVIEWED_CAPTURE_KEY':'synthetic'})
        reject(helper,'new-NUL-env-refused',environment={'YNX_CAPTURE_TEST':'a\x00b'})
        reject(helper,'new-NUL-argument-refused',arguments=['128\x00synthetic'])
        for label,value in [('bool',True),('string','131072'),('negative',-1),('fraction',1.5),('zero',0),('over-max',MAXIMUM+1),('null',None)]:
            reject(helper,'new-cap-'+label+'-refused',cap=value)
        reject(helper,'new-discard-raised-refused',cap=1048576,policy='discardAfterBootstrap')
        # Compile the actual tiny spec/error source slices, not the whole target
        # or an invented implementation of their validation methods.
        gate=(snapshot/'OwnedBackendStartGate.swift').read_text();prefix=gate[:gate.index('public struct PreparedBackendIdentity')]
        failure=next(line for line in gate.splitlines() if line.startswith('public struct BackendStartGateFailure:'))
        (output/'ActualCaptureSpec.swift').write_text(prefix+'\n'+failure+'\n')
        command(['xcrun','swiftc','-parse-as-library','-swift-version','6','-sdk',sdk,'-target',machine+'-apple-macosx14.0','-module-cache-path',str(output.parent/'C-module-cache'),str(alias/'ActualCaptureSpec.swift'),str(alias/'source/CaptureSpecSelfTest.swift'),'-o',str(alias/'CaptureSpecProbe')],'compile-actual-spec')
        command([str(alias/'CaptureSpecProbe')],'new-spec-ack')
        receipt['specAck']=json.loads((output/'new-spec-ack.stdout').read_text())
        receipt['sourceDrift']={str(p):sha(p) for p in source}!=inputs
        receipt['oldHelperUnchanged']=sha(args.old_helper)==receipt['oldHelperSHA256'] if args.old_helper else None
        receipt['newHelperSHA256']=sha(output/'YNXBackendStartGate');receipt['fixtureSHA256']=sha(output/'GateCaptureFixture')
        if receipt['sourceDrift'] or (args.old_helper and not receipt['oldHelperUnchanged']):raise RuntimeError('Source/helper drift')
        receipt['allOwnedHelpersExited']=all(row['helperReaped'] for row in receipt['ownedRuns'])
        receipt['inFlightUnknown']=any(row['cleanupUnknown'] for row in receipt['ownedRuns'])
        if receipt['inFlightUnknown']:raise RuntimeError('UNKNOWN exact helper/child cleanup; preserve recorded handles')
        receipt['codesignInvoked']=False
    except BaseException as error:
        original=next((row['firstCaseFailure'] for row in receipt['ownedRuns'] if 'firstCaseFailure' in row),repr(error))
        receipt['firstFailure']=original;receipt['terminalFailure']=repr(error);raise
    finally:save()
    print(json.dumps({'receipt':str(output/'receipt.json'),'cases':len(receipt['cases']),'specChecks':receipt['specAck']['checks'],'actualNE':'NOT_RUN'}))

if __name__=='__main__':main()
