"""Public synthetic supply controls only; never builds or executes a CABI.

The normal native matrix separately executes the real Go fixture -> C caller ->
read-only N1 export. These tests exercise that recipe's actual metadata/catalog
validators and retention rules without mocking mathematics into qualification.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'verify/registered-n1-verify-cabi-check.sh'
RAW = SCRIPT.read_text(encoding='utf-8')
START = "<<'PY'\n"
assert RAW.count(START) == 1 and RAW.endswith('PY\n')
BODY = RAW.split(START, 1)[1][:-3]
SUPPLY = {'__name__': 'registered_n1_supply_controls'}
# Only define the production DATA validators. Its guarded main (Go/C calls) is
# not executed. Source strings below are explicit recipe contracts, not runtime
# or cryptographic evidence.
exec(compile(BODY, str(SCRIPT), 'exec'), SUPPLY)


class RegisteredN1SupplyControls(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='ynx-n1-public-supply-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve(strict=True)
        self.root.chmod(0o700)

    def write(self, path, raw):
        with path.open('xb') as sink:
            sink.write(raw)
        path.chmod(0o600)

    def parent(self):
        environment = dict(GITHUB_SHA='a' * 40, GITHUB_RUN_ID='123', GITHUB_RUN_ATTEMPT='1',
                           GITHUB_JOB='artifact-release-cabi', YNX_NATIVE_MATRIX_RUNNER='macos-14', RUNNER_OS='macOS')
        host = dict(os='darwin', arch='arm64')
        archive = dict(bytes=321, sha256='c' * 64)
        parent = dict(version='YNX-ARTIFACT-RELEASE-CABI-CANDIDATE/v1', commit=environment['GITHUB_SHA'],
                      runId='123', runAttempt='1', job=environment['GITHUB_JOB'], matrixRunner='macos-14',
                      runnerOS='macOS', sourceTree='b' * 40, host=host, target=copy.deepcopy(host),
                      actualCABIExecuted=True, nativeHostCoreTestsPassed=True, crossCompiled=False,
                      privateMaterialIncluded=False, abi='YNXArtifactPublicationSignV1', suite=SUPPLY['SUITE'], archive=archive)
        return parent, environment, host, 'b' * 40, archive

    def interop(self):
        return dict(schema='ynx-registered-n1-cabi-public-interop/v1', actualCABI=True, cases=62,
                    fullANDChecks=2, N=1, index=0, authority=False, keysRead=False, signingByCABI=False)

    def inputs(self):
        directory = self.root / 'public-inputs'
        directory.mkdir(mode=0o700)
        manifest = []
        for name in SUPPLY['INPUT_NAMES']:
            raw = ('synthetic public bytes/' + name).encode('ascii')
            self.write(directory / name, raw)
            manifest.append(dict(name=name, bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest()))
        self.write(directory / 'PUBLIC-INPUTS.json', json.dumps(manifest).encode('ascii'))
        self.write(directory / 'C-BOUNDARY-CASES.txt', b'62\n')
        result = dict(version=1, structSize=32, verified=1, memberCount=1, index=0,
                      cleanupStatus=0, reserved=0, cases=62, authority=False)
        self.write(directory / 'N1-C-RESULT.json', json.dumps(result).encode('ascii'))
        return directory

    def test_same_job_same_native_host_source_and_original_archive_are_mandatory(self):
        arguments = self.parent()
        SUPPLY['validate_parent'](*arguments)
        for key, value in [('version', 'other'), ('commit', 'd' * 40), ('runId', '124'), ('runAttempt', '2'),
                           ('job', 'other'), ('matrixRunner', 'ubuntu-24.04'), ('runnerOS', 'Linux'),
                           ('sourceTree', 'd' * 40), ('host', dict(os='linux', arch='amd64')),
                           ('target', dict(os='darwin', arch='amd64')), ('abi', 'YNXProjectControlSignV1'),
                           ('suite', 'other'), ('archive', dict(bytes=321, sha256='d' * 64)),
                           ('archive', dict(bytes=True, sha256='c' * 64))]:
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                changed = copy.deepcopy(arguments)
                changed[0][key] = value
                SUPPLY['validate_parent'](*changed)

    def test_old_signing_evidence_or_cross_compile_cannot_be_new_n1_execution(self):
        arguments = self.parent()
        for key, value in [('actualCABIExecuted', False), ('actualCABIExecuted', 1),
                           ('nativeHostCoreTestsPassed', False), ('crossCompiled', True),
                           ('crossCompiled', 0), ('privateMaterialIncluded', True)]:
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                changed = copy.deepcopy(arguments)
                changed[0][key] = value
                SUPPLY['validate_parent'](*changed)
        # Admission of the old parent does not produce an N1 receipt. A distinct
        # actual new C caller and independent Go receipt are both required.
        with self.assertRaises(RuntimeError):
            SUPPLY['validate_interop'](json.dumps(arguments[0]).encode('ascii'))

    def test_interop_exact62_both_math_branches_and_no_authority_are_required(self):
        expected = self.interop()
        self.assertEqual(SUPPLY['validate_interop'](json.dumps(expected).encode('ascii')), expected)
        for key, value in [('actualCABI', False), ('cases', 61), ('cases', '62'), ('fullANDChecks', 1),
                           ('N', True), ('index', 1), ('authority', True), ('keysRead', True),
                           ('signingByCABI', True), ('extra', False)]:
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                changed = dict(expected, **{key: value})
                SUPPLY['validate_interop'](json.dumps(changed).encode('ascii'))
        for key in expected:
            with self.subTest(missing=key), self.assertRaises(RuntimeError):
                changed = dict(expected)
                del changed[key]
                SUPPLY['validate_interop'](json.dumps(changed).encode('ascii'))

    def test_duplicate_trailing_or_nonfinite_json_never_forms_a_receipt(self):
        for raw in (b'{"authority":false,"authority":true}', b'{} {}', b'{"cases":NaN}', b'{"cases":Infinity}'):
            with self.subTest(raw=raw), self.assertRaises((RuntimeError, ValueError)):
                SUPPLY['strict_json'](raw)

    def test_exact22_leaf_public_catalog_pins_receipt_and_count_are_enforced(self):
        directory = self.inputs()
        pins = SUPPLY['validate_public_inputs'](directory)
        self.assertEqual(set(pins), set(SUPPLY['PUBLIC_NAMES']))
        self.assertEqual(len(pins), 22)
        # A new unexpected leaf is never silently uploaded, even if public.
        extra = directory / 'unadmitted.DATA'
        self.write(extra, b'public but not admitted')
        with self.assertRaises(RuntimeError):
            SUPPLY['validate_public_inputs'](directory)
        extra.unlink()
        for name, raw in [('member.bin', b'altered public member'), ('C-BOUNDARY-CASES.txt', b'61\n'),
                          ('N1-C-RESULT.json', b'{"verified":1}')]:
            path = directory / name
            original = path.read_bytes()
            path.write_bytes(raw)
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                SUPPLY['validate_public_inputs'](directory)
            path.write_bytes(original)
        self.assertEqual(SUPPLY['validate_public_inputs'](directory), pins)

    def test_reordered_manifest_or_boolean_scalar_cannot_weaken_public_output(self):
        directory = self.inputs()
        manifest_path = directory / 'PUBLIC-INPUTS.json'
        manifest = json.loads(manifest_path.read_bytes())
        manifest_path.write_text(json.dumps(list(reversed(manifest))), encoding='ascii')
        with self.assertRaises(RuntimeError):
            SUPPLY['validate_public_inputs'](directory)
        manifest_path.write_text(json.dumps(manifest), encoding='ascii')
        result_path = directory / 'N1-C-RESULT.json'
        result = json.loads(result_path.read_bytes())
        for key, value in [('verified', True), ('cleanupStatus', 1), ('reserved', 1), ('authority', 0), ('extra', 0)]:
            result_path.write_text(json.dumps(dict(result, **{key: value})), encoding='ascii')
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                SUPPLY['validate_public_inputs'](directory)

    def test_symlink_hardlink_mode_and_capacity_do_not_admit_public_files(self):
        path = self.root / 'public.DATA'
        self.write(path, b'public bytes')
        SUPPLY['pin'](path, private=True)
        path.chmod(0o644)
        with self.assertRaises(RuntimeError):
            SUPPLY['pin'](path, private=True)
        path.chmod(0o600)
        with self.assertRaises(RuntimeError):
            SUPPLY['pin'](path, maximum=1)
        alias = self.root / 'alias.DATA'
        alias.symlink_to(path)
        with self.assertRaises(RuntimeError):
            SUPPLY['pin'](alias)
        alias.unlink()
        os.link(path, alias)
        with self.assertRaises(RuntimeError):
            SUPPLY['pin'](path)
        alias.unlink()
        self.root.chmod(0o755)
        with self.assertRaises(RuntimeError):
            SUPPLY['directory'](self.root, private=True)

    def test_exclusive_copy_preserves_original_and_failed_unknown_target(self):
        source = self.root / 'libynx_artifact_release.a'
        self.write(source, b'synthetic public archive DATA; not a real native archive')
        before = (SUPPLY['identity'](source.lstat()), source.read_bytes())
        expected = SUPPLY['pin'](source)
        target = self.root / 'delivered.a'
        SUPPLY['copy_public'](source, target, expected)
        self.assertEqual(target.read_bytes(), source.read_bytes())
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        with self.assertRaises(FileExistsError):
            SUPPLY['copy_public'](source, target, expected)
        partial = self.root / 'UNKNOWN.a'
        self.write(partial, b'owned partial must remain')
        with self.assertRaises(FileExistsError):
            SUPPLY['copy_public'](source, partial, expected)
        self.assertEqual(partial.read_bytes(), b'owned partial must remain')
        self.assertEqual((SUPPLY['identity'](source.lstat()), source.read_bytes()), before)

    def test_actual_public_fixture_go_info_requires_full_same_commit_native_clean(self):
        settings = {'GOOS': 'darwin', 'GOARCH': 'arm64', 'CGO_ENABLED': '0', '-trimpath': 'true',
                    'vcs.revision': 'a' * 40, 'vcs.modified': 'false'}
        def raw(values):
            return ('/synthetic/public-fixture: go1.26.10\n' + ''.join('\tbuild\t' + k + '=' + v + '\n' for k, v in values.items())).encode('ascii')
        result = SUPPLY['fixture_build_info'](raw(settings), dict(os='darwin', arch='arm64'), 'a' * 40)
        self.assertFalse(result['archiveBuildInfoClaimed'])
        for key, value in [('GOOS', 'linux'), ('GOARCH', 'amd64'), ('CGO_ENABLED', '1'),
                           ('-trimpath', 'false'), ('vcs.revision', 'b' * 40), ('vcs.modified', 'true')]:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                SUPPLY['fixture_build_info'](raw(dict(settings, **{key: value})), dict(os='darwin', arch='arm64'), 'a' * 40)

    def test_recipe_uses_one_original_archive_and_exact_real_interop_no_fallback(self):
        self.assertNotIn('-buildmode=c-archive', RAW)
        self.assertNotIn('shell=True', RAW)
        self.assertNotIn('shutil.rmtree', RAW)
        self.assertNotIn('unlink(', RAW)
        self.assertEqual(BODY.count("command(['go', 'build'"), 1)
        required = (
            "original == temp / 'ynx-artifact-release-cabi/delivery/native-host'",
            "case == temp / 'ynx-registered-n1-verify-cabi'",
            "not case.exists() and not case.is_symlink()",
            "validate_parent(parent, os.environ, host, tree, archive_pin)",
            "require(set(REQUIRED_SOURCES) <= set(names)",
            "'./scripts/fixtures/verify-registered-n1-cabi'",
            "'scripts/fixtures/verify-registered-n1-cabi/c/registered_n1_smoke.c'), str(archive)",
            "command([str(caller), str(inputs)], timeout=60)",
            "command([str(fixture), 'verify', str(inputs)], timeout=60)",
            "validate_interop(interop_raw)", "validate_public_inputs(public_out)",
            "originalArchiveSource=parent_pin, sharedOriginalArchive=True, archive=archive_pin",
            "abi='YNXRegisteredANDMemberVerifyN1V1', abiVersion=1, requestBytes=160, resultBytes=32, borrowedPublicSpans=7",
            "qualifiedEntryPoints=['YNXRegisteredANDMemberVerifyN1V1'], archiveContainsOtherABIs=True",
            "privateMaterialIncluded=False, keysRead=False, signingByCABI=False",
            "nativeRootAuthorized=False, sourceOwnerQualified=False, accountAuthorized=False",
            "'libynx_artifact_release.a', 'registered_n1_verify.h', 'PUBLIC-INTEROP.json', 'public-inputs', 'SOURCE.json', 'ORIGINAL-ARCHIVE-SOURCE.json'",
            "('linux', 'amd64'), ('darwin', 'arm64')",
            "flags += ['-ldl']", "flags += ['-framework', 'CoreFoundation', '-framework', 'Security']",
        )
        for fragment in required:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, BODY)
        self.assertLess(BODY.index('validate_parent(parent, os.environ'), BODY.index('case.mkdir(mode=0o700)'))
        self.assertLess(BODY.index('validate_interop(interop_raw)'), BODY.index("out = case / 'delivery'"))
        self.assertLess(BODY.index('validate_public_inputs(public_out)'), BODY.index("print('YNX_REGISTERED_N1_CABI_SOURCE '"))


if __name__ == '__main__':
    unittest.main()
