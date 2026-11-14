#!/usr/bin/env python3
"""Only new owned FS/data controls for whole-scratch resource observation. No child/network."""
import argparse, hashlib, importlib.util, json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);a=p.parse_args();a.output.mkdir(parents=True,mode=0o700,exist_ok=False)
f=Path(__file__).with_name('run_successor_public_qa.py');s=importlib.util.spec_from_file_location('supervisor',f);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
scratch=(a.output/'ynx-public-search-ABCDEFGH');scratch.mkdir(mode=0o700);scratch=scratch.resolve();profile=scratch/'YNX Browser Route State/Tor';profile.mkdir(parents=True,mode=0o700)
trace=scratch/'public-runtime.jsonl';trace.write_bytes(bytes(range(256))*64);trace.chmod(0o600)
info=scratch.stat();plan={'scratch':str(scratch),'scratchDevice':info.st_dev,'scratchInode':info.st_ino}
records=[]
root=m.observation_root(profile,plan)
if root!=scratch or m.physical([root])-m.physical([profile])!=trace.stat().st_blocks*512:raise AssertionError('trace omitted from observation')
records.append({'case':'whole-scratch-includes-real-trace-blocks','PASS':True})
for name,patch in [('wrong-inode',{'scratchInode':info.st_ino+1}),('bool-not-device',{'scratchDevice':True}),('wrong-root',{'scratch':str(a.output.resolve())})]:
 try:m.observation_root(profile,dict(plan,**patch));ok=False
 except m.Rejected:ok=True
 if not ok:raise AssertionError(name)
 records.append({'case':name,'PASS':True})
result={'status':'PASS','records':records,'sourceSHA256':hashlib.sha256(f.read_bytes()).hexdigest(),'processes':0,'network':'NOT_RUN','newFilesOnly':True}
(a.output/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'PASS','newFSControls':len(records)}))
