"""Original failed native pair resource diagnosis; no nodes or qualification.
Arguments: original source packet, selected public capture, NEW output JSON.
Only grant/source/log/receipt/resource facts are verified. Complete transaction
stream readback remains separate; an RSS-refused case is never a TPS result.
"""
import datetime,hashlib,json,os,subprocess,sys
from pathlib import Path
base,capture,out=map(Path,sys.argv[1:])
def read(p):return json.loads(p.read_bytes())
def pin(p):
 raw=p.read_bytes();return dict(path=str(p.absolute()),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
grant_path=base/'original-root-grant.json';g=read(grant_path)
assert pin(grant_path)['bytes']==5713 and pin(grant_path)['sha256']=='a8eb606732ecf79f82d8b7831e8a1a30e1e88e305cb17f80261e780bd0b8ae2f'
assert g['onceOnly'] is True and g['automaticRetry'] is False and g['sourceCommit']=='c594a557e9838cd13892dc53000fb371f9efa2ab'
request=read(base/'root-scheduling-request-with-evidence.json');rp=pin(base/'root-scheduling-request-with-evidence.json')
assert rp['bytes']==g['request']['bytes'] and rp['sha256']==g['request']['sha256']
assert request['workflowInputs']==g['workflowInputs'] and request['runtimeCaps']==g['runtimeCaps']
plan=pin(base/'plan.json');assert plan['bytes']==g['planBytes'] and plan['sha256']==g['planSHA256']
assert len(g['frozenReaders'])==12 and g['frozenReaders']==request['frozenReaders']
for name,ref in g['frozenReaders'].items():
 raw=(base/'frozen-readers'/name).read_bytes();assert len(raw)==ref['bytes'] and hashlib.sha256(raw).hexdigest()==ref['sha256']
 assert raw==subprocess.check_output(['git','show',g['sourceCommit']+':'+name])
api=read(base/'original-complete-run-api.json');ci=read(base/'normal-complete-run-api.json')
assert api['id']==40068452896 and api['head_sha']==g['sourceCommit'] and api['head_branch']==g['frozenRef'] and api['run_attempt']==1 and api['status']=='completed' and api['conclusion']=='failure'
assert ci['id']==40067903355 and ci['head_sha']==g['sourceCommit'] and ci['status']=='completed' and ci['conclusion']=='success'
actual=read(base/'actual-dispatch-once.json');sent=read(base/'actual-dispatch-result.json')
argv=['gh','workflow','run','chain-core.yml','--ref',g['frozenRef']]
for k,v in g['workflowInputs'].items():argv+=['-f',k+'='+v]
assert actual['argv']==argv and actual['once'] is True and actual['grantSHA256']==pin(grant_path)['sha256'] and sent['returncode']==0
assert datetime.datetime.fromisoformat(g['issuedUTC'])<=datetime.datetime.fromisoformat(actual['startUTC'])<datetime.datetime.fromisoformat(g['dispatchDeadline'])
log=(base/'original-full.raw').read_text()
def frames(marker):return [json.loads(l.split(marker,1)[1]) for l in log.splitlines() if marker in l and '\x1b' not in l]
terms=frames('YNX_NATIVE_STREAM_TERMINAL ');pairs=frames('YNX_NATIVE_STREAM_PAIR_TERMINAL ');assert len(terms)==2 and len(pairs)==1
pair=read(capture/'evidence/actual.json');terminal=pairs[0]
assert terminal['pairReceiptSHA256']==pin(capture/'evidence/actual.json')['sha256'] and terminal['qualified'] is False
assert pair['sourceCommit']==g['sourceCommit'] and pair['casesQualified'] is False and len(pair['cases'])==2
assert terms[0]['qualified'] is True and terms[0]['firstCause'] is None and terms[1]['qualified'] is False and terms[1]['firstCause']=='rssBytes cap exceeded/invalid'
def closure(scans):
 assert len(scans)==2 and all(s['owned']==[pair['launcher']] and s['launcherStartTicks']>0 for s in scans)
 assert scans[0]['launcherStartTicks']==scans[1]['launcherStartTicks'];return scans[0]['launcherStartTicks']
ticks=closure(terminal['postFsyncClosureScans']);rows=[];identity=None
for i,label in enumerate(('before-native-tip-full-block','after-native-tip-status')):
 path=capture/label/'evidence/actual.json';row=read(path);term=terms[i]
 assert pin(path)['sha256']==term['receiptSHA256']==pair['cases'][i]['sha256']
 assert row['sourceCommit']==g['sourceCommit'] and row['launcher']==pair['launcher'] and row['cleanupComplete'] is True and row['nodesStarted'] is True
 assert closure(row['closureScans'][-2:])==closure(term['postFsyncClosureScans'])==ticks
 assert row.get('nativeBlockTipHint',False) is (i==1) and row['nativeCurrentInputReuse'] is True and row.get('nativeCanonicalCertificate',False) is False and row.get('nativeSuffixSetup',False) is False
 fields={k:row[k] for k in ('sourceCommit','sourceTree','internalTree','compiler','binaries','environment')};fields['host']={k:row['host'][k] for k in ('uname','cpuCount')}
 if identity is None:identity=fields
 else:assert identity==fields
 roles={child['pid']:child['role'] for child in row['children']};assert len(roles)==10;roles[row['launcher']]='launcher'
 samples=row['samples']+row.get('refusedSamples',[]);peaks={}
 for sample in samples:
  buckets={}
  for task in sample['tasks']:
   role=roles[task['pid']];buckets[role]=buckets.get(role,0)+task['rssBytes'];peaks[role]=max(peaks.get(role,0),task['rssBytes'])
  assert sum(buckets.values())==sample['rssBytes']
 peak=max(samples,key=lambda s:s['rssBytes']);at_peak={roles[t['pid']]:t['rssBytes'] for t in peak['tasks']}
 assert sum(at_peak.values())==peak['rssBytes']
 if i==0:assert peak['rssBytes']<=g['runtimeCaps']['case']['ownedRSSBytes'] and row.get('firstCause') is None
 else:
  assert row['firstCause']=='rssBytes cap exceeded/invalid' and len(row['refusedSamples'])==1 and row['refusedSamples']==term['refusedSamples']
  assert row['refusedSamples'][0]==peak and peak['rssBytes']>g['runtimeCaps']['case']['ownedRSSBytes'] and 'measurement' not in row
 rows.append(dict(label=label,originalReceipt=pin(path),elapsedAtAggregatePeakMs=peak['elapsedMs'],sampledAggregatePeakBytes=peak['rssBytes'],rssAtAggregatePeakByRole=at_peak,independentRolePeaksNotAdditive=peaks,originalCaseQualified=term['qualified'],firstCause=row.get('firstCause'),completeTransactionStreamVerified=False))
result=dict(schema=1,kind='original-refused-pair-resource-evidence-not-throughput',runId=api['id'],sourceCommit=g['sourceCommit'],originalGrant=pin(grant_path),request=rp,originalLog=pin(base/'original-full.raw'),originalPairReceipt=pin(capture/'evidence/actual.json'),consumer=pin(Path(__file__)),sameVMIdentity=pair['hostIdentity'],cases=rows,originalRSSLimitBytes=g['runtimeCaps']['case']['ownedRSSBytes'],refusedRSSExcessBytes=rows[1]['sampledAggregatePeakBytes']-g['runtimeCaps']['case']['ownedRSSBytes'],originalPairQualified=False,originalCleanupScansVerified=True,newExecutionGranted=False,networkOrSustainedQualificationAdded=False,interpretation='Separate aggregate-peak instants, not same transaction progress or a causal role delta. Full streams remain separate; no after TPS. Python receipt retention and allocator highwater require their own source/lifetime evidence. Original budgets unchanged.')
with out.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(dict(refusedRSSExcessBytes=result['refusedRSSExcessBytes'],cleanupVerified=True,qualified=False)))
