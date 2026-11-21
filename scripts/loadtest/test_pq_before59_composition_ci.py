"""Negative controls for the source-only original composition CI entry."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('before59_original_composition_ci',Path(__file__).with_name('pq-before59-composition-ci.py'))
ci=importlib.util.module_from_spec(spec);spec.loader.exec_module(ci)

class Before59CompositionCIControls(unittest.TestCase):
    def test_real_workflow_yaml_rejects_duplicate_upload_retention(self):
        workflow=Path(__file__).resolve().parents[2]/'.github/workflows/chain-core.yml'
        source=workflow.read_text()
        ruby=r'''require 'psych'
        def convert(node)
          case node
          when Psych::Nodes::Mapping
            out={}
            node.children.each_slice(2) do |key,value|
              raise 'non-scalar key' unless key.is_a?(Psych::Nodes::Scalar)
              raise 'duplicate key' if out.key?(key.value)
              out[key.value]=convert(value)
            end
            out
          when Psych::Nodes::Sequence then node.children.map { |child| convert(child) }
          when Psych::Nodes::Scalar then node.value
          else raise 'unsupported YAML node'
          end
        end
        root=convert(Psych.parse(STDIN.read).root)
        checks=[['rss-source-controls','Preserve source-only RSS and stage control result','90'],
                ['before59-original-composition','Retain only the original before59 source-build evidence','7']]
        checks.each do |job,name,days|
          steps=root.fetch('jobs').fetch(job).fetch('steps').select { |step| step['name']==name }
          raise 'upload differs' unless steps.length==1 && steps[0].fetch('with').fetch('retention-days')==days
        end'''
        def parse(value):return subprocess.run(['ruby','-rpsych','-e',ruby],input=value,text=True,capture_output=True,timeout=10)
        result=parse(source);self.assertEqual(result.returncode,0,result.stderr)
        for path,days in (('pq-process-rss-source-controls/RESULT.json','90'),('before59-composition-original/','7')):
            needle='          path: ${{ runner.temp }}/'+path+'\n          if-no-files-found: error\n          retention-days: '+days+'\n'
            self.assertIn(needle,source)
            changed=source.replace(needle,needle+'          retention-days: '+days+'\n',1)
            with self.subTest(path=path):self.assertNotEqual(parse(changed).returncode,0)

    def test_wrong_source_tree_fork_or_supplier_refuses_before_worktree(self):
        with tempfile.TemporaryDirectory() as folder:
            repo=Path(folder).resolve();temp=repo/'tmp';temp.mkdir()
            expected={ci.SOURCE+'^{commit}':ci.SOURCE,ci.SOURCE+'^{tree}':ci.TREE,
                      ci.SOURCE+':third_party/cometbft':ci.FORK,ci.SUPPLIER+':third_party/cometbft':ci.SUPPLIER_TREE}
            for wrong in expected:
                def git(_root,_cmd,key):return '0'*40 if key==wrong else expected[key]
                with self.subTest(wrong=wrong),mock.patch.object(ci,'git',side_effect=git), \
                     mock.patch.object(ci.subprocess,'run') as process:
                    with self.assertRaisesRegex(RuntimeError,'Git objects required'):
                        ci.run(repo,temp,require_linux=False)
                    process.assert_not_called();self.assertEqual(list(temp.iterdir()),[])

    def test_non_linux_rejected_before_repository_or_process(self):
        with mock.patch.object(ci.sys,'platform','darwin'),mock.patch.object(ci.subprocess,'run') as process:
            with self.assertRaisesRegex(RuntimeError,'actual Linux'):
                ci.run(Path('/nonexistent'),Path('/nonexistent'))
            process.assert_not_called()

    def test_wrong_tools_run_identity_refuses_before_worktree(self):
        with tempfile.TemporaryDirectory() as folder:
            repo=Path(folder).resolve();temp=repo/'tmp';temp.mkdir()
            identity=dict(toolSource='a'*40,run=101,attempt=1,job='before59-original-composition')
            for key,value in (('toolSource','f'*40),('run',True),('attempt',2),('job','other')):
                changed=dict(identity,**{key:value})
                with self.subTest(key=key),mock.patch.object(ci,'git',return_value='a'*40), \
                     mock.patch.object(ci.subprocess,'run') as process:
                    with self.assertRaisesRegex(RuntimeError,'Tools run identity required'):
                        ci.run(repo,temp,require_linux=False,ci_identity=changed)
                    process.assert_not_called();self.assertEqual(list(temp.iterdir()),[])

    def test_binary_digest_rejects_symlink_hardlink_and_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);path=root/'binary';path.write_bytes(b'original synthetic binary')
            pin=ci.digest_regular(path);self.assertEqual(pin['bytes'],25);self.assertEqual(len(pin['sha256']),64)
            link=root/'hardlink';os.link(path,link)
            with self.assertRaisesRegex(RuntimeError,'single-link'):ci.digest_regular(path)
            link.unlink();link.symlink_to(path)
            with self.assertRaises(OSError):ci.digest_regular(link)
            path.write_bytes(b'')
            with self.assertRaisesRegex(RuntimeError,'nonempty'):ci.digest_regular(path)

if __name__=='__main__':unittest.main()
