"""Opt-in bounded Linux header-only capture of ORIGINAL owned test tuples.

No setns/unshare/sudo/promiscuous mode; shared/unproven namespaces fail closed.
SOCK_DGRAM strips link headers. Read buffers are40 bytes, never TCP payload.
See packet(7) and kernel networking/filter.rst for protocol0/MSG_TRUNC/BPF.
"""
import ctypes
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import socket
import struct
import sys
import threading
import time

MAX_FLOWS=32
MAX_PACKETS=65536
MAX_IP_BYTES=256<<20
MAX_SECONDS=120
PREFIX_BYTES=40

def require(ok,reason):
    if not ok:raise ValueError(reason)
def frozen_tcp():
    path=Path(__file__).with_name('pq-hop-byte-accounting.py');spec=importlib.util.spec_from_file_location('header_existing_hops',path);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h);return h.original('owned-tcp-accounting.py')
def tuple_key(row):return (row['localAddress'],row['localPort'],row['remoteAddress'],row['remotePort'])

def original_flow_scope(tcp,sample):
    _,nodes=tcp._validate_sample(sample)
    flows={};identities=[]
    for name,(node,identity,sockets) in nodes.items():
        identities.append(dict(name=name,pid=node['pid'],startTicks=node['startTicks'],netns=node['netns'],userns=node['userns']))
        for row in sockets.values():
            require(row['scope']==tcp.P2P and row['family']==socket.AF_INET,'capture requires only original registered IPv4 P2P tuples')
            require(all(ipaddress.ip_address(x).is_loopback for x in (row['localAddress'],row['remoteAddress'])),'capture refuses non-loopback tuple')
            key=tuple_key(row);require(key not in flows,'ambiguous original tuple')
            flows[key]=dict(source=name,target=row['peerNode'],sourcePID=node['pid'],sourceStartTicks=node['startTicks'],inode=row['inode'],cookie=row['cookie'],netns=node['netns'])
    require(0<len(flows)<=MAX_FLOWS,'bounded original flow set required')
    for key,row in flows.items():
        reverse=flows.get((key[2],key[3],key[0],key[1]));require(reverse is not None and reverse['source']==row['target'] and reverse['target']==row['source'],'original reverse owned tuple required')
    return flows,identities

def owned_namespace_identity(tcp,sample):
    require(sample['launcher']['pid']==os.getpid(),'capture must stay in the original supervisor')
    guard=tcp._guard();deadline=time.monotonic()+3;rows,_=tcp._inventory(guard,deadline)
    receipts=[dict(name=n['name'],pid=n['pid'],startTicks=n['startTicks']) for n in sample['nodes']]
    tcp.validate_owned_receipts(rows,os.getpid(),receipts,guard)
    owned=set(guard.owned_set(rows,os.getpid()));identities=[]
    for expected in [sample['launcher'],*sample['nodes']]:
        pid=expected['pid'];require(pid in owned and str(rows[pid]['startTicks'])==str(expected['startTicks']),'original PID/startTicks identity changed')
        # Read ONLY the actual launcher/registered original node namespaces.
        # PID1 is never a default namespace source or an extra candidate.
        actual=tcp._process_identity(pid)
        require(all(actual[key]==expected[key] for key in ('uid','processUIDs','netns','userns')),'original owned process namespace/UID identity changed')
        require(actual['netns']==sample['launcher']['netns'] and actual['userns']==sample['launcher']['userns'],'original owned nodes are not in supervisor namespace')
        identities.append(dict(pid=pid,startTicks=expected['startTicks'],netns=actual['netns'],userns=actual['userns']))
    return dict(netns=sample['launcher']['netns'],userns=sample['launcher']['userns'],originalOwnedIdentities=identities,namespaceIdentitySource='actual launcher and registered owned PID/startTicks only',foreignVisibleProcessCount=len(set(rows)-owned),foreignNamespacesRead=False)

def exclusive_current_namespace(tcp,sample):
    proof=owned_namespace_identity(tcp,sample)
    # Stronger than trying to inspect init/foreign namespaces: if the visible
    # inventory is not exclusively ours, dedicated scope is unproven. Do not
    # replace an EACCES with a guessed shared namespace or a broader capture.
    require(proof['foreignVisibleProcessCount']==0,'DEDICATED_CONTROLLED_TEST_NAMESPACE_NOT_SUPPLIED: foreign visible process scope unproven; no foreign namespace read')
    return dict(**proof,exclusiveToOriginalSupervisor=True,exclusivityEvidence='original visible PID inventory all owned; external scope remains operator responsibility')

def bpf_program(flows):
    require(0<len(flows)<=MAX_FLOWS,'bounded exact tuples required')
    # cBPF for cooked IPv4: no options/fragments, TCP base header >=20.
    # Conditional skips are local<=7, never an overflowing255-instruction jump.
    code=[(0x30,0,0,0),(0x15,1,0,0x45),(0x06,0,0,0),
          (0x30,0,0,9),(0x15,1,0,6),(0x06,0,0,0),
          (0x28,0,0,6),(0x45,0,1,0x3fff),(0x06,0,0,0),
          (0x28,0,0,2),(0x35,1,0,40),(0x06,0,0,0),
          (0x30,0,0,32),(0x54,0,0,0xf0),(0x35,1,0,0x50),(0x06,0,0,0)]
    for src,sport,dst,dport in sorted(flows):
        a=int(ipaddress.IPv4Address(src));b=int(ipaddress.IPv4Address(dst))
        code.extend([(0x20,0,0,12),(0x15,0,7,a),(0x20,0,0,16),(0x15,0,5,b),(0x28,0,0,20),(0x15,0,3,sport),(0x28,0,0,22),(0x15,0,1,dport),(0x06,0,0,0xffffffff)])
    code.append((0x06,0,0,0));return code

def attach_filter(sock,code):
    class Filter(ctypes.Structure):_fields_=[('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint32)]
    class Program(ctypes.Structure):_fields_=[('length',ctypes.c_ushort),('filters',ctypes.POINTER(Filter))]
    instructions=(Filter*len(code))(*(Filter(*row) for row in code));program=Program(len(code),instructions)
    sock.setsockopt(socket.SOL_SOCKET,26,bytes(program)) # Linux SO_ATTACH_FILTER
    sock.setsockopt(socket.SOL_SOCKET,44,1) # Linux SO_LOCK_FILTER; no later widening

def parse_prefix(raw,original_ip_bytes):
    require(len(raw)==40 and raw[0]==0x45 and raw[9]==6,'unsupported/truncated IPv4 TCP base header')
    total=struct.unpack_from('!H',raw,2)[0];fragment=struct.unpack_from('!H',raw,6)[0];tcp_header=(raw[32]>>4)*4
    require(fragment&0x3fff==0 and 20<=tcp_header<=60 and total==original_ip_bytes and total>=20+tcp_header,'fragment/offload length or TCP header is not supported')
    src=str(ipaddress.IPv4Address(raw[12:16]));dst=str(ipaddress.IPv4Address(raw[16:20]));sport,dport=struct.unpack_from('!HH',raw,20)
    return dict(tuple=(src,sport,dst,dport),kernelIpBytes=total,tcpHeaderBytes=tcp_header,tcpPayloadBytes=total-20-tcp_header,flags=raw[33])

class OwnedHeaderCapture:
    def __init__(self,sample,public,max_seconds):
        require(0<max_seconds<=MAX_SECONDS,'bounded header capture duration required')
        self.sample=sample;self.public=Path(public);self.max_seconds=max_seconds;self.sock=None;self.stream=None;self.thread=None;self.stop_event=threading.Event();self.started=False;self.closed=False;self.flows={};self.hops={}
        self.result=dict(schema='YNX-PERF-OWNED-HEADER-CAPTURE/v1',status='NOT_SUPPLIED',reason=None,firstCause=None,packetCaptureExecuted=False,captureStartedMonotonicNs=None,captureStoppedMonotonicNs=None,kernelPacketStatistics=None,kernelIpBytes=None,outgoingPackets=None,ignoredIncomingEndpointCopies=None,unsupportedPackets=None,matchedFlowCaptureComplete=False,allTrafficCoverageComplete=False,physicalBytesMeasured=False,physicalWireBytes=None,actualPerTransactionBytes=None,perTransactionAttribution='UNKNOWN: encrypted/multiplexed P2P channels and background not separated',headersOnlyPrefixBytes=40,linkLayer='removed by Linux SOCK_DGRAM; loopback/virtual headers and offloads are not physical wire',retransmissions='included in captured IP datagrams; independent original TCP retransmission counter is not added/subtracted',handshakes='only SYN/FIN/RST flags actually seen within selected existing tuple capture; pre-start/born-closed connections not covered',scope='original controlled same-host IPv4 loopback test namespace/owned PID exact4tuple only',maxPackets=MAX_PACKETS,maxIpBytes=MAX_IP_BYTES,maxSeconds=max_seconds,pcapTimestampMeaning='receiver realtime read clock for raw artifact display; phase bounds use original parent CLOCK_MONOTONIC',backgroundSeparable=False,independentFinality=False)
    def fail(self,reason,error_type=None):
        if self.result['firstCause'] is None:self.result['firstCause']=reason
        self.result['reason']=self.result['firstCause']
        if error_type is not None:self.result['errorType']=error_type
    def start(self):
        began=time.monotonic_ns()
        try:
            require(sys.platform=='linux' and hasattr(socket,'AF_PACKET'),'LINUX_AF_PACKET_NOT_AVAILABLE')
            tcp=frozen_tcp();self.tcp=tcp;self.flows,self.identities=original_flow_scope(tcp,self.sample)
            self.result['ownedNamespaceIdentity']=owned_namespace_identity(tcp,self.sample)
            self.result['controlledNamespace']=exclusive_current_namespace(tcp,self.sample)
            self.sock=socket.socket(socket.AF_PACKET,socket.SOCK_DGRAM,0) # protocol0 receives NOTHING
            self.sock.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,256<<10);self.sock.settimeout(.05)
            code=bpf_program(self.flows);attach_filter(self.sock,code)
            self.result['filterSHA256']=hashlib.sha256(b''.join(struct.pack('=HBBI',*row) for row in code)).hexdigest()
            path=self.public/'network-owned-header-original.pcap'
            descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            self.stream=os.fdopen(descriptor,'wb')
            self.stream.write(struct.pack('<IHHIIII',0xa1b23c4d,2,4,0,0,40,101)) # nano-PCAP, LINKTYPE_RAW
            self.sock.bind(('lo',0x0800)) # only NOW starts scoped IPv4 reception
            # Conservative bracket begins AFTER reception is enabled.
            self.result.update(captureStartedMonotonicNs=str(time.monotonic_ns()),filterAttachedBeforeBind=True,filterLocked=True)
            self.result.update(status='CAPTURING',packetCaptureExecuted=True,kernelIpBytes=0,outgoingPackets=0,ignoredIncomingEndpointCopies=0,unsupportedPackets=0,originalNodeIdentities=self.identities,originalFlowScope=[dict(tuple=list(k),**v) for k,v in sorted(self.flows.items())])
            self.started=True;self.deadline=time.monotonic()+self.max_seconds;self.thread=threading.Thread(target=self._receive,name='owned-header-capture',daemon=True);self.thread.start()
        except (OSError,ValueError,AttributeError) as error:
            self.result['status']='NOT_SUPPLIED';self.fail(str(error),type(error).__name__);self._close()
        self.result["captureSetupElapsedNs"]=time.monotonic_ns()-began
        return self.result
    def _receive(self):
        buf=bytearray(40);seen=0;seen_bytes=0;cpu_started=time.thread_time_ns()
        try:
            while not self.stop_event.is_set():
                if time.monotonic()>=self.deadline:self.fail('CAPTURE_DURATION_LIMIT');break
                try:n,ancillary,flags,address=self.sock.recvmsg_into([buf],0,socket.MSG_TRUNC)
                except socket.timeout:continue
                if self.stop_event.is_set():break
                seen+=1;seen_bytes+=n
                if seen>MAX_PACKETS*2 or seen_bytes>MAX_IP_BYTES*2:self.fail('CAPTURE_TOTAL_EVENT_OR_BYTE_LIMIT');break
                require(address[0]=='lo','capture interface changed')
                if address[2]!=4:self.result['ignoredIncomingEndpointCopies']+=1;continue # OUTGOING only
                try:
                    require(n>=40,'short original IP packet');record=parse_prefix(bytes(buf),n);flow=self.flows.get(record['tuple']);require(flow is not None,'packet outside original tuple scope')
                except ValueError:self.result['unsupportedPackets']+=1;continue
                if self.result['outgoingPackets']>=MAX_PACKETS or self.result['kernelIpBytes']+n>MAX_IP_BYTES:self.fail('CAPTURE_PACKET_OR_BYTE_LIMIT');break
                now=time.time_ns();self.stream.write(struct.pack('<IIII',now//1_000_000_000,now%1_000_000_000,40,n));self.stream.write(buf)
                self.result['outgoingPackets']+=1;self.result['kernelIpBytes']+=n
                h=self.hops.setdefault((flow['source'],flow['target']),dict(packets=0,kernelIpBytes=0,tcpPayloadBytes=0,observedSyn=0,observedFin=0,observedRst=0,observedAckOnly=0))
                h['packets']+=1;h['kernelIpBytes']+=n;h['tcpPayloadBytes']+=record['tcpPayloadBytes'];h['observedSyn']+=bool(record['flags']&2);h['observedFin']+=bool(record['flags']&1);h['observedRst']+=bool(record['flags']&4);h['observedAckOnly']+=record['tcpPayloadBytes']==0 and bool(record['flags']&16) and not record['flags']&7
        except (OSError,ValueError) as error:
            if not self.stop_event.is_set():self.fail(str(error),type(error).__name__)
        finally:self.result.update(captureStoppedMonotonicNs=str(time.monotonic_ns()),receiverThreadCpuNs=time.thread_time_ns()-cpu_started,receivedHeaderEvents=seen,receivedKernelIpBytesBeforeDirectionDedup=seen_bytes)
    def _close(self):
        if self.sock is not None:
            try:self.sock.close()
            except OSError as error:self.fail(str(error),type(error).__name__)
            finally:self.sock=None
        if self.stream is not None:
            try:self.stream.flush();os.fsync(self.stream.fileno())
            except OSError as error:self.fail(str(error),type(error).__name__)
            finally:
                try:self.stream.close()
                except OSError as error:self.fail(str(error),type(error).__name__)
                self.stream=None
    def stop(self,end_sample=None,load_result=None):
        if self.closed:return self.result
        self.stop_event.set()
        if self.thread is not None:self.thread.join(timeout=1)
        if self.thread is not None and self.thread.is_alive():self.fail('CAPTURE_READER_NOT_JOINED')
        self.result['readerJoined']=self.thread is None or not self.thread.is_alive()
        if self.started:
            try:
                raw=self.sock.getsockopt(263,6,8) # SOL_PACKET/PACKET_STATISTICS; single reset-on-read
                packets,drops=struct.unpack('=II',raw);self.result['kernelPacketStatistics']=dict(packets=packets,droppedByKernel=drops)
                require(drops==0,'CAPTURE_KERNEL_DROPS')
                new_flows,new_ids=original_flow_scope(self.tcp,end_sample);require(new_flows==self.flows and new_ids==self.identities,'original owned flow/PID identity changed')
                self.result['finalControlledNamespace']=exclusive_current_namespace(self.tcp,end_sample)
                require(not self.result['reason'] and self.result['unsupportedPackets']==0,'capture partial/bound/error; not complete selected flows')
                self.result.update(status='OBSERVED_SELECTED_KERNEL_IP_HEADERS',matchedFlowCaptureComplete=True)
            except (OSError,ValueError,TypeError,KeyError) as error:self.result['status']='UNKNOWN';self.fail(str(error))
        self._close();self.closed=True
        if self.result['firstCause'] is not None and self.started:
            self.result.update(status='UNKNOWN',matchedFlowCaptureComplete=False)
        path=self.public/'network-owned-header-original.pcap'
        if path.is_file():self.result['originalArtifact']=dict(path=path.name,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        self.result['directedHopIpCounts']=[dict(source=a,target=b,**v) for (a,b),v in sorted(self.hops.items())]
        self.result['qualifiedCohortAmortizedKernelIpBytes']=None
        if self.result['matchedFlowCaptureComplete'] and load_result is not None:
            try:
                n=load_result['configuredDemand'];origin=int(load_result['originMonotonicNs']);cutoff=int(load_result['observationCutoffNs'])
                bracket=int(self.result['captureStartedMonotonicNs'])<=origin and int(self.result['captureStoppedMonotonicNs'])>=origin+cutoff
                self.result['offeredAndTailInsideCapture']=bracket
                if bracket and n>0 and load_result['qualified']==n and load_result['notQualified']==0 and load_result['notSubmitted']==0 and load_result['lateSubmitted']==0 and load_result['windowCompleted'] is True:self.result['qualifiedCohortAmortizedKernelIpBytes']=dict(numerator=self.result['kernelIpBytes'],denominator=n,meaning='selected-flow cohort IP datagrams incl headers/background/retransmits; not physical-wire or individually attributed transaction bytes')
            except (ValueError,KeyError,TypeError):self.result['offeredAndTailInsideCapture']=None
        return self.result
