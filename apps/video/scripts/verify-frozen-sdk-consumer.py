#!/usr/bin/env python3
"""Compose owned Media source with exact Git-frozen SDK, in a temporary tree.
Reads the shared repository through git show only. Does not install a runtime.
"""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tempfile
parser = argparse.ArgumentParser()
parser.add_argument('--shared-repository', required=True)
parser.add_argument('--evidence', required=True)
parser.add_argument('--central-source-package', help='Exact A complete16195 or Music successor frozen fixture package; enables actual loopback authority tests')
args = parser.parse_args()
owned = pathlib.Path(__file__).resolve().parents[3]
visible_owned_paths = set(subprocess.check_output(['git', '-C', str(owned), 'ls-files', '--cached', '--others', '--exclude-standard']).decode().splitlines())
shared = pathlib.Path(args.shared_repository).resolve()
evidence = pathlib.Path(args.evidence).resolve()
evidence.mkdir(parents=True, exist_ok=True)
commit = '16195c6663525b0965725a922f46f38cf7b0a004'
tree = '13c7016a8bbb13cc61912633f9787ef9fc9b69d2'
def git(*parts):
    return subprocess.check_output(['git', '-C', str(shared), *parts])
assert git('rev-parse', commit + '^{tree}').decode().strip() == tree
pins = []
fixture_package_receipt = None
if args.central_source_package:
    candidate = pathlib.Path(args.central_source_package).resolve()
    manifest_bytes = (candidate / 'freeze-manifest.json').read_bytes()
    package_sha = hashlib.sha256(manifest_bytes).hexdigest()
    assert package_sha in ['cb6a6262f1d0468e5f9192465c25d6d93480ca7ca7828895ad4f39b92ca6ef5a', '91212923c02e9ca213b628a1793e4d6b4cb435dd3f3eda6e817c0e598d6869b7']
    manifest = json.loads(manifest_bytes)
    for name, pin in manifest['files'].items():
        path = candidate / name
        assert not path.is_symlink() and path.is_file()
        data = path.read_bytes()
        assert len(data) == pin['bytes'] and hashlib.sha256(data).hexdigest() == pin['sha256'], name
    successor = package_sha == '91212923c02e9ca213b628a1793e4d6b4cb435dd3f3eda6e817c0e598d6869b7'
    source_pins = json.loads((candidate / ('source-inputs.json' if successor else 'source-pins.json')).read_bytes())
    fixture_commit = '5c5e8a234206e306b6044deb6e938c1763ac7005' if successor else commit
    fixture_tree = '4742a47562040898a503702f413fd4a87a3d38c0' if successor else tree
    assert source_pins['commit'] == fixture_commit and source_pins['tree'] == fixture_tree
    if successor:
        assert source_pins['parent'] == commit
        archive = candidate / 'music-web-macos-complete-sdk.tar.gz'
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == '24e84f0dc5faae2510a31a454dc678e4a97b577d90b3f5ef448c5551bfc39cc3'
        source_items = [(pin['path'], pin) for pin in source_pins['files']]
    else:
        source_items = source_pins['files'].items()
    for name, pin in source_items:
        data = git('show', fixture_commit + ':' + name)
        assert len(data) == pin['bytes'] and hashlib.sha256(data).hexdigest() == pin['sha256'], name
    fixture_package_receipt = dict(manifestSHA256=package_sha, sourceCommit=fixture_commit, sourceTree=fixture_tree, verifiedFiles=len(manifest['files']), verifiedGitSourcePaths=len(source_pins['files']), actualWalletConsent=False)
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
    if fixture_package_receipt is not None and successor:
        browser_inputs = list((owned / 'apps/music/web').rglob('*')) + list((owned / 'apps/music').glob('*.go')) + [owned / 'apps/music/scripts/canonical-browser-authority-check.cjs', owned / 'apps/video/scripts/media-browser-authority-check.cjs', owned / 'apps/video/scripts/media-native-authority-check.mjs']
        for product in ['video', 'creator-studio']:
            for path in (owned / 'apps' / product).rglob('*'):
                if path.is_file() and str(path.relative_to(owned)) in visible_owned_paths and not any(part in ['audit', 'evidence', 'android', 'dist', 'build', 'node_modules', 'scripts', 'recovery'] or part.startswith('.') for part in path.relative_to(owned / 'apps' / product).parts) and '.test.' not in path.name:
                    browser_inputs.append(path)
        for path in sorted(browser_inputs):
            if path.is_file():
                relative = path.relative_to(owned)
                out = target / relative
                out.parent.mkdir(parents=True, exist_ok=True)
                data = path.read_bytes()
                out.write_bytes(data)
                pins.append(dict(owner='Media protected browser QA composition', path=str(relative), bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
    for name in git('ls-tree', '-r', '--name-only', commit, 'internal/productsessionv2').decode().splitlines():
        data = git('show', commit + ':' + name)
        out = target / name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        pins.append(dict(owner='A frozen Git', path=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
    # Adapt only temporary module metadata to A's required cached foundation;
    # neither owned nor shared go.mod/go.sum is overwritten.
    build_env = dict(os.environ, GOTOOLCHAIN='go1.25.13', GOPROXY='off', GOWORK='off', GOFLAGS='-mod=readonly')
    build_env.pop('YNX_QA_CENTRAL_SOURCE', None)
    if args.central_source_package:
        build_env['YNX_QA_CENTRAL_SOURCE'] = str(candidate / 'source')
        build_env['YNX_QA_MEDIA_MUSIC_EXTENDED'] = '1' if successor else '0'
        if successor:
            build_env['YNX_QA_MEDIA_SCREENSHOT_DIRECTORY'] = str(evidence)
    subprocess.run(['go', 'mod', 'edit', '-go=1.25.13', '-require=golang.org/x/sys@v0.47.0'], cwd=target, env=build_env, check=True)
    shared_sum = git('show', commit + ':go.sum')
    foundation_sums = b'\n'.join(line for line in shared_sum.splitlines() if line.startswith(b'golang.org/x/sys v0.47.0')) + b'\n'
    assert len(foundation_sums.splitlines()) == 2
    with (target / 'go.sum').open('ab') as output:
        output.write(foundation_sums)
    staged_modules = [dict(path=name, sha256=hashlib.sha256((target / name).read_bytes()).hexdigest()) for name in ['go.mod', 'go.sum']]
    toolchain = subprocess.check_output(['go', 'version'], cwd=target, env=build_env).decode().strip()
    dependency = json.loads(subprocess.check_output(['go', 'list', '-m', '-json', 'golang.org/x/sys'], cwd=target, env=build_env))
    commands = [(['go', 'test', '-race', '-count=1', '-tags=ynx_canonical_media', '-json', './internal/video', './internal/music'], 'combined-go-race.jsonl'),
                (['go', 'vet', '-tags=ynx_canonical_media', './internal/video', './internal/music'], 'combined-go-vet.txt')]
    results = []
    for command, name in commands:
        with (evidence / name).open('xb') as log:
            result = subprocess.run(command, cwd=target, env=build_env, stdout=log, stderr=subprocess.STDOUT)
        results.append(dict(command=command, exitCode=result.returncode, log=name))
        if result.returncode:
            break
    pass_events = [event for line in (evidence / 'combined-go-race.jsonl').read_text().splitlines()
                   if line.startswith('{') for event in [json.loads(line)] if event.get('Action') == 'pass']
    protected_browser_pass = any(event.get('Test') == 'TestMusicProtectedBrowserAndOriginalBusiness' for event in pass_events)
    protected_video_creator_pass = any(event.get('Test') == 'TestVideoCreatorProtectedBrowserAndOriginalBusiness' for event in pass_events)
    receipt = dict(sharedSourceCommit=commit, sharedSourceTree=tree, inputPins=pins, results=results,
                   toolchain=toolchain, dependency=dependency, temporaryModulePins=staged_modules,
                   fixturePackage=fixture_package_receipt,
                   actualNodeAuthorityProtocol=fixture_package_receipt is not None and all(r['exitCode'] == 0 for r in results) and len(results) == 2,
                   actualProtectedBrowserOriginalMusicBusiness=protected_browser_pass and all(r['exitCode'] == 0 for r in results) and len(results) == 2,
                   actualProtectedBrowserOriginalVideoCreatorBusiness=protected_video_creator_pass and all(r['exitCode'] == 0 for r in results) and len(results) == 2,
                   actualNativePortsOriginalVideoCreatorMusicBusiness=all(any(event.get('Test') == name for event in pass_events) for name in ['TestVideoCreatorNativeConsumerAndOriginalBusiness','TestMusicNativeConsumerAndOriginalBusiness']) and all(r['exitCode'] == 0 for r in results) and len(results) == 2,
                   actualNativeOSStorage=False,
                   actualSDKActionCrypto=all(r['exitCode'] == 0 for r in results) and len(results) == 2, actualWalletConsent=False, productionInstalled=False,
                   note='Temporary composition only. Trusted current-actor host binding and protected keys remain mandatory for installation.')
    (evidence / 'combined-source-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(dict(results=results, inputs=len(pins))))
    raise SystemExit(next((r['exitCode'] for r in results if r['exitCode']), 0))
