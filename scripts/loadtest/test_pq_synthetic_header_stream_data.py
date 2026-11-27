import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('synthetic_header_data',Path(__file__).with_name('pq-synthetic-header-stream-data.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def raw(value): return json.dumps(value,separators=(',',':')).encode()+b'\n'
def sha(value): return hashlib.sha256(value).hexdigest()
def fixture():
    stream=m._HEADER+b''.join(raw(dict(height=h,headerHash='ab'*32,appHash='cd'*32,captureEpoch=3,attempt=h+2,monotonicNs=str(100+h))) for h in (8,9))
    receipt=raw(dict(version='YNX-SYNTHETIC-HEADER-STREAM-RECEIPT/v1',classification='DATA_ONLY',status='UNKNOWN',streamStatus='OBSERVED_DATA',enqueued=2,written=2,bytes=len(stream),sha256=sha(stream),streamDurable=True,streamCleanupDebt=False,firstCauseBytes=0,firstCauseTruncated=False,startupCoverageComplete=False,walReplayExcluded=False,nodeBindingVerified=False,runtimeAuthorized=False,independentFinality=False,receiptPublicationVerified=False))
    return stream,receipt

def inspect(s,r,**kw):return m.inspect_bytes(s,r,stream_sha256=sha(s),receipt_sha256=sha(r),**kw)

class HeaderStreamDataControls(unittest.TestCase):
    def test_original_shape_and_bounded_selection(self):
        s,r=fixture();out=inspect(s,r,selected_heights=[9])
        self.assertEqual(out['events'],2);self.assertEqual(out['selected'][9]['attempt'],11)
        for key in ('runtimeAuthorized','independentFinality','sourceVerified','startupCoverageComplete','nodeBindingVerified'):
            self.assertIs(out[key],False)
    def test_pins_and_receipt_contract(self):
        s,r=fixture()
        with self.assertRaises(ValueError):m.inspect_bytes(s,r,stream_sha256='0'*64,receipt_sha256=sha(r))
        for field,value in [('status','OBSERVED'),('streamCleanupDebt',True),('runtimeAuthorized',True),('written',1),('firstCauseBytes',1)]:
            obj=json.loads(r);obj[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):inspect(s,raw(obj))
    def test_private_failure_never_disclosed(self):
        s,r=fixture();obj=json.loads(r);obj['firstCauseBase64']='c2VjcmV0';obj['firstCauseBytes']=6
        with self.assertRaises(ValueError) as caught:inspect(s,raw(obj))
        self.assertNotIn('c2VjcmV0',str(caught.exception))
    def test_empty_stream_and_nonproducer_receipt_encoding_fail_after_repin(self):
        s,r=fixture();obj=json.loads(r);empty=m._HEADER
        obj.update(enqueued=0,written=0,bytes=len(empty),sha256=sha(empty))
        with self.assertRaises(ValueError):inspect(empty,raw(obj))
        obj=json.loads(r)
        for encoded in (json.dumps(obj,indent=2).encode()+b'\n',raw(dict(reversed(list(obj.items())))),r[:-1]):
            with self.assertRaises(ValueError):inspect(s,encoded)
    def test_gap_duplicate_and_invalid_clock_fail_after_repin(self):
        s,r=fixture();lines=s.splitlines(keepends=True)
        changes=[lines[0]+lines[1]+lines[1],lines[0]+lines[1]+lines[2].replace(b'"height":9',b'"height":10'),lines[0]+lines[1]+lines[2].replace(b'"monotonicNs":"109"',b'"monotonicNs":"0109"')]
        for bad in changes:
            obj=json.loads(r);obj['bytes']=len(bad);obj['sha256']=sha(bad)
            with self.subTest(bad=bad),self.assertRaises(ValueError):inspect(bad,raw(obj))
    def test_duplicate_fields_and_truncated_original_fail(self):
        s,r=fixture()
        for bad in (s[:-1],s.replace(b'"height":8',b'"height":8,"height":8')):
            obj=json.loads(r);obj['bytes']=len(bad);obj['sha256']=sha(bad)
            with self.assertRaises(ValueError):inspect(bad,raw(obj))
    def test_real_regular_files_and_nofollow(self):
        s,r=fixture()
        with tempfile.TemporaryDirectory() as t:
            root=Path(t).resolve();a=root/'stream';b=root/'stream.receipt.json';a.write_bytes(s);b.write_bytes(r);a.chmod(0o600);b.chmod(0o600)
            self.assertEqual(m.inspect_paths(a,b,stream_sha256=sha(s),receipt_sha256=sha(r))['events'],2)
            root.chmod(0o755)
            with self.assertRaises(ValueError):m.inspect_paths(a,b,stream_sha256=sha(s),receipt_sha256=sha(r))
            root.chmod(0o700)
            with mock.patch.object(m.os,'geteuid',return_value=os.geteuid()+1):
                with self.assertRaises(ValueError):m.inspect_paths(a,b,stream_sha256=sha(s),receipt_sha256=sha(r))
            a.chmod(0o644)
            with self.assertRaises(ValueError):m.inspect_paths(a,b,stream_sha256=sha(s),receipt_sha256=sha(r))
            a.chmod(0o600)
            wrong=root/'other';wrong.write_bytes(r)
            with self.assertRaises(ValueError):m.inspect_paths(a,wrong,stream_sha256=sha(s),receipt_sha256=sha(r))
            alias=root/'alias';alias.symlink_to(a)
            (root/'alias.receipt.json').write_bytes(r)
            with self.assertRaises(ValueError):m.inspect_paths(alias,root/'alias.receipt.json',stream_sha256=sha(s),receipt_sha256=sha(r))
            if hasattr(os,'mkfifo'):
                fifo=root/'fifo';os.mkfifo(fifo)
                (root/'fifo.receipt.json').write_bytes(r)
                with self.assertRaises(ValueError):m.inspect_paths(fifo,root/'fifo.receipt.json',stream_sha256=sha(s),receipt_sha256=sha(r))

    def test_failed_directory_close_never_reuses_fd_number(self):
        s,r=fixture()
        with tempfile.TemporaryDirectory() as t:
            root=Path(t).resolve();a=root/'stream';b=root/'stream.receipt.json'
            a.write_bytes(s);b.write_bytes(r);a.chmod(0o600);b.chmod(0o600)
            original_close=os.close;sentinel=os.open('/dev/null',os.O_RDONLY);reused=[];calls=[]
            def fail_once(fd):
                calls.append(fd)
                if not reused:
                    original_close(fd);os.dup2(sentinel,fd);reused.append(fd)
                    raise OSError('CONTROL close reported unknown')
                return original_close(fd)
            try:
                try:raise RuntimeError('CONTROL caller already handles another exception')
                except RuntimeError:
                    with mock.patch.object(m.os,'close',side_effect=fail_once):
                        with self.assertRaises(ValueError):m.inspect_paths(a,b,stream_sha256=sha(s),receipt_sha256=sha(r))
                self.assertEqual(calls.count(reused[0]),1);os.fstat(reused[0])
            finally:
                if reused:original_close(reused[0])
                original_close(sentinel)

    def test_replaced_parent_between_original_leaves_is_rejected(self):
        s,r=fixture()
        with tempfile.TemporaryDirectory() as t:
            base=Path(t).resolve();root=base/'private';root.mkdir(mode=0o700)
            a=root/'stream';b=root/'stream.receipt.json';a.write_bytes(s);b.write_bytes(r);a.chmod(0o600);b.chmod(0o600)
            original=m._read_leaf;calls=[]
            def swap(directory,path,limit):
                result=original(directory,path,limit);calls.append(path)
                if len(calls)==1:
                    root.rename(base/'old-private');root.mkdir(mode=0o700)
                    (root/'stream').write_bytes(s);(root/'stream.receipt.json').write_bytes(r)
                    (root/'stream').chmod(0o600);(root/'stream.receipt.json').chmod(0o600)
                return result
            with mock.patch.object(m,'_read_leaf',side_effect=swap):
                with self.assertRaises(ValueError):m.inspect_paths(a,b,stream_sha256=sha(s),receipt_sha256=sha(r))
            self.assertEqual(len(calls),1)

if __name__=='__main__': unittest.main()
