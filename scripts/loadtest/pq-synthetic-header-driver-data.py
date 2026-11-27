"""Original stopped Window header DATA, never a source or runtime qualifier."""
import hashlib
import importlib.util
from pathlib import Path

_spec=importlib.util.spec_from_file_location('original_header_data_reader',Path(__file__).with_name('pq-synthetic-header-stream-data.py'))
reader=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(reader)


def retain_after_stop(window,descriptors,cleanup_complete):
    """Read only the four original stopped Window paths, without copying private bytes.

    Pins are computed from held bytes, not independent source/binary attestations.
    Each FD's read is stable; stream then receipt are not simultaneous snapshots.
    """
    result=dict(schema='YNX-PERF-STOPPED-SYNTHETIC-HEADER-DATA/v1',status='NOT_SUPPLIED',nodes=[],errors=[],
                sourceVerified=False,nodeBindingVerified=False,timeDomainVerified=False,startupCoverageComplete=False,
                walReplayExcluded=False,runtimeAuthorized=False,independentFinality=False,receiptPublicationVerified=False,
                independentPinsVerified=False,readbackRSSMeasured=False,privateOriginalsCopied=False,
                readbackCleanupDebt=False,pinBasis='computed-from-held-stopped-bytes',sequentialOriginalReads=True)
    if cleanup_complete is not True or type(descriptors) is not list or len(descriptors)!=4:
        result['errors'].append(dict(errorType='OriginalStopOrDescriptorsUnavailable'));return result
    if (any(type(d) is not dict or type(d.get('node')) is not int for d in descriptors)
            or [d['node'] for d in descriptors]!=list(range(4))):
        result['errors'].append(dict(errorType='OriginalNodeInventoryUnavailable'));return result
    processes=[]
    try:
        for node in range(4):
            children=[c for c in window.children if type(c) is dict and c.get('name')=='pq-node-%d'%node]
            if len(children)!=1:raise ValueError('original child inventory differs')
            proc=children[0]['process']
            lock=vars(proc).get('_ynx_lifecycle_lock')
            if lock is None or not lock.acquire(blocking=False):raise ValueError('original lifecycle unavailable')
            try:
                if type(proc.pid) is not int or proc.pid<=0 or type(proc.returncode) is not int:raise ValueError('original child not reaped')
            finally:lock.release()
            processes.append(proc)
        if len({id(p) for p in processes})!=4 or len({p.pid for p in processes})!=4:raise ValueError('original child identities repeat')
    except (OSError,ValueError,TypeError,KeyError,RuntimeError,AttributeError) as error:
        result['errors'].append(dict(errorType=type(error).__name__,status='NOT_SUPPLIED'));return result
    for d,proc in zip(descriptors,processes):
        node=d['node'];expected_name='pq-node-%d'%node
        try:
            root=Path(window.work)/'.private/commit-observations';path=Path(d['path'])
            if d.get('processName')!=expected_name or path!=root/('header-node-%d.jsonl'%node):raise ValueError('descriptor differs')
            receipt=path.with_name(path.name+'.receipt.json')
            stream,original_receipt=reader._read_private_pair(path,receipt)
            stream_pin=hashlib.sha256(stream).hexdigest();receipt_pin=hashlib.sha256(original_receipt).hexdigest()
            projection=reader.inspect_bytes(stream,original_receipt,stream_sha256=stream_pin,receipt_sha256=receipt_pin)
            result['nodes'].append(dict(node=node,processName=expected_name,originalProcessPID=proc.pid,
                eventCount=projection['events'],streamSHA256=stream_pin,receiptSHA256=receipt_pin,
                status='OBSERVED_DATA',sourceVerified=False,nodeBindingVerified=False,timeDomainVerified=False))
        except (OSError,ValueError,TypeError,KeyError,RuntimeError) as error:
            debt=getattr(error,'readbackCleanupDebt',False) is True
            if debt:result['readbackCleanupDebt']=True
            result['errors'].append(dict(node=node,errorType=getattr(error,'firstErrorType',type(error).__name__),
                                         readbackCleanupDebt=debt,status='NOT_SUPPLIED'))
            if debt:break # An unresolved original close never authorizes another read attempt.
    if len(result['nodes'])==4 and not result['errors']:result['status']='OBSERVED_DATA'
    return result
