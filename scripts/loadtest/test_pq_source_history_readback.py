import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('history_readback',Path(__file__).with_name('pq-source-history-readback.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
SOURCE='a'*40
RUN=123
TS=b'2026-11-21T12:00:00.1234567Z '

def fixture():
    members={}; frames=[]
    for (case,idx),(positive,tops) in h.CASES.items():
        children=h.REQUIRED_CHILDREN.get((case,idx),[])
        outcomes=h.EXPECTED_RED_CHILDREN.get((case,idx),{})
        lines=[]
        for n,top in enumerate(tops):
            own=[c for c in children if c.split('/')[0]==top]
            lines.append('=== RUN   '+top+'\n')
            lines.extend('=== RUN   '+child+'\n' for child in own)
            if n==0:
                for literal,count in h.RED_LITERALS.get((case,idx),{}).items():
                    lines.extend('    example: '+literal+'\n' for _ in range(count))
            top_outcome='PASS' if positive else 'FAIL'
            lines.append(f'--- {top_outcome}: {top} (0.00s)\n')
            lines.extend(f'    --- {outcomes.get(child,"pass").upper()}: {child} (0.00s)\n' for child in own)
        package='github.com/JiahaoAlbus/YNX-Chain/'+('cmd/ynx-consensus-key-init' if case=='ceremony' and idx==3 else 'cmd/ynx-comet' if case=='comet-layout' else 'internal/consensus')
        lines.append(('ok' if positive else 'FAIL')+'\t'+package+'\t0.1s\n')
        if not positive: lines.append('FAIL\n')
        raw=''.join(lines).encode(); code=0 if positive else 1
        events=h.qualify(raw.decode(),case,idx,code)
        metadata=dict(case=case,index=idx,exit=code,source=SOURCE,run=str(RUN),attempt='1',bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),events=events)
        meta=(json.dumps(metadata,sort_keys=True)+'\n').encode()
        members[f'{case}-{idx}.log']=raw;members[f'{case}-{idx}.json']=meta
        begin=f'YNX-HISTORY-RAW-BEGIN/v1 case={case} index={idx} source={SOURCE} run={RUN} attempt=1 exit={code}\n'.encode()
        end=f'YNX-HISTORY-RAW-END/v1 case={case} index={idx}\n'.encode()
        frames += [begin,*raw.splitlines(keepends=True),end,b'YNX-HISTORY-RAW-METADATA/v1 '+meta]
    return b''.join(TS+x for x in frames),members

def check(log,members):
    return h.inspect_original_streams(log,members,source=SOURCE,run=RUN,attempt=1,expected_job_sha=hashlib.sha256(log).hexdigest(),expected_members={k:hashlib.sha256(v).hexdigest() for k,v in members.items()})

class SourceHistoryTests(unittest.TestCase):
    def setUp(self): self.log,self.members=fixture()
    def test_all_twelve_are_data_only(self):
        result=check(self.log,self.members)
        self.assertEqual(result['cases'],12)
        self.assertFalse(result['sourceQualified']);self.assertFalse(result['runtimePermissionGranted'])
    def test_missing_duplicate_and_extra_are_rejected(self):
        for mutate in ('missing','duplicate','extra'):
            with self.subTest(mutate=mutate),self.assertRaises(ValueError):
                log=self.log; members=self.members.copy()
                if mutate=='missing': del members['journal-1.log']
                if mutate=='extra': members['extra.log']=b''
                if mutate=='duplicate': log+=self.log
                check(log,members)
    def test_wrong_run_and_cancelled_red_rejected(self):
        for old,new in ((b'run=123 attempt=1',b'run=124 attempt=1'),(b'attempt=1 exit=1',b'attempt=1 exit=137')):
            with self.subTest(new=new),self.assertRaises(ValueError): check(self.log.replace(old,new,1),self.members)
    def test_job_segment_and_artifact_must_match(self):
        members=self.members.copy();members['journal-1.log']+=b'x'
        with self.assertRaises(ValueError): check(self.log,members)
    def test_package_terminal_and_child_lifecycle(self):
        raw=self.members['journal-1.log'].decode()
        with self.assertRaises(ValueError): h.qualify(raw.replace('FAIL\tgithub.com','ok\tgithub.com',1),'journal',1,1)
        with self.assertRaises(ValueError): h.qualify(raw.replace('=== RUN   TestPQEngineStateReadActualLayoutsRegistryRotationRevocation/snapshot-journal\n',''),'journal',1,1)
        with self.assertRaises(ValueError): h.qualify(raw.replace('--- FAIL: TestPQEngineStateReadActualLayoutsRegistryRotationRevocation','--- SKIP: TestPQEngineStateReadActualLayoutsRegistryRotationRevocation',1),'journal',1,1)
    def test_literal_is_required(self):
        original=h.RED_LITERALS[('ceremony',1)]
        try:
            h.RED_LITERALS[('ceremony',1)]={'an unrelated assertion failed':1}
            log,members=fixture()
        finally:
            h.RED_LITERALS[('ceremony',1)]=original
        # Complete internally consistent original-looking Go events, metadata,
        # artifact bytes and SHA cannot replace the fixed counterexample.
        with self.assertRaisesRegex(ValueError,'counterexample'): check(log,members)
    def test_history_segment_order_and_decimal_are_canonical(self):
        lines=self.log.splitlines(keepends=True)
        starts=[i for i,line in enumerate(lines) if b'YNX-HISTORY-RAW-BEGIN/v1' in line]
        # Swap two complete self-consistent segments without altering members.
        altered=b''.join(lines[starts[1]:starts[2]]+lines[starts[0]:starts[1]]+lines[starts[2]:])
        with self.assertRaisesRegex(ValueError,'out of order'):check(altered,self.members)
        for old,new in ((b'index=1 source=',b'index=01 source='),(b'attempt=1 exit=1',b'attempt=1 exit=01')):
            with self.subTest(new=new),self.assertRaises(ValueError):check(self.log.replace(old,new,1),self.members)

    def test_original_metadata_bytes_are_not_normalized(self):
        members=self.members.copy()
        value=json.loads(members['ceremony-1.json'])
        members['ceremony-1.json']=(json.dumps(value,separators=(',',':'))+'\n').encode()
        self.assertNotEqual(members['ceremony-1.json'],self.members['ceremony-1.json'])
        with self.assertRaisesRegex(ValueError,'metadata bytes differ'):
            check(self.log,members)
    def test_frozen_hash_and_duplicate_json(self):
        with self.assertRaises(ValueError): h.inspect_original_streams(self.log,self.members,source=SOURCE,run=RUN,attempt=1,expected_job_sha='0'*64,expected_members={k:hashlib.sha256(v).hexdigest() for k,v in self.members.items()})
        with self.assertRaises(ValueError): h._strict_json(b'{"exit":1,"exit":1}')
    def test_job_log_requires_real_framing(self):
        with self.assertRaises(ValueError): check(self.log.replace(TS,b'',1),self.members)
        with self.assertRaises(ValueError): check(self.log[:-1],self.members)
        self.assertEqual(check(self.log+b'unframed original script continuation\n',self.members)['cases'],12)

if __name__=='__main__': unittest.main()
