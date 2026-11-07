#!/usr/bin/env python3
import copy
import hashlib
import json
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('collector',Path(__file__).with_name('collect_pq_committed_account_wire_tests.py'))
collector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

def valid():
    rows=[dict(Package=collector.PACKAGE,Action='start')]
    for name in collector.REQUIRED:
        rows.extend([dict(Package=collector.PACKAGE,Action='run',Test=name),dict(Package=collector.PACKAGE,Action='pass',Test=name)])
    rows.append(dict(Package=collector.PACKAGE,Action='pass'))
    return rows

class AccountWireCollector(unittest.TestCase):
    def test_original_closed_stream(self):
        result=collector.qualify(valid())
        self.assertEqual(result['requiredPassed'],list(collector.REQUIRED))
        for key in ['nodeStarted','keysGenerated','newSignaturesCreated','rootSelected','nativeReceipt','walletAccountAuthorized','publicNetwork']:
            self.assertIs(result[key],False)
    def test_reject_missing_duplicate_foreign_fail_skip(self):
        cases={}
        cases['empty']=[]
        cases['missing']=valid()[:-3]+valid()[-1:]
        cases['duplicate']=valid()+valid()[1:3]
        cases['foreignpackage']=valid();cases['foreignpackage'][1]['Package']='other'
        cases['foreignsubtest']=valid()+[dict(Package=collector.PACKAGE,Action='run',Test='Foreign/Sub')]
        for action in ['fail','skip','build-fail']:
            cases[action]=valid()+[dict(Package=collector.PACKAGE,Action=action)]
        cases['missingpackage']=valid()[:-1]
        cases['duplicatepackage']=valid()+[valid()[-1]]
        cases['malformed']=valid()+[None]
        for name,rows in cases.items():
            with self.subTest(name=name):
                with self.assertRaises(ValueError):collector.qualify(rows)
    def test_sole_sdk_verbatim_data_contract(self):
        folder=Path(__file__).resolve().parents[2]/'internal/consensus/testdata/account_proof_wire_sdk'
        pins={'MobileAccountProofHostPortPrivate.hpp':'8aa0a0bf28ecfc139fc6a6c637abe4e6e38730cc97c1a9f1dfc70cc2ca9823a4','MobileAccountProofWireDATA.hpp':'786c9b56aa445e82d0ffbc64e949272cb99692a674341e036199bccbe2b564fe'}
        provenance=json.loads((folder/'PROVENANCE.json').read_text())
        self.assertEqual(provenance['contractHSHA256'],'df06446ca993a46dd7e0054a6415b7665de0fd0a3a4cde6728d73154873e9ab9')
        self.assertIs(provenance['dataInteropOnly'],True)
        self.assertIs(provenance['rootQualification'],False)
        for name,pin in pins.items():
            self.assertEqual(hashlib.sha256((folder/name).read_bytes()).hexdigest(),pin)
            self.assertEqual([p['sha256'] for p in provenance['files'] if p['file']==name],[pin])
    def test_recipe_exact_original_groups(self):
        recipe=(Path(__file__).resolve().parents[1]/'verify/committed-account-wire-check.sh').read_text()
        for name in collector.REQUIRED:self.assertEqual(recipe.count(name),1)
        for literal in ['-tags=ynx_public_trace_testsupport','-json -p 1 -count=1 -timeout=120s','scripts/loadtest/fixtures/finalize-1b-public','./internal/consensus','collect_pq_committed_account_wire_tests.py','YNX_ACCOUNT_PROOF_SDK_DATA_DRIVER','-std=c++17 -Wall -Wextra -Werror','test_collect_pq_committed_account_wire_tests.py']:
            self.assertIn(literal,recipe)
        for forbidden in ['KeyGen','GenerateCandidateKey','Node.Start','go build','go run','-short','|| true']:
            self.assertNotIn(forbidden,recipe)

if __name__=='__main__':unittest.main()
