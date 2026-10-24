"""Original qualified matched-pair diagnosis, no network/submissions.
Arguments: original independent pair verdict JSON, NEW output JSON.
Refuses incomplete/failed pairs; stage wall totals overlap and are not additive.
"""
import hashlib,json,math,sys
from pathlib import Path
source=Path(sys.argv[1]).absolute();output=Path(sys.argv[2]).absolute();raw=source.read_bytes();value=json.loads(raw)
assert value['runId']==40085358438 and value['sourceCommit']=='c8b7a2f6b14034acbf4a4e801a3260b86a659368'
assert value['nativePairQualified'] is True and value['slotReturned'] is True and len(value['cases'])==2
before,after=value['cases']
for case in (before,after):
 assert case['summary']['finalSubmitted']==8192 and case['summary']['input']==8192
 assert all(case['summary'][key]==0 for key in ('submissionUnknown','timedOut','notSubmitted','executionFailed'))
 assert case['processCPU']['available'] is True
 assert case['mode']=='bounded-cadence'
def delta(a,b):
 assert type(a) in (int,float) and type(b) in (int,float) and math.isfinite(a) and math.isfinite(b) and a>=0 and b>=0
 return dict(before=a,after=b,change=b-a,changePercent=(b/a-1)*100 if a else None)
metrics={}
for key in ('finalSubmittedPerMeasurementSecond','rpcSubmissionsPerMeasurementSecond','checkTxAcceptedPerMeasurementSecond','effectiveBusinessIncludedPerMeasurementSecond','measurementWindowSeconds','offeredInterarrivalRate'):
 metrics[key]=delta(before['summary'][key],after['summary'][key])
for key in ('totalNs','userNs','systemNs','cpuPercentOfOneCore'):
 metrics['clientCPU.'+key]=delta(before['processCPU'][key],after['processCPU'][key])
for key in ('rssBytes','threads','privateBytes','buildBytes'):
 metrics['sampledPeaks.'+key]=delta(before['sampledPeaks'][key],after['sampledPeaks'][key])
for key in ('loadNs','hashNs','captureNs','decodeNs','indexPublishNs','transactionVerifyNs'):
 metrics['readerWall.'+key]=delta(before['reader']['phaseTotalsNs'][key],after['reader']['phaseTotalsNs'][key])
 metrics['readerWallPerFinalNs.'+key]=delta(before['reader']['phaseTotalsNs'][key]/8192,after['reader']['phaseTotalsNs'][key]/8192)
for key in ('acquisitions','waitNs','holdNs','maxWaitNs','maxHoldNs'):
 metrics['readerGate.'+key]=delta(before['reader']['readerGate'][key],after['reader']['readerGate'][key])
for key in ('snapshotValidations','snapshotCacheHits','transactionVerifications','bytesHashed'):
 metrics['reader.'+key]=delta(before['reader'][key],after['reader'][key])
assert set(before['reader']['prefixReplay']['workPhases'])==set(after['reader']['prefixReplay']['workPhases'])
for phase in before['reader']['prefixReplay']['workPhases']:
 if phase=='certificatePublishDetails':continue
 for field in ('calls','errors','durationNs'):
  metrics['prefix.'+phase+'.'+field]=delta(before['reader']['prefixReplay']['workPhases'][phase][field],after['reader']['prefixReplay']['workPhases'][phase][field])
for key in ('pacingWaitNs','pacingPositiveRemainingNs','pacingWakeLatenessNs','signNs','encodeNs','journalAppendNs','terminalSinkNs'):
 metrics['supplyWall.'+key]=delta(before['supply'][key],after['supply'][key])
assert set(before['observerPhaseTotals'])==set(after['observerPhaseTotals'])
for phase in before['observerPhaseTotals']:
 for field in ('attempts','errors','durationNs'):
  metrics['observer.'+phase+'.'+field]=delta(before['observerPhaseTotals'][phase][field],after['observerPhaseTotals'][phase][field])
assert before['reader']['currentInputReuse']['enabled'] is True and after['reader']['currentInputReuse']['enabled'] is True
assert all(case['reader']['prefixReplay'].get('canonicalCertificate',False) is False for case in (before,after))
assert [case['submitters'] for case in (before,after)]==[8,16]
assert all(case['reader']['prefixReplay'].get('nativeSuffixSetup',False) is False for case in (before,after))
parts=[case['reader']['prefixReplay']['workPhases']['certificatePublishDetails'] for case in (before,after)]
for phase in ('payloadCopy','strictJSON','nativeClone','canonicalNative'):
 for field in ('calls','errors','durationNs'):
  metrics['certificate.'+phase+'.'+field]=delta(parts[0].get(phase,dict(calls=0,errors=0,durationNs=0))[field],parts[1].get(phase,dict(calls=0,errors=0,durationNs=0))[field])
for key in ('payloadBytes','prefixBytesHashed','canonicalNativeAccepted'):
 metrics['certificate.'+key]=delta(parts[0].get(key,0),parts[1].get(key,0))
for key in ('callbackStarted','callbackReturned','activeCallbacksAtEnd','peakActiveCallbacks','callbackBusyNs','queueWaitSamples','queueWaitNs','peakQueueWaitNs','measurementWallNs'):
 metrics['submitOccupancy.'+key]=delta(before['measurement']['runtimeMeasurements']['submissionOccupancy'][key],after['measurement']['runtimeMeasurements']['submissionOccupancy'][key])
for name,fn in {
 'averageActiveCallbacks':lambda o,n:o['callbackBusyNs']/o['measurementWallNs'],
 'callbackWorkerUtilization':lambda o,n:o['callbackBusyNs']/o['measurementWallNs']/n,
 'callbackMeanWallNs':lambda o,n:o['callbackBusyNs']/8192,
 'queueWaitMeanNs':lambda o,n:o['queueWaitNs']/8192,
}.items():metrics['submitOccupancy.'+name]=delta(fn(before['measurement']['runtimeMeasurements']['submissionOccupancy'],8),fn(after['measurement']['runtimeMeasurements']['submissionOccupancy'],16))
result=dict(schema=1,runId=value['runId'],sourceCommit=value['sourceCommit'],originalQualifiedPairSHA256=hashlib.sha256(raw).hexdigest(),cases=2,finalTransactionsPerCase=8192,metrics=metrics,currentInputReuseBefore=before['reader']['currentInputReuse'],currentInputReuseAfter=after['reader']['currentInputReuse'],latencies=[{k:case['measurement'][k] for k in ('latencyIntervalsNs','offerLatencyIntervalsNs','stageGapIntervalsNs')} for case in (before,after)],jointObservation=value['jointObservation'],sameHostIdentity=value['hostIdentity'],binaries=value['binaries'],sustainedTPSQualified=False,interpretation='Only original qualified same-VM/source/four-ELF8192x2. Negative wall/CPU changes indicate reduction; negative rate changes indicate regression. Per-final wall normalizes equal business coverage; wall totals and nested child phases overlap, never add. Sampled peaks are not hard upper bounds. No sustained1000TPS/600s qualification.')
with output.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result['metrics']))
