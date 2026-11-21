#!/usr/bin/env python3
"""Retain only original synthetic enrollment test events and their run identity."""
import hashlib
import json
import os
from pathlib import Path
import sys

TEST = 'TestPQLabEnrollmentOriginalCLIConfirmAndRestart'
PACKAGE = 'github.com/JiahaoAlbus/YNX-Chain/internal/consensus'


def main():
    source = Path(os.environ['RUNNER_TEMP']) / 'pq-lab-core-tests.jsonl'
    target = Path(os.environ['RUNNER_TEMP']) / 'ynx-enrollment-original-ci'
    target.mkdir(mode=0o700)
    raw = source.read_bytes()
    kept = []
    for line in raw.splitlines(keepends=True):
        row = json.loads(line)
        if row.get('Package') != PACKAGE or row.get('Test') != TEST:
            continue
        action = row.get('Action')
        if action in ('run', 'pass', 'fail', 'skip') or (action == 'output' and 'synthetic trusted=' in row.get('Output', '')):
            kept.append(line)
    events = b''.join(kept)
    (target / 'events.jsonl').write_bytes(events)
    meta = dict(version='YNX-SYNTHETIC-ENROLLMENT-CI-EVENTS/v1', sourceCommit=os.environ['GITHUB_SHA'],
                runId=os.environ['GITHUB_RUN_ID'], runAttempt=os.environ['GITHUB_RUN_ATTEMPT'],
                inputSHA256=hashlib.sha256(raw).hexdigest(), eventsSHA256=hashlib.sha256(events).hexdigest(),
                originalStepExit=int(sys.argv[1]), syntheticOnly=True, publicActivation=False)
    (target / 'identity.json').write_text(json.dumps(meta, sort_keys=True) + '\n')


if __name__ == '__main__':
    main()
