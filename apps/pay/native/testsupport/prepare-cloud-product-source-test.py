#!/usr/bin/env python3
"""Prepare a new P06 delta test over the complete pinned original Cloud source.

Only the external test closure gains a Go fixture. Original owner files are
never edited; PUBLIC Source/pricing fixture setup is reused, not admission.
"""
import hashlib
import json
from pathlib import Path
import sys
import tarfile

handoff, expected, output = sys.argv[1:]
handoff, output = Path(handoff), Path(output)
assert output.is_absolute() and '/owners/P06/client-consumer-work/' in str(output)
raw = handoff.read_bytes()
assert hashlib.sha256(raw).hexdigest() == expected
h = json.loads(raw)
manifest = h['sourceManifest']
mraw = Path(manifest['path']).read_bytes()
assert len(mraw) == manifest['bytes'] and hashlib.sha256(mraw).hexdigest() == manifest['sha256']
files = json.loads(mraw)['files']
for f in files:
    relative = Path(f['relative'])
    assert not relative.is_absolute() and '..' not in relative.parts
    original = Path(h['frozenSource']) / relative
    assert original.is_file() and not original.is_symlink()
    data = original.read_bytes()
    assert len(data) == f['bytes'] and hashlib.sha256(data).hexdigest() == f['sha256'], relative
    target = output / 'source' / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
source = output / 'source'
client = source / 'apps/cloud/client'
package = client / 'node_modules/@ynx-chain/open-protocol'
with tarfile.open(client / 'vendor/ynx-chain-open-protocol-0.0.0-dev.4.tgz') as archive:
    for item in archive.getmembers():
        p = Path(item.name)
        assert p.parts[0] == 'package' and '..' not in p.parts and not p.is_absolute()
        assert item.isdir() or item.isfile()
        target = package.joinpath(*p.parts[1:])
        if item.isdir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(item).read())

# Reuse the supplier's actual Store/normal-host fixture setup. The only new
# journey is P06 -> actual original Cloud client -> original read route, twice
# across actual cold reopen and once after the original read Source revokes.
original = (source / 'internal/cloud/ide_deployment_v2_readback_test.go').read_text()
body = original[original.index('func p04V2NormalReadback('):]
body = body.replace('func p04V2NormalReadback(t *testing.T, nativeIntent bool)', 'func TestP06ProductSourceActualCloudColdAndRevoke(t *testing.T)')
body = body.replace('\tcodec, _, payload, body :=', '\tnativeIntent := true\n\tcodec, _, payload, body :=', 1)
body = body.replace('filepath.Abs("../../apps/cloud/client/deployment-v2-service-readback.fixture.mjs")', 'filepath.Abs(os.Getenv("PAY_PRODUCT_SOURCE_CLOUD_DRIVER"))')
body = body.replace('\tfirst := run(false)', '\tqueriesBefore := pay.queries\n\tfirst := run(false)', 1)
body = body.replace('pay.queries != 2', 'pay.queries != queriesBefore')
body = body.replace('V2_NORMAL_READ', 'P06_PRODUCT_SOURCE_ACTUAL_CLOUD_READ')
imports = original[original.index('import ('):original.index('\n)') + 2].replace('\n\t"io"', '\n\t"os"')
overlay = source / 'internal/cloud/pay_product_source_consumer_test.go'
overlay.write_text('package cloud\n\n' + imports + '\n\n' + body)
receipt = {'supplier': str(handoff), 'handoffSha256': expected, 'verifiedSourceFiles': len(files),
           'consumerSourceRoot': str(source), 'overlay': str(overlay),
           'overlaySha256': hashlib.sha256(overlay.read_bytes()).hexdigest(),
           'PUBLICSourceFixture': True, 'SourceAdmission': False, 'supplierOldTestsRerun': False}
(output / 'INTAKE.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
