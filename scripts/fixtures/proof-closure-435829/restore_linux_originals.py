#!/usr/bin/env python3
"""Fixed original PUBLIC paths, exclusive files; no relocation or verification."""
import hashlib,json,os,pathlib,platform,stat
CASE=pathlib.Path(os.environ['YNX_PROOF_CLOSURE_CASE']).resolve(strict=True)
ROOT=pathlib.Path('/home/runner/work/_temp/pq-independent-load-q_0vnx7j')
assert platform.system()=='Linux' and platform.machine()=='x86_64', 'original Linux amd64 runner required'
assert ROOT.parent.resolve(strict=True)==ROOT.parent
assert str(ROOT.parent)==os.environ.get('RUNNER_TEMP'), 'normal original runner temp root required'
# A failed previous restoration remains an original attempt. Never merge/retry.
ROOT.mkdir(mode=0o700)
rows=[]
for index in range(2):
    manifest=json.loads((CASE/f'closure/{index:05d}/original-public-proof-manifest.json').read_bytes())
    base=ROOT/f'.private/network/live-materials/node-{index}/operation-000001'
    expected={'context':'verifier/trust-context.json','genesis':'verifier/genesis.json','migration':'verifier/migration.json','proof':'proof.json','publicProofInputs':'verifier/PUBLIC-PROOF-INPUTS.json','request':'verifier/request.json','schedule':'verifier/schedule.json','state':'verifier/committed-state.json','trustedLightBlock':'verifier/trusted-light-block.json'}
    assert set(manifest['entries'])==set(expected)
    for role,relative in expected.items():
        row=manifest['entries'][role]; target=base/relative
        assert str(target)==row['originalAbsolutePath']
        target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        assert target.parent.resolve(strict=True)==target.parent
        source=CASE/f'closure/{index:05d}'/(role+'.json')
        fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        before=os.fstat(fd)
        assert stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size==row['bytes']
        h=hashlib.sha256(); n=0
        with os.fdopen(fd,'rb') as f, target.open('xb') as out:
            os.fchmod(out.fileno(),0o600)
            while block:=f.read(1<<20):out.write(block);h.update(block);n+=len(block)
            after=os.fstat(f.fileno())
            assert (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)
            assert n==row['bytes'] and h.hexdigest()==row['sha256']
            out.flush();os.fsync(out.fileno())
        rows.append(dict(role=role,index=index,bytes=n,sha256=h.hexdigest(),originalPathUnchanged=True))
with (CASE/'LINUX-PUBLIC-RESTORE.json').open('x') as f:
    json.dump(dict(version='YNX-PROOF-CLOSURE-ORIGINAL-PATH-RESTORE/v1',files=rows,proofVerified=False,authorityGranted=False,transactionReplayed=False),f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
print('ORIGINAL_PUBLIC_PATHS_RESTORED',len(rows),'NO_VERIFICATION_OR_AUTHORITY')
