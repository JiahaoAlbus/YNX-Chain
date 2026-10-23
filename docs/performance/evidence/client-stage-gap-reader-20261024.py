"""Derive ordered client-observed phase gaps from the already qualified original pair.
No network, workload or new business acceptance. Exact nanosecond RFC3339 parsing.
"""
import calendar,hashlib,json,math,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
PROOF=ROOT/'docs/performance/evidence/observer-native-facts-pair-ci-39996035179-actual.json'
RAW=ROOT/'artifacts/chain-performance-20261017/observer-native-facts-pair-39996035179'
def pin(p):
 b=p.read_bytes();return dict(path=str(p),bytes=len(b),sha256=hashlib.sha256(b).hexdigest())
def ns(value):
 match=re.fullmatch(r'(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?Z',value)
 if not match:raise RuntimeError('exact UTC timestamp required')
 fields=[int(v) for v in match.groups()[:6]]
 return calendar.timegm((*fields,0,0,0))*1_000_000_000+int((match[7] or '').ljust(9,'0'))
def distribution(values):
 ordered=sorted(values)
 def q(percent):return ordered[max(0,math.ceil(len(ordered)*percent)-1)]/1e6
 return dict(samples=len(values),meanMs=sum(values)/len(values)/1e6,p50Ms=q(.5),p95Ms=q(.95),p99Ms=q(.99),maxMs=ordered[-1]/1e6)
def derive(client):
 rows=client['transactions']
 if len(rows)!=2048 or any(r.get('status')!='confirmed' or r.get('executionCode')!=0 or any(r.get(k) is not True for k in ('checkTxIdentityVerified','quorumVerified','transactionProofVerified','durableStateVerified','durableInfoVerified')) for r in rows):raise RuntimeError('full original2048 successful qualified business rows required')
 fields=['offeredAt','submittedAt','checkTxObservedAt','includedObservedAt','confirmedObservedAt']
 names=['offeredToSubmission','submissionToCheckTxObserved','checkTxObservedToInclusionObserved','inclusionObservedToQualifiedFinalObserved']
 samples={name:[] for name in names};samples['offeredToQualifiedFinalObserved']=[];blocks={}
 for r in rows:
  times=[ns(r[k]) for k in fields]
  if times!=sorted(times):raise RuntimeError('original phase timestamps not ordered')
  gaps=[b-a for a,b in zip(times,times[1:])]
  if sum(gaps)!=times[-1]-times[0]:raise RuntimeError('per-input critical path did not reconcile exactly')
  for name,gap in zip(names,gaps):samples[name].append(gap)
  samples['offeredToQualifiedFinalObserved'].append(times[-1]-times[0])
  block=blocks.setdefault(r['height'],dict(inclusion=[],final=[],count=0))
  block['inclusion'].append(times[-2]);block['final'].append(times[-1]);block['count']+=1
 total=sum(samples['offeredToQualifiedFinalObserved'])
 stages={name:dict(distribution(values),**(dict(shareOfTotalMean=sum(values)/total) if name in names else {})) for name,values in samples.items()}
 callback=[];response=[];tail=[]
 for r in rows:
  ph=r['submissionPhases'];a,b,c=(ph[k] for k in ('firstWroteRequestNs','firstResponseByteNs','callbackReturnNs'))
  if any(type(v) is not int for v in (a,b,c)) or not 0<=a<=b<=c:raise RuntimeError('original HTTP trace phase ordering differs')
  callback.append(c);response.append(b-a);tail.append(c-b)
 http=dict(callbackWall=distribution(callback),writeToFirstByte=distribution(response),firstByteToCallbackReturn=distribution(tail),optimisticEightWorkerServiceRate=8*len(callback)*1e9/sum(callback),interpretation='8 divided by observed mean callback wall is an optimistic finite-client service-capacity diagnostic excluding pacing/idle/other work, not chain TPS, a sustained rate or a promise under a different load. Small per-input CheckTx latency can still limit throughput with a fixed worker pool.')
 return dict(rows=2048,allPerRowCriticalPathSumsExact=True,stageGaps=stages,httpPhases=http,businessBlocks=[dict(height=height,transactions=b['count'],observedInclusionSpreadMs=(max(b['inclusion'])-min(b['inclusion']))/1e6,qualifiedFinalObservationSpreadMs=(max(b['final'])-min(b['final']))/1e6) for height,b in sorted(blocks.items())])
if __name__=='__main__':
 original=PROOF.read_bytes()
 if len(original)!=1016461 or hashlib.sha256(original).hexdigest()!='cceb6602272a1b39a458a4736215cb94f4abfa8f6ae05d1edff8ed86ce35f852':raise RuntimeError('original committed full-readout identity differs')
 proof=json.loads(original)
 if proof['sourceCommit']!='73b4abc00503a59128e312bb2ee27e9999c61f1f' or proof['fullOriginalBusinessRawReadoutPending'] is not False:raise RuntimeError('original full qualified readout required')
 cases=[]
 for side in ('before','after'):
  path=RAW/(side+'-transactions-result.json');actual=pin(path)
  matches=[p for p in proof['raw'] if Path(p['path']).name==path.name]
  if len(matches)!=1 or any(matches[0][k]!=actual[k] for k in ('sha256','bytes')):raise RuntimeError('original full-readout raw pin differs')
  cases.append(dict(side=side,raw=actual,**derive(json.loads(path.read_bytes()))))
 result=dict(schema=1,runId=39996035179,sourceCommit=proof['sourceCommit'],originalFullQualifiedReadout=pin(PROOF),derivation=pin(Path(__file__).resolve()),cases=cases,interpretation='All4096 original qualified rows. Ordered observed wall intervals reconcile per input. CheckTx→inclusion includes actual chain waiting, polling and client scheduling; inclusion→qualified final includes quorum/durable proof work and client scheduling. These are not pure node stages or BFT vote instants. P95 values must not be added. Mean shares refer to the same2048 rows; no new network measurement or sustained qualification.')
 out=ROOT/'docs/performance/evidence/observer-native-facts-client-stage-gaps-39996035179-actual.json'
 if out.exists():raise RuntimeError('preserve existing derivation output')
 out.write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(dict(output=pin(out),cases=[dict(side=c['side'],stageGaps=c['stageGaps'],businessBlocks=c['businessBlocks']) for c in cases]),indent=2))
