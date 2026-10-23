"""Derive finite actual block/phase metrics from the fully qualified original case.
No RPC, new workload, retry or before/after inference. All evidence remains original.
"""
import collections,gzip,hashlib,json,math,re,sys
from pathlib import Path
root=Path(sys.argv[1]);out=Path(sys.argv[2]);capture=root/'capture'
qualified=json.loads((root/'original-case-qualified.json').read_text());assert qualified['nativeCaseQualified'] is True
receipt=json.loads((capture/'evidence/actual.json').read_text());report=json.loads((capture/'network/transactions-result.json').read_text())
counts=collections.Counter();declared={};apphash={};stages=collections.defaultdict(float);transients=collections.Counter();n=0
for index in range(report['terminalStream']['segments']):
 raw=gzip.decompress((capture/'network/transactions-result.json.terminal-stream'/('terminal-%06d.jsonl'%index)).read_bytes())
 for line in raw.splitlines()[1:-1]:
  row=json.loads(line)['result'];assert row['status']=='confirmed'
  height=row['height'];counts[height]+=1;n+=1
  total=row['blockTxTotal'];state_hash=row['durableStateAppHash'].upper()
  assert height not in declared or declared[height]==total
  assert height not in apphash or apphash[height]==state_hash
  declared[height]=total;apphash[height]=state_hash
  q,c,i,f=(row[k] for k in ('queueDelayMs','checkTxMs','inclusionMs','confirmationMs'))
  for name,value in dict(queue=q,checkTx=c,checkToObservedInclusion=i-c,observedInclusionToFinal=f-i,offerToIncluded=q+i,offerToFinal=q+f).items():assert value>=0;stages[name]+=value
  for error in row.get('errors') or []:transients[error.get('stage','unspecified')]+=error['count']
assert n==8192 and dict(counts)==declared and sum(transients.values())==report['summary']['errorOccurrences']
node_blocks=[];all_samples=collections.defaultdict(list);business_samples=collections.defaultdict(list)
for node in range(4):
 finalized={};committed={};file=capture/('comet-'+str(node)+'.log')
 for line in file.read_text().splitlines():
  if 'finalized block ' in line:
   height=int(re.search(r'\bheight=(\d+)\b',line)[1]);txs=int(re.search(r'\bnum_txs_res=(\d+)\b',line)[1]);digest=re.search(r'\bblock_app_hash=([A-Fa-f0-9]{64})\b',line)[1].upper()
   assert height not in finalized;finalized[height]=(txs,digest)
  if 'committed state ' in line:
   height=int(re.search(r'\bheight=(\d+)\b',line)[1]);digest=re.search(r'\bblock_app_hash=([A-Fa-f0-9]{64})\b',line)[1].upper();assert height not in committed;committed[height]=digest
 for height in counts:
  assert finalized[height]==(counts[height],apphash[height])
  # Pinned Comet0.38.23 execution.go443 logs block.AppHash in committed-state:
  # the header at H binds the post-state of H-1. The next header binds H.
  assert committed[height]==finalized[height-1][1] and committed[height+1]==apphash[height]
 node_blocks.append(dict(node=node,businessHeights=len(counts),businessTransactionInputs=sum(counts.values()),allOriginalFinalizedAndNextHeaderCommittedHashesMatch=True,lastCommittedHeight=max(committed)))
 for line in (capture/('abci-'+str(node)+'.log')).read_text().splitlines():
  if not line.startswith('YNX_ABCI_PHASE_TIMING '):continue
  frame=json.loads(line.split('YNX_ABCI_PHASE_TIMING ',1)[1])
  if frame['reason']!='commit':continue
  commit=frame['commit'];values=dict(commit=commit['elapsedNs'],**commit['stagesNs'])
  values.update({'validate.'+k:v for k,v in commit['validationStagesNs'].items()})
  for key,value in values.items():
   all_samples[key].append(value)
   if commit['height'] in counts:business_samples[key].append(value)
def distribution(values):
 values=sorted(values);n=len(values)
 return dict(samples=n,meanMs=sum(values)/n/1e6,p50Ms=values[math.ceil(n*.50)-1]/1e6,p95Ms=values[math.ceil(n*.95)-1]/1e6,p99Ms=values[math.ceil(n*.99)-1]/1e6)
peak=max(receipt['samples'],key=lambda r:r['rssBytes']);role={row['pid']:row['role'] for row in receipt['children']};peak_tasks=[dict(pid=t['pid'],role=role.get(t['pid'],'launcher'),rssBytes=t['rssBytes'],threads=t['threads']) for t in peak['tasks']]
result=dict(schema=1,runId=40026609226,sourceCommit=receipt['sourceCommit'],caseQualifiedSHA256=hashlib.sha256((root/'original-case-qualified.json').read_bytes()).hexdigest(),hardware=dict(logicalCPUs=receipt['host']['cpuCount'],cpuModel=re.search(r'model name\s*:\s*(.*)',receipt['host']['cpuinfo'])[1],uname=receipt['host']['uname']),summary=report['summary'],businessBlockTransactions=dict(sorted(counts.items())),originalFourCometLogAgreement=node_blocks,originalNodeCommitAllBlocks={k:distribution(v) for k,v in all_samples.items()},originalNodeCommitBusinessBlocks={k:distribution(v) for k,v in business_samples.items()},meanPerTransactionStageMs={k:v/n for k,v in stages.items()},transientObservationRecordsByStage=dict(transients),supplyPhases=report['readySenders']['supply'],prefixReplay=report['durableReadback']['prefixReplay'],readerBudget=report['durableReadback']['readerBudget'],readerPhaseTotalsNs=report['durableReadback']['phaseTotalsNs'],runtime=receipt['measurement']['runtimeMeasurements'],peakSample=dict(elapsedMs=peak['elapsedMs'],tasks=peak_tasks,rssBytes=peak['rssBytes']),timeSeries=receipt['measurement']['timeSeries'],latencyIntervalsNs=receipt['measurement']['latencyIntervalsNs'],offerLatencyIntervalsNs=receipt['measurement']['offerLatencyIntervalsNs'],stageGapIntervalsNs=receipt['measurement']['stageGapIntervalsNs'],allEightNodesSpawnedMarker=qualified['actualNodesSpawned'],firstNodeStartIndividuallyInstrumented=False,firstNodeBeforeDeadlineProvenByAllEightSpawnedUpperBound=True,nativeCaseQualified=True,matchedBeforeAfter=False,sustained1000Qualified=False,interpretation='Original complete8192 records plus four original Comet block tx counts/post-execution app hashes and next-header committed-state hashes all agree. Comet0.38.23 committed-state log atH prints block.AppHash, the H-1 post-state; this is not a same-height post-state hash. Node distributions separate business-bearing blocks from empty warmup/drain blocks; validation child times are nested in Commit. Means/gaps use each original transaction before aggregation; interval quantiles are original bounded1ms histograms. Phase wall totals/CPU/node totals overlap and must not be summed as critical-path finality. First-node deadline follows from the all-eight-spawned upper bound, not an invented direct timestamp. One finite low actual offer window, no matched improvement or sustained TPS claim.')
with out.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(dict(output=str(out),businessBlockHeights=len(counts),businessCommitSamples=len(business_samples['commit']),allCommitSamples=len(all_samples['commit']),cometNodesVerified=4,allOriginalRows=n,transientRecords=sum(transients.values()),nodeBusinessCommit=result['originalNodeCommitBusinessBlocks']['commit'],nodeBusinessEncode=result['originalNodeCommitBusinessBlocks'].get('delta_encode'),nodeBusinessFileSync=result['originalNodeCommitBusinessBlocks']['file_sync'])))
