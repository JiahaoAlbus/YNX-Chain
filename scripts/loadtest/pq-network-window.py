"""Original PQ supervisor hook for frozen LINK accounting; no load generator.

Captures bracket the complete finite load plus drain, not an atomic fixed-window
network count. Missing live logical/proto publishers remain absent. Nothing in
this hook enables experimental transport or metrics endpoints. Header capture
requires the separate explicit opt-in and dedicated controlled namespace.
"""
import hashlib
import importlib.util
import ipaddress
import os
from pathlib import Path
import time
from urllib.parse import urlsplit

LINK_COMMIT="0d0490055c57191f20ca2d3813bf6d4b6b5f37aa"
FROZEN={"owned-tcp-accounting.py":"612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440",
        "network-layer-accounting.py":"1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635"}


def frozen_module(name):
    path=Path(__file__).with_name(name)
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=FROZEN[name]:
        raise RuntimeError("frozen LINK accounting module identity changed")
    spec=importlib.util.spec_from_file_location("pq_frozen_"+name.replace("-","_"),path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


class NetworkWindow:
    def __init__(self,ceremony,lab,source,tools,input_sha,demand,live_reader=None,header_capture=False,header_capture_seconds=45):
        self.c,self.lab=ceremony,lab;self.start=None;self.end=None
        self.live_reader=live_reader;self.header_capture_requested=header_capture;self.header_capture_seconds=header_capture_seconds;self.header_capture=None
        self.tcp=frozen_module("owned-tcp-accounting.py");self.layers=frozen_module("network-layer-accounting.py")
        nodes=[]
        for planned in ceremony.plan["nodes"]:
            name="pq-node-%d"%planned["index"]
            matches=[child for child in ceremony.w.children if child["name"]==name]
            lab.require(len(matches)==1 and matches[0]["process"].poll() is None,"one live original PQ producer required for network accounting")
            child=matches[0];endpoint=urlsplit(planned["p2pAddress"])
            address=ipaddress.ip_address(endpoint.hostname)
            lab.require(endpoint.scheme=="tcp" and address.is_loopback and endpoint.port is not None and endpoint.username is None and endpoint.path=="","original loopback P2P endpoint required")
            nodes.append(dict(name=name,pid=child["process"].pid,startTicks=str(child["startTicks"]),peerID=planned["nodeId"],p2pLocalEndpoints=[dict(address=str(address),port=endpoint.port)]))
        self.binding=dict(schema=self.layers.BINDING_SCHEMA,runID=os.environ["GITHUB_RUN_ID"]+"-"+os.environ.get("GITHUB_RUN_ATTEMPT","1"),
            source=source,tools=tools,inputSHA256=input_sha,mode=ceremony.mode,window="load-plus-drain-bracket",
            configuredDemand=str(demand),qualifiedCount=None,nodes=nodes)
        self.layers.validate_binding(self.binding)
        self.pin=self.layers.digest(self.binding)
        lab.write_new(ceremony.w.work/"public/network-binding.json",self.binding)

    def capture_live_node(self,node):
        # The owner of the normal private producer supplies this explicit
        # read callback. No cache/file/publisher or transport is invented here.
        if self.live_reader is None:
            return dict(name=node["name"],pid=node["pid"],startTicks=node["startTicks"],wire=None,lossless=None,proto=None,liveStatus="UNKNOWN",liveReason="normal_private_producer_read_callee_not_supplied")
        lo=time.clock_gettime_ns(time.CLOCK_MONOTONIC)
        try:
            raw=self.live_reader(dict(node))
            hi=time.clock_gettime_ns(time.CLOCK_MONOTONIC)
            self.lab.require(type(raw) is bytes and len(raw)<=128<<10,"bounded original live publisher bytes required")
            text=raw.decode("utf-8",errors="strict")
            return self.layers.original_live_node_capture(node=node,raw=text,sha256=hashlib.sha256(raw).hexdigest(),start_monotonic_ns=lo,end_monotonic_ns=hi)
        except Exception as error:
            return dict(name=node["name"],pid=node["pid"],startTicks=node["startTicks"],wire=None,lossless=None,proto=None,liveStatus="UNKNOWN",liveReason="normal_private_producer_read_failed",readErrorType=type(error).__name__,readStartMonotonicNs=str(lo),readEndMonotonicNs=str(time.clock_gettime_ns(time.CLOCK_MONOTONIC)))

    def capture(self,side):
        self.lab.require(side in ("start","end") and getattr(self,side) is None,"one original network checkpoint per side")
        lo=time.clock_gettime_ns(time.CLOCK_MONOTONIC)
        # The immutable node identity/endpoint list is the SAME in outer binding
        # and sampler. The sampler itself rechecks the original live guard.
        sample=self.tcp.sample_owned_tcp(launcher_pid=os.getpid(),nodes=self.binding["nodes"],previous=self.start.get("tcp") if self.start is not None else None)
        rows=[self.capture_live_node(n) for n in self.binding["nodes"]]
        checkpoint=dict(bindingSHA256=self.pin,startMonotonicNs=str(lo),endMonotonicNs=str(time.clock_gettime_ns(time.CLOCK_MONOTONIC)),nodes=rows,tcp=sample,
            originalLiveReadCalleeSupplied=self.live_reader is not None,
            missingPublishers=dict(wire="normal private callee required; missing/stale/invalid remains UNKNOWN, after-stop data not substituted",
                lossless="disabled or absent remains UNKNOWN; experimental transport is not enabled by hook",
                proto="no original owned metrics endpoint supplied; no endpoint enabled or size inferred"))
        self.lab.write_new(self.c.w.work/("public/network-%s.json"%side),checkpoint)
        setattr(self,side,checkpoint)
        if side=="start" and self.header_capture_requested:
            path=Path(__file__).with_name("pq-owned-header-capture.py");spec=importlib.util.spec_from_file_location("original_owned_header_capture",path);capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)
            self.header_capture=capture.OwnedHeaderCapture(sample,self.c.w.work/"public",self.header_capture_seconds)
            state=self.header_capture.start()
            self.lab.write_new(self.c.w.work/"public/network-header-capture-start.json",{key:state.get(key) for key in ("schema","status","reason","packetCaptureExecuted","captureStartedMonotonicNs","ownedNamespaceIdentity","controlledNamespace","filterSHA256","filterAttachedBeforeBind","filterLocked","maxPackets","maxIpBytes","maxSeconds")})
        return checkpoint

    def finish(self,qualified_count,load_clock=None,load_result=None):
        self.lab.require(self.start is not None and self.end is None,"original start checkpoint required before finish")
        try:self.capture("end")
        except BaseException:
            if getattr(self,"header_capture",None) is not None:
                closed=self.header_capture.stop()
                self.lab.write_new(self.c.w.work/"public/network-header-capture.json",closed)
            raise
        header=None
        if getattr(self,"header_capture",None) is not None:
            header=self.header_capture.stop(self.end.get("tcp"),load_result)
            self.lab.write_new(self.c.w.work/"public/network-header-capture.json",header)
        result=self.layers.account_layers(binding=self.binding,start=self.start,end=self.end)
        result.update(frozenLINKSource=LINK_COMMIT,frozenModules=FROZEN,qualifiedCountEvidence=qualified_count,loadClockEvidence=load_clock,
            qualifiedCountMeaning="normal load result evidence only; not inferred from network counters; immutable binding count remains null",
            captureScope=("original pre/post checkpoint bracket; no load result supplied; neither atomic nor an offered-rate window"
                          if load_result is None else
                          "brackets load plus all drain/consumer overhead; neither atomic nor the exact offered-rate window"),
            samplingOverheadNs=dict(start=str(int(self.start["endMonotonicNs"])-int(self.start["startMonotonicNs"])),end=str(int(self.end["endMonotonicNs"])-int(self.end["startMonotonicNs"]))),
            originalCheckpoints=[dict(path="network-%s.json"%side,sha256=self.lab.guard.digest(self.c.w.work/("public/network-%s.json"%side))) for side in ("start","end")])
        path=Path(__file__).with_name("pq-hop-byte-accounting.py")
        spec=importlib.util.spec_from_file_location("original_hop_byte_accounting",path);hops=importlib.util.module_from_spec(spec);spec.loader.exec_module(hops)
        result["ownedHeaderCapture"]=header
        result["perHopTCPAccounting"]=hops.directional_hops(self.binding,self.start,self.end,load_result)
        self.lab.write_new(self.c.w.work/"public/network-hop-accounting.json",result["perHopTCPAccounting"])
        self.lab.write_new(self.c.w.work/"public/network-accounting.json",result)
        return result
