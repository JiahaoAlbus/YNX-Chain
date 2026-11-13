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


def prepared_ready(reply, owners, require):
    """Check Core's explicit static-only READY/v2, never command readiness."""
    def closed(value, fields, label):
        require(type(value) is dict and set(value)==set(fields.split()),
                'closed original prepared READY '+label+' required')
    def integer(value, maximum=(1<<63)-1):
        return type(value) is int and 0<=value<=maximum

    closed(reply,'version status owners startupElapsedNs signed nonceReserved bootstrapLoaded '
                 'syntheticOnly authorityGranted preparationTimings session','fields')
    require(reply['version']=='YNX-PQ-LAB-PUBLIC-OWNER-READY/v2'
            and reply['status']=='original_public_static_source_held'
            and type(reply['owners']) is list and reply['owners']==list(owners)
            and all(type(v) is int for v in reply['owners'])
            and integer(reply['startupElapsedNs'])
            and reply['signed'] is False and reply['nonceReserved'] is False
            and reply['bootstrapLoaded'] is True and reply['syntheticOnly'] is True
            and reply['authorityGranted'] is False,
            'original prepared public source READY differs; no command issued')
    timing=reply['preparationTimings']
    closed(timing,'version clock intervalsOverlap stages','preparation timings')
    require(timing['version']=='YNX-PQ-LAB-CALLEE-ELAPSED/v1'
            and timing['clock']=='monotonic_elapsed_wall_ns' and timing['intervalsOverlap'] is True
            and type(timing['stages']) is dict and 0<len(timing['stages'])<=128,
            'original static preparation timing schema differs')
    # Keep the original bounded metric map extensible for static subspans. No
    # current checkpoint, sender key or command may become preparation work.
    required={'lab.bootstrapFullValidation','lab.validatedMigrationOwnerBuild',
              'checkpoint.prepareStaticTotal','publicOwner.prepareSource'}
    require(required<=set(timing['stages']),'original static preparation stages differ')
    for name, stage in timing['stages'].items():
        require(type(name) is str and 0<len(name)<=128
                and not name.startswith('sender.')
                and (not name.startswith('checkpoint.') or name=='checkpoint.prepareStaticTotal')
                and name not in ('publicOwner.signTotal','publicOwner.confirmTotal','publicOwner.recoverTotal'),
                'prepared source timing includes command or current-checkpoint work')
        closed(stage,'calls elapsedNs','stage')
        require(integer(stage['calls'],(1<<64)-1) and stage['calls']>0
                and integer(stage['elapsedNs']), 'invalid original preparation stage timing')
        require(name not in required or stage['calls']==1,'original static preparation must occur once')

    session=reply['session']
    closed(session,'allowedOwners openedOwners commands commandLimit retired closed staticCache sourceInputs','session')
    require(integer(session['allowedOwners']) and session['allowedOwners']==len(owners)
            and integer(session['openedOwners']) and session['openedOwners']==0
            and integer(session['commands'],(1<<64)-1) and session['commands']==0
            and integer(session['commandLimit'],(1<<64)-1) and session['commandLimit']>0
            and session['retired'] is False and session['closed'] is False,
            'prepared original session already opened an owner or consumed commands')
    cache=session['staticCache'];source=session['sourceInputs']
    closed(cache,'scope entries heldFiles originalBytes hits misses bypasses closed','static cache')
    require(cache['scope']=='YNX-PQ-LAB-PUBLIC-STATIC-MATH/v1' and cache['closed'] is False
            and all(integer(cache[k],(1<<64)-1) for k in ('hits','misses','bypasses'))
            and all(integer(cache[k]) for k in ('entries','heldFiles','originalBytes')),
            'original prepared cache snapshot differs')
    closed(source,'scope state staticOriginalFiles staticOriginalBytes activationOriginalFiles '
                  'activationOriginalBytes cacheRetained cacheAdmissionReason cacheMaxBytes '
                  'cacheMaxFiles snapshotOnly','source inputs')
    require(source['scope']=='YNX-PQ-LAB-HELD-PUBLIC-INPUTS/v1' and source['snapshotOnly'] is True
            and integer(source['cacheMaxBytes']) and source['cacheMaxBytes']==32<<20
            and integer(source['cacheMaxFiles']) and source['cacheMaxFiles']==16
            and integer(source['staticOriginalFiles'],16) and source['staticOriginalFiles']>0
            and integer(source['staticOriginalBytes'],16<<30) and source['staticOriginalBytes']>0
            and integer(source['activationOriginalFiles']) and source['activationOriginalFiles']==0
            and integer(source['activationOriginalBytes']) and source['activationOriginalBytes']==0,
            'prepared source bounds or static-only footprint differ')
    retained=source['state']=='CACHE_ENTRY'
    require(source['state'] in ('CACHE_ENTRY','INVOCATION_HELD')
            and source['cacheRetained'] is retained,
            'original prepared public source is not held')
    count,size=source['staticOriginalFiles'],source['staticOriginalBytes']
    expected=(1,count,size) if retained else (0,0,0)
    reason='WITHIN_BOUNDS' if retained else 'BYTE_BOUND' if size>32<<20 else 'NOT_RETAINED_WITHIN_BOUNDS'
    require(tuple(cache[k] for k in ('entries','heldFiles','originalBytes'))==expected
            and (not retained or size<=32<<20) and source['cacheAdmissionReason']==reason,
            'original prepared source/cache admission differs')
    return reply


def read_prepared_ready(path, require):
    # Base.receive retains the exact line before decoding. Decode that original
    # again so duplicate fields/nonfinite numbers cannot disappear in json.loads.
    def fields(items):
        result={}
        for key,value in items:
            require(key not in result,'duplicate original prepared READY field')
            result[key]=value
        return result
    def constant(value):
        raise RuntimeError('nonfinite original prepared READY number')
    with open(path,'rb') as source:raw=source.read((2<<20)+1)
    require(0<len(raw)<=2<<20 and raw.endswith(b'\n') and raw.count(b'\n')==1,
            'one bounded original prepared READY line required')
    return json.loads(raw,object_pairs_hook=fields,parse_constant=constant)


def session_class(Base, normal, lab):
    class PublicOwnerSession(Base):
        def __init__(self, ceremony, owners, name='load-public-owners', *, prepare_source=False):
            indices=tuple(owners)
            lab.require(type(prepare_source) is bool,'explicit boolean static source preparation required')
            lab.require(0<len(indices)<=1000 and all(type(v) is int and 0<=v<1000 for v in indices)
                        and tuple(sorted(set(indices)))==indices,
                        'explicit ascending unique original owner indices required')
            lab.require(name and all(v.isalnum() or v in '-_' for v in name),'bounded original process label required')
            self.c=ceremony;self.owners=indices;self.name=name;self.prepare_source=prepare_source
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
                if prepare_source:args.append('--prepare-source')
                self.proc=ceremony.w.launch(name,normal.fd3_command(args,fd),True,
                                           pass_fds=(fd,),stdin_pipe=True,thread_safe=True)
            finally:
                os.close(fd)
            self.path=ceremony.w.work/'public'/(name+'.log')

        def wait_ready(self, stop, deadline, check):
            lab.require(self.ready is None,'original scope READY already consumed')
            path=self.c.w.work/'public'/(self.name+'-ready.json')
            if getattr(self,'prepare_source',False):
                self.receive(path,stop,'YNX-PQ-LAB-PUBLIC-OWNER-READY/v2',deadline,check)
                reply=prepared_ready(read_prepared_ready(path,lab.require),self.owners,lab.require)
                self.ready=dict(reply)
                return dict(reply)
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
                if operation in ('sign','confirm'):
                    # Operation IDs belong to an owner's custody scope. Two
                    # independent owners may legally use the same ID.
                    self.c.measurements.record(operation,(owner,identity),reply,owner=owner)
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
