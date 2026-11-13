"""Read complete held-session component tests from original Go streams."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'original_go_frames', Path(__file__).with_name('pq-7c25-source-qualification.py'))
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)

REQUIRED = {
    'core': ('internal/consensus', (
        'TestPQLabLiveSessionOriginalProofAndHeldScope',
        'TestPQLabLiveSessionLifecycleAndOriginalRefusal',
        'TestPQLabSenderPrepareOriginalWitnessAndCurrent',
        'TestPQLabPublicOwnerPrepareBeforeCommands')),
    'cli': ('cmd/ynx-consensus-pq-lab', (
        'TestPQLabLiveSessionCommandStrictInputs',
        'TestPQLabLiveSessionFailureProjection',
        'TestPQLabLiveSessionCommandOriginalSourceAndLostAck',
        'TestPQLabSenderPUBLICOwnersPreparedReady',
        'TestPQLabSenderPUBLICOwnersPreparedReadyRefusals')),
}


def readback(kind, raw, sha256):
    package, required = REQUIRED[kind]
    original.require(type(raw) is bytes and 0 < len(raw) <= 4 << 20
                     and hashlib.sha256(raw).hexdigest() == sha256,
                     'held-session original stream bytes or SHA256 differ')
    report = original.original_go_frames(raw, 'github.com/JiahaoAlbus/YNX-Chain/' + package,
                                         required, closed_tops=True)
    return dict(report, originalSHA256=sha256, originalBytes=len(raw),
                componentTestOnly=True, fourNodePerformanceMeasured=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for kind in REQUIRED:
        parser.add_argument('--' + kind, type=Path, required=True)
        parser.add_argument('--' + kind + '-sha256', required=True)
    args = parser.parse_args()
    report = {}
    for kind in REQUIRED:
        with getattr(args, kind).open('rb') as source:
            report[kind] = readback(kind, source.read((4 << 20) + 1),
                                    getattr(args, kind + '_sha256'))
    print(json.dumps(report, indent=2))
