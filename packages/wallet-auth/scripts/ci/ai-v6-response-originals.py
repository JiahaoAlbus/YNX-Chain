#!/usr/bin/env python3
"""Only new PUBLIC C++ DATA controls; no Native/Go/math/Root execution."""
from pathlib import Path
import hashlib,json,os,platform,shutil,subprocess,tempfile
root=Path(__file__).resolve().parents[2]
test=root/'test/ai-v6-response-originals'
source=root/'native/ai-v6-response-originals'
for name,pin in json.loads((test/'FIXTURE_PINS.json').read_text()).items():
    raw=(test/'fixtures'/name).read_bytes()
    if len(raw)!=pin['bytes'] or hashlib.sha256(raw).hexdigest()!=pin['sha256']:
        raise SystemExit('AI_RESPONSE_ORIGINAL_AUTH_DATA_FIXTURE_DIFFERS:'+name)
with tempfile.TemporaryDirectory(prefix='ynx-ai-response-originals-',dir=os.environ.get('RUNNER_TEMP')) as tmp:
    compiler=shutil.which('clang++') or shutil.which('c++')
    if not compiler:raise SystemExit('CXX_NOT_SUPPLIED')
    argv=[compiler,'-std=c++17','-Wall','-Wextra','-Werror','-O0','-I',str(source),'-I',str(test/'fixtures'),str(source/'AIResponseOutcomeOriginalsDATA.cpp'),str(test/'fixtures/MobileCanonicalDATA.cpp'),str(test/'response-originals.cpp'),'-o',str(Path(tmp)/'controls')]
    if platform.system()!='Darwin':argv+=['-lcrypto']
    subprocess.run(argv,check=True)
    subprocess.run([str(Path(tmp)/'controls')],check=True)
