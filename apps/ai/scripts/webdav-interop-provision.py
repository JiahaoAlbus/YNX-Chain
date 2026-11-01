#!/usr/bin/env python3
"""Verify pinned official PyPI wheels and retain primary provenance, no root writes."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile

def isolated_root(value):
    try:
        target = Path(value).resolve()
        if str(target).startswith('/Volumes/'):
            return True
        runner_value = os.environ.get('RUNNER_TEMP', '')
        if os.environ.get('CI') != 'true' or not runner_value or not Path(runner_value).is_absolute():
            return False
        runner = Path(runner_value).resolve()
        return runner != Path('/') and runner.is_dir() and runner in target.parents
    except (OSError, ValueError, RuntimeError):
        return False

if len(sys.argv) == 2 and sys.argv[1] in ('--help', '-h'):
    print('Usage: webdav-interop-provision.py ISOLATION_ROOT [--download]\nLocal: /Volumes/...; CI: CI=true and a strict descendant of absolute existing RUNNER_TEMP. No production tenants.')
    raise SystemExit(0)

if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != '--download') or not isolated_root(sys.argv[1]):
    raise SystemExit('Require /Volumes/... or CI=true with a strict child of absolute existing RUNNER_TEMP')
root = Path(sys.argv[1]).resolve()
wheels = root / 'upstream/wheels'
metadata = root / 'upstream/pypi-metadata'
for folder in (wheels, metadata, root / 'evidence'):
    folder.mkdir(parents=True, exist_ok=True)
pins = {'wsgidav': '4.3.3', 'cheroot': '10.0.1', 'defusedxml': '0.7.1', 'jinja2': '3.1.6', 'json5': '0.9.28', 'pyyaml': '6.0.2', 'markupsafe': '2.1.5', 'jaraco-functools': '4.1.0', 'more-itertools': '10.5.0'}
if len(sys.argv) == 3:
    wheels.mkdir(exist_ok=True)
    temp = root / 'upstream/tmp'
    temp.mkdir(exist_ok=True)
    subprocess.run([sys.executable, '-m', 'pip', '--isolated', 'download', '--disable-pip-version-check', '--no-cache-dir', '--no-deps', '--only-binary=:all:', '--index-url', 'https://pypi.org/simple', '--dest', str(wheels)] + ['%s==%s' % pair for pair in pins.items()], env=dict(os.environ, TMPDIR=str(temp)), check=True)

def verify(wheel):
    with ZipFile(wheel) as z:
        meta = z.read(next(n for n in z.namelist() if n.endswith('.dist-info/METADATA'))).decode()
        name = next(x[6:] for x in meta.splitlines() if x.startswith('Name: '))
        version = next(x[9:] for x in meta.splitlines() if x.startswith('Version: '))
        licenses = [n for n in z.namelist() if not n.endswith('/') and Path(n).name.lower().startswith(('license', 'copying'))]
        license_documents = [{'path': n, 'bytes': len(z.read(n)), 'sha256': hashlib.sha256(z.read(n)).hexdigest()} for n in licenses]
        license_classifiers = [n[12:] for n in meta.splitlines() if n.startswith('Classifier: License ::')]
    source = 'https://pypi.org/pypi/%s/%s/json' % (name, version)
    dest = metadata / (name + '-' + version + '.json')
    subprocess.run(['curl', '-sSfL', '--max-time', '30', '-o', str(dest), source], check=True)
    data = json.loads(dest.read_text())
    release = next(x for x in data['urls'] if x['filename'] == wheel.name)
    digest = hashlib.sha256(wheel.read_bytes()).hexdigest()
    assert digest == release['digests']['sha256'], wheel.name
    return {'name': name, 'version': version, 'wheel': wheel.name, 'bytes': wheel.stat().st_size, 'sha256': digest, 'officialPyPIMatch': True, 'source': release['url'], 'metadata': source, 'license': data['info']['license'], 'licenseClassifiers': license_classifiers, 'licenseDocuments': license_documents, 'licenseFiles': licenses, 'requiresDist': data['info']['requires_dist']}

with ThreadPoolExecutor(max_workers=3) as pool:
    rows = list(pool.map(verify, sorted(wheels.glob('*.whl'))))
assert len(rows) == 9
assert {x['name'].lower().replace('_', '-').replace('.', '-'): x['version'] for x in rows} == pins
(root / 'evidence/wsgidav-provenance.json').write_text(json.dumps({'upstream': 'WsgiDAV 4.3.3 / cheroot 10.0.1', 'upstreamDocs': 'https://github.com/mar10/wsgidav/tree/v4.3.3', 'license': 'MIT', 'licensePrimary': 'https://raw.githubusercontent.com/mar10/wsgidav/v4.3.3/LICENSE', 'scope': 'FilesystemProvider only; no MySQLBrowser sample, production, real tenants or payments', 'wheels': rows}, indent=2))
(root / 'upstream/requirements.lock').write_text('\n'.join('%s==%s --hash=sha256:%s' % (x['name'], x['version'], x['sha256']) for x in rows) + '\n')
print(json.dumps({'verifiedWheels': len(rows), 'totalBytes': sum(x['bytes'] for x in rows), 'manifest': str(root / 'evidence/wsgidav-provenance.json')}))
