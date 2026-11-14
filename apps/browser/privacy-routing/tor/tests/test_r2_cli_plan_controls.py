#!/usr/bin/env python3
"""Actual prepared CLI rejects target/port/age/inode changes before trace/network/child."""
import argparse
import json
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('prepared', type=Path); parser.add_argument('output', type=Path)
    args = parser.parse_args(); source = args.prepared.resolve(); out = args.output.resolve(); out.mkdir(parents=True, mode=0o700, exist_ok=False)
    plan = json.loads((source/'CLI-PLAN.json').read_text()); binary = source/'R2TorCLI.app/Contents/MacOS/R2TorCLI'
    changes = [('wrong-target', 'fixedHTTPS', 'https://example.invalid/'), ('wrong-port', 'port', 443), ('expired-plan', 'createdAt', 0), ('different-inode', 'scratchInode', int(plan['scratchInode'])+1)]
    events = []; failed = None
    trace = Path(plan['scratch'])/'public-runtime.jsonl'
    if trace.exists(): raise RuntimeError('not an unused offline plan')
    for name, key, value in changes:
        case = out/name; case.mkdir(mode=0o700); mutated = dict(plan); mutated[key] = value
        (case/'CLI-PLAN.json').write_text(json.dumps(mutated)+'\n')
        start = time.monotonic(); child = subprocess.Popen([str(binary), '--run-prepared', str(case)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try: stdout, stderr = child.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            child.terminate(); stdout, stderr = child.communicate(timeout=3); failed = 'negative control timeout'
        (case/'stdout').write_bytes(stdout); (case/'stderr').write_bytes(stderr)
        rejected = child.returncode == 2 and (case/'CLI-FIRST-ERROR.json').exists() and not (case/'RUN-ONCE').exists() and not trace.exists()
        events.append(dict(name=name, pid=child.pid, returncode=child.returncode, reaped=child.poll() is not None, rejectedBeforeRunOnceAndTrace=rejected, seconds=time.monotonic()-start))
        if not rejected: failed = name+' did not reject before startup'; break
    result = dict(status='FAIL' if failed else 'PASS', firstCause=failed, checks=events, scope='four new actual CLI plan rejection controls only; no backend/GUI/network')
    (out/'RESULT.json').write_text(json.dumps(result, indent=2)+'\n'); print(json.dumps(result, indent=2)); raise SystemExit(1 if failed else 0)


if __name__ == '__main__': main()
