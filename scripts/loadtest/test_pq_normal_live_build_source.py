"""Matching build routing controls only; no Go build, node or real archive claim."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from contextlib import ExitStack
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


class HeldSignerSourceControls(unittest.TestCase):
    def fixture(self, *, legacy=False):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        root=Path(temporary.name).resolve();source=root/'original';source.mkdir();dest=root/'composition'
        profile=dict(reader.HELD_SIGNER_COMPOSITION)
        identity={key:profile[key] for key in ('commit','tree','forkTree')}
        if legacy:
            native=reader.native_source_dependencies
            identity=dict(commit=native.HELD_SOURCE,tree=native.HELD_TREE,
                          forkTree='5a128880d14bfc73de4334cba23218859ad3473c')
        script=source/'scripts/verify/wire-live-matching-source-ci.py'
        script.parent.mkdir(parents=True);script.write_bytes(b'# synthetic composer fixture\n')
        profile['compositionScriptSHA256']=hashlib.sha256(script.read_bytes()).hexdigest()
        descriptors=('go.mod','go.sum','third_party/cometbft/go.mod','third_party/cometbft/go.sum')
        originals={name:('original '+name+'\n').encode() for name in descriptors}
        originals.update({'third_party/cometbft/'+name:('original '+name+'\n').encode()
                          for name in reader.SIGNER_RETAINED})
        for name,raw in originals.items():
            path=source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
        def prepare(src,target,commit,tree):
            target.mkdir();built=target/'source';built.mkdir()
            for name,raw in originals.items():
                path=built/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            selection=dict(originalSourceCommit=commit,originalSourceTree=tree,
                originalProductionForkTree=identity['forkTree'],
                selectedOptionalForkCommit=profile['optionalForkCommit'],
                selectedOptionalForkTree=profile['optionalForkTree'],buildTags=[reader.BUILD_TAG],
                sourceOnly=True,fakeVCSIdentity=False,originalCheckoutWritten=False,
                originalModuleDescriptorsChanged=False,nodeStarted=False,carrierEnabled=False,publicActivation=False,
                retainedProductionSHA256={name:hashlib.sha256(originals['third_party/cometbft/'+name]).hexdigest()
                                          for name in reader.SIGNER_RETAINED},
                moduleDescriptorSHA256={name:hashlib.sha256(originals[name]).hexdigest() for name in descriptors})
            return self.receipt(target,selection)
        core=SimpleNamespace(prepare_wire_live_source=mock.Mock(side_effect=prepare))
        def git(command,**kwargs):
            self.assertEqual(kwargs['env']['GIT_NO_LAZY_FETCH'],'1')
            args=command[3:]
            if args==['status','--porcelain','--untracked-files=normal']:return b''
            refs={'HEAD':identity['commit'],'HEAD^{tree}':identity['tree'],
                  'HEAD:third_party/cometbft':identity['forkTree'],
                  profile['optionalForkCommit']+':third_party/cometbft':profile['optionalForkTree']}
            self.assertEqual(args[0],'rev-parse');return refs[args[1]].encode()
        return source,dest,profile,identity,core,git

    def receipt(self,target,selection):
        path=target/'SOURCE-SELECTION.json';raw=json.dumps(selection).encode();path.write_bytes(raw)
        return dict(sourceDirectory=str(target/'source'),sourceSelection=selection,receiptPath=str(path),
                    receiptBytes=len(raw),receiptSHA256=hashlib.sha256(raw).hexdigest())

    def compose(self,fixture,*,held_source_only=True,native_error=None):
        source,dest,profile,identity,core,git=fixture
        loader=SimpleNamespace(exec_module=lambda module:None)
        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(reader,'HELD_SIGNER_COMPOSITION',profile))
            stack.enter_context(mock.patch.object(reader.subprocess,'check_output',side_effect=git))
            stack.enter_context(mock.patch.object(reader.importlib.util,'spec_from_file_location',
                                                 return_value=SimpleNamespace(loader=loader)))
            stack.enter_context(mock.patch.object(reader.importlib.util,'module_from_spec',return_value=core))
            native=stack.enter_context(mock.patch.object(reader.native_source_dependencies,'materialize',
                                                       return_value={'fixtureNativeSourceOnly':True},side_effect=native_error))
            result=reader.prepare_matching_source(source,dest,held_source_only=held_source_only)
            native.assert_called_once_with(source,dest/'source',dest/'SOURCE-NATIVE-DEPENDENCIES.json')
            return result

    def test_exact_signer_tuple_uses_normal_callee_without_runtime_qualification(self):
        f=self.fixture();source,dest,profile,identity,core,_=f
        result=self.compose(f)
        self.assertEqual(result['source'],identity)
        self.assertEqual(result['compositionScriptSHA256'],profile['compositionScriptSHA256'])
        self.assertIsNone(result['ciEvidenceSHA256']);self.assertTrue(result['sourceCompositionOnly'])
        for field in ('runtimeAuthorized','sourceCIQualified','pressureAuthorized','carrierEnabled','actualNetworkWindow'):
            self.assertIs(result[field],False)
        core.prepare_wire_live_source.assert_called_once_with(source,dest,identity['commit'],identity['tree'])
        self.assertEqual(len(result['originalCoreSelection']['sourceSelection']['retainedProductionSHA256']),7)

    def test_source_only_pin_never_inherits_an_old_live_qualification(self):
        f=self.fixture()
        with self.assertRaisesRegex(RuntimeError,'exact normal live source profile'):
            self.compose(f,held_source_only=False)
        f[4].prepare_wire_live_source.assert_not_called();self.assertFalse(f[1].exists())

    def test_commit_tree_fork_and_composer_changes_refuse_before_export(self):
        for field in ('commit','tree','forkTree','compositionScriptSHA256'):
            with self.subTest(field=field):
                f=self.fixture()
                if field=='compositionScriptSHA256':f[2][field]='0'*64
                else:f[3][field]='0'*40
                with self.assertRaises(RuntimeError):self.compose(f)
                f[4].prepare_wire_live_source.assert_not_called();self.assertFalse(f[1].exists())

    def test_wrong_supplier_object_is_refused_before_export(self):
        f=list(self.fixture());original=f[5]
        def wrong(command,**kwargs):
            if command[-1]==f[2]['optionalForkCommit']+':third_party/cometbft':return b'0'*40
            return original(command,**kwargs)
        f[5]=wrong
        with self.assertRaisesRegex(RuntimeError,'matching module object differs'):self.compose(f)
        f[4].prepare_wire_live_source.assert_not_called();self.assertFalse(f[1].exists())

    def test_forged_receipt_or_replaced_retained_bytes_preserve_failed_composition(self):
        for kind in ('missing','extra','wrongHash','signerBytes','observerBytes','descriptorBytes','scope','fakeVCS'):
            with self.subTest(kind=kind):
                f=self.fixture();dest=f[1];original=f[4].prepare_wire_live_source.side_effect
                def changed(*args):
                    result=original(*args);selection=result['sourceSelection']
                    key='privval/ynx_context_server.go'
                    if kind=='missing':del selection['retainedProductionSHA256'][key]
                    elif kind=='extra':selection['retainedProductionSHA256']['unexpected.go']='0'*64
                    elif kind=='wrongHash':selection['retainedProductionSHA256'][key]='0'*64
                    elif kind in ('signerBytes','observerBytes'):
                        if kind=='observerBytes':key='node/ynx_proof_source.go'
                        (dest/'source/third_party/cometbft'/key).write_bytes(b'replaced')
                    elif kind=='descriptorBytes':(dest/'source/third_party/cometbft/go.sum').write_bytes(b'replaced')
                    elif kind=='scope':selection['sourceOnly']=False
                    elif kind=='fakeVCS':(dest/'source/.git').mkdir()
                    return self.receipt(dest,selection)
                f[4].prepare_wire_live_source.side_effect=changed
                with self.assertRaises(RuntimeError):self.compose(f)
                self.assertTrue(dest.exists())

    def test_native_dependency_failure_cannot_be_converted_to_composition_success(self):
        f=self.fixture()
        with self.assertRaisesRegex(RuntimeError,'native mismatch'):
            self.compose(f,native_error=RuntimeError('native mismatch'))
        self.assertTrue(f[1].exists())

    def test_legacy_held_source_still_requires_its_original_composer(self):
        f=self.fixture(legacy=True)
        # The new signer composer is not a blanket replacement for old sources.
        with self.assertRaisesRegex(RuntimeError,'exact original Core composition callee'):
            self.compose(f)
        f[4].prepare_wire_live_source.assert_not_called();self.assertFalse(f[1].exists())


if __name__=='__main__':unittest.main()
