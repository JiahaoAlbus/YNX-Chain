"""Original PQ supervisor hook for frozen LINK accounting; no load generator.

Captures bracket the complete finite load plus drain, not an atomic fixed-window
network count. Missing live logical/proto publishers remain absent. Nothing in
this hook enables the experimental transport, metrics endpoint or packet capture.
"""
import hashlib
import importlib.util
import ipaddress
import os
from pathlib import Path
import time
from urllib.parse import urlsplit

LINK_COMMIT="05500bd907375884a727161e73ba634f1c6e1a27"
FROZEN={"owned-tcp-accounting.py":"612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440",
        "network-layer-accounting.py":"1d4f4dc9fe8bf5227312f1c5f995d289d4a2c4cfd1b8a4dd210cba7248fc3626"}


def frozen_module(name):
    path=Path(__file__).with_name(name)
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=FROZEN[name]:
        raise RuntimeError("frozen LINK accounting module identity changed")
    spec=importlib.util.spec_from_file_location("pq_frozen_"+name.replace("-","_"),path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


class NetworkWindow:
    def __init__(self,ceremony,lab,source,tools,input_sha,demand):
        self.c,self.lab=ceremony,lab;self.start=None;self.end=None
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

    def capture(self,side):
        self.lab.require(side in ("start","end") and getattr(self,side) is None,"one original network checkpoint per side")
        lo=time.monotonic_ns()
        # The immutable node identity/endpoint list is the SAME in outer binding
        # and sampler. The sampler itself rechecks the original live guard.
        sample=self.tcp.sample_owned_tcp(launcher_pid=os.getpid(),nodes=self.binding["nodes"],previous=self.start.get("tcp") if self.start is not None else None)
        rows=[dict(name=n["name"],pid=n["pid"],startTicks=n["startTicks"],wire=None,lossless=None,proto=None) for n in self.binding["nodes"]]
        checkpoint=dict(bindingSHA256=self.pin,startMonotonicNs=str(lo),endMonotonicNs=str(time.monotonic_ns()),nodes=rows,tcp=sample,
            missingPublishers=dict(wire="original publisher is after-stop lifetime only; cannot supply live window endpoints",
                lossless="no original live publisher supplied; experimental transport is not enabled by hook",
                proto="no original owned metrics endpoint supplied; no endpoint enabled or size inferred"))
        self.lab.write_new(self.c.w.work/("public/network-%s.json"%side),checkpoint)
        setattr(self,side,checkpoint)
        return checkpoint

    def finish(self,qualified_count,load_clock=None):
        self.lab.require(self.start is not None and self.end is None,"original start checkpoint required before finish")
        self.capture("end")
        result=self.layers.account_layers(binding=self.binding,start=self.start,end=self.end)
        result.update(frozenLINKSource=LINK_COMMIT,frozenModules=FROZEN,qualifiedCountEvidence=qualified_count,loadClockEvidence=load_clock,
            qualifiedCountMeaning="normal load result evidence only; not inferred from network counters; immutable binding count remains null",
            captureScope="brackets load plus all drain/consumer overhead; neither atomic nor the exact offered-rate window",
            samplingOverheadNs=dict(start=str(int(self.start["endMonotonicNs"])-int(self.start["startMonotonicNs"])),end=str(int(self.end["endMonotonicNs"])-int(self.end["startMonotonicNs"]))),
            originalCheckpoints=[dict(path="network-%s.json"%side,sha256=self.lab.guard.digest(self.c.w.work/("public/network-%s.json"%side))) for side in ("start","end")])
        self.lab.write_new(self.c.w.work/"public/network-accounting.json",result)
        return result
