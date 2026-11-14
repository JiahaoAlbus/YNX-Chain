"""Original source materialization controls only: no compiler, node or runtime."""
import hashlib,importlib.util,json,os,posixpath,re,tempfile
from pathlib import Path
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('native_source_dependency_controls',Path(__file__).with_name('pq-7c25-native-source-dependencies.py'))
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
FIXTURES=Path(__file__).with_name('testdata')/'native-source-dependencies'

class OriginalDependencies(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name).resolve();self.source=self.base/'original';self.source.mkdir()
        self.view=self.base/'private';self.build=self.view/'source';self.build.mkdir(parents=True)
        for name in ('go.mod','go.sum','third_party/cometbft/go.mod','third_party/cometbft/go.sum'):
            path=self.build/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'original descriptor\n')
        self.receipt=self.view/'SOURCE-NATIVE-DEPENDENCIES.json'
    def git(self,source,*args):
        self.assertEqual(source,self.source)
        if args==('rev-parse','HEAD'):return (d.SOURCE+'\n').encode()
        if args==('rev-parse','HEAD^{tree}'):return (d.TREE+'\n').encode()
        if args==('status','--porcelain','--untracked-files=all'):return b''
        if args[:3]==('ls-tree','-z',d.SOURCE):
            name=args[-1];ref=d.FILES[name]
            return (ref['mode']+' blob '+ref['gitBlob']+'\t'+name+'\0').encode()
        self.assertEqual(args[:2],('cat-file','blob'))
        name=next(name for name,ref in d.FILES.items() if ref['gitBlob']==args[2])
        return (FIXTURES/name).read_bytes()
    def test_original_closed_include_graph_and_exclusive_materialization(self):
        self.assertEqual((len(d.FILES),sum(v['bytes'] for v in d.FILES.values())),(11,35651))
        for name,ref in d.FILES.items():
            raw=(FIXTURES/name).read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),ref['sha256'])
            resolved=[]
            for include in re.findall(r'^\s*#\s*include\s*"([^"]+)"',raw.decode(),re.M):
                candidates=[posixpath.normpath(posixpath.join(posixpath.dirname(name),include)),
                            posixpath.normpath(posixpath.join('packages/wallet-auth/native/source-parent',include))]
                resolved.append(next(path for path in candidates if path in d.FILES))
            self.assertEqual(resolved,ref['includes'])
        with mock.patch.object(d,'git',side_effect=self.git):result=d.materialize(self.source,self.build,self.receipt)
        record=json.loads(self.receipt.read_bytes());self.assertEqual(record,result['sourceDependencies'])
        self.assertFalse(record['originalSixRootReceiptIncludesTheseFiles'] or record['authorityGranted'] or record['nodeStarted'] or record['cgoDisabled'])
        for name in d.FILES:
            self.assertEqual((self.build/name).read_bytes(),(FIXTURES/name).read_bytes())
            self.assertEqual((self.build/name).stat().st_mode&0o777,0o644)
        self.assertFalse(any(self.source.iterdir()))
        with mock.patch.object(d,'git',side_effect=self.git),self.assertRaises(FileExistsError):d.materialize(self.source,self.build,self.receipt)
    def test_wrong_original_blob_is_refused_before_any_dependency_write(self):
        def changed(source,*args):
            raw=self.git(source,*args)
            return b'wrong bytes' if args[:2]==('cat-file','blob') else raw
        with mock.patch.object(d,'git',side_effect=changed),self.assertRaisesRegex(RuntimeError,'bytes differ'):
            d.materialize(self.source,self.build,self.receipt)
        self.assertFalse((self.build/'packages').exists());self.assertFalse(self.receipt.exists())
    def test_destination_symlink_and_existing_file_are_never_followed_or_overwritten(self):
        outside=self.base/'outside';outside.mkdir();(self.build/'packages').symlink_to(outside,target_is_directory=True)
        with mock.patch.object(d,'git',side_effect=self.git),self.assertRaises(OSError):d.materialize(self.source,self.build,self.receipt)
        self.assertFalse(any(outside.iterdir()));(self.build/'packages').unlink()
        name=next(iter(d.FILES));path=self.build/name;path.parent.mkdir(parents=True);path.write_bytes(b'preserve existing')
        with mock.patch.object(d,'git',side_effect=self.git),self.assertRaises(FileExistsError):d.materialize(self.source,self.build,self.receipt)
        self.assertEqual(path.read_bytes(),b'preserve existing')
    def test_original_identity_and_receipt_location_remain_required(self):
        with self.assertRaisesRegex(RuntimeError,'disjoint'):
            d.materialize(self.source,self.source,self.source.parent/'SOURCE-NATIVE-DEPENDENCIES.json')
        with mock.patch.object(d,'git',return_value=b'wrong\n'),self.assertRaisesRegex(RuntimeError,'exact clean'):
            d.materialize(self.source,self.build,self.receipt)
        with self.assertRaisesRegex(RuntimeError,'sibling dependency receipt'):
            d.materialize(self.source,self.build,self.base/'SOURCE-NATIVE-DEPENDENCIES.json')

    def test_fixed_held_proof_source_is_admitted_by_the_native_dependency_reader(self):
        pin_spec = importlib.util.spec_from_file_location('held_source_pin', Path(__file__).with_name('pq-held-first100-source.py'))
        pin = importlib.util.module_from_spec(pin_spec)
        pin_spec.loader.exec_module(pin)
        git = {'HEAD': pin.SOURCE.encode(), 'HEAD^{tree}': pin.TREE.encode(), '--untracked-files=all': b''}
        with mock.patch.object(d, 'git', side_effect=lambda _source, *args: git[args[-1]]):
            self.assertEqual(d.source_identity(self.source), (pin.SOURCE, pin.TREE))
            git['HEAD^{tree}'] = b'0' * 40
            with self.assertRaisesRegex(RuntimeError, 'exact clean'):
                d.source_identity(self.source)

if __name__=='__main__':unittest.main(verbosity=2)
