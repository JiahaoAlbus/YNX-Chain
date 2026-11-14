#!/usr/bin/env python3
"""New real owned-helper output/cleanup delta; no vendor, fake NE ACK, install or outside network."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import selectors
import socket
import subprocess
import time
import uuid

HERE = Path(__file__).resolve().parent
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

class Child:
    def __init__(self, helper, fixture, directory, policy):
        self.directory=directory;directory.mkdir(mode=0o700)
        self.spool=directory/'backend.output';config=directory/'start.json'
        self.run='output-'+uuid.uuid4().hex[:12];self.epoch=str(uuid.uuid4())
        config.write_text(json.dumps({'schema':'P05_BACKEND_START_GATE_V1','runID':self.run,'epoch':self.epoch,'target':str(fixture),'sha256':sha(fixture),'requirement':'identifier "GateOutputFixture"','arguments':[],'environment':{},'keepStandardInputOpen':True,'output':'standardOutput','outputPolicy':policy,'spool':str(self.spool)}));config.chmod(0o600)
        self.process=subprocess.Popen([str(helper),str(config)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin'})
        self.selector=selectors.DefaultSelector();self.selector.register(self.process.stdout,selectors.EVENT_READ)
        self.pending=b'';self.frames=[];self.reader=None
        self.prepared=self.wait('prepared');self.pid=self.prepared['pid']
        assert self.prepared['state']=='post-exec-suspended'
        assert self.prepared['processPin']['sha256']==sha(fixture) and self.spool.stat().st_size==0
        self.token=hashlib.sha256(bytes.fromhex(self.prepared['processPin']['auditTokenHex'])).hexdigest()
        self.reader=self.spool.open('rb',buffering=0);self.spool.unlink()
        assert not self.spool.exists() and not config.exists()
    def command(self,value): self.process.stdin.write((value+'\n').encode());self.process.stdin.flush()
    def wait(self,kind,timeout=8):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            for i,value in enumerate(self.frames):
                if value.get('kind')==kind:return self.frames.pop(i)
                if value.get('kind')=='refused' and kind not in ('refused','exit'):raise AssertionError(value)
            if self.selector.select(.05):
                data=os.read(self.process.stdout.fileno(),8192)
                if not data:raise AssertionError('helper EOF before '+kind)
                self.pending+=data;assert len(self.pending)<=65536
                while b'\n' in self.pending:
                    line,self.pending=self.pending.split(b'\n',1);self.frames.append(json.loads(line))
        raise AssertionError('timeout '+kind)
    def resume(self):
        self.command('RESUME');self.wait('resumed')
        raw=b'';end=time.monotonic()+3
        while b'\n' not in raw and time.monotonic()<end:raw+=self.reader.read() or b'';time.sleep(.005)
        self.line=raw.split(b'\n')[0].removesuffix(b'\r')
        # Python3.9-compatible exact raw line hash, without LF/optional CR; no JSON re-encoding.
        self.marker=hashlib.sha256(self.line).hexdigest();self.ready=json.loads(self.line)
        assert self.ready['pid']==self.pid and self.ready['fixtureReady'] is True
    def drop(self,token=None,marker=None):
        nonce=str(uuid.uuid4());self.command('DROP_OUTPUT '+(token or self.token)+' '+nonce+' '+(marker or self.marker));return nonce
    def request(self,command):
        connection=socket.create_connection(('127.0.0.1',self.ready['port']),timeout=8);connection.sendall(command);return connection
    def stop(self,mode='STOP'):
        if mode=='EOF':self.process.stdin.close()
        else:self.command('STOP')
        value=self.wait('exit');self.process.wait(timeout=4)
        assert value['pid']==self.pid and value['childReaped'] is True and self.process.returncode==0
        return value
    def cleanup(self):
        if self.process.poll() is None:
            if not self.process.stdin.closed:self.process.stdin.close()
            try:self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:self.process.terminate();self.process.wait(timeout=5)
        if self.reader:self.reader.close()
        self.process.stdout.close();self.process.stderr.close();self.selector.close()

def cases(helper,fixture,out,receipt):
    child=Child(helper,fixture,out/'discard-before-resume-refused','discardAfterBootstrap')
    try:
        child.drop(marker='0'*64);refusal=child.wait('refused');assert refusal['operation']=='output-discard-boundary'
        exit=child.wait('exit');child.process.wait(timeout=4);assert exit['childReaped'] and os.fstat(child.reader.fileno()).st_size==0
        receipt['cases'].append({'case':'discard-before-resume-refused','refusal':refusal,'childExit':exit,'capturedBytes':0})
    finally:child.cleanup()
    for name,policy,invalid in [('auxiliary-capability-refused','boundedCapture','policy'),('wrong-token-refused','discardAfterBootstrap','token'),('uncaptured-marker-refused','discardAfterBootstrap','marker')]:
        child=Child(helper,fixture,out/name,policy)
        try:
            child.resume();child.drop(token='0'*64 if invalid=='token' else None,marker='0'*64 if invalid=='marker' else None)
            refusal=child.wait('refused');assert refusal['operation']=='output-discard-boundary'
            exit=child.wait('exit');child.process.wait(timeout=4);assert exit['childReaped'] and child.process.returncode==0
            receipt['cases'].append({'case':name,'refusal':refusal,'childExit':exit})
        finally:child.cleanup()
    child=Child(helper,fixture,out/'capture-limit-preserved','boundedCapture')
    try:
        child.resume();connection=child.request(b'F')
        try:
            refusal=child.wait('refused');assert refusal['operation']=='bounded-backend-output'
            exit=child.wait('exit');child.process.wait(timeout=4);assert exit['childReaped'] and os.fstat(child.reader.fileno()).st_size<=131072
            receipt['cases'].append({'case':'capture-limit-preserved','refusal':refusal,'childExit':exit,'capturedMaximumBytes':os.fstat(child.reader.fileno()).st_size})
        finally:connection.close()
    finally:child.cleanup()
    for end in ['STOP','EOF']:
        child=Child(helper,fixture,out/('long-lived-'+end.lower()),'discardAfterBootstrap')
        try:
            child.resume();nonce=child.drop();ack=child.wait('output-discarding')
            assert ack['pid']==child.pid and ack['runID']==child.run and ack['epoch']==child.epoch and ack['backendTokenSHA256']==child.token and ack['markerSHA256']==child.marker and ack['requestNonce']==nonce and ack['state']=='discarding'
            assert ack['capturedBytes']<=131072 and os.fstat(child.reader.fileno()).st_size==0 and not child.spool.exists()
            connection=child.request(b'F')
            try:assert connection.recv(4)==b'DONE'
            finally:connection.close()
            until=time.monotonic()+3
            while True:
                child.command('STATUS');status=child.wait('status')
                if status['discardedBytes']==2097152 or time.monotonic()>=until:break
                time.sleep(.01) # Read-only counter observation, not another lifecycle action.
            assert status['state']=='running' and status['outputState']=='discarding' and status['discardedBytes']==2097152 and child.process.poll() is None
            connection=child.request(b'C')
            try:assert connection.recv(6)==b'CLOSED'
            finally:connection.close()
            child.command('STATUS');closed=child.wait('status');assert closed['state']=='running'
            exit=child.stop(end)
            receipt['cases'].append({'case':'long-lived-'+end.lower(),'discardAcknowledgement':ack,'afterTwoMiB':status,'afterOutputEOF':closed,'childExit':exit,'anonymousPrefixErased':True,'spoolPathAbsent':True})
        finally:child.cleanup()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    assert args.output.is_absolute() and not args.output.exists();args.output.mkdir(mode=0o700)
    inputs=[HERE/name for name in ['BackendStartGate.m','IdentityBridge.c','IdentityBridge.h','GateOutputFixture.c','OwnedBackendStartGate.swift','test_output_discard.py']]
    receipt={'schema':'P05_OWNED_OUTPUT_DISCARD_DELTA_V1','sourceInputs':{str(p):sha(p) for p in inputs},'commands':[],'cases':[],'productionRouteAdmission':False,'actualNE':'NOT_RUN','scope':'Only exact Popen-owned synthesized children and their generated loopback listeners; no vendor/user/network traffic'}
    path=args.output/'receipt.json'
    try:
        sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip();receipt['sdk']=sdk
        obj=args.output/'IdentityBridge.o';helper=args.output/'YNXBackendStartGate';fixture=args.output/'GateOutputFixture'
        commands=[['xcrun','clang','-isysroot',sdk,'-mmacosx-version-min=14.0','-Wno-deprecated-declarations','-c',str(HERE/'IdentityBridge.c'),'-o',str(obj)],['xcrun','clang','-fobjc-arc','-isysroot',sdk,'-mmacosx-version-min=14.0','-Wno-deprecated-declarations',str(HERE/'BackendStartGate.m'),str(obj),'-framework','Foundation','-framework','Security','-lbsm','-o',str(helper)],['xcrun','clang','-isysroot',sdk,str(HERE/'GateOutputFixture.c'),'-o',str(fixture)]]
        for command in commands:
            run=subprocess.run(command,text=True,capture_output=True,timeout=60);receipt['commands'].append({'argv':command,'exit':run.returncode,'stdout':run.stdout,'stderr':run.stderr});path.write_text(json.dumps(receipt,indent=2)+'\n');run.check_returncode()
        receipt.update(helperSHA256=sha(helper),fixtureSHA256=sha(fixture),codesignInvoked=False,automaticLinkerAdHocIsNotAuthorizedSigning=True)
        cases(helper,fixture,args.output,receipt)
        receipt['sourceDrift']={str(p):sha(p) for p in inputs}!=receipt['sourceInputs'];assert not receipt['sourceDrift'];receipt['controlledOutputContract']=True
    except BaseException as error:receipt['firstFailure']=repr(error);raise
    finally:path.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'receipt':str(path),'cases':len(receipt['cases']),'controlledOutputContract':True,'actualNE':'NOT_RUN'}))
if __name__=='__main__':main()
