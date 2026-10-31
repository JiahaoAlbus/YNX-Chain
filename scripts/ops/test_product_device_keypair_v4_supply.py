"""Pure public DATA controls for the actual supply validators, not a seal.

No GITHUB environment is installed, no guarded main is called, and no Go/C
runtime, archive, private material or qualified SOURCE is produced here. Real
C39/Go10 and the native package tests execute separately in the normal CI job.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'verify/product-device-keypair-v4-cabi-check.sh'
RAW = SCRIPT.read_text(encoding='utf-8')
START = "<<'PY'\n"
assert RAW.count(START) == 1 and RAW.endswith('PY\n')
BODY = RAW.split(START, 1)[1][:-3]
DATA = {'__name__': 'product_device_keypair_supply_controls'}
exec(compile(BODY, str(SCRIPT), 'exec'), DATA)


class DeviceCreatorSupplyControls(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='ynx-device-creator-public-data-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve(strict=True)
        self.root.chmod(0o700)

    def write(self, path, raw):
        with path.open('xb') as output:
            output.write(raw)
        path.chmod(0o600)

    def environment(self):
        # Explicit model DATA passed to a pure function; never os.environ.
        return dict(GITHUB_ACTIONS='true', GITHUB_EVENT_NAME='push', GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain',
                    GITHUB_JOB='artifact-release-cabi', GITHUB_SHA='a' * 40, GITHUB_RUN_ID='123', GITHUB_RUN_ATTEMPT='1',
                    YNX_NATIVE_MATRIX_RUNNER='macos-15', RUNNER_OS='macOS')

    def parent(self):
        env = self.environment()
        host = dict(os='darwin', arch='arm64')
        pins = {name: dict(bytes=index + 1, sha256=hashlib.sha256(name.encode()).hexdigest())
                for index, name in enumerate(DATA['PARENT_NAMES'])}
        parent = dict(version='YNX-ARTIFACT-RELEASE-CABI-CANDIDATE/v1', commit=env['GITHUB_SHA'], sourceTree='b' * 40,
                      runId='123', runAttempt='1', job=env['GITHUB_JOB'], matrixRunner=env['YNX_NATIVE_MATRIX_RUNNER'], runnerOS=env['RUNNER_OS'],
                      host=host, target=copy.deepcopy(host), archive=pins['libynx_artifact_release.a'], suite=DATA['SUITE'],
                      circl=dict(Path='github.com/cloudflare/circl', Version='v1.6.5'), publicEvidenceTarget=host,
                      minimumSystemVersion='13.0', deploymentTargetEnvironment='13.0')
        for name in ('actualCABIExecuted', 'nativeHostCoreTestsPassed', 'independentGoDualANDVerified', 'typedN1Inspected', 'targetCompiled',
                     'targetCallerLinked', 'actualTransactionCABIExecuted', 'transactionIndependentGoDualANDVerified', 'actualInitialAccountCABIExecuted',
                     'initialAccountIndependentGoDualANDVerified', 'actualDeviceHTTPCABIExecuted', 'deviceHTTPIndependentGoDualANDVerified'):
            parent[name] = True
        for name in ('crossCompiled', 'privateMaterialIncluded', 'publisherAuthorized', 'nativeRootAuthorized', 'mainCustodyVerified',
                     'productInstalled', 'publicDeployment', 'pqActivation', 'transactionAccountAuthorized', 'initialAccountAuthorized',
                     'deviceHTTPSourceQualified', 'deviceHTTPSessionAuthorized'):
            parent[name] = False
        parent.update(abi='YNXArtifactPublicationSignV1', abiVersion=1, transactionABI='YNXTransactionBatchSignV1', transactionABIVersion=1,
                      initialAccountABI='YNXAccountInitialSignV1', initialAccountABIVersion=1, deviceHTTPABI='YNXProductSessionHTTPProofSignV4', deviceHTTPABIVersion=4)
        for field, name in (('header', 'ynx_artifact_release.h'), ('transactionHeader', 'tx_batch.h'),
                            ('initialAccountHeader', 'account_initial.h'), ('deviceHTTPHeader', 'product_session_http.h')):
            parent[field] = pins[name]
        for field, prefix in (('publicEvidence', ''), ('transactionPublicEvidence', 'TX-'),
                              ('initialAccountPublicEvidence', 'INITIAL-'), ('deviceHTTPPublicEvidence', 'DEVICE-HTTP-')):
            parent[field] = {prefix + name: pins[prefix + name] for name in ('PUBLIC-RECEIPT.json', 'PUBLIC-INTEROP.json')}
        return parent, env, host, 'b' * 40, pins['libynx_artifact_release.a'], pins

    def public_material(self):
        path = self.root / 'public-material'
        path.mkdir(mode=0o700)
        public_pins = {}
        for label, name, size, marker in (('firstA', 'first-pk-a.bin', 2592, 1), ('firstB', 'first-pk-b.bin', 64, 2),
                                          ('secondA', 'second-pk-a.bin', 2592, 3), ('secondB', 'second-pk-b.bin', 64, 4)):
            raw = bytes([marker]) * size
            self.write(path / name, raw)
            public_pins[label] = dict(bytes=size, sha256=hashlib.sha256(raw).hexdigest())
        public_pins.update(firstMember=dict(bytes=63730, sha256='c' * 64), secondMember=dict(bytes=63730, sha256='d' * 64))
        self.write(path / 'C-RESULT.json', json.dumps(dict(version='YNX-PRODUCT-DEVICE-KEYPAIR-C-RESULT/v4', cases=39,
                                                        syntheticOnly=True, authority=False)).encode())
        receipt = dict(version='YNX-PRODUCT-DEVICE-KEYPAIR-PUBLIC-RESULT/v4', purpose='product-session-device-v4',
                       syntheticOnly=True, actualCCreator=True, cCases=39, independentFullPairImport=True, actualDualANDVerified=True,
                       typedRegistrationInspected=True, negativeCases=copy.deepcopy(DATA['NEGATIVES']), privateTestFilesRemoved=True,
                       logicalCleanupOnly=True, physicalEraseClaimed=False, authProvisioningVerified=False, visibleApprovalVerified=False,
                       osCustodyImported=False, rootGrant=False, publicPins=public_pins)
        self.write(path / 'PUBLIC-RESULT.json', json.dumps(receipt).encode())
        return path, receipt

    def markers(self):
        counts = dict(null_request=1, null_outcome=1, version=1, struct_size=1, unaligned_request=1, unaligned_outcome=1,
                      outcome_request_overlap=1, buffer_request_overlap=4, null_buffer=4, exact_capacity=12,
                      output_pair_overlap=6, outcome_buffer_overlap=4, actual_fresh_pair_complete_no_overrun=2)
        lines = ['DEVICE_KEYPAIR_C_CASE_PASS ' + name for name, count in counts.items() for _ in range(count)]
        lines += ['YNX_PRODUCT_DEVICE_KEYPAIR_C_PASS cases=39 purpose=product-session-device-v4 physicalEraseClaimed=false',
                  'YNX_PRODUCT_DEVICE_KEYPAIR_INTEROP_PASS C=39 GoNegative=10 actualFullAND=true authority=false',
                  'YNX_PRODUCT_DEVICE_KEYPAIR_CHECK_PASS sharedArchive=true authority=false']
        return ('\n'.join(lines) + '\n').encode()

    def test_environment_is_the_exact_normal_push_native_matrix(self):
        env = self.environment()
        DATA['validate_environment'](env, dict(os='darwin', arch='arm64'))
        for key, value in (('GITHUB_ACTIONS', 'false'), ('GITHUB_EVENT_NAME', 'workflow_dispatch'), ('GITHUB_REPOSITORY', 'foreign/repo'),
                           ('GITHUB_JOB', 'foreign'), ('GITHUB_SHA', '0' * 40), ('GITHUB_SHA', 'A' * 40), ('GITHUB_SHA', 'a' * 12),
                           ('GITHUB_RUN_ID', '01'), ('GITHUB_RUN_ATTEMPT', True), ('YNX_NATIVE_MATRIX_RUNNER', 'macos-14'), ('RUNNER_OS', 'Linux')):
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                DATA['validate_environment'](dict(env, **{key: value}), dict(os='darwin', arch='arm64'))
        for host in (dict(os='darwin', arch='amd64'), dict(os='linux', arch='amd64'), dict(os='darwin', arch=True)):
            with self.subTest(host=host), self.assertRaises(RuntimeError):
                DATA['validate_environment'](env, host)

    def test_parent_preserves_complete_original_symbols_job_suite_target_and_pins(self):
        args = self.parent()
        DATA['validate_parent'](*args)
        for key, value in (('commit', 'c' * 40), ('sourceTree', 'c' * 40), ('runId', '124'), ('runAttempt', '2'), ('job', 'foreign'),
                           ('matrixRunner', 'ubuntu-24.04'), ('runnerOS', 'Linux'), ('target', dict(os='darwin', arch='amd64')),
                           ('suite', 'classical'), ('abiVersion', True), ('deviceHTTPABI', 'other'), ('header', {}),
                           ('publicEvidence', {}), ('deviceHTTPPublicEvidence', {}), ('minimumSystemVersion', '14.0'),
                           ('deploymentTargetEnvironment', None), ('archive', dict(bytes=True, sha256='c' * 64))):
            changed = copy.deepcopy(args)
            changed[0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                DATA['validate_parent'](*changed)
        for key in ('actualCABIExecuted', 'nativeHostCoreTestsPassed', 'independentGoDualANDVerified', 'typedN1Inspected',
                    'targetCompiled', 'targetCallerLinked', 'actualTransactionCABIExecuted', 'actualInitialAccountCABIExecuted', 'actualDeviceHTTPCABIExecuted'):
            for value in (False, 1):
                changed = copy.deepcopy(args)
                changed[0][key] = value
                with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                    DATA['validate_parent'](*changed)
        for key in ('crossCompiled', 'privateMaterialIncluded', 'nativeRootAuthorized', 'mainCustodyVerified', 'productInstalled', 'publicDeployment'):
            changed = copy.deepcopy(args)
            changed[0][key] = True
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                DATA['validate_parent'](*changed)

    def test_actual_four_core_tests_and_complete_suite_cannot_be_skipped(self):
        package = 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-artifact-release-cabi'
        rows = [dict(Package=package, Test=name, Action='pass') for name in DATA['CORE_TESTS']] + [dict(Package=package, Action='pass')]
        encode = lambda value: b'\n'.join(json.dumps(row).encode() for row in value) + b'\n'
        self.assertEqual(DATA['validate_core_tests'](encode(rows)), list(DATA['CORE_TESTS']))
        for change in (lambda value: value.pop(0), lambda value: value[0].update(Action='skip'), lambda value: value[0].update(Action='fail'),
                       lambda value: value[0].update(Package='other'), lambda value: value.append(copy.deepcopy(value[0])),
                       lambda value: value[-1].update(Action='fail')):
            bad = copy.deepcopy(rows)
            change(bad)
            with self.subTest(bad=bad), self.assertRaises(RuntimeError):
                DATA['validate_core_tests'](encode(bad))

    def test_markers_require_all39_cases_and_exact_go10_no_extra_output(self):
        raw = self.markers()
        DATA['validate_markers'](raw)
        for bad in (raw.replace(b'GoNegative=10', b'GoNegative=9'), raw.replace(b'cases=39', b'cases=38'),
                    raw.replace(b'actualFullAND=true', b'actualFullAND=false'), raw.replace(b'authority=false', b'authority=true'),
                    raw.split(b'\n', 1)[1], raw + b'extra unqualified text\n', raw + raw):
            with self.subTest(bad=bad[-120:]), self.assertRaises(RuntimeError):
                DATA['validate_markers'](bad)

    def test_closed_public_material_rejects_der_unknown_leaf_or_wrong_pair_bytes(self):
        path, _ = self.public_material()
        pins, _ = DATA['validate_material'](path)
        self.assertEqual(set(pins), set(DATA['MATERIAL_NAMES']))
        for name in ('SYNTHETIC-ONLY-first-a.der', 'unqualified-public.bin'):
            extra = path / name
            self.write(extra, b'public parser-control marker, never a key')
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                DATA['validate_material'](path)
            self.assertEqual(extra.read_bytes(), b'public parser-control marker, never a key')
            extra.unlink()
        original = (path / 'first-pk-a.bin').read_bytes()
        (path / 'first-pk-a.bin').write_bytes(b'x' * 2592)
        with self.assertRaises(RuntimeError):
            DATA['validate_material'](path)
        (path / 'first-pk-a.bin').write_bytes(original)
        self.assertEqual(DATA['validate_material'](path)[0], pins)

    def test_closed_actual_receipt_math_flags_counts_no_authority_and_negatives(self):
        path, receipt = self.public_material()
        for key, value in (('actualCCreator', False), ('actualDualANDVerified', 1), ('independentFullPairImport', False),
                           ('typedRegistrationInspected', False), ('cCases', True), ('privateTestFilesRemoved', False),
                           ('logicalCleanupOnly', False), ('physicalEraseClaimed', True), ('authProvisioningVerified', True),
                           ('visibleApprovalVerified', True), ('osCustodyImported', True), ('rootGrant', True),
                           ('purpose', 'asset-account'), ('negativeCases', DATA['NEGATIVES'][:-1]), ('unexpected', False)):
            (path / 'PUBLIC-RESULT.json').write_text(json.dumps(dict(receipt, **{key: value})))
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                DATA['validate_material'](path)
        for label, row in (('firstA', dict(bytes=True, sha256='c' * 64)), ('firstMember', dict(bytes=0, sha256='c' * 64)),
                           ('secondMember', dict(bytes=63730, sha256='0' * 64))):
            bad = copy.deepcopy(receipt)
            bad['publicPins'][label] = row
            (path / 'PUBLIC-RESULT.json').write_text(json.dumps(bad))
            with self.subTest(label=label), self.assertRaises(RuntimeError):
                DATA['validate_material'](path)

    def test_duplicate_trailing_nonfinite_json_and_c_case_tampering_refuse(self):
        for raw in (b'{"x":1,"x":2}', b'{} {}', b'{"x":NaN}', b'{"x":Infinity}'):
            with self.subTest(raw=raw), self.assertRaises((RuntimeError, ValueError)):
                DATA['strict_json'](raw)
        path, _ = self.public_material()
        for value in (dict(version='YNX-PRODUCT-DEVICE-KEYPAIR-C-RESULT/v4', cases=True, syntheticOnly=True, authority=False),
                      dict(version='YNX-PRODUCT-DEVICE-KEYPAIR-C-RESULT/v4', cases=39, syntheticOnly=True, authority=True)):
            (path / 'C-RESULT.json').write_text(json.dumps(value))
            with self.assertRaises(RuntimeError):
                DATA['validate_material'](path)

    def test_public_metadata_reader_and_copy_preserve_unknown_partial(self):
        source = self.root / 'public.DATA'
        self.write(source, b'public metadata parser control')
        before = (DATA['identity'](source.lstat()), source.read_bytes())
        expected = DATA['pin'](source, private=True)
        target = self.root / 'copied.DATA'
        DATA['copy_public'](source, target, expected)
        with self.assertRaises(FileExistsError):
            DATA['copy_public'](source, target, expected)
        partial = self.root / 'UNKNOWN.DATA'
        self.write(partial, b'original partial must remain')
        with self.assertRaises(FileExistsError):
            DATA['copy_public'](source, partial, expected)
        self.assertEqual(partial.read_bytes(), b'original partial must remain')
        self.assertEqual((DATA['identity'](source.lstat()), source.read_bytes()), before)
        source.chmod(0o644)
        with self.assertRaises(RuntimeError):
            DATA['pin'](source, private=True)
        source.chmod(0o600)
        link = self.root / 'linked.DATA'
        link.symlink_to(source)
        with self.assertRaises(RuntimeError):
            DATA['pin'](link)
        link.unlink()
        os.link(source, link)
        with self.assertRaises(RuntimeError):
            DATA['pin'](source)

    def test_actual_fixture_build_info_binds_native_full_commit_and_clean_source(self):
        settings = {'GOOS': 'darwin', 'GOARCH': 'arm64', 'CGO_ENABLED': '0', '-trimpath': 'true', 'vcs.revision': 'a' * 40, 'vcs.modified': 'false'}
        encode = lambda value: ('public-fixture: go1.26.10\n' + ''.join('\tbuild\t' + k + '=' + v + '\n' for k, v in value.items())).encode()
        DATA['fixture_build_info'](encode(settings), dict(os='darwin', arch='arm64'), 'a' * 40)
        for key, value in (('GOOS', 'linux'), ('GOARCH', 'amd64'), ('CGO_ENABLED', '1'), ('-trimpath', 'false'),
                           ('vcs.revision', 'b' * 40), ('vcs.modified', 'true')):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                DATA['fixture_build_info'](encode(dict(settings, **{key: value})), dict(os='darwin', arch='arm64'), 'a' * 40)

    def test_complete_new_archive_compile_sources_cannot_be_missing_or_changed(self):
        names = list(DATA['REQUIRED_SOURCES']) + ['go.mod', 'go.sum', 'internal/ynxbatch/key_material.go']
        sources = {name: dict(bytes=100, sha256='c' * 64, gitBlob='d' * 40) for name in names}
        parent = dict(sources=copy.deepcopy(sources))
        DATA['validate_source_pins'](sources, parent)
        for name in ('cmd/ynx-artifact-release-cabi/product_device_keypair_v4_bridge.go', 'internal/ynxbatch/key_material.go', 'go.mod'):
            changed = copy.deepcopy(parent)
            changed['sources'].pop(name)
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                DATA['validate_source_pins'](sources, changed)
        changed = copy.deepcopy(parent)
        changed['sources']['go.sum']['bytes'] = True
        with self.assertRaises(RuntimeError):
            DATA['validate_source_pins'](sources, changed)
        changed = dict(sources)
        changed.pop(DATA['HEADER'])
        with self.assertRaises(RuntimeError):
            DATA['validate_source_pins'](changed, parent)

    def test_recipe_is_the_fixed_single_archive_five_leaf_normal_supplier(self):
        self.assertEqual(len(DATA['PARENT_NAMES']), 14)
        self.assertEqual(len(DATA['MATERIAL_NAMES']), 6)
        self.assertEqual(set(DATA['DELIVERY_NAMES']), {'libynx_artifact_release.a', 'product_device_keypair_v4.h', 'PUBLIC-RESULT.json', 'ORIGINAL-ARCHIVE-SOURCE.json', 'SOURCE.json'})
        for forbidden in ('-buildmode=c-archive', 'shell=True', 'os.environ.update', 'shutil.rmtree', '.unlink('):
            self.assertNotIn(forbidden, RAW)
        for fragment in ("original == temp / 'ynx-artifact-release-cabi/delivery/native-host'", "case == temp / 'ynx-product-device-keypair-v4-cabi'",
                         "not case.exists() and not case.is_symlink()", "['bash', str(root / CHECK), str(archive), str(exercise)]",
                         "validate_parent(parent, os.environ, host, tree, archive_pin, original_pins)", "validate_core_tests(read_public(core_log",
                         "fixture_build_info(command(['go', 'version', '-m', str(exercise / 'independent')])", "pin(core_log, 16 << 20) == core_pin"):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, BODY)
        self.assertLess(BODY.index('validate_parent(parent, os.environ'), BODY.index('case.mkdir(mode=0o700)'))
        self.assertLess(BODY.index('validate_core_tests(read_public(core_log'), BODY.index("subprocess.run(['bash'"))
        self.assertLess(BODY.index('material_pins, result = validate_material(material)'), BODY.index("out = case / 'delivery'"))
        self.assertLess(BODY.index('fixture_build_info(command('), BODY.index("out = case / 'delivery'"))


if __name__ == '__main__':
    unittest.main()
