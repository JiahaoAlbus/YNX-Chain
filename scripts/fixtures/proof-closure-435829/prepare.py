#!/usr/bin/env python3
"""Reconstruct fixed PUBLIC inputs/source; never execute a verifier or a node."""
import argparse, hashlib, json, os, pathlib, runpy, subprocess, zipfile

parser=argparse.ArgumentParser()
parser.add_argument('--source-root',required=True)
parser.add_argument('--case',required=True)
args=parser.parse_args()
CASE=pathlib.Path(args.case).resolve(strict=True)
REPO=pathlib.Path(args.source_root).resolve(strict=True)
EVIDENCE=CASE/'evidence'
SOURCE = '763b7f8f422f38f39e747a4f7f6cfb6405a0b96d'
TREE = 'f083502be012d84b3cd50e383c3bf2a922d8c2dd'
SUPPLIER = '5a49f5c91452604dffb910df736702b3b9df2562'
FORK = '08747364c24c065bf2b13527c210625d7ec95fba'
ZIP_SHA = 'c2c0dbaf5c51302f2f857c2188eafa508a1e66c4ea89c893a82c1a0bbbc4e5e1'
PREFIX = 'pq-independent-load-q_0vnx7j/public/'
ROOTS = ('go.mod', 'go.sum', 'cmd', 'internal', 'contracts', 'third_party')
ROLES = {'context', 'genesis', 'migration', 'proof', 'publicProofInputs', 'request', 'schedule', 'state', 'trustedLightBlock'}
MANIFEST_PINS = ['68308050423d993863f9adb8a1a533eb590175552cab98390a1bd6a0f92b8b76', 'a3f705532a1cc8237ca0a62bb3ad281b58c9a5d7f44c8016ea449b684fc5ea49']

def sha(raw): return hashlib.sha256(raw).hexdigest()
def git(*args): return subprocess.check_output(['git', '-C', str(REPO), *args])
def pin(path):
    h = hashlib.sha256(); size = 0
    with path.open('rb') as f:
        while block := f.read(1 << 20): h.update(block); size += len(block)
    return {'bytes': size, 'sha256': h.hexdigest()}
def write(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as f: f.write(raw)
def dump(path, obj): write(path, (json.dumps(obj, indent=2, sort_keys=True)+'\n').encode())

assert git('rev-parse', SOURCE+'^{tree}').decode().strip() == TREE
assert git('rev-parse', SUPPLIER+':third_party/cometbft').decode().strip() == FORK
zip_pin = pin(EVIDENCE/'COMPLETE-ORIGINAL.zip')
assert zip_pin == {'bytes': 54288662, 'sha256': ZIP_SHA}
artifacts = json.loads((EVIDENCE/'ARTIFACTS.json').read_bytes())
artifact = artifacts
assert artifact['id'] == 14108709609 and artifact['workflow_run']['id'] == 43582982073
assert artifact['name']=='pq-first100-held-public-owner-43582982073-1'
assert artifact['workflow_run']['head_sha']=='a2799df40c141e8b54e673a403c4af79d71150b5' and not artifact['expired']
assert artifact['size_in_bytes'] == zip_pin['bytes'] and artifact['digest'] == 'sha256:'+ZIP_SHA
with zipfile.ZipFile(EVIDENCE/'COMPLETE-ORIGINAL.zip') as z:
    receipt_raw=z.read(PREFIX+'receipt.json')
assert len(receipt_raw)==720181 and sha(receipt_raw)=='17abba18c82eee2e88e2923c89512c75a6932eed7b1505d30b43f9b6c1a197d8'
receipt=json.loads(receipt_raw)
write(EVIDENCE/'RECEIPT-ORIGINAL.json',receipt_raw)
selection = receipt['normalLiveBuildSource']['originalCoreSelection']['sourceSelection']
native = receipt['normalLiveSourceDependencies']['sourceDependencies']
assert selection['originalSourceCommit'] == SOURCE and selection['originalSourceTree'] == TREE
assert selection['selectedOptionalForkTree'] == FORK and native['source'] == SOURCE
composer_raw = git('show', SOURCE+':scripts/verify/wire-live-matching-source-ci.py')
assert sha(composer_raw) == receipt['normalLiveBuildSource']['compositionScriptSHA256']
composer_path = CASE/'prep/original-composer.py'
write(composer_path, composer_raw)
composer = runpy.run_path(str(composer_path))
assert set(git('diff', '--name-only', selection['originalProductionForkTree'], FORK).decode().splitlines()) == composer['DIFF']
assert not git('diff','--diff-filter=D','--name-only',selection['originalProductionForkTree'],FORK).strip()
assert git('rev-parse','HEAD').decode().strip()==SOURCE
assert not git('status','--porcelain','--untracked-files=normal').strip()
composed=CASE/'composition'
normal_selection=composer['prepare_wire_live_source'](REPO,composed,SOURCE,TREE)
source=composed/'source'
dump(CASE/'SOURCE-SELECTION-NORMAL.json',normal_selection)
for row in native['files']:
    raw = git('show', SOURCE+':'+row['path'])
    assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
    assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == row['gitBlob']
    write(source/row['path'], raw)
for name, expected in selection['moduleDescriptorSHA256'].items(): assert pin(source/name)['sha256'] == expected
for name, expected in selection['retainedProductionSHA256'].items(): assert pin(source/'third_party/cometbft'/name)['sha256'] == expected

entries = {}
for revision, roots in [(SOURCE, ROOTS), (SUPPLIER, ('third_party/cometbft',)), (SOURCE, tuple(r['path'] for r in native['files']))]:
    for row in git('ls-tree','-rz',revision,'--',*roots).split(b'\0'):
        if not row: continue
        head, path = row.split(b'\t',1); mode, kind, blob = head.decode().split()
        assert kind == 'blob' and mode in ('100644','100755')
        entries[path.decode()] = (mode, blob)
ledger = []
for name, (mode, blob) in sorted(entries.items()):
    raw = (source/name).read_bytes()
    assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == blob
    ledger.append(dict(path=name, mode=mode, gitBlob=blob, bytes=len(raw), sha256=sha(raw)))
assert set(p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()) == set(entries)
dump(CASE/'SOURCE-LEDGER.json',ledger)

closures=[]
with zipfile.ZipFile(EVIDENCE/'COMPLETE-ORIGINAL.zip') as z:
    names=z.namelist(); assert len(names)==251 and len(names)==len(set(names))
    for index in range(2):
        relative=f'load-operations/{index:05d}/original-public-proof-manifest.json'
        raw=z.read(PREFIX+relative); assert sha(raw)==MANIFEST_PINS[index]
        m=json.loads(raw)
        assert m['schema']=='YNX-PERF-ORIGINAL-PUBLIC-PROOF-CLOSURE/v1' and set(m['entries'])==ROLES
        assert m['sourceCommit']==SOURCE and m['verifierBinarySHA256']=='6f1633033727073511d71db98224f31e297f1dabe9a89ce68d42e96117328d0e'
        assert m['syntheticOnly'] and not any(m[k] for k in ['actualNetworkExecutionClaim','authorityGranted','independentReverification'])
        write(CASE/f'closure/{index:05d}/original-public-proof-manifest.json',raw)
        for role,row in m['entries'].items():
            assert row['publicRelativePath']=='proof-public-blobs/'+row['sha256']+'.json'
            dest=CASE/f'closure/{index:05d}'/(role+'.json')
            with z.open(PREFIX+row['publicRelativePath']) as src, dest.open('xb') as dst:
                h=hashlib.sha256(); n=0
                while block:=src.read(1<<20): dst.write(block);h.update(block);n+=len(block)
                assert n==row['bytes'] and h.hexdigest()==row['sha256']
        context=json.loads((CASE/f'closure/{index:05d}/context.json').read_bytes())
        assert context['lightTrust']['runtimePlanFile']==''
        closures.append(m)
dump(CASE/'PREPARED.json',dict(schema='YNX-PROOF-CLOSURE-DIAGNOSTIC-PREPARED/v1',sourceCommit=SOURCE,sourceTree=TREE,
    supplierCommit=SUPPLIER,supplierForkTree=FORK,composition='Original normal source composer + exact original eleven native dependencies; independent Git-blob ledger',
    sourceFiles=len(ledger),sourceLedger=pin(CASE/'SOURCE-LEDGER.json'),zip=zip_pin,closures=closures,
    originalPlatform='linux/amd64 CGO_ENABLED=1 Go1.26.11',localPlatform='linux/amd64',linuxEngineAvailable=True,
    originalBinaryPresent=False,normalCurrentClockNowExpired=True,historicalTestClock='2026-11-14T10:06:52Z',
    historicalClockBasis='Original JOB.json completed_at; not an original verifier clock sample',
    portableV1Compatible=False,portableV1Changed=False,goExecuted=False,proofVerified=False,onlineFinalityQualified=False,nodeStarted=False,transactionReplayed=False))
print('PREPARED',source,len(ledger),zip_pin)
