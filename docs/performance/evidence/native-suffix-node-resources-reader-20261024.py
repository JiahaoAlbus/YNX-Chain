"""Original qualified case logs and samples only; no nodes or submissions.
Arguments: qualified pair verdict, NEW output JSON.
"""
import json,sys,math,hashlib
from pathlib import Path
source=Path(sys.argv[1]);output=Path(sys.argv[2]);raw=source.read_bytes();value=json.loads(raw)
assert value['runId']==40060919778 and value['nativePairQualified'] is True and value['slotReturned'] is True
rows=[]
for case in value['cases']:
 receipt=Path(case['receipt']['path']);row=json.loads(receipt.read_bytes());roles={child['pid']:child['role'] for child in row['children']};assert len(roles)==10
 roles[row['launcher']]='launcher'
 samples=row['samples'];peak=max(samples,key=lambda s:s['rssBytes']);peak_roles={};role_max={}
 for sample in samples:
  buckets={}
  for task in sample['tasks']:
   assert task['pid'] in roles
   role=roles[task['pid']];buckets[role]=buckets.get(role,0)+task['rssBytes']
  assert sum(buckets.values())==sample['rssBytes']
  for role,rss in buckets.items():role_max[role]=max(role_max.get(role,0),rss)
  if sample is peak:peak_roles=buckets
 phases={};per_node=[]
 def add(name,ns):
  assert type(ns) is int and ns>=0
  phases.setdefault(name,[]).append(ns)
 for index in range(4):
  total=0;blocks=0
  for line in (receipt.parent.parent/('abci-'+str(index)+'.log')).read_text().splitlines():
   if not line.startswith('YNX_ABCI_PHASE_TIMING '):continue
   data=json.loads(line.split(' ',1)[1]);block=data.get('blockExecution')
   if data['reason']!='commit' or not block or block['transactions']==0:continue
   assert block['transactions']==block['codeZeroTransactions'] and data['commit']['durable'] is True
   total+=block['transactions'];blocks+=1
   commit=data['commit'];add('commit',commit['elapsedNs'])
   for stage,ns in commit['stagesNs'].items():add(stage,ns)
   for stage,ns in commit.get('validationStagesNs',{}).items():add('validate.'+stage,ns)
  assert total==8192
  per_node.append(dict(node=index,businessTransactions=total,businessCommitSamples=blocks))
 def summary(a):
  a=sorted(a);n=len(a)
  return dict(samples=n,totalNs=sum(a),meanNs=sum(a)/n,**{q:a[max(0,math.ceil(f*n)-1)] for q,f in [('p50Ns',.5),('p95Ns',.95),('p99Ns',.99)]})
 rows.append(dict(mode=case['mode'],canonicalCertificate=row.get('nativeCanonicalCertificate',False),perNode=per_node,businessCommitPhases={k:summary(a) for k,a in phases.items()},sampledRSSPeak=peak['rssBytes'],rssAtAggregatePeakByRole=peak_roles,independentRolePeaks=role_max))
result=dict(schema=1,runId=value['runId'],sourceCommit=value['sourceCommit'],qualifiedVerdictSHA256=hashlib.sha256(raw).hexdigest(),cases=rows,networkOrSustainedQualificationAdded=False,interpretation='Business heights only;4node execution samples are not4x business TPS. Per-role peaks occur at different times and must not be added; aggregate peak decomposition uses one actual sample. Stage children/quantiles are nested and not additive; batch density differs.')
with output.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print('original business Commit and per-role sampled RSS derived')
