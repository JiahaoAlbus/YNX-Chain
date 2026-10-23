"""Read-only diagnostics of original failed side; confirmed-subset latency only.
No successful8192/network/A-B/sustained acceptance, no RPC or retry.
"""
import base64,collections,gzip,hashlib,importlib.util,json,math,subprocess,sys
from pathlib import Path
base=Path(sys.argv[1]).absolute();root=Path(sys.argv[2]).absolute();out=Path(sys.argv[3]).absolute();case=root/'capture/before-native-stream-relative';network=case/'network'
spec=importlib.util.spec_from_file_location('original_stream',base/'frozen-readers/native-stream-evidence.py');e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
receipt=e.strict_json(e.capture(case/'evidence/actual.json',16<<20));raw=e.capture(network/'transactions-result.json',16<<20);report=e.strict_json(raw)
assert hashlib.sha256(raw).hexdigest()==receipt['partialMeasurement']['resultSHA256'] and report['summary']==receipt['partialMeasurement']['summary']
assert receipt['sourceCommit']=='6d653b63835e56fecb9d6bf07cc9a661e880e4cf' and report['summary']['input']==8192 and receipt['partialMeasurement']['qualified'] is False
manifest_raw=e.capture(network/'network-manifest.json',1<<20);manifest=e.strict_json(manifest_raw)
binding=dict(kind='YNX_LOCAL_READY_SENDER_V1',manifestSha256=e.digest(manifest_raw),migrationHash=manifest['migrationStateHash'],genesisHash=manifest['genesisHash'])
initial=e.strict_json(e.capture(network/'transactions.json',16<<20))['transactions'];assert len(initial)==2048
templates=[e.strict_json(base64.b64decode(encoded,validate=True)) for encoded in initial];intent=report['readySenders']['intentSegments'];terminal=report['terminalStream'];runtime=Path(receipt['case'])/'network'
intents={};chain=e.ZERO;size=0;last=[0]*2048
path,before=e.inventory(network,runtime,intent['directory'],'sender-ready-intents','intent',intent,8192)
for segment in range(intent['segments']):
 data=e.capture(path/('intent-%06d.jsonl'%segment),e.SEGMENT_LIMIT);size+=len(data);first,payload=data.split(b'\n',1);header=e.strict_json(first);lines=payload[:-1].split(b'\n')
 assert header['kind']=='YNX_LOCAL_READY_INTENT_SEGMENT_V1' and header['fixture']==binding and header['segment']==segment and header['firstRecord']==len(intents) and header['records']==len(lines) and header['previousSha256']==chain and header['payloadSha256']==e.digest(payload)
 chain=e.digest(data)
 for line in lines:
  row=e.strict_json(line);i=row['index'];sender=i%2048;round_number=i//2048+1
  assert type(i) is int and 0<=i<8192 and i not in intents and row['sender']==sender and row['round']==round_number==last[sender]+1
  wire=e.signed_shape(row['transaction'],templates,sender,round_number);assert row['hash']==e.digest(wire).upper();last[sender]=round_number;intents[i]=row
assert len(intents)==intent['records'] and size==intent['bytes'] and chain==intent['chainSha256'];e.finish_directory(path,before)
counts=collections.Counter();seen=set();chain=e.ZERO;sequence=0;size=0;fold=e.LatencyFold();business_heights=set();missing_failed_signed=0
path,before=e.inventory(network,runtime,terminal['directory'],'transactions-result.json.terminal-stream','terminal',terminal,8192)
for segment in range(terminal['segments']):
 stored=e.capture(path/('terminal-%06d.jsonl'%segment),e.SEGMENT_LIMIT);size+=len(stored);data=gzip.decompress(stored);assert len(data)<=e.SEGMENT_LIMIT and data.endswith(b'\n');lines=data[:-1].split(b'\n');header=e.strict_json(lines[0])
 assert header['kind']=='YNX_LOCAL_TERMINAL_SEGMENT_V1' and header['fixture']==binding and header['segment']==segment and header['firstSequence']==sequence and header['previousSha256']==chain
 for line in lines[1:-1]:
  frame=e.strict_json(line);assert frame['sequence']==sequence and frame['previousSha256']==chain;chain=e.digest(line);sequence+=1;row=frame['result'];i=row['index'];assert type(i) is int and 0<=i<8192 and i not in seen and i in intents and row['round']==i//2048+1;seen.add(i);counts[row['status']]+=1
  if row.get('signedTransaction'):
   wire=e.signed_shape(row['signedTransaction'],templates,i%2048,row['round']);assert row['hash']==intents[i]['hash']==e.digest(wire).upper() and row['signedTransaction']==intents[i]['transaction'] and row['bytes']==len(wire)
  else:assert row['status']!='confirmed';missing_failed_signed+=1
  if row['status']=='confirmed':
   assert row['checkTxCode']==row['executionCode']==0 and all(row.get(k) is True for k in ('checkTxIdentityVerified','quorumVerified','transactionProofVerified','durableStateVerified','durableInfoVerified'))
   assert row['height']==row['durableStateHeight']==row['durableInfoHeight'] and row['height']>0
   fold.add(row);business_heights.add(row['height'])
 seal=e.strict_json(lines[-1]);assert seal['kind']=='YNX_LOCAL_TERMINAL_SEAL_V1' and seal['records']==len(lines)-2 and seal['chainSha256']==chain
assert sequence==terminal['records']==terminal['durableRecords']==report['summary']['offered'] and size==terminal['bytes'] and chain==terminal['chainSha256'];e.finish_directory(path,before)
assert counts['confirmed']==report['summary']['finalSubmitted']==6312
code="import fs from 'node:fs';import{pathToFileURL}from'node:url';const{readNodePhaseTiming:r}=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify(process.argv.slice(2).map(p=>r(fs.readFileSync(p,'utf8')))));"
phases=json.loads(subprocess.check_output(['/opt/homebrew/bin/node','--input-type=module','-e',code,str(base/'frozen-readers/node-phase-timing.mjs')]+[str(case/('abci-'+str(i)+'.log')) for i in range(4)],timeout=10));assert phases==receipt['nodePhases']
samples=collections.defaultdict(list)
for node in range(4):
 for line in (case/('abci-'+str(node)+'.log')).read_text().splitlines():
  if not line.startswith('YNX_ABCI_PHASE_TIMING '):continue
  row=json.loads(line.split(' ',1)[1])
  if row['reason']!='commit' or row['commit']['height'] not in business_heights:continue
  commit=row['commit'];values=dict(commit=commit['elapsedNs'],**commit['stagesNs']);values.update({'validate.'+k:v for k,v in commit['validationStagesNs'].items()})
  for key,value in values.items():samples[key].append(value)
def dist(values):
 v=sorted(values);n=len(v);return dict(samples=n,meanMs=sum(v)/n/1e6,p50Ms=v[math.ceil(n*.5)-1]/1e6,p95Ms=v[math.ceil(n*.95)-1]/1e6,p99Ms=v[math.ceil(n*.99)-1]/1e6)
value=dict(schema=1,runId=40034580462,sourceCommit=receipt['sourceCommit'],nativePairQualified=False,full8192Qualified=False,secondCaseActivated=False,sustainedTPSQualified=False,firstCause='original client30s context deadline exceeded; original relative side incomplete',originalResultSHA256=e.digest(raw),reportedFailedSummary=report['summary'],intentRecordsIdentityVerified=len(intents),terminalRecordsHashChainVerified=sequence,terminalStatusCounts=dict(counts),failedRowsWithoutSignedEnvelope=missing_failed_signed,confirmedSubsetOnly=True,confirmedSubsetOriginalFlagsAndSignedIdentitiesVerified=True,confirmedSubsetLatency=fold.result(),originalFourABCIPhaseLogsMatchReceipt=True,observedConfirmedBusinessHeights=len(business_heights),commitDistributionsAtThoseHeights={k:dist(v) for k,v in samples.items()},supplyPhases=report['readySenders']['supply'],readyState={k:report['readySenders'][k] for k in ('prepared','offered','completed','quarantinedAccounts','peakInFlightAccounts','roundsCompleted','queues')},processCPU=report['processCPU'],submissionOccupancy=report['submissionOccupancy'],reader=report['durableReadback'],interpretation='Only failed-side diagnostics. Complete recovered original manifests, signed identities and terminal seals are checked; confirmed6312-subset latencies exclude remaining1880 planned inputs and cannot qualify full-load latency or sustainedTPS. Original reported flags do not independently repeat BFT cryptography. Commit distributions use heights with confirmed observations; nested child phases/CPU/parallel waits overlap. Original thirty-second deadline and all UNKNOWN/failures remain; no second side or A/B conclusion.')
with out.open('x') as f:json.dump(value,f,indent=2);f.write('\n')
print(json.dumps(dict(statuses=value['terminalStatusCounts'],confirmedSubsetLatency=value['confirmedSubsetLatency']['offerLatencyIntervalsNs'],commit=value['commitDistributionsAtThoseHeights']['commit'],encode=value['commitDistributionsAtThoseHeights']['delta_encode'],fsync=value['commitDistributionsAtThoseHeights']['file_sync'],full8192Qualified=False)))
