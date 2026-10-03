#!/usr/bin/env python3
"""Compose owned Media source with exact Git-frozen SDK, in a temporary tree.
Reads the shared repository through git show only. Does not install a runtime.
"""
import argparse, hashlib, json, pathlib, shutil, subprocess, tempfile
parser = argparse.ArgumentParser()
parser.add_argument('--shared-repository', required=True)
parser.add_argument('--evidence', required=True)
args = parser.parse_args()
owned = pathlib.Path(__file__).resolve().parents[3]
shared = pathlib.Path(args.shared_repository).resolve()
evidence = pathlib.Path(args.evidence).resolve()
evidence.mkdir(parents=True, exist_ok=True)
commit = '16195c6663525b0965725a922f46f38cf7b0a004'
tree = '13c7016a8bbb13cc61912633f9787ef9fc9b69d2'
def git(*parts):
    return subprocess.check_output(['git', '-C', str(shared), *parts])
assert git('rev-parse', commit + '^{tree}').decode().strip() == tree
pins = []
with tempfile.TemporaryDirectory(prefix='ynx-media-frozen-sdk-') as directory:
    target = pathlib.Path(directory)
    for name in ['go.mod', 'go.sum']:
        shutil.copyfile(owned / name, target / name)
        data = (owned / name).read_bytes()
        pins.append(dict(owner='Media module', path=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
    for package in ['video', 'music', 'accountaddress', 'buildinfo', 'nativewallet']:
        source = owned / 'internal' / package
        for path in sorted(source.rglob('*')):
            if path.is_file():
                relative = path.relative_to(owned)
                out = target / relative
                out.parent.mkdir(parents=True, exist_ok=True)
                data = path.read_bytes()
                out.write_bytes(data)
                pins.append(dict(owner='Media', path=str(relative), bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
    for name in git('ls-tree', '-r', '--name-only', commit, 'internal/productsessionv2').decode().splitlines():
        data = git('show', commit + ':' + name)
        out = target / name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        pins.append(dict(owner='A frozen Git', path=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
    commands = [(['go', 'test', '-race', '-count=1', '-tags=ynx_canonical_media', '-json', './internal/video', './internal/music'], 'combined-go-race.jsonl'),
                (['go', 'vet', '-tags=ynx_canonical_media', './internal/video', './internal/music'], 'combined-go-vet.txt')]
    results = []
    for command, name in commands:
        with (evidence / name).open('xb') as log:
            result = subprocess.run(command, cwd=target, stdout=log, stderr=subprocess.STDOUT)
        results.append(dict(command=command, exitCode=result.returncode, log=name))
        if result.returncode:
            break
    receipt = dict(sharedSourceCommit=commit, sharedSourceTree=tree, inputPins=pins, results=results,
                   actualSDKActionCrypto=all(r['exitCode'] == 0 for r in results) and len(results) == 2, actualWalletConsent=False, productionInstalled=False,
                   note='Temporary composition only. Trusted current-actor host binding and protected keys remain mandatory for installation.')
    (evidence / 'combined-source-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(dict(results=results, inputs=len(pins))))
    raise SystemExit(next((r['exitCode'] for r in results if r['exitCode']), 0))
