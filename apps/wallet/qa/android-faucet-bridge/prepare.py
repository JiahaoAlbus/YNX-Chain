#!/usr/bin/env python3
"""Prepare a separate test application without editing the original native module."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET

PRODUCTION_SOURCE = '673522fe126b5b87f91c6790ca7bea0eb574f2e8'
QA_PACKAGE = 'com.ynxweb4.wallet.faucetbridgeqa'
SCOPE = 'apps/wallet/qa/android-faucet-bridge/'
ROOT = Path(__file__).resolve().parents[4]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def replace_once(path, old, new):
    text = path.read_text()
    assert text.count(old) == 1, f'Expected exactly one source match in {path.name}'
    path.write_text(text.replace(old, new))


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, help='New absolute evidence directory; it must not exist')
args = parser.parse_args()
output = Path(args.output)
assert output.is_absolute() and output == output.resolve(), 'Require an absolute non-symlink output path'
assert not output.exists(), 'Preserve previous test artifacts; choose a fresh output directory'
assert output.parent.is_dir(), 'Create the intended parent evidence directory separately'
head = git('rev-parse', 'HEAD').decode().strip()
assert git('status', '--porcelain') == b'', 'Commit and review the QA source before preparation'
delta = git('diff', '--name-only', PRODUCTION_SOURCE, head).decode().splitlines()
assert delta and all(path.startswith(SCOPE) for path in delta), 'Only test sources may differ from the fixed production baseline'
output.mkdir()
build = output / 'build-source'
subprocess.run(['git', 'worktree', 'add', '--detach', str(build), head], cwd=ROOT, check=True)
wallet = build / 'apps/wallet'
app = json.loads((wallet / 'app.json').read_text())
app['expo']['name'] = 'Faucet Bridge QA'
app['expo']['slug'] = 'ynx-faucet-bridge-qa'
app['expo']['scheme'] = 'ynxfaucetbridgeqa'
app['expo']['android']['package'] = QA_PACKAGE
app['expo']['android']['intentFilters'] = []
app['expo']['android']['blockedPermissions'].append('android.permission.INTERNET')
(wallet / 'app.json').write_text(json.dumps(app, indent=2) + '\n')
(wallet / 'App.tsx').write_text("export { default } from './qa/android-faucet-bridge/ProbeApp';\n")
replace_once(wallet / 'android/app/build.gradle', "applicationId 'com.ynxweb4.wallet'", f"applicationId '{QA_PACKAGE}'")

android = '{http://schemas.android.com/apk/res/android}'
tools = '{http://schemas.android.com/tools}'
ET.register_namespace('android', android[1:-1])
ET.register_namespace('tools', tools[1:-1])
manifest = wallet / 'android/app/src/main/AndroidManifest.xml'
document = ET.parse(manifest)
root = document.getroot()
permission = next(node for node in root.findall('uses-permission') if node.get(android + 'name') == 'android.permission.INTERNET')
permission.set(tools + 'node', 'remove')
application = root.find('application')
assert application is not None
application.set(android + 'name', 'com.ynxweb4.wallet.MainApplication')
application.set(android + 'allowBackup', 'false')
activity = application.find('activity')
assert activity is not None
activity.set(android + 'name', 'com.ynxweb4.wallet.MainActivity')
removed = 0
for entry in list(activity.findall('intent-filter')):
    if any(action.get(android + 'name') == 'android.intent.action.VIEW' for action in entry.findall('action')):
        activity.remove(entry)
        removed += 1
assert removed == 2, 'The QA app must not register either production Wallet deep-link filter'
document.write(manifest, encoding='unicode')
strings = wallet / 'android/app/src/main/res/values/strings.xml'
document = ET.parse(strings)
label = next(node for node in document.getroot().findall('string') if node.get('name') == 'app_name')
label.text = 'Faucet Bridge QA'
document.write(strings, encoding='unicode')

probe_source = wallet / 'qa/android-faucet-bridge/probe-module'
probe_target = wallet / 'modules/ynx-faucet-bridge-qa'
assert not probe_target.exists()
probe_files = []
for source in sorted(probe_source.rglob('*')):
    assert not source.is_symlink(), 'QA module templates must be regular files'
    if source.is_file():
        target = probe_target / source.relative_to(probe_source)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        probe_files.append(target.relative_to(build).as_posix())

tracked = git('ls-tree', '-r', '--name-only', head, 'apps/wallet', 'packages/wallet-auth').decode().splitlines()
production_module = {}
for path in tracked:
    if path.startswith('apps/wallet/modules/ynx-faucet-transport/'):
        original = git('show', f'{PRODUCTION_SOURCE}:{path}')
        actual = (build / path).read_bytes()
        assert actual == original, f'The original production native module changed: {path}'
        production_module[path] = digest(actual)
assert production_module
native = (wallet / 'modules/ynx-faucet-transport/android/src/main/java/com/ynxweb4/faucettransport/YnxFaucetTransportModule.kt').read_text()
assert 'private const val PRODUCTION_ENABLED = false' in native
assert 'return null;' in (wallet / 'modules/ynx-faucet-transport/index.ts').read_text()
files = {path: digest((build / path).read_bytes()) for path in tracked + probe_files}
record = {
    'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'productionSource': PRODUCTION_SOURCE,
    'qaSource': head,
    'qaPackage': QA_PACKAGE,
    'sourceFilesAfterIsolatedOverrides': files,
    'originalTransportModuleSha256': production_module,
    'overrideScope': ['apps/wallet/App.tsx', 'apps/wallet/app.json', 'apps/wallet/android/app/build.gradle',
                      'apps/wallet/android/app/src/main/AndroidManifest.xml', 'apps/wallet/android/app/src/main/res/values/strings.xml',
                      'apps/wallet/modules/ynx-faucet-bridge-qa/**'],
    'networkPermissionRemovedInTestApp': True,
    'productionCodeOrGateChanged': False,
    'built': False,
    'installed': False,
}
(output / 'prepared-source.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'qaSource': head, 'buildSource': str(build), 'package': QA_PACKAGE, 'boundFiles': len(files)}))
