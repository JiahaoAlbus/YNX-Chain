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


# These assertions come from the original 43697 wrapper scripts, in addition to
# the original event grammar. An arbitrary failed test is not a counterexample.
RED_LITERALS = {
 ('ceremony',1): {'public output replaced generated custody or hid the failure: <nil>': 1},
 ('signed-history',1): {'PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED': 1},
 ('signed-history',2): {'PRODUCTION_ROLLBACK_TRANSPORT_NOT_PRESERVED': 1},
 ('source-authority',1): {'MIGRATION_PRESERVATION_FACTORY_BLOCKED': 1},
 ('journal',1): {'actual fresh signing source rejected the complete layout': 2},
 ('comet-layout',1): {'normal helper silently used another storage layout': 2,
                     'wrong layout silently selected another decoder': 1,
                     'normalOperatorLayout=atomic-json actualCommitAndColdRecovery=true': 1},
}
_BEGIN='YNX-HISTORY-RAW-BEGIN/v1 '
_END='YNX-HISTORY-RAW-END/v1 '
_META='YNX-HISTORY-RAW-METADATA/v1 '
_TIMESTAMP=re.compile(rb'^(?:\xef\xbb\xbf)?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,9}Z ')

def _strict_json(raw):
    def unique(items):
        out={}
        for k,v in items:
            if k in out:
                raise ValueError('duplicate JSON key')
            out[k]=v
        return out
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('non-finite JSON')))

def inspect_original_streams(job_log, members, *, source, run, attempt, expected_job_sha, expected_members):
    """Validate frozen public bytes only; caller must establish official provenance.

    Identity and hashes must be frozen by the owner from independently retrieved
    official evidence. Calling this helper does not grant CI or runtime status.
    """
    if (type(source) is not str or not re.fullmatch(r'[0-9a-f]{40}',source)
        or type(run) is not int or run<=0 or type(attempt) is not int or attempt!=1
        or type(expected_job_sha) is not str or not re.fullmatch(r'[0-9a-f]{64}',expected_job_sha)):
        raise ValueError('invalid frozen source identity')
    names={f'{case}-{idx}.{ext}' for case,idx in CASES for ext in ('log','json')}
    if (type(job_log) is not bytes or len(job_log)>128*1024*1024
        or hashlib.sha256(job_log).hexdigest()!=expected_job_sha
        or type(members) is not dict or set(members)!=names
        or type(expected_members) is not dict or set(expected_members)!=names):
        raise ValueError('original bytes or frozen member inventory differs')
    for name in names:
        data,digest=members[name],expected_members[name]
        if (type(data) is not bytes or len(data)>8*1024*1024
            or type(digest) is not str or not re.fullmatch(r'[0-9a-f]{64}',digest)
            or hashlib.sha256(data).hexdigest()!=digest):
            raise ValueError('original artifact member differs: '+name)
    # GitHub original job logs prefix every output line with a timestamp. Do not
    # accept unframed lookalike text or infer identity from a self-reported path.
    lines=[];framed=[]
    for line in job_log.splitlines(keepends=True):
        if not line.endswith(b'\n'):
            raise ValueError('incomplete original job log')
        m=_TIMESTAMP.match(line)
        framed.append(m is not None)
        lines.append(line[m.end():] if m else line)
    segments={}
    i=0
    while i<len(lines):
        line=lines[i]
        if line.startswith(_BEGIN.encode()):
            if not framed[i]:raise ValueError('unframed original history marker')
            match=re.fullmatch(rb'YNX-HISTORY-RAW-BEGIN/v1 case=([a-z-]+) index=([0-9]+) source=([0-9a-f]{40}) run=([0-9]+) attempt=([0-9]+) exit=([0-9]+)\n',line)
            if not match:
                raise ValueError('invalid original BEGIN')
            case=match.group(1).decode(); idx=int(match.group(2)); key=(case,idx)
            if (key not in CASES or key in segments or match.group(2).decode()!=str(idx)
                or match.group(6).decode()!=str(int(match.group(6))) or match.group(3).decode()!=source
                or match.group(4).decode()!=str(run) or match.group(5).decode()!=str(attempt)):
                raise ValueError('foreign, duplicate, or unknown history segment')
            code=int(match.group(6)); end=f'{_END}case={case} index={idx}\n'.encode()
            i+=1; payload=[]
            while i<len(lines) and lines[i]!=end:
                if not framed[i]:raise ValueError('unframed original history payload')
                if lines[i].startswith((_BEGIN.encode(),_END.encode(),_META.encode())):
                    raise ValueError('nested or mismatched history segment')
                payload.append(lines[i]); i+=1
            if i>=len(lines) or i+1>=len(lines) or not framed[i] or not framed[i+1] or not lines[i+1].startswith(_META.encode()):
                raise ValueError('history END or metadata missing')
            actual=b''.join(payload); logname=f'{case}-{idx}.log'; metaname=f'{case}-{idx}.json'
            if actual!=members[logname]:
                raise ValueError('job log differs from original member')
            if lines[i+1][len(_META):]!=members[metaname]:
                raise ValueError('job metadata bytes differ from original member')
            try:
                raw=actual.decode('utf-8'); metadata=_strict_json(members[metaname]); live=_strict_json(lines[i+1][len(_META):])
            except (UnicodeError,ValueError) as exc:
                raise ValueError('invalid original history JSON or text') from exc
            if type(code) is not int or code!=(0 if CASES[key][0] else 1):
                raise ValueError('incorrect original test exit')
            events=qualify(raw,case,idx,code)
            for literal,count in RED_LITERALS.get(key,{}).items():
                if raw.count(literal)!=count:
                    raise ValueError('missing or ambiguous original counterexample')
            expected=dict(case=case,index=idx,exit=code,source=source,run=str(run),attempt=str(attempt),bytes=len(actual),sha256=hashlib.sha256(actual).hexdigest(),events=events)
            # Strict types avoid Python bool == int. Canonical encoding also
            # prevents numeric identity aliases and duplicate-key normalization.
            if (json.dumps(metadata,sort_keys=True,separators=(',',':')) != json.dumps(expected,sort_keys=True,separators=(',',':'))
                or json.dumps(live,sort_keys=True,separators=(',',':')) != json.dumps(expected,sort_keys=True,separators=(',',':'))):
                raise ValueError('original history metadata differs')
            segments[key]=True; i+=2; continue
        if line.startswith((_END.encode(),_META.encode())):
            raise ValueError('orphan original history marker')
        i+=1
    if list(segments)!=list(CASES):
        raise ValueError('original history segments incomplete or out of order')
    return {'source':source,'run':run,'attempt':attempt,'cases':len(segments),
            'dataOnly':True,'sourceQualified':False,'runtimePermissionGranted':False}
