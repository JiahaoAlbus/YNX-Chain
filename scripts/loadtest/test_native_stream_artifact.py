"""ZIP/range source counterexamples only; no HTTP, compiler, nodes or workload."""
import importlib.util,io,json,os,stat,struct,tempfile,unittest,zipfile,zlib
from pathlib import Path
from unittest.mock import patch
FILE=Path(__file__).with_name('native-stream-artifact.py')
spec=importlib.util.spec_from_file_location('stream_zip',FILE);zip_reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(zip_reader)

def build(files,comment=b''):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
        z.comment=comment
        for name,data in files:z.writestr(name,data)
    return out.getvalue()

def source(raw,seen=None):
    def fetch(at,size):
        if seen is not None:seen.append((at,size))
        assert 0<size<=65536
        return raw[at:at+size]
    return zip_reader.Blocks(len(raw),fetch)

class NativeStreamArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()/'capture'
    def test_original_go_public_archive_recovers_complete_signed_and_latency_identity(self):
        original=os.environ.get('YNX_NATIVE_STREAM_PUBLIC_FIXTURE_DIR')
        self.assertTrue(original,'original Go public fixture is mandatory; do not count a skipped positive as proof')
        original=Path(original).resolve();out=io.BytesIO()
        with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
            for directory,_,files in os.walk(original):
                for filename in sorted(files):
                    path=Path(directory)/filename;self.assertNotIn('secret',filename)
                    z.write(path,str(path.relative_to(original)))
        before=zip_reader.verify_capture(original,'unit','0'*40)
        recovered=zip_reader.recover(source(out.getvalue()),self.root,'unit')
        after=zip_reader.verify_capture(self.root,'unit','0'*40)
        self.assertEqual(before,after);self.assertTrue(after['streamReadbackVerified'])
        self.assertEqual(after['publicStream']['validatedRecords'],102)
        self.assertEqual(recovered['members'],4+after['publicStream']['originalPublicMemberManifest']['members'])
        self.assertFalse(after['networkQualified'])

    def test_large_central_directory_streams_all_public_segments_and_resumes_exact_bytes(self):
        files=[('sender-ready-intents/intent-%06d.jsonl'%i,b'row'+str(i).encode()) for i in range(1800)]
        files+=[('ephemeral-sender-secrets.json',b'PRIVATE MUST NOT BE COPIED')]
        raw=build(files);seen=[];out=zip_reader.recover(source(raw,seen),self.root,'unit')
        self.assertEqual(out['members'],1800);self.assertGreater(out['centralDirectoryBytes'],131072)
        self.assertLessEqual(max(size for _,size in seen),65536);self.assertFalse((self.root/'ephemeral-sender-secrets.json').exists())
        again=zip_reader.recover(source(raw),self.root,'unit');self.assertEqual(out['selectedMemberManifestSHA256'],again['selectedMemberManifestSHA256'])
        self.assertEqual((self.root/'sender-ready-intents/intent-001799.jsonl').read_bytes(),b'row1799')
        self.assertFalse(out['wholeZipDigestComputed']);self.assertFalse(out['networkQualified'])
    def test_local_header_name_substitution_refuses_before_decode(self):
        raw=bytearray(build([('transactions.json',b'original')]))
        raw[30]^=1
        with self.assertRaisesRegex(RuntimeError,'local/central name'):zip_reader.recover(source(bytes(raw)),self.root,'unit')
        self.assertFalse((self.root/'transactions.json.recover-partial').exists());self.assertFalse((self.root/'transactions.json').exists())
    def test_duplicate_selected_segment_and_path_escape_refuse(self):
        for files in ([('sender-ready-intents/intent-000000.jsonl',b'a')]*2,[('../transactions.json',b'a')],[('a\\transactions.json',b'a')]):
            with self.subTest(files=files),tempfile.TemporaryDirectory() as d,self.assertRaises(RuntimeError):
                zip_reader.recover(source(build(files)),Path(d).resolve()/'out','unit')
    def test_symlink_and_oversized_selected_members_refuse(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            info=zipfile.ZipInfo('transactions.json');info.create_system=3;info.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(info,'/tmp/secret')
        with self.assertRaisesRegex(RuntimeError,'type/size'):zip_reader.recover(source(out.getvalue()),self.root,'unit')
        raw=build([('transactions.json',b'x'*(zip_reader.MAX_MEMBER+1))])
        with self.assertRaisesRegex(RuntimeError,'type/size'):zip_reader.recover(source(raw),self.root,'unit')
    def test_corrupted_member_crc_or_truncated_central_never_promotes(self):
        raw=bytearray(build([('transactions.json',b'real bytes')]))
        cd=raw.index(b'PK\x01\x02');struct.pack_into('<I',raw,cd+16,42)
        with self.assertRaisesRegex(RuntimeError,'CRC'):zip_reader.recover(source(bytes(raw)),self.root,'unit')
        with self.assertRaises(RuntimeError):zip_reader.Archive(source(bytes(raw[:-1])))
    def test_changed_existing_member_and_symlinked_output_are_not_overwritten(self):
        raw=build([('transactions.json',b'original')]);zip_reader.recover(source(raw),self.root,'unit');target=self.root/'transactions.json';target.write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError,'existing recovered member differs'):zip_reader.recover(source(raw),self.root,'unit')
        self.assertEqual(target.read_bytes(),b'changed');target.unlink();target.symlink_to(self.root/'absent')
        with self.assertRaisesRegex(RuntimeError,'regular'):zip_reader.recover(source(raw),self.root,'unit')
    def test_existing_member_is_bound_to_original_sha_not_only_crc(self):
        raw=build([('transactions.json',b'original')]);zip_reader.recover(source(raw),self.root,'unit')
        identity=zip_reader.file_identity(self.root/'transactions.json');identity['sha256']='0'*64
        with patch.object(zip_reader,'file_identity',return_value=identity),self.assertRaisesRegex(RuntimeError,'SHA256 differs'):
            zip_reader.recover(source(raw),self.root,'unit')

    def test_zip64_local_sizes_and_directory_locator(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
            with z.open('transactions.json','w',force_zip64=True) as f:f.write(b'original64')
        raw=out.getvalue();end=raw.rfind(b'PK\x05\x06');e=list(struct.unpack('<4s4H2IH',raw[end:end+22]));count,cd_size,cd=e[4:7]
        z64=struct.pack('<4sQ2H2I4Q',b'PK\x06\x06',44,45,45,0,0,count,count,cd_size,cd)
        locator=struct.pack('<4sIQI',b'PK\x06\x07',0,end,1);e[3]=e[4]=65535;e[5]=e[6]=0xffffffff
        raw=raw[:end]+z64+locator+struct.pack('<4s4H2IH',*e)
        out=zip_reader.recover(source(raw),self.root,'unit');self.assertEqual(out['members'],1);self.assertEqual((self.root/'transactions.json').read_bytes(),b'original64')
    def test_eocd_signature_in_comment_is_not_mistaken_for_final_record(self):
        raw=build([('transactions.json',b'original')],b'comment PK\x05\x06 false signature')
        self.assertEqual(zip_reader.recover(source(raw),self.root,'unit')['members'],1)
    def test_data_descriptor_and_local_flag_binding(self):
        class NonSeek(io.BytesIO):
            def seekable(self):return False
            def seek(self,*args):raise io.UnsupportedOperation()
        out=NonSeek()
        with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:z.writestr('transactions.json',b'descriptor'*10000)
        raw=out.getvalue();zip_reader.recover(source(raw),self.root,'unit')
        self.assertEqual((self.root/'transactions.json').read_bytes(),b'descriptor'*10000)
        raw=bytearray(raw);descriptor=raw.index(b'PK\x07\x08');raw[descriptor+4]^=1
        with tempfile.TemporaryDirectory() as d,self.assertRaisesRegex(RuntimeError,'descriptor'):zip_reader.recover(source(bytes(raw)),Path(d).resolve()/'out','unit')
    def test_network_selection_is_fixed_and_never_copies_private_node_or_sender_keys(self):
        files=[('ynx-linux-supply-case/network/transactions.json',b'original'),('ynx-linux-supply-case/network/sender-ready-intents/intent-000000.jsonl',b'intent'),('ynx-linux-supply-evidence/actual.json',b'receipt'),('ynx-linux-supply-case/network/ephemeral-sender-secrets.json',b'private'),('ynx-linux-supply-case/network/validator-0/config/priv_validator_key.json',b'private')]
        proof=zip_reader.recover(source(build(files)),self.root,'network');self.assertEqual(proof['members'],3)
        self.assertEqual({str(p.relative_to(self.root)) for p in self.root.rglob('*') if p.is_file()},{'network/transactions.json','network/sender-ready-intents/intent-000000.jsonl','evidence/actual.json'})

class HTTPRangeTests(unittest.TestCase):
    class Response:
        def __init__(self,raw,start,status=206,etag='"unit-etag"',bad_range=False):
            self.raw=raw;self.status=status;self.reads=0
            self.headers={'Content-Range':'wrong' if bad_range else 'bytes '+str(start)+'-'+str(start+len(raw)-1)+'/120000','ETag':etag}
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def read(self,n):
            self.reads+=1;assert n<=65537;return self.raw[:n]
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.cache=Path(self.temp.name).resolve()/'cache'
        self.identity=dict(artifactId=1,head='a'*40,bytes=120000);self.raw=b'x'*120000
    def backend(self,*,status=206,bad_range=False,change_etag=False):
        owner=self
        class Opener:
            calls=0;last=None
            def open(self,request,timeout):
                span=request.get_header('Range').split('=')[1];a,b=map(int,span.split('-'));self.calls+=1
                self.last=owner.Response(owner.raw[a:b+1],a,status,etag='"changed"' if change_etag and self.calls>1 else '"unit-etag"',bad_range=bad_range);return self.last
        opener=Opener();ranges=zip_reader.ExactHTTPRanges('https://unit.blob.core.windows.net/unit?sig=fake',120000,self.cache,self.identity,opener=opener)
        return ranges,opener
    def test_original_ranges_resume_with_bound_identity_and_hash_without_refetch(self):
        ranges,opener=self.backend();self.assertEqual(ranges.fetch(0,65536),self.raw[:65536]);self.assertEqual(opener.calls,1)
        resumed,second=self.backend();self.assertEqual(resumed.fetch(0,65536),self.raw[:65536]);self.assertEqual(second.calls,0)
        with self.assertRaisesRegex(RuntimeError,'another artifact'):
            zip_reader.ExactHTTPRanges('https://unit.blob.core.windows.net/unit',120000,self.cache,dict(self.identity,artifactId=2))
        path=self.cache/'block-0000000000.bin';raw=path.read_bytes();path.write_bytes(b'y'+raw[1:])
        with self.assertRaisesRegex(RuntimeError,'integrity'):resumed.fetch(0,65536)
    def test_non206_or_wrong_range_refuses_before_body_download(self):
        for delta in (dict(status=200),dict(bad_range=True)):
            ranges,opener=self.backend(**delta)
            with self.subTest(delta=delta),self.assertRaisesRegex(RuntimeError,'exact206'):ranges.fetch(0,65536)
            self.assertEqual(opener.last.reads,0)
    def test_changed_etag_deadline_and_incomplete_cache_are_not_retried(self):
        ranges,opener=self.backend(change_etag=True);ranges.fetch(0,65536)
        with self.assertRaisesRegex(RuntimeError,'ETag changed'):ranges.fetch(65536,54464)
        self.assertFalse((self.cache/'block-0000065536.bin').exists())
        ranges.deadline=0
        with self.assertRaisesRegex(RuntimeError,'deadline'):ranges.fetch(0,65536)
        (self.cache/'block-0000065536.bin').write_bytes(b'uncertain partial')
        resumed,opener=self.backend()
        with self.assertRaisesRegex(RuntimeError,'incomplete original'):resumed.fetch(65536,54464)
        self.assertEqual(opener.calls,0)
    def test_hard_deadline_interrupts_blocked_work(self):
        import subprocess,sys
        code="""import importlib.util,signal,time
spec=importlib.util.spec_from_file_location('reader',%r);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
signal.signal(signal.SIGALRM,m.recovery_timeout);signal.setitimer(signal.ITIMER_REAL,.01)
try:
 time.sleep(1)
except RuntimeError as error:
 assert 'original60s recovery deadline' in str(error);print('DEADLINE_INTERRUPTED')
else:
 raise RuntimeError('deadline handler did not interrupt blocked work')
finally:
 signal.setitimer(signal.ITIMER_REAL,0)
"""%str(FILE.resolve())
        out=subprocess.check_output([sys.executable,'-B','-c',code],timeout=3)
        self.assertEqual(out.strip(),b'DEADLINE_INTERRUPTED')

    def test_redirect_host_and_aligned_range_are_explicit(self):
        for url in ('http://unit.blob.core.windows.net/unit','https://example.com/unit','https:///unit','https://u:p@unit.blob.core.windows.net/unit'):
            with self.subTest(url=url),self.assertRaises(RuntimeError):zip_reader.ExactHTTPRanges(url,120000,self.cache,self.identity)
        ranges,_=self.backend()
        with self.assertRaisesRegex(RuntimeError,'aligned'):ranges.fetch(1,65536)

if __name__=='__main__':unittest.main()
