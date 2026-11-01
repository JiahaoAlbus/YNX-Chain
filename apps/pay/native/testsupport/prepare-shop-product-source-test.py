#!/usr/bin/env python3
"""Freeze the original Shop's complete Git Go graph and add one P06 delta.

No owner checkout mutation, live leaves, build flags or authority enrollment.
Final owner H is separate from this fixed-commit consumer test receipt.
"""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

repository, commit, output = sys.argv[1:]
output = Path(output)
assert output.is_absolute() and '/owners/P06/client-consumer-work/' in str(output)
actual = subprocess.check_output(['git', '-C', repository, 'rev-parse', commit + '^{commit}'], text=True).strip()
assert actual == commit
paths = ['go.mod', 'go.sum', 'internal', 'packages/auth-grant-policy/go',
         'packages/auth-grant-runtime/go', 'packages/auth-grant-history-client/go', 'packages/open-protocol/go']
archive = subprocess.check_output(['git', '-C', repository, 'archive', commit, *paths])
source = output / 'source'
files = []
with tarfile.open(fileobj=io.BytesIO(archive)) as entries:
    for item in entries:
        relative = Path(item.name)
        assert not relative.is_absolute() and '..' not in relative.parts
        assert item.isfile() or item.isdir()
        target = source / relative
        if item.isdir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            data = entries.extractfile(item).read()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            files.append({'relative': str(relative), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
overlay = Path(__file__).with_name('product_source_shop_consumer_test.go.txt').read_bytes()
(source / 'internal/commerce/p06_product_source_consumer_test.go').write_bytes(overlay)
receipt = {'sourceCommit': commit, 'originalGitRepositoryReadOnly': repository,
           'consumerSourceRoot': str(source), 'completeGitGoGraph': paths, 'files': files,
           'ownTestOverlaySha256': hashlib.sha256(overlay).hexdigest(),
           'SourceAdmission': False, 'PUBLICBusinessAuthorityFixture': True,
           'supplierOldMatrixRerun': False}
(output / 'INTAKE.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'sourceCommit': commit, 'frozenFiles': len(files), 'output': str(output)}))
