"""Posthoc source-repair diagnostic only; cannot qualify original failed run.
Arguments: original source packet, complete original capture, NEW output JSON.
"""
import hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path
base,capture,out=map(Path,sys.argv[1:]);base=base.resolve();capture=capture.resolve()
controller=Path('scripts/loadtest/supply-linux-window.py').resolve()
assert controller.read_bytes()==subprocess.check_output(['git','show','bc4ed12d129b8ce3631ac6471a64323bbf2b8b67:scripts/loadtest/supply-linux-window.py'])
def pin(path):
 raw=path.read_bytes();return dict(path=str(path),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
for name in ['native-stream-evidence.py','node-phase-timing.mjs','native-stream-verifier.py']:
 assert Path('scripts/loadtest',name).read_bytes()==(base/'frozen-readers/scripts/loadtest'/name).read_bytes()
raw_proof_path=capture.parent/'failed-original-public-raw-recovery.json';raw_proof=json.loads(raw_proof_path.read_bytes())
assert raw_proof['diagnosticRawRecoveryOnly'] is True and raw_proof['originalFullReadbackPassed'] is False and raw_proof['networkRangeBytes']==0
assert raw_proof['artifact']['artifactId']==12556983116 and raw_proof['artifact']['runId']==40085358438
spec=importlib.util.spec_from_file_location('repaired_controller_diagnostic',controller);c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c);e=c.stream_evidence
pair=e.strict_json(e.capture(capture/'evidence/actual.json',16<<20));assert pair['firstCause']=='post-fsync stream scope differs' and pair['casesQualified'] is False
rows=[]
for index,label in enumerate(['before-native-submit8','after-native-submit16']):
 root=capture/label;receipt=e.strict_json(e.capture(root/'evidence/actual.json',16<<20));client_raw=e.capture(root/'network/transactions-result.json',16<<20);client=e.strict_json(client_raw)
 assert receipt['sourceCommit']=='c8b7a2f6b14034acbf4a4e801a3260b86a659368' and receipt['cleanupComplete'] is True and receipt['clientExit']['returncode']==0
 assert receipt.get('firstCause')==(None if index==0 else 'native verifier: stream worker scope differs')
 if index==0:assert receipt['resultSHA256']==hashlib.sha256(client_raw).hexdigest()
 runtime=Path(receipt['case'])/'network'
 measured=c.validate_native_stream_report(client,root/'network',runtime_network=runtime,pacing='bounded-cadence',expected_input_reuse=True,expected_canonical_certificate=False,expected_native_suffix=False,expected_block_tip_hint=False,expected_submitters=8 if index==0 else 16)
 # Reparse all original node logs, then join by block/transaction/height using
 # the unchanged original evidence math. Never repair original receipt fields.
 code="import fs from 'node:fs';import{pathToFileURL}from'node:url';const{readNodePhaseTiming:r}=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify(process.argv.slice(2).map(p=>r(fs.readFileSync(p,'utf8')))));"
 logs=[root/f'abci-{i}.log' for i in range(4)]
 phases=json.loads(subprocess.check_output(['/opt/homebrew/bin/node','--input-type=module','-e',code,str(base/'frozen-readers/scripts/loadtest/node-phase-timing.mjs')]+[str(p) for p in logs],timeout=10))
 assert phases==receipt['nodePhases']
 manifest_raw=e.capture(root/'network/network-manifest.json',1<<20);manifest=e.strict_json(manifest_raw);initial=e.strict_json(e.capture(root/'network/transactions.json',16<<20))['transactions']
 join=e.NodeCompletionJoin([n['rpcUrl'] for n in manifest['nodes']],phases,measured['timeSeries'],8192)
 proof=e.verify_streams(root/'network',str(runtime),str(runtime/'transactions-result.json'),manifest_raw,initial,client['readySenders']['intentSegments'],client['terminalStream'],client['transactions'],4,64<<20,node_completion_join=join)
 rows.append(dict(label=label,submitters=8 if index==0 else 16,receipt=pin(root/'evidence/actual.json'),client=pin(root/'network/transactions-result.json'),originalFirstCause=receipt.get('firstCause'),measurement=measured,nodeCompletionJoin=proof['nodeCompletionJoin'],nodePhases=phases,nodeLogs=[pin(p) for p in logs]))
result=dict(schema=1,runId=40085358438,originalSourceCommit='c8b7a2f6b14034acbf4a4e801a3260b86a659368',posthocControllerSource='bc4ed12d129b8ce3631ac6471a64323bbf2b8b67',consumer=pin(Path(__file__)),controller=pin(controller),originalRawRecovery=pin(raw_proof_path),cases=rows,diagnosticCompleteStreamReadback=True,posthocControllerRepairUsed=True,originalPairQualified=False,originalAfterPostFsyncTerminalMissing=True,networkQualified=False,sustainedTPSQualified=False,interpretation='Complete original signed streams and node observations pass only a posthoc repaired diagnostic controller. Original failed verifier/terminal/resource admission is never replaced, and no original pair improvement or sustained1000 qualification is created.')
fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
print(json.dumps(dict(diagnosticCompleteStreamReadback=True,posthocControllerRepairUsed=True,originalPairQualified=False,sustainedTPSQualified=False,output=pin(out))))
