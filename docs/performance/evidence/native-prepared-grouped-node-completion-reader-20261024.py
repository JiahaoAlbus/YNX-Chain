"""Offline diagnostic only: complete original case + node points, no HTTP/nodes.
Arguments: source packet, recovered original case root, NEW output JSON, original terminal run API JSON. Original source/resource/
BFT admission is separate and cannot be manufactured by this diagnostic join.
"""
import hashlib,importlib.util,json,subprocess,sys,shutil
from pathlib import Path
base=Path(sys.argv[1]).resolve()
case=Path(sys.argv[2]).absolute();output=Path(sys.argv[3]).absolute();run_api_path=Path(sys.argv[4]).absolute()
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
e=load('completion_diagnostic',base/'frozen-readers/scripts/loadtest/native-stream-evidence.py')
c=load('frozen_controller',base/'frozen-readers/scripts/loadtest/supply-linux-window.py')
def capture(path,limit):return e.capture(path,limit)
def pin(path,limit):
 raw=capture(path,limit);return dict(path=str(path),bytes=len(raw),sha256=e.digest(raw))
receipt_raw=capture(case/'evidence/actual.json',16<<20);receipt=e.strict_json(receipt_raw)
e.need(receipt.get('sourceCommit')=='1f21f1f2eed732c0948ac98ff7028bee5f2d6ca4' and receipt.get('firstCause') is None and receipt.get('cleanupComplete') is True and receipt.get('nodesStarted') is True,'original complete native case required')
api=e.strict_json(capture(run_api_path,65536));e.need(type(api.get('id')) is int and api['id']>0 and api.get('head_sha')=='1f21f1f2eed732c0948ac98ff7028bee5f2d6ca4' and api.get('event')=='workflow_dispatch' and api.get('run_attempt')==1 and api.get('status')=='completed','original terminal run/source identity differs')
expected_modes={'before-native-prepared-bounded':'bounded-cadence','after-native-prepared-grouped':'grouped-cadence4'}
e.need(case.name in expected_modes and Path(receipt['case']).name==case.name and receipt.get('pacingMode')==expected_modes[case.name] and receipt.get('nativePreparedCertificate') is True and receipt.get('nativeCachedFeeJSON',False) is False,'original grouped pair case scope differs')
network=case/'network';raw=capture(network/'transactions-result.json',16<<20);report=e.strict_json(raw)
e.need(e.digest(raw)==receipt['resultSHA256'],'original report hash differs')
measurement=c.validate_native_stream_report(report,network,runtime_network=Path(receipt['case'])/'network',pacing=expected_modes[case.name],expected_input_reuse=receipt['nativeCurrentInputReuse'],expected_canonical_certificate=receipt.get('nativeCanonicalCertificate',False),expected_native_suffix=receipt.get('nativeSuffixSetup',False),expected_block_tip_hint=receipt.get('nativeBlockTipHint',False),expected_submitters=receipt.get('nativeStreamSubmitters',8),expected_prepared_certificate=receipt.get('nativePreparedCertificate',False))
e.need(measurement==receipt['measurement'],'original full case readback differs')
code="import fs from 'node:fs';import{pathToFileURL}from'node:url';const{readNodePhaseTiming:r}=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify(process.argv.slice(2).map(p=>r(fs.readFileSync(p,'utf8')))));"
logs=[case/('abci-'+str(i)+'.log') for i in range(4)]
phases=json.loads(subprocess.check_output([shutil.which('node') or 'node','--input-type=module','-e',code,str(base/'frozen-readers/scripts/loadtest/node-phase-timing.mjs')]+[str(p) for p in logs],timeout=10))
e.need(phases==receipt['nodePhases'],'original parsed node phase receipt differs')
manifest_raw=capture(network/'network-manifest.json',1<<20);manifest=e.strict_json(manifest_raw)
initial=e.strict_json(capture(network/'transactions.json',16<<20))['transactions']
join=e.NodeCompletionJoin([n['rpcUrl'] for n in manifest['nodes']],phases,measurement['timeSeries'],8192)
proof=e.verify_streams(network,str(Path(receipt['case'])/'network'),str(Path(receipt['case'])/'network/transactions-result.json'),manifest_raw,initial,report['readySenders']['intentSegments'],report['terminalStream'],report['transactions'],4,64<<20,node_completion_join=join)
result=dict(schema=1,runId=api['id'],originalRunAPI=pin(run_api_path,65536),sourceCommit=receipt['sourceCommit'],diagnosticSource='1f21f1f2eed732c0948ac98ff7028bee5f2d6ca4',originalReceiptSHA256=e.digest(receipt_raw),originalClientSHA256=e.digest(raw),reader=pin(base/'frozen-readers/scripts/loadtest/native-stream-evidence.py',1<<20),nodeLogs=[pin(p,1<<20) for p in logs],join=proof['nodeCompletionJoin'],originalSignedTerminalIdentity=proof['originalPublicMemberManifest'],networkQualified=False,sustainedTPSQualified=False)
with output.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result['join']))
