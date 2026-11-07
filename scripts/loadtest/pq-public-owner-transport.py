"""Consumer for Core's normal sender-owners stream; no runtime profile activation.

The Go CLI processes one JSONL command at a time. Serialize the complete
write/read pair, rather than allowing concurrent Python readers to steal an
owner's reply. EOF/cancellation never retries a command or releases a nonce.
"""
import json
import os
import stat
import threading
import time


def session_class(Base, normal, lab):
    class PublicOwnerSession(Base):
        def __init__(self, ceremony, owners, name='load-public-owners'):
            indices=tuple(owners)
            lab.require(0<len(indices)<=1000 and all(type(v) is int and 0<=v<1000 for v in indices)
                        and tuple(sorted(set(indices)))==indices,
                        'explicit ascending unique original owner indices required')
            lab.require(name and all(v.isalnum() or v in '-_' for v in name),'bounded original process label required')
            self.c=ceremony;self.owners=indices;self.name=name
            self.offset=0;self.partial=b'';self.ready=None
            self.lock=threading.Lock();self.poisoned=False
            self.trace_lock=threading.Lock();self.traces=[];self.attempts=0
            self.launched_ns=time.monotonic_ns()
            fd=os.open(ceremony.root/'workload/private-senders/recovery.raw',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
            try:
                st=os.fstat(fd)
                lab.require(stat.S_ISREG(st.st_mode) and st.st_size==32 and st.st_mode&0o077==0 and st.st_nlink==1,
                            'original private credential required')
                args=[str(ceremony.bins/'ynx-consensus-pq-lab'),'sender-owners','--synthetic',
                      '--root',str(ceremony.root),'--plan-sha256',ceremony.pin,
                      '--activation-sha256',ceremony.activation_pin,'--workload-sha256',ceremony.workload_pin,
                      '--owners',','.join(map(str,indices)),'--ready','--timings','--credential-fd','3']
                self.proc=ceremony.w.launch(name,normal.fd3_command(args,fd),True,
                                           pass_fds=(fd,),stdin_pipe=True,thread_safe=True)
            finally:
                os.close(fd)
            self.path=ceremony.w.work/'public'/(name+'.log')

        def wait_ready(self, stop, deadline, check):
            lab.require(self.ready is None,'original scope READY already consumed')
            path=self.c.w.work/'public'/(self.name+'-ready.json')
            reply=self.receive(path,stop,'YNX-PQ-LAB-PUBLIC-OWNER-READY/v1',deadline,check)
            lab.require(reply.get('status')=='original_public_scope_held'
                        and reply.get('owners')==list(self.owners)
                        and all(type(v) is int for v in reply.get('owners',[]))
                        and reply.get('syntheticOnly') is True and reply.get('authorityGranted') is False
                        and all(reply.get(k) is False for k in ('signed','nonceReserved','bootstrapLoaded'))
                        and type(reply.get('startupElapsedNs')) is int and reply['startupElapsedNs']>=0,
                        'original public scope READY differs; no command issued')
            self.ready=dict(reply)
            return dict(reply)

        def exchange(self, command, path, stop, prepare_command=None):
            lab.require(self.ready is not None,'original public scope READY required')
            operation=command.get('operation');request=command.get('request',{})
            owner=request.get('ownerIndex');identity=request.get('operationId')
            lab.require(type(owner) is int and owner in self.owners
                        and operation in ('sign','recover','confirm','close-owner')
                        and type(identity) is str and (bool(identity) or operation=='close-owner'),
                        'original owner and operation binding required')
            # Reuse the exact existing command ABI, preserving field order.
            acquired=False
            trace=dict(ownerIndex=owner,operationId=identity,operation=operation,
                       requestedMonotonicNs=time.monotonic_ns())
            with self.trace_lock:self.attempts+=1
            try:
                while not stop.is_set():
                    if self.lock.acquire(timeout=.02):acquired=True;break
                lab.require(acquired and not stop.is_set(),'canceled before original command; preserve UNKNOWN')
                trace['streamAcquiredMonotonicNs']=time.monotonic_ns()
                lab.require(not self.poisoned and self.proc.poll() is None,
                            'original stream unavailable; recover originals, never replay')
                if prepare_command is not None:
                    command=prepare_command()
                    lab.require(command.get('operation')==operation and command.get('request')==request,
                                'checkpoint preparation changed original request; no command issued')
                lab.require(not stop.is_set(),'canceled before original write; preserve UNKNOWN')
                raw=json.dumps(command,separators=(',',':')).encode()+b'\n'
                lab.require(len(raw)<32<<10,'original Go scanner command bound')
                # Any uncertain write/read poisons this stream. A later call
                # cannot mistake its delayed reply for another operation.
                self.poisoned=True
                trace['commandRequestedMonotonicNs']=time.monotonic_ns()
                self.proc.stdin.write(raw);self.proc.stdin.flush()
                reply=self.receive(path,stop,'YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1')
                trace['replyReceivedMonotonicNs']=time.monotonic_ns()
                allowed={'sign':('ORIGINAL_SAVED',),'recover':('ORIGINAL_RECOVERED',),
                         'confirm':('PROOF_CONFIRMED_DATA',),'close-owner':('OWNER_RETIRED',)}
                lab.require(type(reply.get('ownerIndex')) is int and reply['ownerIndex']==owner
                            and reply.get('operationId')==identity
                            and reply.get('code') in (*allowed[operation],'UNKNOWN','REJECTED'),
                            'original reply owner/operation/outcome differs; preserve UNKNOWN')
                if operation!='close-owner':
                    self.c.measurements.record(operation,identity,reply,owner=owner)
                self.poisoned=False
                trace['code']=reply['code']
                return reply
            except BaseException as error:
                trace['errorType']=type(error).__name__
                raise
            finally:
                if acquired:self.lock.release()
                trace['returnedMonotonicNs']=time.monotonic_ns()
                with self.trace_lock:
                    if len(self.traces)<2048:self.traces.append(trace)

        def transport_report(self):
            with self.trace_lock:
                return dict(schema='YNX-PERF-PUBLIC-OWNER-TRANSPORT/v1',clock='parent_monotonic_ns',
                            attempted=self.attempts,retained=len(self.traces),omitted=self.attempts-len(self.traces),
                            records=[dict(v) for v in self.traces],recordLimit=2048,
                            meaning='Queue wait and write-to-reply are parent observations; nested Go callee timings overlap. Missing replies remain unknown; these records do not qualify business finality.',
                            automaticRetry=False,authorityGranted=False)
    return PublicOwnerSession
