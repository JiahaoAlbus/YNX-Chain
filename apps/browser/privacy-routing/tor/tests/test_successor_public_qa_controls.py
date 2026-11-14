#!/usr/bin/env python3
"""Only new offline metadata/byte-pin controls; never compiles or runs a backend."""
import argparse,hashlib,importlib.util,json,tempfile,time
from pathlib import Path
from unittest.mock import patch

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);a=p.parse_args();a.output.mkdir(parents=True,mode=0o700,exist_ok=False)
 here=Path(__file__).resolve().parent;spec=importlib.util.spec_from_file_location('successor',here/'prepare_successor_public_qa.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 now=1800000000.;plan={'schema':'P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V1','port':63782,'fixedTargets':m.FIXED_TARGETS,'fixedMethod':'GET','lyrebirdSHA256':m.HELPER_SHA256,'createdAt':now,'chosenLineSHA256':'9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f','profile':'/owned/ynx-public-search-ABCDEFGH/YNX Browser Route State/Tor'}
 records=[]
 def check(name,fn,reject=False):
  try:fn();accepted=True
  except(ValueError,FileNotFoundError):accepted=False
  assert accepted != reject,name
  records.append({'name':name,'PASS':True})
 with patch('subprocess.Popen',side_effect=AssertionError('no process permitted')):
  check('fixed-metadata',lambda:m.validate_metadata(plan,now))
  for label,change in [('expired',{'createdAt':now-1801}),('future',{'createdAt':now+1}),('wrong-helper',{'lyrebirdSHA256':'0'*64}),('wrong-profile',{'profile':'/user/Tor'}),('wrong-port',{'port':9050}),('wrong-reviewed-line',{'chosenLineSHA256':'0'*64}),('wrong-profile-suffix',{'profile':'/owned/ynx-public-search-too-short/YNX Browser Route State/Tor'})]:
   item=dict(plan);item.update(change);check(label,lambda item=item:m.validate_metadata(item,now),True)
  bad=a.output/'synthetic-not-a-helper';bad.write_bytes(b'PUBLIC SYNTHETIC invalid helper');bad.chmod(0o700)
  check('wrong-actual-file-pin',lambda:m.check_helper(bad),True)
  link=a.output/'synthetic-link';link.symlink_to(bad);check('symlink-rejected',lambda:m.check_helper(link),True)
  check('missing-helper',lambda:m.check_helper(a.output/'missing'),True)
 result={'schema':'P05_SUCCESSOR_QA_OFFLINE_CONTROLS_V1','records':records,'status':'PASS','processes':0,'network':'NOT_RUN','SwiftSDKTypecheck':'NOT_RUN','sourcePins':{str(here/n):hashlib.sha256((here/n).read_bytes()).hexdigest() for n in ['prepare_successor_public_qa.py','run_successor_public_qa.py','SuccessorPublicQA.swift']}}
 (a.output/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'PASS','newControls':len(records),'network':'NOT_RUN'}))
if __name__=='__main__':main()
