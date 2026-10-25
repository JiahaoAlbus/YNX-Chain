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
e.need(receipt.get('sourceCommit')=='31fe7b86ca74c290dfcd410eea27d1b44f379b31' and receipt.get('firstCause') is None and receipt.get('cleanupComplete') is True and receipt.get('nodesStarted') is True,'original complete native case required')
api=e.strict_json(capture(run_api_path,65536));e.need(type(api.get('id')) is int and api['id']==40176399057 and api.get('head_sha')=='31fe7b86ca74c290dfcd410eea27d1b44f379b31' and api.get('event')=='workflow_dispatch' and api.get('run_attempt')==1 and api.get('status')=='completed','original terminal run/source identity differs')
expected_modes={'before-native-grouped-procs1':'grouped-cadence4','after-native-grouped-procs2':'grouped-cadence4'}
e.need(case.name in expected_modes and Path(receipt['case']).name==case.name and receipt.get('pacingMode')==expected_modes[case.name] and receipt.get('nativePreparedCertificate') is True and receipt.get('nativeCachedFeeJSON',False) is False,'original grouped pair case scope differs')
network=case/'network';raw=capture(network/'transactions-result.json',16<<20);report=e.strict_json(raw)
e.need(e.digest(raw)==receipt['resultSHA256'],'original report hash differs')
measurement=c.validate_native_stream_report(report,network,runtime_network=Path(receipt['case'])/'network',pacing=expected_modes[case.name],expected_input_reuse=receipt['nativeCurrentInputReuse'],expected_canonical_certificate=receipt.get('nativeCanonicalCertificate',False),expected_native_suffix=receipt.get('nativeSuffixSetup',False),expected_block_tip_hint=receipt.get('nativeBlockTipHint',False),expected_submitters=receipt.get('nativeStreamSubmitters',8),expected_prepared_certificate=receipt.get('nativePreparedCertificate',False),expected_client_procs2=case.name=='after-native-grouped-procs2')
e.need(measurement==receipt['measurement'],'original full case readback differs')
logs=[case/('abci-'+str(i)+'.log') for i in range(4)]
# Reuse the exact completed original node audit rather than reparse node logs.
audit_path=case.parent.parent/'original-business-checkpoint-phases-01.json'
e.need(pin(audit_path,1<<20)['bytes']==int(sys.argv[5]) and pin(audit_path,1<<20)['sha256']==sys.argv[6],'original node audit differs')
audit=e.strict_json(capture(audit_path,1<<20));e.need(audit['runId']==40176399057 and audit['sourceCommit']==receipt['sourceCommit'],'node audit source/run differs')
audit_case=next(c for c in audit['cases'] if c['name']==case.name)
phases=receipt['nodePhases'];e.need(len(phases)==len(audit_case['nodes'])==4,'node coverage differs')
for i,node in enumerate(audit_case['nodes']):
 e.need(node['completeLogValidated'] is True and node['source']==pin(logs[i],1<<20) and node['cumulativeHandlerTimings']==phases[i]['stages'],'original node audit input changed')
c.validate_exit_mm_samples(receipt,True)
manifest_raw=capture(network/'network-manifest.json',1<<20);manifest=e.strict_json(manifest_raw)
initial=e.strict_json(capture(network/'transactions.json',16<<20))['transactions']
replica_tool=Path('/Users/huangjiahao/.codex/worktrees/chain-performance-20261017/YNX Chain/docs/performance/evidence/native-prepared-replica-completion-reader-20261024.py')
e.need(replica_tool.read_bytes()==subprocess.check_output(['git','show','31fe7b86ca74c290dfcd410eea27d1b44f379b31:docs/performance/evidence/'+replica_tool.name]),'replica join source differs')
replica=load('replica_completion_consumer',replica_tool)
join=replica.replica_join_type(e)([n['rpcUrl'] for n in manifest['nodes']],phases,measurement['timeSeries'])
proof=e.verify_streams(network,str(Path(receipt['case'])/'network'),str(Path(receipt['case'])/'network/transactions-result.json'),manifest_raw,initial,report['readySenders']['intentSegments'],report['terminalStream'],report['transactions'],4,64<<20,node_completion_join=join)
result=dict(schema=1,runId=api['id'],originalRunAPI=pin(run_api_path,65536),sourceCommit=receipt['sourceCommit'],diagnosticSource='31fe7b86ca74c290dfcd410eea27d1b44f379b31',originalReceiptSHA256=e.digest(receipt_raw),originalClientSHA256=e.digest(raw),reader=pin(base/'frozen-readers/scripts/loadtest/native-stream-evidence.py',1<<20),originalNodeAuditReused=pin(audit_path,1<<20),nodeLogs=[pin(p,1<<20) for p in logs],join=proof['nodeCompletionJoin'],replicaJoin=join.replica_result(),replicaConsumer=pin(replica_tool,1<<20),originalSignedTerminalIdentity=proof['originalPublicMemberManifest'],networkQualificationAdded=False,bftQuorumFormationInstantMeasured=False,networkQualified=False,sustainedTPSQualified=False)
with output.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result['join']))
