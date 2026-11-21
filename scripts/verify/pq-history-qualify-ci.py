#!/usr/bin/env python3
"""Recheck each original same-run history log and pin its exact bytes."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path

root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history',root/'pq-history-events-ci.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
d=Path(os.environ['RUNNER_TEMP'])/'ynx-pq-history-public'
expected={f'{case}-{idx}.{ext}' for case,idx in h.CASES for ext in ('log','json')}
if not d.is_dir() or d.is_symlink() or {p.name for p in d.iterdir()} != expected:
    raise SystemExit('original history artifact members missing or unexpected')
entries=[]
for case,idx in sorted(h.CASES):
    lp=d/f'{case}-{idx}.log'; mp=d/f'{case}-{idx}.json'
    if lp.is_symlink() or mp.is_symlink(): raise SystemExit('original history artifact is a symlink')
    data=lp.read_bytes();meta=json.loads(mp.read_text())
    positive,_=h.CASES[case,idx]
    status=meta.get('exit')
    if type(status) is not int or (status==0)!=positive: raise SystemExit('history exit differs')
    events=h.qualify(data.decode(),case,idx,status)
    if meta != dict(case=case,index=idx,exit=status,source=os.environ['GITHUB_SHA'],run=os.environ['GITHUB_RUN_ID'],attempt=os.environ['GITHUB_RUN_ATTEMPT'],bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),events=events):
        raise SystemExit('history source, bytes, or events differ')
    entries.append(meta)
manifest=dict(version='YNX-HISTORY-ORIGINAL-EVENTS/v1',source=os.environ['GITHUB_SHA'],run=os.environ['GITHUB_RUN_ID'],attempt=os.environ['GITHUB_RUN_ATTEMPT'],cases=entries,sourceOnly=True,publicActivation=False,independentFinality=False)
print('YNX_HISTORY_ORIGINAL_EVENTS_DATA_ONLY '+json.dumps(manifest,sort_keys=True))
