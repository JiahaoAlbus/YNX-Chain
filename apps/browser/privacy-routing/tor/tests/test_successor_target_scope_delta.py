#!/usr/bin/env python3
import argparse,importlib.util,json,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);a=p.parse_args();a.output.mkdir(parents=True,mode=0o700,exist_ok=False)
f=Path(__file__).with_name('prepare_successor_public_qa.py');s=importlib.util.spec_from_file_location('preparer',f);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
now=time.time();plan={'schema':'P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V1','port':63782,'lyrebirdSHA256':m.HELPER_SHA256,'createdAt':now,'chosenLineSHA256':'9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f','profile':'/owned/ynx-public-search-ABCDEFGH/YNX Browser Route State/Tor','fixedTargets':m.FIXED_TARGETS,'fixedMethod':'GET'}
records=[]
for case,patch,accept in [('fixed-two-targets',{},True),('missing-targets',{'fixedTargets':None},False),('arbitrary-target',{'fixedTargets':[m.FIXED_TARGETS[0],'https://invalid.example/']},False),('extra-query',{'fixedTargets':[m.FIXED_TARGETS[0],m.FIXED_TARGETS[1]+'&q=other']},False),('post-method',{'fixedMethod':'POST'},False)]:
 item=dict(plan);item.update(patch)
 try:m.validate_metadata(item,now);actual=True
 except ValueError:actual=False
 assert actual==accept,case
 records.append({'case':case,'PASS':True})
(a.output/'RESULT.json').write_text(json.dumps({'status':'PASS','newControls':records,'network':'NOT_RUN','processes':0},indent=2)+'\n');print(json.dumps({'status':'PASS','controls':len(records)}))
