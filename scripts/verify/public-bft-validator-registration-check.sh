#!/usr/bin/env bash
set -Eeuo pipefail

# Run in the original Linux CI after its normal ynx-comet build and actual
# public light-fixture export. The fixture contains genuinely signed public
# registration bytes; curl below is an isolated transport stub, not a node,
# cryptographic verifier, deployed root or transaction-finality proof.
repo="$(cd "$(dirname "$0")/../.." && pwd)"
encoder="${1:?normal built ynx-comet path required}"
fixture="${2:?actual public light-proof fixture required}"
[[ "$#" == 2 ]] || { echo 'expected exactly normal encoder and public fixture paths' >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
python3 - "$repo" "$encoder" "$fixture" "$tmp" <<'PY'
import base64, copy, hashlib, json, os, pathlib, subprocess, sys

repo,encoder,fixture_path,tmp=map(pathlib.Path,sys.argv[1:])
encoder=encoder.resolve(strict=True)
caller=repo/'scripts/ops/public-bft-validator-registration.sh'
fixture_original=fixture_path.read_bytes()
fixture=json.loads(fixture_original)
assert fixture['version']=='YNX-PQ-CONSENSUS-LIGHT-PROOF-PUBLIC-FIXTURE/v1'
assert fixture['syntheticOnly'] is True and fixture['normalFileLoaderVerified'] is True and fixture['nativeRootAuthorized'] is False
material=next(x for x in fixture['materials'] if x['name']=='committed-state.json')
state_bytes=base64.b64decode(material['bytes'],validate=True)
assert str(len(state_bytes))==material['byteLength'] and hashlib.sha256(state_bytes).hexdigest()==material['sha256']
state=json.loads(state_bytes)
registry=state['validatorRegistry']
event=registry['events'][0]
wire=base64.b64decode(event['wire'],validate=True)
assert len(wire)>50000 # the original complete AND proof, not a placeholder
wire_pin=hashlib.sha256(wire).hexdigest(); encoder_pin=hashlib.sha256(encoder.read_bytes()).hexdigest()
source=tmp/'original-registration.wire'; source.write_bytes(wire); source.chmod(0o600)
encoded_run=subprocess.run([str(encoder),'encode-validator-registration','--wire',str(source),'--wire-sha256',wire_pin],capture_output=True,check=False,timeout=15)
assert encoded_run.returncode==0,encoded_run.stderr.decode(errors='replace')
encoding=json.loads(encoded_run.stdout)
payload=base64.b64decode(encoding['payloadBase64'],validate=True)
assert encoding['registrationAuthorized'] is False and encoding['abciHash']==event['abciHash'] and encoding['operationHash']==event['operationHash']
assert encoding['approvedAt']==str(event['height']) and encoding['consensusGenesisSHA256']==registry['bootstrap']['cometGenesisSHA256']
tx_hash=encoding['abciHash'][2:].upper()
height=event['height']; index=event['transactionIndex']
b64=lambda x:base64.b64encode(x).decode()
result={'code':0,'data':b64(encoding['abciHash'].encode()),'log':'ynx_validator_registry_v1'}
txs=[b64(b'unrelated source-control envelope') for _ in range(index)]+[b64(payload)]
results=[{'code':1} for _ in range(index)]+[result]
rpc=lambda body,identity=-1:{'jsonrpc':'2.0','id':identity,'result':body}
baseline={
 'broadcast':rpc({'hash':tx_hash,'height':str(height),'check_tx':{'code':0},'tx_result':result},'validator-registration'),
 'tx':rpc({'hash':tx_hash,'height':str(height),'index':index,'tx_result':result,'tx':b64(payload)}),
 'block':rpc({'block_id':{'hash':'D'*64},'block':{'header':{'chain_id':encoding['chainId'],'height':str(height)},'data':{'txs':txs}}}),
 'block_results':rpc({'height':str(height),'txs_results':results}),
 'abci_query':rpc({'response':{'code':0,'height':str(state['height']),'value':b64(json.dumps(registry,separators=(',',':')).encode())}}),
}
bin_dir=tmp/'bin'; bin_dir.mkdir(mode=0o700)
curl=bin_dir/'curl'
curl.write_text('''#!/usr/bin/env python3
import base64,json,os,pathlib,sys,urllib.parse
args=sys.argv[1:]
root=pathlib.Path(os.environ['REGISTRATION_CONTROL_ROOT'])
assert args[0]=='--disable' and '--location' not in args and '-L' not in args
assert args[args.index('--retry')+1]=='0'
assert args[args.index('--noproxy')+1]=='*'
url=args[args.index('--url')+1]; parsed=urllib.parse.urlsplit(url)
assert parsed.scheme=='http' and parsed.netloc=='127.0.0.1:27757'
mode='broadcast' if '--request' in args else parsed.path[1:]
if mode=='broadcast':
 assert args[args.index('--request')+1]=='POST'
 request=json.loads(pathlib.Path(args[args.index('--data-binary')+1][1:]).read_bytes())
 assert request['method']=='broadcast_tx_commit' and request['id']=='validator-registration'
 assert base64.b64decode(request['params']['tx'],validate=True)==(root/'payload').read_bytes()
 # The irreversible intent/body are durable files before any transport call.
 attempt=root/'attempt'
 assert json.loads((attempt/'intent.json').read_bytes())['status']=='unknown'
 assert (attempt/'transaction.json').read_bytes()==(root/'payload').read_bytes()
 assert (attempt/'registration.wire').is_file()
else:
 assert '--data-binary' not in args and mode in ('tx','block','block_results','abci_query')
 query=urllib.parse.parse_qs(parsed.query)
 if mode=='tx': assert query['hash']==['0x'+os.environ['REGISTRATION_CONTROL_HASH']]
 if mode=='abci_query': assert query=={'path':['"/validator-registry"'],'height':['0'],'prove':['false']}
with open(root/'calls','a') as f: f.write(mode+'\\n')
scenario=(root/'scenario').read_text()
if mode=='broadcast' and scenario=='timeout':
 print('synthetic curl timeout after request dispatch',file=sys.stderr); sys.exit(28)
status='302' if scenario=='redirect' and mode=='broadcast' else '200'
body=json.loads((root/'responses.json').read_bytes())[mode]
pathlib.Path(args[args.index('--output')+1]).write_text(json.dumps(body,separators=(',',':')))
print(status,end='')
''')
curl.chmod(0o700)
counter=0
def case(scenario='normal',responses=None):
 global counter
 counter+=1
 root=tmp/f'case-{counter}'; root.mkdir(mode=0o700)
 (root/'scenario').write_text(scenario); (root/'calls').write_text('')
 (root/'responses.json').write_text(json.dumps(responses or baseline,separators=(',',':')))
 (root/'payload').write_bytes(payload)
 return root
def args_for(root,mode='submit'):
 a=['bash',str(caller),mode,'--attempt-dir',str(root/'attempt'),'--rpc','http://127.0.0.1:27757','--encoder',str(encoder),'--encoder-sha256',encoder_pin,'--wire-sha256',wire_pin]
 if mode=='submit': a+=['--wire',str(source)]
 return a
def invoke(root,mode='submit',modify=None,approval=True):
 env=dict(os.environ,PATH=str(bin_dir)+os.pathsep+os.environ['PATH'],REGISTRATION_CONTROL_ROOT=str(root),REGISTRATION_CONTROL_HASH=encoding['abciHash'][2:])
 env.pop('PUBLIC_BFT_VALIDATOR_REGISTRATION_APPROVED',None)
 if approval: env['PUBLIC_BFT_VALIDATOR_REGISTRATION_APPROVED']='yes'
 args=args_for(root,mode)
 if modify: modify(args)
 completed=subprocess.run(args,env=env,capture_output=True,timeout=30,check=False)
 return completed
def calls(root):return (root/'calls').read_text().splitlines()
def refused(run,fragment):
 assert run.returncode!=0 and fragment.encode() in run.stderr,(fragment,run.returncode,run.stdout,run.stderr)
def retained(root):
 assert (root/'attempt/registration.wire').read_bytes()==wire
 assert (root/'attempt/transaction.json').read_bytes()==payload
 assert json.loads((root/'attempt/intent.json').read_bytes())['status']=='unknown'
def snapshot(root):
 return {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}

# Normal codec with the genuine signed public source wire; all HTTP results
# remain transport fixtures, explicitly not mathematical/finality proofs.
root=case(); run=invoke(root)
assert run.returncode==0,(run.stdout,run.stderr)
receipt=json.loads(run.stdout)
assert receipt['status']=='registered_observed' and receipt['registrationObserved'] is True
assert receipt['height']==str(height) and receipt['transactionIndex']==str(index)
assert receipt['abciHash']==event['abciHash'] and receipt['operationHash']==event['operationHash']
assert all(receipt[k] is False for k in ('independentFinalityVerified','scheduleAuthorized','pqActivationVerified','automaticRetry'))
assert calls(root)==['broadcast','tx','block','block_results','abci_query']
retained(root)
before=snapshot(root/'attempt'); run=invoke(root); refused(run,'File exists')
assert before==snapshot(root/'attempt') and calls(root).count('broadcast')==1
run=invoke(root,'readback',approval=False)
assert run.returncode==0,(run.stdout,run.stderr)
assert calls(root).count('broadcast')==1 and calls(root)[-4:]==['tx','block','block_results','abci_query']
retained(root)

# Timeout after dispatch: no completion, original bytes remain, only explicit
# readback may resolve it. Neither repeated submit nor readback retransmits.
root=case('timeout'); run=invoke(root); refused(run,'VALIDATOR_REGISTRATION_UNKNOWN')
retained(root); assert calls(root)==['broadcast']
before=snapshot(root/'attempt'); run=invoke(root); refused(run,'File exists')
assert before==snapshot(root/'attempt') and calls(root)==['broadcast']
(root/'scenario').write_text('normal')
run=invoke(root,'readback',approval=False); assert run.returncode==0,(run.stdout,run.stderr)
assert calls(root).count('broadcast')==1

for label in ('approval','wire-pin','encoder-pin','extra-arg','abbreviated-arg','duplicate','nonloopback-http','wire-symlink','preexisting','dangling'):
 root=case()
 def mutate(a):
  if label=='wire-pin': a[a.index('--wire-sha256')+1]='f'*64
  if label=='encoder-pin': a[a.index('--encoder-sha256')+1]='f'*64
  if label=='extra-arg': a.append('--unknown-option')
  if label=='abbreviated-arg': a[a.index('--wire-sha256')]='--wire-sha'
  if label=='duplicate': a+=['--wire-sha256',wire_pin]
  if label=='nonloopback-http': a[a.index('--rpc')+1]='http://192.0.2.1:27757'
  if label=='wire-symlink':
   p=root/'wire-link'; p.symlink_to(source); a[a.index('--wire')+1]=str(p)
 if label=='preexisting': (root/'attempt').mkdir(); (root/'attempt/UNKNOWN').write_text('retain original')
 if label=='dangling': (root/'attempt').symlink_to(root/'missing-original')
 run=invoke(root,modify=mutate,approval=label!='approval')
 assert run.returncode!=0 and calls(root)==[],(label,run.stdout,run.stderr)
 if label=='preexisting': assert (root/'attempt/UNKNOWN').read_text()=='retain original'
 if label=='dangling': assert (root/'attempt').is_symlink()

# Normal Go decoder refuses a malformed complete-wire input before transport.
root=case(); malformed=root/'malformed.wire'; malformed.write_bytes(wire+b'\0')
def malformed_args(a):
 a[a.index('--wire')+1]=str(malformed); a[a.index('--wire-sha256')+1]=hashlib.sha256(malformed.read_bytes()).hexdigest()
run=invoke(root,modify=malformed_args); refused(run,'normal Go registration encoder refused')
assert calls(root)==[] and (root/'attempt/registration.wire').read_bytes()==malformed.read_bytes()

for label in ('redirect','rpc-error-with-result','bad-hash','check-only','data','wrong-height','index','block-index','wrong-chain','block-result','registry-pending','registry-wire','registry-operation','registry-duplicate','registry-network'):
 responses=copy.deepcopy(baseline)
 if label=='rpc-error-with-result': responses['broadcast']['error']={'code':-1,'message':'transport fixture error'}
 if label=='bad-hash': responses['broadcast']['result']['hash']='E'*64
 if label=='check-only': responses['broadcast']['result'].pop('tx_result')
 if label=='data':
  responses['tx']['result']['tx_result']['data']=b64(b'0x' + b'0'*64)
  responses['broadcast']['result']['tx_result']=responses['tx']['result']['tx_result']
  responses['block_results']['result']['txs_results'][index]=responses['tx']['result']['tx_result']
 if label=='wrong-height': responses['tx']['result']['height']=str(height+1)
 if label=='index': responses['tx']['result']['index']=index+1
 if label=='block-index': responses['block']['result']['block']['data']['txs'][index]=b64(b'not original')
 if label=='wrong-chain': responses['block']['result']['block']['header']['chain_id']='wrong-chain'
 if label=='block-result': responses['block_results']['result']['txs_results'][index]={'code':1}
 if label.startswith('registry-'):
  reg=copy.deepcopy(registry)
  if label=='registry-pending': responses['abci_query']['result']['response']['height']=str(height-1)
  if label=='registry-wire': reg['events'][0]['wire']=b64(wire[:-1]+bytes([wire[-1]^1]))
  if label=='registry-operation': reg['events'][0]['operationHash']='0x'+'e'*64
  if label=='registry-duplicate': reg['events'].append(copy.deepcopy(reg['events'][0]))
  if label=='registry-network': reg['bootstrap']['cometGenesisSHA256']='e'*64
  responses['abci_query']['result']['response']['value']=b64(json.dumps(reg,separators=(',',':')).encode())
 root=case(label,responses); run=invoke(root)
 refused(run,'VALIDATOR_REGISTRATION_UNKNOWN'); retained(root)
 assert calls(root).count('broadcast')==1,(label,calls(root))
 assert not any(json.loads(p.read_bytes()).get('registrationObserved') is True for p in (root/'attempt').glob('observation-*/result.json'))

# Explicit CheckTx rejection is not committed registration and not a retry grant.
responses=copy.deepcopy(baseline); responses['broadcast']['result']['check_tx']['code']=9
root=case(responses=responses); run=invoke(root)
assert run.returncode==3 and json.loads(run.stdout)['status']=='check_rejected'
assert json.loads(run.stdout)['registrationObserved'] is False and calls(root)==['broadcast']
retained(root)

# Committed failure can be observed without falsely claiming registration.
responses=copy.deepcopy(baseline)
failure={'code':9,'log':'rejected'}
responses['broadcast']['result']['tx_result']=failure; responses['tx']['result']['tx_result']=failure
responses['block_results']['result']['txs_results'][index]=failure
responses['abci_query']['result']['response']['value']=b64(b'null')
root=case(responses=responses); run=invoke(root)
assert run.returncode==3,(run.stdout,run.stderr)
assert json.loads(run.stdout)['status']=='execution_rejected' and json.loads(run.stdout)['registrationObserved'] is False
assert calls(root).count('broadcast')==1

# Reconciliation rejects changed retained original bytes and changed external
# endpoint/pins without a second write or an invented replacement intent.
root=case('timeout'); run=invoke(root); refused(run,'VALIDATOR_REGISTRATION_UNKNOWN')
before=snapshot(root/'attempt')
for flag,value in [('--rpc','http://127.0.0.1:27758'),('--wire-sha256','f'*64),('--encoder-sha256','f'*64)]:
 def changed(a): a[a.index(flag)+1]=value
 run=invoke(root,'readback',modify=changed,approval=False); refused(run,'readback differs from original fixed attempt inputs')
 assert calls(root)==['broadcast'] and snapshot(root/'attempt')==before
root=case('timeout'); run=invoke(root); refused(run,'VALIDATOR_REGISTRATION_UNKNOWN')
original_intent=(root/'attempt/intent.json').read_bytes()
body_path=root/'attempt/transaction.json'; body_path.write_bytes(payload+b' ')
run=invoke(root,'readback',approval=False); refused(run,'preserved ABCI identity changed')
assert calls(root)==['broadcast'] and (root/'attempt/intent.json').read_bytes()==original_intent
assert body_path.read_bytes()==payload+b' '

assert source.read_bytes()==wire and fixture_path.read_bytes()==fixture_original
assert hashlib.sha256(encoder.read_bytes()).hexdigest()==encoder_pin
print('VALIDATOR_REGISTRATION_CALLER_CONTROLS_PASS normalGoCodec=true syntheticTransport=true networkRequests=0 registrationActivated=false')
PY
