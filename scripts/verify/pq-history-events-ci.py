#!/usr/bin/env python3
"""Check original verbose Go events for each same-run synthetic history control."""
import re
import sys
import json
import hashlib
import os
from pathlib import Path

CASES = {
 ('ceremony', 1): (False, ['TestProductionKeyCeremonyPublicPathCannotReplaceGeneratedPrivateKey']),
 ('ceremony', 2): (True, ['TestProductionKeyCeremonyCreatesHostLocalKeysAndPublicRecord', 'TestProductionKeyCeremonyExistingPublicRecordIsPreservedBeforeGeneration', 'TestProductionKeyCeremonyPostGenerationFailureRetainsOriginalCustody', 'TestProductionKeyCeremonyPublicPathCannotReplaceGeneratedPrivateKey', 'TestProductionKeyCeremonyExclusiveIntentAndPublicCommit', 'TestProductionKeyCeremonyPartialDirectoryAndDanglingDirectoryRefuse']),
 ('ceremony', 3): (True, ['TestInspectPublicRecordCannotOverwriteOriginalKeysHRSNodeOrPublic', 'TestInspectPublicRecordRejectsSymlinksDirectoriesAndEmptyEvidence', 'TestInspectPublicRecordCreatesExactNewDurablePublicOutput', 'TestInspectPublicRecordPersistenceFailuresRetainPartialAndFirstCause']),
 ('signed-history', 1): (False, ['TestProductionRoleScriptsPreserveSignedStateAndUnknownResults']),
 ('signed-history', 2): (False, ['TestProductionRollbackCallerRefusesBeforeTransport']),
 ('signed-history', 3): (True, ['TestProductionRoleScriptsPreserveSignedStateAndUnknownResults', 'TestProductionRollbackCallerRefusesBeforeTransport']),
 ('source-authority', 1): (False, ['TestMigrationPreservationFactoryKeepsSourceAndIndependentExecution']),
 ('source-authority', 2): (True, ['TestMigrationPreservationFactoryKeepsSourceAndIndependentExecution', 'TestMigrationPreservationRejectsCorruptSourceAndColdRewrite', 'TestMigrationPreservationClassifiesOnlyValidatedAuthorityGaps', 'TestMigrationPaySourceDoesNotInventMerchantAuthority']),
 ('journal', 1): (False, ['TestPQEngineStateReadActualLayoutsRegistryRotationRevocation']),
 ('journal', 2): (True, ['TestPQEngineStateReadActualLayoutsRegistryRotationRevocation', 'TestPQEngineStateReadKeepsPinnedHistoricalRuntimeDomains', 'TestPQEngineStateReadRejectsCorruptionAndIncompleteTailWithoutRepair', 'TestPQEngineStateReadRejectsSourceChangeAfterCapture']),
 ('comet-layout', 1): (False, ['TestCometJournalOperatorApplicationRealRegistryScheduleColdContinuation']),
 ('comet-layout', 2): (True, ['TestCometJournalOperatorApplicationRealRegistryScheduleColdContinuation', 'TestCometJournalLayoutOptionsNeverFallBackToStockOrAtomic', 'TestCometJournalRuntimeAndCustodyModesRetainIndependentConfiguration', 'TestCometJournalRuntimePlanRefusesBeforeOpeningOriginalState']),
}

REQUIRED_CHILDREN = {
 ('signed-history', 1): ['TestProductionRoleScriptsPreserveSignedStateAndUnknownResults/existing-signed-install'],
 ('signed-history', 2): ['TestProductionRollbackCallerRefusesBeforeTransport/without-archive'],
 ('signed-history', 3): ['TestProductionRoleScriptsPreserveSignedStateAndUnknownResults/existing-signed-install', 'TestProductionRollbackCallerRefusesBeforeTransport/without-archive'],
 ('journal', 1): ['TestPQEngineStateReadActualLayoutsRegistryRotationRevocation/'+n for n in ('atomic-json','snapshot-journal','block-journal')],
 ('journal', 2): ['TestPQEngineStateReadActualLayoutsRegistryRotationRevocation/'+n for n in ('atomic-json','snapshot-journal','block-journal')],
 ('comet-layout', 1): ['TestCometJournalOperatorApplicationRealRegistryScheduleColdContinuation/'+n for n in ('atomic-json','snapshot-journal','block-journal')],
 ('comet-layout', 2): ['TestCometJournalOperatorApplicationRealRegistryScheduleColdContinuation/'+n for n in ('atomic-json','snapshot-journal','block-journal')],
}

EXPECTED_RED_CHILDREN = {
 ('signed-history', 1): {'TestProductionRoleScriptsPreserveSignedStateAndUnknownResults/existing-signed-install':'fail'},
 ('signed-history', 2): {'TestProductionRollbackCallerRefusesBeforeTransport/without-archive':'fail'},
 ('journal', 1): {'TestPQEngineStateReadActualLayoutsRegistryRotationRevocation/atomic-json':'pass', 'TestPQEngineStateReadActualLayoutsRegistryRotationRevocation/snapshot-journal':'fail', 'TestPQEngineStateReadActualLayoutsRegistryRotationRevocation/block-journal':'fail'},
 ('comet-layout', 1): {'TestCometJournalOperatorApplicationRealRegistryScheduleColdContinuation/'+name:'fail' for name in ('atomic-json','snapshot-journal','block-journal')},
}

# These t.Run calls intentionally contain a slash in a single test name. They
# have no intermediate RUN event, as confirmed by the original Go source and
# retained raw streams. Other missing intermediate parents are refused.
DIRECT_SLASH_NAMES = {
 ('source-authority', 2): {'TestMigrationPreservationClassifiesOnlyValidatedAuthorityGaps/'+a+'/'+b for a in ('ai','pay','trust_governance') for b in ('identical_authority_reason','invalid_original','same_module_new_failure','unknown_class')},
 ('journal', 2): {'TestPQEngineStateReadKeepsPinnedHistoricalRuntimeDomains/'+a+'/'+b for a in ('atomic-json','snapshot-journal','block-journal') for b in ('12','13')},
 ('comet-layout', 2): ({'TestCometJournalRuntimeAndCustodyModesRetainIndependentConfiguration/'+a+'/'+b for a in ('atomic-json','snapshot-journal','block-journal') for b in ('runtime-only','local','remote')} | {'TestCometJournalRuntimePlanRefusesBeforeOpeningOriginalState/'+a+'/'+b for a in ('atomic-json','snapshot-journal','block-journal') for b in ('invalid_plan','missing_pin','wrong_pin')}),
}

def qualify(raw, case, index, exit_code):
    positive, required = CASES[case, index]
    if exit_code != (0 if positive else 1):
        raise ValueError('unexpected Go exit status')
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('original log too large')
    package = 'github.com/JiahaoAlbus/YNX-Chain/' + ('cmd/ynx-consensus-key-init' if case == 'ceremony' and index == 3 else 'cmd/ynx-comet' if case == 'comet-layout' else 'internal/consensus')
    outcomes = re.findall(r'(?m)^(ok|FAIL)[ \t]+([^\s]+)(?:[ \t]|$)', raw)
    if outcomes != [('ok' if positive else 'FAIL', package)]:
        raise ValueError('package result missing, foreign, or duplicated')
    lines=raw.splitlines()
    package_lines=[i for i,line in enumerate(lines) if re.match(r'^(ok|FAIL)[ \t]+([^\s]+)(?:[ \t]|$)', line)]
    if len(package_lines)!=1 or [line for line in lines[package_lines[0]+1:] if line.strip()] != ([] if positive else ['FAIL']):
        raise ValueError('package result or original log tail incomplete')
    package_end=package_lines[0]
    events = {}
    positions = {}
    for pos, line in enumerate(lines):
        m = re.match(r'^\s*=== RUN\s+(\S+)', line)
        if m:
            events.setdefault(m.group(1), []).append('run')
            positions.setdefault(m.group(1), []).append(pos)
        m = re.match(r'^\s*--- (PASS|FAIL|SKIP):\s+(\S+)', line)
        if m:
            events.setdefault(m.group(2), []).append(m.group(1).lower())
            positions.setdefault(m.group(2), []).append(pos)
    if set(name.split('/')[0] for name in events) != set(required):
        raise ValueError('top-level test set changed, missing, or empty')
    if not set(REQUIRED_CHILDREN.get((case,index), ())) <= set(events):
        raise ValueError('required original subtest missing')
    for child, outcome in EXPECTED_RED_CHILDREN.get((case,index), {}).items():
        if events.get(child) != ['run',outcome]:
            raise ValueError('original counterexample child result differs: '+child)
    for name, actions in events.items():
        if any(pos >= package_end for pos in positions[name]):
            raise ValueError('test event follows package result: ' + name)
        if actions not in (['run', 'pass'], ['run', 'fail']):
            raise ValueError('repeated, missing, skipped, or unordered event: ' + name)
        top = name.split('/')[0]
        if '/' in name:
            later = [v[0] for k,v in positions.items() if '/' not in k and v[0] > positions[top][0]]
            next_top = min(later, default=len(raw.splitlines()))
            if not positions[top][0] < positions[name][0] < positions[top][1] < positions[name][1] < next_top:
                raise ValueError('child outside original Go verbose parent result: ' + name)
            parent=name.rpartition('/')[0]
            if parent not in positions and name not in DIRECT_SLASH_NAMES.get((case,index), set()):
                raise ValueError('missing intermediate parent: ' + name)
            while parent in positions and '/' in parent:
                if not positions[parent][0] < positions[name][0] < positions[parent][1] < positions[name][1]:
                    raise ValueError('child outside its immediate parent: ' + name)
                parent=parent.rpartition('/')[0]
        if positive and actions != ['run', 'pass']:
            raise ValueError('green test failed: ' + name)
    if not positive and not any(events[name] == ['run', 'fail'] for name in required):
        raise ValueError('expected RED never failed at top level')
    return events

if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit('usage: case invocation status raw-log')
    slug, idx, status, path = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4])
    try:
        raw=path.read_bytes()
        events=qualify(raw.decode(), slug, idx, status)
        print(json.dumps(dict(case=slug,index=idx,exit=status,source=os.environ['GITHUB_SHA'],run=os.environ['GITHUB_RUN_ID'],attempt=os.environ['GITHUB_RUN_ATTEMPT'],bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),events=events),sort_keys=True))
    except (KeyError, ValueError, OSError, UnicodeError) as exc:
        raise SystemExit('original history event rejected: ' + str(exc))
