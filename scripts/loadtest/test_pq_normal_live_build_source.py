"""Matching build routing controls only; no Go build, node or real archive claim."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('live_build_controls',Path(__file__).with_name('pq-normal-live-reader.py'))
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)


class MatchingSourceControls(unittest.TestCase):
    def fixture(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        root=Path(temporary.name).resolve();source=root/'source';source.mkdir();dest=root/'private-build'
        script=source/'scripts/verify/wire-live-matching-source-ci.py';script.parent.mkdir(parents=True);script.write_text('# fixture, no compiler or main invoked\n')
        for name in ('go.mod','go.sum'):(source/name).write_bytes(name.encode())
        identity=dict(commit='a'*40,tree='b'*40,forkTree='c'*40)
        q=dict(identity,optionalForkCommit='d'*40,optionalForkTree='e'*40,buildTag=reader.BUILD_TAG,
               compositionScriptSHA256=hashlib.sha256(script.read_bytes()).hexdigest(),ciEvidenceSHA256='f'*64)
        core=SimpleNamespace(PRODUCTION_TREE='c'*40,FORK_COMMIT='d'*40,FORK_TREE='e'*40,DIFF={'mempool/live.go'})
        def prepare(src,target,commit,tree):
            target.mkdir();built=target/'source';built.mkdir()
            for name in ('go.mod','go.sum'):(built/name).write_bytes((source/name).read_bytes())
            selection=dict(originalSourceCommit=commit,originalSourceTree=tree,originalProductionForkTree='c'*40,
                selectedOptionalForkCommit='d'*40,selectedOptionalForkTree='e'*40,buildTags=[reader.BUILD_TAG],
                fakeVCSIdentity=False,originalCheckoutWritten=False,originalModuleDescriptorsChanged=False,
                nodeStarted=False,carrierEnabled=False,publicActivation=False)
            receipt=target/'SOURCE-SELECTION.json';raw=json.dumps(selection).encode();receipt.write_bytes(raw)
            return dict(sourceDirectory=str(built),sourceSelection=selection,receiptPath=str(receipt),
                        receiptBytes=len(raw),receiptSHA256=hashlib.sha256(raw).hexdigest())
        core.prepare_wire_live_source=mock.Mock(side_effect=prepare)
        def git(command,**kw):
            args=command[3:]
            if args==['status','--porcelain','--untracked-files=normal']:return b''
            if args==['rev-parse','HEAD']:return identity['commit'].encode()
            if args==['rev-parse','HEAD^{tree}']:return identity['tree'].encode()
            if args==['rev-parse','HEAD:third_party/cometbft']:return identity['forkTree'].encode()
            if args==['rev-parse',core.FORK_COMMIT+':third_party/cometbft']:return q['optionalForkTree'].encode()
            if args[:2]==['diff','--name-only']:return b'mempool/live.go\n'
            if args[:2]==['diff','--diff-filter=D']:return b''
            raise AssertionError(command)
        return source,dest,q,core,git

    def compose(self,source,dest,q,core,git):
        loader=SimpleNamespace(exec_module=lambda module:None)
        with mock.patch.object(reader,'NORMAL_LIVE_SOURCE_QUALIFICATION',q), mock.patch.object(reader,'verify_qualification_evidence'), \
             mock.patch.object(reader.subprocess,'check_output',side_effect=git), \
             mock.patch.object(reader.importlib.util,'spec_from_file_location',return_value=SimpleNamespace(loader=loader)), \
             mock.patch.object(reader.importlib.util,'module_from_spec',return_value=core):
            return reader.prepare_matching_source(source,dest)

    def test_matching_source_preserves_original_identity_and_exports_selected_module(self):
        source,dest,q,core,git=self.fixture();result=self.compose(source,dest,q,core,git)
        self.assertEqual(result['source']['forkTree'],'c'*40)
        self.assertEqual(result['optionalForkTree'],'e'*40)
        self.assertEqual(result['buildSource'],str(dest/'source'))
        self.assertFalse(result['carrierEnabled']);self.assertFalse(result['actualNetworkWindow'])
        core.prepare_wire_live_source.assert_called_once_with(source,dest,q['commit'],q['tree'])
        self.assertEqual((source/'go.mod').read_bytes(),(dest/'source/go.mod').read_bytes())

    def test_absent_qualification_and_changed_composer_never_export_source(self):
        for kind in ('absent','composer'):
            with self.subTest(kind=kind):
                source,dest,q,core,git=self.fixture()
                if kind=='absent':q=None
                else:q['compositionScriptSHA256']='0'*64
                with self.assertRaises(RuntimeError):self.compose(source,dest,q,core,git)
                core.prepare_wire_live_source.assert_not_called();self.assertFalse(dest.exists())

    def test_production_and_selected_fork_cannot_be_conflated(self):
        source,dest,q,core,git=self.fixture();q['forkTree']=q['optionalForkTree']
        with self.assertRaisesRegex(RuntimeError,'exact normal live source profile'):self.compose(source,dest,q,core,git)
        core.prepare_wire_live_source.assert_not_called();self.assertFalse(dest.exists())

    def test_source_change_or_descriptor_change_during_export_is_rejected(self):
        source,dest,q,core,git=self.fixture()
        original=core.prepare_wire_live_source.side_effect
        def changed(*args):
            result=original(*args)
            (dest/'source/go.sum').write_bytes(b'changed')
            return result
        core.prepare_wire_live_source.side_effect=changed
        with self.assertRaisesRegex(RuntimeError,'module descriptor changed'):self.compose(source,dest,q,core,git)
        self.assertTrue(dest.exists())  # preserve partial composition, no retry.


if __name__=='__main__':unittest.main()
