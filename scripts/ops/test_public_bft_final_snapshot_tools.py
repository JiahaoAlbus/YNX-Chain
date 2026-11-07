#!/usr/bin/env python3
"""Pure original producer-record/remote-reader interoperability; no ELF execution."""
import ast
import copy
import hashlib
import json
import os
import re
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
READER = ROOT / 'remote/public-bft-final-snapshot.sh'
PRODUCER = ROOT / 'build-pq-offline-migration-tools.sh'


def python_body(path):
    raw = path.read_text()
    return raw.split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]


def original_reader(path=READER):
    tree = ast.parse(python_body(path))
    # Execute the real reader definitions, never main or export/transport.
    tree.body = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef))]
    namespace = {}
    exec(compile(tree, str(path), 'exec'), namespace)
    return namespace['tools_record']


class FinalSnapshotTools(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ynx-exporter-reader-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.commit, self.tree = 'a' * 40, 'b' * 40
        self.reader = original_reader()
        self.binaries = {}
        for name in ('ynx-chaind', 'ynx-consensus-package'):
            # Public synthetic ELF-shaped DATA, not a compiler/runtime result.
            raw = b'\x7fELF\x02\x01\x01' + bytes(11) + b'\x3e\x00' + name.encode()
            (self.root/name).write_bytes(raw)
            settings = {'-buildmode':'exe', '-trimpath':'true', 'CGO_ENABLED':'0', 'GOOS':'linux',
                        'GOARCH':'amd64', 'vcs':'git', 'vcs.revision':self.commit, 'vcs.modified':'false'}
            main = 'github.com/JiahaoAlbus/YNX-Chain/cmd/' + name
            info = str(self.root/name) + ': go1.26.10\n\tpath\t' + main + '\n'
            info += ''.join('\tbuild\t' + k + '=' + v + '\n' for k,v in settings.items())
            self.binaries[name] = dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                                      goInfo=dict(goVersion='go1.26.10', path=main, settings=settings, raw=info))
        observation = dict(head=self.commit, tree=self.tree, status='')
        # Construct via the unchanged normal producer's actual record AST,
        # so schema drift cannot be hidden by a second hand-written v2 DTO.
        producer = ast.parse(python_body(PRODUCER))
        assignments = [n for n in producer.body if isinstance(n, ast.Assign)
                       and any(isinstance(t, ast.Name) and t.id=='record' for t in n.targets)]
        self.assertEqual(len(assignments), 1)
        namespace = dict(after=observation, before=copy.deepcopy(observation),
                         controller=dict(commit='c'*40, runId='1234', runAttempt='1'), binaries=self.binaries)
        exec(compile(ast.Module(body=assignments, type_ignores=[]), str(PRODUCER), 'exec'), namespace)
        self.record = namespace['record']

    def publish(self, value=None, raw=None):
        if raw is None:
            raw=(json.dumps(self.record if value is None else value, sort_keys=True, separators=(',', ':'))+'\n').encode()
        (self.root/'SOURCE.json').write_bytes(raw)
        return hashlib.sha256(raw).hexdigest()

    def test_original_v2_producer_record_consumed(self):
        pin=self.publish()
        before={p.name:p.read_bytes() for p in self.root.iterdir()}
        self.assertEqual(self.reader(self.root,self.commit,pin),self.record)
        self.assertEqual(before,{p.name:p.read_bytes() for p in self.root.iterdir()})

    def test_original_v1_still_consumed_without_relabel(self):
        v=dict(version='YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1',commit=self.commit,runId='1234',
               platform='linux/amd64',purpose=self.record['purpose'],
               binaries={k:{f:r[f] for f in ('bytes','sha256')} for k,r in self.binaries.items()})
        pin=self.publish(v)
        self.assertEqual(self.reader(self.root,self.commit,pin),v)

    def test_v2_rejects_claims_closure_and_original_build_mismatch(self):
        mutations = {
            'version':lambda r:r.update(version='YNX-PQ-OFFLINE-MIGRATION-TOOLS/v3'),
            'extra':lambda r:r.update(extra=True),
            'missing':lambda r:r.pop('tree'),
            'dirty-before':lambda r:r['sourceBefore'].update(status=' M go.mod'),
            'changed-after':lambda r:r['sourceAfter'].update(tree='d'*40),
            'controller-run':lambda r:r['controllerCI'].update(runId='4321'),
            'controller-extra':lambda r:r['controllerCI'].update(extra=True),
            'zero-attempt':lambda r:r.update(runAttempt='0'),
            'root-claim':lambda r:r.update(authorityGranted=True),
            'execution-claim':lambda r:r.update(executionReady=True),
            'deployment-claim':lambda r:r.update(deploymentReady=True),
            'runtime-claim':lambda r:r.update(runtimeStarted=True),
            'build-source':lambda r:r['binaries']['ynx-chaind']['goInfo']['settings'].update({'vcs.revision':'d'*40}),
            'build-raw':lambda r:r['binaries']['ynx-chaind']['goInfo'].update(raw='not actual Go metadata'),
            'build-version':lambda r:r['binaries']['ynx-chaind']['goInfo'].update(goVersion='go1.25.7'),
            'build-path':lambda r:r['binaries']['ynx-chaind']['goInfo'].update(path='other/cmd/no'),
            'build-extra':lambda r:r['binaries']['ynx-chaind']['goInfo'].update(extra=True),
            'binary-extra':lambda r:r['binaries']['ynx-chaind'].update(extra=True),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                value=copy.deepcopy(self.record);mutate(value)
                with self.assertRaises((ValueError,TypeError,KeyError)):
                    self.reader(self.root,self.commit,self.publish(value))

    def test_independent_pins_catalog_and_original_bytes(self):
        pin=self.publish()
        with self.assertRaises(ValueError): self.reader(self.root,'d'*40,pin)
        with self.assertRaises(ValueError): self.reader(self.root,self.commit,'e'*64)
        (self.root/'unexpected').write_bytes(b'original')
        with self.assertRaises(ValueError): self.reader(self.root,self.commit,pin)
        (self.root/'unexpected').unlink()
        binary=self.root/'ynx-chaind'; old=binary.read_bytes();binary.write_bytes(old+b'tamper')
        with self.assertRaises(ValueError): self.reader(self.root,self.commit,pin)
        binary.write_bytes(old)
        alias=self.root/'alias';binary.rename(alias);binary.symlink_to(alias)
        with self.assertRaises(ValueError): self.reader(self.root,self.commit,pin)

    def test_duplicate_and_nonfinite_manifest_rejected(self):
        raw=(json.dumps(self.record)[:-1]+',"commit":"'+self.commit+'"}').encode()
        with self.assertRaises(ValueError): self.reader(self.root,self.commit,self.publish(raw=raw))
        raw=json.dumps(self.record).replace('"runtimeStarted": false','"runtimeStarted": NaN',1).encode()
        with self.assertRaisesRegex(ValueError,'invalid JSON constant'):
            self.reader(self.root,self.commit,self.publish(raw=raw))

    def test_v2_metadata_bound_and_actual_elf_identification(self):
        value=copy.deepcopy(self.record)
        value['binaries']['ynx-chaind']['goInfo']['raw']+='\tdep\texample.invalid/public-synthetic\tv1.0.0\t'+'a'*18000+'\n'
        pin=self.publish(value)
        self.assertGreater((self.root/'SOURCE.json').stat().st_size,16384)
        self.assertEqual(self.reader(self.root,self.commit,pin),value)
        binary=self.root/'ynx-chaind'
        raw=b'MZ'+binary.read_bytes()[2:]
        binary.write_bytes(raw)
        value['binaries']['ynx-chaind']['sha256']=hashlib.sha256(raw).hexdigest()
        with self.assertRaisesRegex(ValueError,'not Linux amd64 ELF'):
            self.reader(self.root,self.commit,self.publish(value))
    def test_normal_integration_push_builds_current_tools_without_old_replay(self):
        workflow=(ROOT.parent.parent/'.github/workflows/resource-market-ci.yml').read_text()
        def contract(raw):
            self.assertIn("      - 'scripts/ops/test_public_bft_final_snapshot_tools.py'\n", raw)
            section=re.split(r'(?m)^  # Export one public contract',
                             re.split(r'(?m)^  offline-migration-streaming:\n',raw,maxsplit=1)[1],maxsplit=1)[0]
            self.assertTrue(section.startswith("    if: github.event_name == 'push'\n"))
            names=['Verify original exporter v2 consumer and closed provenance','Use the qualified exporter Go toolchain',
                   'Build actual clean current-source offline tools without starting services','Upload the exact new-source clean exporter supply']
            expected="steps.scope.outputs.changed == 'true' || github.ref == 'refs/heads/codex/ynx-pq-perf-integration'"
            for name in names:
                self.assertEqual(section.count('      - name: '+name+'\n'),1)
                body=section.split('      - name: '+name+'\n',1)[1].split('      - name: ',1)[0]
                self.assertEqual(body.splitlines()[0], '        if: '+expected)
            for name in ['Install the pinned compiler runtime for retained-state fixtures',
                         'Verify normal native producer source and actual identity refusal protections',
                         'Prepare the same real compiled contracts used by migration recovery fixtures',
                         'Verify unchanged canonical bytes and source and output failure protections',
                         'Compile a distinct normal native transition candidate and read its actual build identity']:
                body=section.split('      - name: '+name+'\n',1)[1].split('      - name: ',1)[0]
                self.assertEqual(body.splitlines()[0], "        if: steps.scope.outputs.changed == 'true'")
            for literal in ['--source-commit "$GITHUB_SHA"','--source-tree "$(git rev-parse "$GITHUB_SHA^{tree}")"',
                            'name: ynx-pq-offline-migration-streaming-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',
                            'run: python3 -B scripts/ops/test_public_bft_final_snapshot_tools.py -v']:
                self.assertIn(literal,section)
        contract(workflow)
        for old,new in [(" || github.ref == 'refs/heads/codex/ynx-pq-perf-integration'",''),
                        (" || github.ref == 'refs/heads/codex/ynx-pq-perf-integration'"," || github.ref == 'refs/heads/main'"),
                        ('--source-commit "$GITHUB_SHA"','--source-commit 7f88113ea5848291db4f2da046aa447e876b8b8a')]:
            with self.subTest(mutation=new):
                with self.assertRaises(AssertionError):contract(workflow.replace(old,new))


if __name__ == '__main__':
    unittest.main()
