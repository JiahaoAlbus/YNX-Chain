"""Bounded parent RPC wall intervals, never source execution or finality."""
import copy
import threading
import time

class RPCMeasurements:
    def __init__(self):
        self.lock=threading.Lock();self.groups={}
    def call(self,node,method,operation):
        if type(node) is not int or not 0<=node<4 or method not in ('tx','status','abci_info'):raise RuntimeError('original four-node observation RPC required')
        key=(node,method);started=time.monotonic_ns()
        with self.lock:
            group=self.groups.setdefault(key,dict(node=node,method=method,attempted=0,returned=0,raised=0,completed=0,elapsedNs=0,minNs=None,maxNs=None))
            group['attempted']+=1
        outcome='raised'
        try:
            value=operation();outcome='returned';return value
        finally:
            elapsed=time.monotonic_ns()-started
            with self.lock:
                group['completed']+=1;group[outcome]+=1;group['elapsedNs']+=elapsed
                group['minNs']=elapsed if group['minNs'] is None else min(group['minNs'],elapsed)
                group['maxNs']=elapsed if group['maxNs'] is None else max(group['maxNs'],elapsed)
    def report(self):
        with self.lock:groups=[dict(copy.deepcopy(value),inFlight=value['attempted']-value['completed']) for _,value in sorted(self.groups.items())]
        return dict(schema='YNX-PERF-PARENT-RPC-ELAPSED/v1',clock='parent_monotonic_ns',groupLimit=12,groups=groups,intervalsOverlap=True,businessSuccessInferred=False,sourceExecutionMeasured=False,independentFinality=False,meaning='Original observation RPC calls only; returned is not successful business execution. Completed wall intervals include transport, parsing and guard work in Window.rpc. In-flight elapsed is unknown, omitted from totals; concurrent intervals are not added into a pipeline duration. No per-business quantiles or retry permission.')
