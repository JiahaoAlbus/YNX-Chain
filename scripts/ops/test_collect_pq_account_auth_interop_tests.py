#!/usr/bin/env python3
import hashlib,importlib.util,json,unittest
from pathlib import Path
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('joint',Path(__file__).with_name('collect_pq_account_auth_interop_tests.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
def valid():
    rows=[dict(Package=c.PACKAGE,Action='start')]
    for name in c.REQUIRED:rows.extend([dict(Package=c.PACKAGE,Action='run',Test=name),dict(Package=c.PACKAGE,Action='pass',Test=name)])
    return rows+[dict(Package=c.PACKAGE,Action='pass')]
class Joint(unittest.TestCase):
    def test_same_test_package_build_output_is_only_a_prefix(self):
        notice=dict(Action='build-output',ImportPath=c.PACKAGE+'.test',Output='original linker diagnostic\n')
        rows=[notice]+valid()
        original=json.dumps(rows,sort_keys=True)
        self.assertEqual(c.qualify(rows),c.qualify(valid()))
        self.assertEqual(json.dumps(rows,sort_keys=True),original)
        # More than one original diagnostic line is still not an extra test.
        self.assertEqual(c.qualify([notice,dict(notice,Output='next original diagnostic\n')]+valid()),c.qualify(valid()))
    def test_build_output_closed_shape_origin_type_and_position_are_required(self):
        notice=dict(Action='build-output',ImportPath=c.PACKAGE+'.test',Output='original linker diagnostic\n')
        malformed=[dict(notice,Action='build-fail'),dict(notice,ImportPath='foreign.test'),
                   dict(notice,ImportPath=c.PACKAGE),dict(notice,ImportPath=c.PACKAGE+'.test/other'),
                   dict(notice,Package=c.PACKAGE),dict(notice,Test=c.TOP),dict(notice,extra=True),
                   dict(notice,Output=''),dict(notice,Output=None),dict(notice,Output=1)]
        malformed += [{k:v for k,v in notice.items() if k!=field} for field in notice]
        for event in malformed:
            with self.subTest(event=event),self.assertRaises(ValueError):c.qualify([event]+valid())
        for index in range(1,len(valid())+1):
            with self.subTest(position=index),self.assertRaises(ValueError):c.qualify(valid()[:index]+[notice]+valid()[index:])
    def test_build_output_cannot_replace_or_mask_any_original_outcome(self):
        notice=dict(Action='build-output',ImportPath=c.PACKAGE+'.test',Output='original linker diagnostic\n')
        cases=[[],valid()[:-1],valid()+valid()[-1:]]
        for name in c.REQUIRED:
            for action in ('run','pass'):
                cases.append([e for e in valid() if not(e.get('Test')==name and e['Action']==action)])
                cases.append(valid()+[dict(Package=c.PACKAGE,Action=action,Test=name)])
            for action in ('fail','skip','build-fail'):
                cases.append(valid()+[dict(Package=c.PACKAGE,Action=action,Test=name)])
        for rows in cases:
            with self.subTest(rows=rows),self.assertRaises(ValueError):c.qualify([notice]+rows)
    def test_closed_actual_group(self):
        v=c.qualify(valid());self.assertTrue(v['jointPUBLICPassed'])
        for name in ['normalProtectedHost','RootAdmission','SourceAdmission','NativeReceipt','walletAccountAuthorized','newKeysOrSignatures','nodeStarted','mobileLibraryQualified','newArchiveBuilt']:self.assertIs(v[name],False)
    def test_missing_duplicate_fail_skip_foreign(self):
        cases=[[],valid()[:-1],valid()+valid()[1:3],valid()+valid()[-1:],valid()+[{}],valid()+[dict(Package='other',Action='pass')]]
        for action in ['fail','skip','build-fail']:cases.append(valid()+[dict(Package=c.PACKAGE,Action=action,Test=c.REQUIRED[1])])
        for name in c.REQUIRED:cases.append([e for e in valid() if e.get('Test')!=name])
        for rows in cases:
            with self.subTest(rows=rows):
                with self.assertRaises(ValueError):c.qualify(rows)
    def test_original_foreign_closure(self):
        base=root/'internal/consensus/testdata/account_auth_interop';p=json.loads((base/'PROVENANCE.json').read_text())
        self.assertEqual(p['AuthFinalH']['sha256'],'ff6bf6bc34fc0e82665ab7399da900dea816a680a6c30f4b1f48a2e3e949b987');self.assertEqual(len(p['copied']),33);self.assertEqual(len(p['originalLinkDependencies']),6)
        for entry in p['copied']+p['originalLinkDependencies']:
            b=(base/entry['path']).read_bytes();self.assertTrue(entry['verbatim']);self.assertEqual(len(b),entry['bytes']);self.assertEqual(hashlib.sha256(b).hexdigest(),entry['sha256'])
        fixed={'auth-final-r1/source/MobileAccountProofClient.cpp':'8799a6fb18db26ad3729223b9193eb40a390993c32fb92159126a8487ec89481','auth-final-r1/source/MobileRegisteredReceipt.cpp':'8015b8bac2f12981fb643ad94e8587a66443377056a4aa9c3b4b91a11c23b3d6'}
        for name,digest in fixed.items():self.assertEqual(hashlib.sha256((base/name).read_bytes()).hexdigest(),digest)
    def test_normal_recipe_is_additive(self):
        recipe=(root/'scripts/verify/account-auth-interop-check.sh').read_text()
        for text in [c.TOP,'-json -p 1 -count=1 -timeout=120s','ynx_public_trace_testsupport,ynx_account_auth_interop','build-account-auth-interop.py','YNX_ACCOUNT_AUTH_ROOT0_BINARY','scripts/loadtest/fixtures/finalize-1b-public','collect_pq_account_auth_interop_tests.py']:self.assertIn(text,recipe)
        for text in ['KeyGen','Node.Start','go build','go run','-short','|| true']:self.assertNotIn(text,recipe)
        test=(root/'internal/consensus/pq_committed_account_auth_interop_test.go').read_text();self.assertIn('//go:build darwin && ynx_public_trace_testsupport && ynx_account_auth_interop',test)
        for name in c.REQUIRED[1:]:self.assertIn(name.split('/')[1],test)
        for literal in ['GOMAXPROCS=2','GOMEMLIMIT=1536MiB']:self.assertIn(literal,test)
if __name__=='__main__':unittest.main()
