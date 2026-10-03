#!/usr/bin/env python3
"""Compose owned Media source with exact Git-frozen SDK, in a temporary tree.
Reads the shared repository through git show only. Does not install a runtime.
"""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tempfile
parser = argparse.ArgumentParser()
parser.add_argument('--shared-repository', required=True)
parser.add_argument('--android-music-upload-classes', help='Actual isolated JVM Music upload controller with original SDK proofs; compiled source/class pins required')
parser.add_argument('--apple-music-engine', help='Isolated actual Music Swift model/engine QA binary with source pin sidecar')
parser.add_argument('--apple-video-engine', help='Compiled isolated Apple Swift/WebKit QA binary with exact source pin sidecar; no installed/OS storage claim')
parser.add_argument('--apple-creator-engine', help='Actual Creator Swift controller and pinned SDK, isolated generated key/storage/network only')
parser.add_argument('--packaged-video-engine', action='store_true', help='Exercise actual packaged Android Video driver with disposable software ports')
parser.add_argument('--packaged-music-engine', action='store_true', help='Exercise actual packaged Android Music driver with disposable software ports; no installed/OS claim')
parser.add_argument('--test-run', help='Optional Go test name filter for focused repair; receipt retains exact command')
parser.add_argument('--evidence', required=True)
parser.add_argument('--central-source-package', help='Exact A complete16195 or Music successor frozen fixture package; enables actual loopback authority tests')
parser.add_argument('--browser-roster-overlay', help='Exact A approved258 BrowserSSO source freeze; requires matching combined641 source package')
args = parser.parse_args()
owned = pathlib.Path('/Users/huangjiahao/Desktop/YNX Audit Worktrees/20260906-video')
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
combined = False
overlay_receipt = None
if args.central_source_package:
    candidate = pathlib.Path(args.central_source_package).resolve()
    manifest_bytes = (candidate / 'freeze-manifest.json').read_bytes()
    package_sha = hashlib.sha256(manifest_bytes).hexdigest()
    assert package_sha in ['cb6a6262f1d0468e5f9192465c25d6d93480ca7ca7828895ad4f39b92ca6ef5a', '91212923c02e9ca213b628a1793e4d6b4cb435dd3f3eda6e817c0e598d6869b7', '7f978142e5f481936e513cf1ed2093fd2a312d888d9868f7ff471c50d19e0e3c']
    manifest = json.loads(manifest_bytes)
    for name, pin in manifest['files'].items():
        path = candidate / name
        assert not path.is_symlink() and path.is_file()
        data = path.read_bytes()
        assert len(data) == pin['bytes'] and hashlib.sha256(data).hexdigest() == pin['sha256'], name
    combined = package_sha == '7f978142e5f481936e513cf1ed2093fd2a312d888d9868f7ff471c50d19e0e3c'
    successor = combined or package_sha == '91212923c02e9ca213b628a1793e4d6b4cb435dd3f3eda6e817c0e598d6869b7'
    source_pins = json.loads((candidate / ('source-inputs.json' if successor else 'source-pins.json')).read_bytes())
    fixture_commit = '5c5e8a234206e306b6044deb6e938c1763ac7005' if successor else commit
    fixture_tree = '4742a47562040898a503702f413fd4a87a3d38c0' if successor else tree
    if combined:
        commit = fixture_commit = '6413198530fcc89abfcc44cf010ee96228475b8b'
        tree = fixture_tree = 'f70c782e828b81b5aea955c6481edd079176e88c'
        assert git('rev-parse', commit + '^{tree}').decode().strip() == tree
    assert source_pins.get('commit', source_pins.get('sourceCommit')) == fixture_commit and source_pins.get('tree', source_pins.get('sourceTree')) == fixture_tree
    if successor:
        if combined:
            assert source_pins['sourceParent'] == 'f1b4256bf5e2d175a24e9000e7ec3fd22d21053b'
            archive = candidate / 'combined-authority-cancellation-complete-source.tar.gz'
            assert hashlib.sha256(archive.read_bytes()).hexdigest() == '848e72b75837e7566a0392e85bfb570035f98113e295a4821ac1d733e01f596e'
        else:
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
if args.browser_roster_overlay:
    assert combined, 'Approved BrowserSSO overlay requires complete combined641 foundation'
    overlay = pathlib.Path(args.browser_roster_overlay).resolve()
    freeze_bytes = (overlay / 'freeze.json').read_bytes()
    freeze = json.loads(freeze_bytes)
    assert freeze['commit'] == '2587012a7eaf9c2b827596b7914d6304d91840ab' and freeze['tree'] == 'e33264c7c12d8b3d6283bfcdfd915a20c25c0a6b'
    assert git('rev-parse', freeze['commit'] + '^{tree}').decode().strip() == freeze['tree']
    for pin in freeze['files']:
        data = (overlay / pin['path']).read_bytes()
        assert len(data) == pin['bytes'] and hashlib.sha256(data).hexdigest() == pin['sha256'], pin['path']
        if pin['path'].startswith('internal/'):
            assert data == git('show', freeze['commit'] + ':' + pin['path'])
    overlay_receipt = dict(sourceCommit=freeze['commit'], sourceTree=freeze['tree'], manifestSHA256=hashlib.sha256(freeze_bytes).hexdigest(), paths=['internal/productsessionv2/browser_sso.go'], installed=False)
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
        browser_inputs = [owned / 'apps/music/scripts/packaged-native-engine-fixture.mjs'] + [owned / name for name in sorted(visible_owned_paths) if name.startswith(('apps/music/android/','apps/video/android/')) and not any(part in ['build','.gradle'] for part in pathlib.PurePosixPath(name).parts)] + list((owned / 'apps/music/web').rglob('*')) + list((owned / 'apps/music').glob('*.go')) + [owned / 'apps/music/scripts/canonical-browser-authority-check.cjs', owned / 'apps/video/scripts/media-browser-authority-check.cjs', owned / 'apps/video/scripts/media-native-authority-check.mjs', owned / 'apps/video/scripts/media-apple-authority-check.mjs']
        browser_inputs.append(owned / 'apps/music/scripts/apple-native-authority-check.mjs')
        browser_inputs.append(owned / 'apps/music/scripts/android-upload-original-business-check.mjs')
        browser_inputs.append(owned / 'apps/creator-studio/scripts/apple-native-authority-check.mjs')
        for product in ['video', 'creator-studio', 'music']:
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
        selected = overlay_receipt['sourceCommit'] if overlay_receipt and name == 'internal/productsessionv2/browser_sso.go' else commit
        data = git('show', selected + ':' + name)
        out = target / name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        pins.append(dict(owner='A approved BrowserSSO overlay' if selected != commit else 'A frozen Git', sourceCommit=selected, path=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
    # Adapt only temporary module metadata to A's required cached foundation;
    # neither owned nor shared go.mod/go.sum is overwritten.
    build_env = dict(os.environ, GOTOOLCHAIN='go1.25.13', GOPROXY='off', GOWORK='off', GOFLAGS='-mod=readonly')
    build_env.pop('YNX_QA_CENTRAL_SOURCE', None)
    java_music_receipt = None
    if args.android_music_upload_classes:
        classes = pathlib.Path(args.android_music_upload_classes).resolve()
        java_music_receipt = json.loads(pathlib.Path(str(classes)+'.json').read_text())
        for pin in java_music_receipt['sourcePins']:
            assert hashlib.sha256((owned / pin['path']).read_bytes()).hexdigest()==pin['sha256']
        for pin in java_music_receipt['classPins']:
            assert hashlib.sha256((classes / pin['path']).read_bytes()).hexdigest()==pin['sha256']
        java_json_dependency=java_music_receipt['jsonDependency']
        assert hashlib.sha256(pathlib.Path(java_json_dependency['path']).read_bytes()).hexdigest()==java_json_dependency['sha256']
        build_env['YNX_QA_ANDROID_MUSIC_UPLOAD_CLASSES']=str(classes)
    apple_receipt = None
    if args.apple_video_engine:
        binary = pathlib.Path(args.apple_video_engine).resolve()
        apple_receipt = json.loads(pathlib.Path(str(binary) + '.json').read_text())
        assert hashlib.sha256(binary.read_bytes()).hexdigest() == apple_receipt['sha256']
        for pin in apple_receipt['sourcePins']:
            assert hashlib.sha256((owned / pin['path']).read_bytes()).hexdigest() == pin['sha256']
        build_env['YNX_QA_APPLE_VIDEO_ENGINE_BIN'] = str(binary)
    apple_creator_receipt = None
    if args.apple_creator_engine:
        binary = pathlib.Path(args.apple_creator_engine).resolve()
        apple_creator_receipt = json.loads(pathlib.Path(str(binary)+'.json').read_text())
        assert hashlib.sha256(binary.read_bytes()).hexdigest()==apple_creator_receipt['sha256']
        for pin in apple_creator_receipt['sourcePins']:
            assert hashlib.sha256((owned / pin['path']).read_bytes()).hexdigest()==pin['sha256']
        build_env['YNX_QA_APPLE_CREATOR_ENGINE_BIN']=str(binary)
    apple_music_receipt = None
    if args.apple_music_engine:
        binary = pathlib.Path(args.apple_music_engine).resolve()
        apple_music_receipt = json.loads(pathlib.Path(str(binary)+'.json').read_text())
        assert hashlib.sha256(binary.read_bytes()).hexdigest()==apple_music_receipt['sha256']
        for pin in apple_music_receipt['sourcePins']:
            assert hashlib.sha256((owned / pin['path']).read_bytes()).hexdigest()==pin['sha256']
        build_env['YNX_QA_APPLE_MUSIC_ENGINE_BIN']=str(binary)
    if args.packaged_video_engine or args.packaged_music_engine:
        assert fixture_package_receipt is not None and successor, 'Actual packaged engine requires frozen approved registration package'
        if args.packaged_music_engine:
            build_env['YNX_QA_PACKAGED_MUSIC_ENGINE'] = '1'
        if args.packaged_video_engine:
            build_env['YNX_QA_PACKAGED_VIDEO_ENGINE'] = '1'
    if overlay_receipt:
        build_env['YNX_QA_MEDIA_APPROVED_BROWSER_ROSTER'] = '1'
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
    tags = 'ynx_canonical_media,ynx_media_combined_authority' if combined and overlay_receipt else 'ynx_canonical_media'
    commands = [(['go', 'test', '-race', '-count=3', '-tags='+tags, '-json', './internal/video', './internal/music'], 'combined-go-race.jsonl'),
                (['go', 'vet', '-tags='+tags, './internal/video', './internal/music'], 'combined-go-vet.txt')]
    if args.test_run:
        commands[0][0].insert(5, '-run='+args.test_run)
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
                   fixturePackage=fixture_package_receipt, approvedBrowserRosterOverlay=overlay_receipt,
                   actualNodeAuthorityProtocol=fixture_package_receipt is not None and all(r['exitCode'] == 0 for r in results) and len(results) == 2,
                   actualProtectedBrowserOriginalMusicBusiness=protected_browser_pass and all(r['exitCode'] == 0 for r in results) and len(results) == 2,
                   actualProtectedBrowserOriginalVideoCreatorBusiness=protected_video_creator_pass and all(r['exitCode'] == 0 for r in results) and len(results) == 2,
                   actualNativePortsOriginalVideoCreatorMusicBusiness=all(any(event.get('Test') == name for event in pass_events) for name in ['TestVideoCreatorNativeConsumerAndOriginalBusiness','TestMusicNativeConsumerAndOriginalBusiness']) and all(r['exitCode'] == 0 for r in results) and len(results) == 2,
                   actualAppleSwiftWebKitEngine=bool(apple_receipt) and all(any(event.get('Test') == 'TestVideoCreatorNativeConsumerAndOriginalBusiness/video:' + platform for event in pass_events) for platform in ['ios','macos']) and all(r['exitCode'] == 0 for r in results),
                   appleCompiledSource=apple_receipt,
                   actualAppleCreatorSwiftWebKitEngine=bool(apple_creator_receipt) and all(any(event.get('Test')=='TestVideoCreatorNativeConsumerAndOriginalBusiness/creator-studio:'+platform for event in pass_events) for platform in ['ios','macos']) and all(r['exitCode']==0 for r in results),
                   appleCreatorCompiledSource=apple_creator_receipt,
                   actualAppleMusicSwiftWebKitEngine=bool(apple_music_receipt) and all(any(event.get('Test')=='TestMusicNativeConsumerAndOriginalBusiness/'+platform for event in pass_events) for platform in ['ios','macos']) and all(r['exitCode']==0 for r in results),
                   appleMusicCompiledSource=apple_music_receipt,
                   actualNativeOSStorage=False,
                   actualOriginalJavaMusicUpload=bool(java_music_receipt) and any(event.get('Test')=='TestMusicNativeConsumerAndOriginalBusiness/android' for event in pass_events) and all(r['exitCode']==0 for r in results),
                   javaMusicCompiledSource=java_music_receipt,
                   actualSDKActionCrypto=all(r['exitCode'] == 0 for r in results) and len(results) == 2, actualWalletConsent=False, productionInstalled=False,
                   note='Temporary composition only. Trusted current-actor host binding and protected keys remain mandatory for installation.')
    (evidence / 'combined-source-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(dict(results=results, inputs=len(pins))))
    raise SystemExit(next((r['exitCode'] for r in results if r['exitCode']), 0))
