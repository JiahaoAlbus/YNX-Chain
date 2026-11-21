"""Closed source-only gate for the exact before59 observer successor.

The separately frozen same-run clock gate and original log remain mandatory;
this module never grants a business window or verifies finality.
"""
import copy
import importlib.util
from pathlib import Path

SOURCE='de54c52b669ad56ebc702a484e2eaca51d0efc2e'
TREE='d22b51801073930a4715dcea20b0320259d27fb4'
FORK='5a128880d14bfc73de4334cba23218859ad3473c'
BINDING=None  # Owner-frozen original same-run tuple only; no CLI override.

spec=importlib.util.spec_from_file_location('before59_held_original_clock',Path(__file__).with_name('pq-commit-clock-source-qualification.py'))
clock=importlib.util.module_from_spec(spec);spec.loader.exec_module(clock)

def qualification(*, metadata_reader=None, focused_log_reader=None):
    if BINDING is None or clock.BINDING is None or BINDING!=clock.BINDING:
        raise RuntimeError('before59 exact same-run held source binding NOT_SUPPLIED')
    binding=copy.deepcopy(BINDING)
    identity=dict(commit=SOURCE,tree=TREE,forkTree=FORK)
    clock.binding_identity(binding,identity)
    result=clock.qualification(identity,metadata_reader=metadata_reader,focused_log_reader=focused_log_reader)
    if not (type(result) is dict and result.get('source')==SOURCE and result.get('sourceTree')==TREE
            and result.get('forkTree')==FORK and result.get('run')==binding['run']
            and result.get('focusedJob')==binding['focusedJob']
            and result.get('before59OriginalEquivalenceVerified') is True
            and result.get('focusedOriginalLogVerified') is True and result.get('sourceOnlyEvidence') is True
            and result.get('runtimePermissionGranted') is False and result.get('pressureAuthorized') is False
            and result.get('independentFinality') is False):
        raise RuntimeError('before59 original same-run source and log evidence differs')
    return dict(source=SOURCE,sourceTree=TREE,run=binding['run'],job=binding['focusedJob'],
                requiredSteps=result['focusedSteps'],sourceOnlyQualified=True,runtimePermissionGranted=False,
                independentFinality=False,originalClockAndEquivalenceLog=True)
