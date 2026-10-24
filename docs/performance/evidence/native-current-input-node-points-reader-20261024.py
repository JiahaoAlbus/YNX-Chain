"""Offline diagnostic only: complete original case + node points, no HTTP/nodes.
Arguments: recovered original case root, NEW output JSON. Original source/resource/
BFT admission is separate and cannot be manufactured by this diagnostic join.
"""
import hashlib,importlib.util,json,subprocess,sys,shutil
from pathlib import Path
base=Path(sys.argv[1]).absolute()
case=Path(sys.argv[2]).absolute();output=Path(sys.argv[3]).absolute()
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
e=load('completion_diagnostic',base/'diagnostic-readers-publication-fix/native-stream-evidence.py')
frozen=load('frozen_controller',base/'frozen-readers/supply-linux-window.py')
c=load('corrected_controller',base/'diagnostic-readers-publication-fix/supply-linux-window.py')
def capture(path,limit):return e.capture(path,limit)
def pin(path,limit):
 raw=capture(path,limit);return dict(path=str(path),bytes=len(raw),sha256=e.digest(raw))
receipt_raw=capture(case/'evidence/actual.json',16<<20);receipt=e.strict_json(receipt_raw)
e.need(receipt.get('sourceCommit')=='7c4cac62a6e434d2ee7eb6c3793421c95a3035b7' and receipt.get('firstCause')=='stream durable plan/report differs: maxRuntimeMs' and receipt.get('cleanupComplete') is True and receipt.get('nodesStarted') is True,'original complete native case required')
network=case/'network';raw=capture(network/'transactions-result.json',16<<20);report=e.strict_json(raw)
e.need(e.digest(raw)==receipt['partialMeasurement']['resultSHA256'],'original report hash differs')
try:
 frozen.validate_native_stream_report(report,network,runtime_network=Path(receipt['case'])/'network',pacing='bounded-cadence',expected_input_reuse=receipt['nativeCurrentInputReuse'])
except RuntimeError as error:
 e.need(str(error)=='stream durable plan/report differs: maxRuntimeMs','original rejection firstCause changed')
else:raise RuntimeError('original stale reader unexpectedly qualified')
measurement=c.validate_native_stream_report(report,network,runtime_network=Path(receipt['case'])/'network',pacing='bounded-cadence',expected_input_reuse=receipt['nativeCurrentInputReuse'])
e.need(report['summary']==receipt['partialMeasurement']['summary'],'original partial receipt summary differs')
code="import fs from 'node:fs';import{pathToFileURL}from'node:url';const{readNodePhaseTiming:r}=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify(process.argv.slice(2).map(p=>r(fs.readFileSync(p,'utf8')))));"
logs=[case/('abci-'+str(i)+'.log') for i in range(4)]
phases=json.loads(subprocess.check_output([shutil.which('node') or 'node','--input-type=module','-e',code,str(base/'frozen-readers/node-phase-timing.mjs')]+[str(p) for p in logs],timeout=10))
e.need(phases==receipt['nodePhases'],'original parsed node phase receipt differs')
manifest_raw=capture(network/'network-manifest.json',1<<20);manifest=e.strict_json(manifest_raw)
initial=e.strict_json(capture(network/'transactions.json',16<<20))['transactions']
join=e.NodeCompletionJoin([n['rpcUrl'] for n in manifest['nodes']],phases,measurement['timeSeries'],8192)
proof=e.verify_streams(network,str(Path(receipt['case'])/'network'),str(Path(receipt['case'])/'network/transactions-result.json'),manifest_raw,initial,report['readySenders']['intentSegments'],report['terminalStream'],report['transactions'],4,64<<20,node_completion_join=join)
result=dict(schema=1,runId=40044977213,sourceCommit=receipt['sourceCommit'],diagnosticSource='uncommitted-plan-and-publication-fix; exact reader SHA retained',originalNativePairQualified=False,originalConsumerRejected=True,originalConsumerFirstCause=receipt['firstCause'],posthocCorrectedReadback=True,correctedController=pin(base/'diagnostic-readers-publication-fix/supply-linux-window.py',1<<20),originalReceiptSHA256=e.digest(receipt_raw),originalClientSHA256=e.digest(raw),reader=pin(base/'diagnostic-readers-publication-fix/native-stream-evidence.py',1<<20),nodeLogs=[pin(p,1<<20) for p in logs],join=proof['nodeCompletionJoin'],originalSignedTerminalIdentity=proof['originalPublicMemberManifest'],networkQualified=False,sustainedTPSQualified=False)
with output.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result['join']))
