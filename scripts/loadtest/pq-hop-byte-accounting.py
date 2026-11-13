#!/usr/bin/env python3
"""Read original frozen LINK snapshots; separate directional TCP counters.

No socket, packet capture, listener, namespace entry or traffic generation.
Endpoint counter deltas are neither complete transport totals nor physical wire.
"""
import hashlib
import importlib.util
import ipaddress
import json
from pathlib import Path

FROZEN={
 'owned-tcp-accounting.py':'612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440',
 'network-layer-accounting.py':'1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635',
}

def require(ok,reason):
    if not ok:raise ValueError(reason)
def original(name):
    path=Path(__file__).with_name(name)
    require(not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest()==FROZEN[name],'original LINK accounting module changed')
    spec=importlib.util.spec_from_file_location('hop_original_'+name.replace('-','_'),path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

def directional_hops(binding,start,end,load_result=None):
    tcp=original('owned-tcp-accounting.py');layers=original('network-layer-accounting.py')
    report=dict(schema='YNX-PERF-ORIGINAL-DIRECTIONAL-HOP-COUNTERS/v1',status='UNKNOWN',reason=None,directedConnections=[],directedHops=[],sourceSocketEndpointBytesSentSum=None,sourceSocketEndpointRetransmittedBytesSum=None,physicalBytesMeasured=False,physicalBytes=None,actualPerTransactionHopBytes=None,actualPerTransactionHopBytesStatus='UNMEASURED',completeTrafficCoverage=False,backgroundTrafficSeparable=False,handshakeCoverage='UNKNOWN: connections established before start or born-and-closed between snapshots are not covered',headersAndLinkFraming='UNMEASURED',kernelPacketCapture='NOT_SUPPLIED',applicationScope='whole registered owned P2P TCP connections, all channels; not individual business transactions',counterGroupsAdditive=False,receiverBytesAddedToSenderBytes=False,independentFinality=False,gainsQualified=False,sameHost=True,physicalFaultDomains=1,attribution='matched endpoint sender counters only; background/consensus/retransmission may be included; no per-transaction or physical-wire attribution',originalLINKModules=FROZEN,denominators=None,matchedEndpointQualifiedCohortMean=None)
    try:
        nodes=layers.validate_binding(binding);owned={n['name']:n for n in nodes};report['originalLogicalNodeCount']=len(nodes)
        pin=layers.digest(binding);layers.validate_checkpoint(start,pin,owned);layers.validate_checkpoint(end,pin,owned)
        for node in nodes:
            endpoints=node.get('p2pLocalEndpoints');require(type(endpoints) is list and endpoints,'original registered P2P endpoints required')
            for endpoint in endpoints:require(ipaddress.ip_address(endpoint['address']).is_loopback and 0<int(endpoint['port'])<65536,'only original numeric loopback endpoints allowed')
        for checkpoint in (start,end):
            layers.validate_tcp_scope(checkpoint['tcp'],checkpoint,owned)
            sample=checkpoint['tcp'];launcher=sample.get('launcher') or {}
            for node in sample.get('nodes',[]):require(node.get('netns')==launcher.get('netns') and node.get('userns')==launcher.get('userns'),'original launcher/node namespace differs')
        diff=tcp.diff_owned_tcp(start['tcp'],end['tcp']);report['originalTCPWindow']=diff
        report['originalInputs']=dict(bindingSHA256=pin,startTCP=tcp.sample_sha256(start['tcp']),endTCP=tcp.sample_sha256(end['tcp']),startCheckpointSHA256=layers.digest(start),endCheckpointSHA256=layers.digest(end))
        require(diff.get('complete') is True,'original TCP endpoint window incomplete: '+str(diff.get('firstCause')))
        index={};node_by_name={n['name']:n for n in diff['nodes']}
        def key(name,row):return (name,row['family'],row['localAddress'],row['localPort'],row['remoteAddress'],row['remotePort'])
        for node in diff['nodes']:
            require(node['name'] in owned and node['pid']==owned[node['name']]['pid'] and str(node['startTicks'])==str(owned[node['name']]['startTicks']),'original hop process identity differs')
            for row in node['sockets']:
                require(key(node['name'],row) not in index,'duplicate original directed connection tuple');index[key(node['name'],row)]=row
        groups={};excluded=0
        for node in diff['nodes']:
            for row in node['sockets']:
                if row['scope']!=tcp.P2P:excluded+=1;continue
                require(row['peerNode'] in owned and row['complete'] is True and row['delta'] is not None,'registered original peer/delta missing')
                for address in (row['localAddress'],row['remoteAddress']):require(ipaddress.ip_address(address).is_loopback,'non-loopback original tuple rejected')
                reverse=index.get((row['peerNode'],row['family'],row['remoteAddress'],row['remotePort'],row['localAddress'],row['localPort']))
                require(reverse is not None and reverse['peerNode']==node['name'] and reverse['scope']==tcp.P2P and reverse['delta'] is not None,'original reverse owned endpoint missing')
                require(node_by_name[row['peerNode']]['netns']==node['netns'],'cross-namespace hop rejected')
                counters={k:str(tcp.uint(row['delta'][k])) for k in tcp.COUNTERS}
                receiver={k:str(tcp.uint(reverse['delta'][k])) for k in ('bytesReceived','bytesAcked','segmentsIn')}
                connection=dict(source=node['name'],target=row['peerNode'],sourcePID=node['pid'],sourceStartTicks=node['startTicks'],networkNamespace=node['netns'],localAddress=row['localAddress'],localPort=row['localPort'],remoteAddress=row['remoteAddress'],remotePort=row['remotePort'],socketInode=row['inode'],socketCookie=row['cookie'],senderCounters=counters,reverseEndpointCountersForCrossCheckOnly=receiver,startObservedMonotonicNs=row['startObservedMonotonicNs'],endObservedMonotonicNs=row['endObservedMonotonicNs'])
                report['directedConnections'].append(connection)
                group=groups.setdefault((node['name'],row['peerNode']),dict(connections=0,bytesSent=0,bytesRetransmitted=0,bytesAcked=0,reverseEndpointBytesReceived=0))
                group['connections']+=1
                for field in ('bytesSent','bytesRetransmitted','bytesAcked'):group[field]+=tcp.uint(counters[field])
                group['reverseEndpointBytesReceived']+=tcp.uint(receiver['bytesReceived'])
        require(bool(groups),'no original registered directional P2P pair')
        for (source,target),totals in sorted(groups.items()):report['directedHops'].append(dict(source=source,target=target,matchedConnections=totals['connections'],senderBytesSent=str(totals['bytesSent']),senderBytesRetransmitted=str(totals['bytesRetransmitted']),senderBytesAcked=str(totals['bytesAcked']),receiverCrossCheckBytesOnly=str(totals['reverseEndpointBytesReceived']),countingRule='sum only source sender bytesSent; receiver observation is never added; retransmission counter is reported separately, not added/subtracted'))
        report.update(status='OBSERVED_MATCHED_ENDPOINT_HOPS',excludedUnknownScopeEndpoints=excluded,sourceSocketEndpointBytesSentSum=str(sum(x['bytesSent'] for x in groups.values())),sourceSocketEndpointRetransmittedBytesSum=str(sum(x['bytesRetransmitted'] for x in groups.values())),phase=dict(startCaptureNs=[start['startMonotonicNs'],start['endMonotonicNs']],endCaptureNs=[end['startMonotonicNs'],end['endMonotonicNs']],atomic=False,meaning=('original pre/post checkpoint bracket; no load result supplied; no business denominator or offered-rate window inferred' if load_result is None else 'original pre-load and post-drain bracket; not exact offered-rate window; includes consumer/consensus/background overhead')))
        if load_result is not None:
            demand=tcp.uint(binding['configuredDemand']);require(demand>0 and load_result.get('configuredDemand')==demand,'complete original demand differs')
            counts={key:tcp.uint(load_result[key]) for key in ('logicalReleased','submitted','qualified','notQualified','notSubmitted','lateSubmitted')}
            require(all(v<=demand for v in counts.values()) and counts['qualified']+counts['notQualified']==demand and counts['submitted']+counts['notSubmitted']==demand and counts['qualified']<=counts['submitted']<=counts['logicalReleased'],'original load count evidence differs')
            report['denominators']=dict(configuredDemand=demand,**counts,qualifiedCountIsOwnerEvidence=True,offeredWindowNs=load_result.get('windowNs'),observationCutoffNs=load_result.get('observationCutoffNs'))
            clock_keys=('originMonotonicNs','offeredWindowEndMonotonicNs','windowNs','observationCutoffNs')
            clock_ok=False
            report['loadClockBinding']=dict(status='UNKNOWN',reason='original parent load clock not supplied')
            if all(load_result.get(key) is not None for key in clock_keys):
                clock={key:tcp.uint(load_result[key]) for key in clock_keys};origin=clock['originMonotonicNs']
                clock_ok=clock['offeredWindowEndMonotonicNs']==origin+clock['windowNs'] and clock['observationCutoffNs']>=clock['windowNs'] and tcp.uint(start['endMonotonicNs'])<=origin and tcp.uint(end['startMonotonicNs'])>=origin+clock['observationCutoffNs']
                report['loadClockBinding']=dict(status='BRACKETED' if clock_ok else 'UNKNOWN',originalClock={key:str(value) for key,value in clock.items()},offeredAndTailInsideCaptureBracket=clock_ok,exactOfferedWindowCapture=False)
            full=clock_ok and counts['qualified']==demand and counts['logicalReleased']==demand and counts['notSubmitted']==0 and counts['lateSubmitted']==0 and load_result.get('windowCompleted') is True and load_result.get('firstCause') is None
            if full and excluded==0:report['matchedEndpointQualifiedCohortMean']=dict(numeratorSourceBytesSent=report['sourceSocketEndpointBytesSentSum'],denominatorQualified=demand,kind='exact rational for observed matched-endpoint bracket only; includes background and retransmission; not actual physical or individually attributed transaction bytes')
    except (ValueError,KeyError,TypeError,OverflowError) as error:
        report.update(status='UNKNOWN',reason=str(error),directedConnections=[],directedHops=[],sourceSocketEndpointBytesSentSum=None,sourceSocketEndpointRetransmittedBytesSum=None,matchedEndpointQualifiedCohortMean=None)
    return report


def main(argv=None):
    import argparse,os,stat
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account',action='store_true')
    for name in ('binding','start','end','receipt'):
        parser.add_argument('--'+name);parser.add_argument('--'+name+'-sha256')
    parser.add_argument('--output');args=parser.parse_args(argv)
    if not args.account:
        print(json.dumps(dict(status='prepared-only',packetCaptureExecuted=False,originalSnapshotsRead=False,physicalBytesMeasured=False,actualPerTransactionHopBytes=None)));return 0
    values={};pins={}
    for name,basename in [('binding','network-binding.json'),('start','network-start.json'),('end','network-end.json'),('receipt','receipt.json')]:
        path=Path(getattr(args,name) or '');pin=getattr(args,name+'_sha256')
        require(path.is_absolute() and path.name==basename and path.resolve(strict=True)==path,'explicit original public '+name+' artifact required')
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            info=os.fstat(fd);require(stat.S_ISREG(info.st_mode) and 0<info.st_size<=4<<20,'bounded original public JSON required')
            with os.fdopen(fd,'rb',closefd=False) as handle:raw=handle.read((4<<20)+1)
            require(len(raw)==info.st_size and hashlib.sha256(raw).hexdigest()==pin,'external original artifact pin differs')
        finally:os.close(fd)
        values[name]=json.loads(raw);pins[name]=pin
    require(values['receipt'].get('planSHA256')==values['binding'].get('inputSHA256') and values['receipt'].get('source',{}).get('commit')==values['binding'].get('source'),'original source/input binding differs')
    report=directional_hops(values['binding'],values['start'],values['end'],values['receipt'].get('loadResult'));report['originalArtifactSHA256']=pins
    output=Path(args.output or '');require(output.is_absolute() and output.parent.resolve(strict=True)==output.parent and not output.exists(),'fresh canonical output required')
    raw=(json.dumps(report,indent=2)+'\n').encode()
    with open(output,'xb') as handle:os.chmod(output,0o600);handle.write(raw);handle.flush();os.fsync(handle.fileno())
    print(json.dumps(dict(status=report['status'],output=str(output),sha256=hashlib.sha256(raw).hexdigest(),physicalBytesMeasured=False,actualPerTransactionHopBytes=None)))
    return 0 if report['status']=='OBSERVED_MATCHED_ENDPOINT_HOPS' else 1

if __name__=='__main__':raise SystemExit(main())
