import hashlib
import importlib.util
import io
from pathlib import Path
import stat
import unittest
import warnings
import zipfile
spec=importlib.util.spec_from_file_location('archive',Path(__file__).with_name('pq-source-evidence-archive.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

def make(entries):
    f=io.BytesIO()
    with zipfile.ZipFile(f,'w') as z:
        for name,value in entries:z.writestr(name,value)
    return f.getvalue()
def inspect(data,pins): return a.read_original_archive(data,expected_sha256=hashlib.sha256(data).hexdigest(),expected_members=pins)
def pin(value):return hashlib.sha256(value).hexdigest()

class ArchiveControls(unittest.TestCase):
    def test_original_members(self):
        self.assertEqual(inspect(make([('one',b'1'),('d/two',b'2')]),{'one':pin(b'1'),'d/two':pin(b'2')}),{'one':b'1','d/two':b'2'})
    def test_inventory_and_digest_refuse(self):
        for data,pins in ((make([('one',b'1')]),{'one':pin(b'2')}),(make([('one',b'1'),('extra',b'2')]),{'one':pin(b'1')})):
            with self.assertRaises(ValueError):inspect(data,pins)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning)
            duplicate=make([('one',b'1'),('one',b'1')])
        with self.assertRaisesRegex(ValueError,'inventory differs'):inspect(duplicate,{'one':pin(b'1')})
    def test_paths_and_links_refuse(self):
        with self.assertRaises(ValueError):inspect(make([('../x',b'x')]),{'../x':pin(b'x')})
        entry=zipfile.ZipInfo('x');entry.create_system=3;entry.external_attr=(stat.S_IFLNK|0o777)<<16
        with self.assertRaises(ValueError):inspect(make([(entry,b'target')]),{'x':pin(b'target')})
    def test_total_bound_and_wrong_zip_digest_refuse(self):
        data=make([('one',b'11')]);pins={'one':pin(b'11')}
        with self.assertRaises(ValueError):a.read_original_archive(data,expected_sha256='0'*64,expected_members=pins)
        with self.assertRaises(ValueError):a.read_original_archive(data,expected_sha256=pin(data),expected_members=pins,total_limit=1)

if __name__=='__main__':unittest.main()
