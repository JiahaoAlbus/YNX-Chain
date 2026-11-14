#!/usr/bin/env python3
"""New actual-binary QA entry refusal controls. No target URL, vendor, profile or normal grant.

Run only with exact immutable normal/QA executables from one parent-reviewed
source cohort. Temporary minimal bundles are sealed locally to distinguish the
application's early refusal from an AMFI/signature launch failure. No installed
app or user's bundle is changed. --self-test checks only test DATA construction.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import selectors
import shutil
import subprocess
import time

ROLE = 'com.ynxweb4.browser.qa.nym.public-search'
ORDINARY_TEST_ROLE = 'com.ynxweb4.browser.qa.security.entry-arguments.ordinary'
PRODUCTION = b'Public-search diagnostics are unavailable in this production build.\n'
ROLE_REJECTED = b'Public-search diagnostic role rejected before ordinary startup.\n'
UNKNOWN = b'Unknown public diagnostic argument rejected before AppKit startup.\n'
CHECK_REJECTED = b'Nym input check rejected before ordinary startup.\n'
MISSING_SUPPLY = b'Nym input check failed; no backend or window created.\n'
SF_REJECTED = b'Snowflake input check rejected before ordinary startup.\n'


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''): h.update(part)
    return h.hexdigest()


def cases():
    strict = {'YNXPublicSearchDiagnostic': True, 'YNXPublicNymSearchDiagnostic': True}
    rows = []
    def add(label, cohort, arguments, message, markers=None, identifier=ROLE):
        rows.append(dict(label=label, cohort=cohort, arguments=arguments, message=message,
                         markers=dict(strict if markers is None else markers), identifier=identifier))
    add('QA-strict-role-typo-check', 'qa', ['--public-nym-chek-only'], UNKNOWN)
    add('NORMAL-strict-role-typo-check', 'normal', ['--public-nym-chek-only'], PRODUCTION)
    for key, name in [('YNXPublicSearchDiagnostic', 'public'), ('YNXPublicNymSearchDiagnostic', 'nym')]:
        for value, kind in [(1, 'number-one'), (False, 'false'), ('true', 'string')]:
            markers = dict(strict); markers[key] = value
            add('QA-' + name + '-marker-' + kind, 'qa', ['--public-nym-check-only'], ROLE_REJECTED, markers)
    add('QA-correct-check-missing-supply', 'qa', ['--public-nym-check-only'], MISSING_SUPPLY)
    add('NORMAL-correct-check', 'normal', ['--public-nym-check-only'], PRODUCTION)
    add('QA-check-extra-argument', 'qa', ['--public-nym-check-only', '--unexpected'], CHECK_REJECTED)
    add('QA-cross-Snowflake-check', 'qa', ['--public-snowflake-check-only'], SF_REJECTED)
    add('QA-routed-marker-conflict', 'qa', ['--public-nym-check-only'], ROLE_REJECTED,
        dict(strict, YNXPrivacyRouteMode='nym'))
    for cohort, message in [('normal', PRODUCTION), ('qa', ROLE_REJECTED)]:
        for flag, label in [('--public-nym-chek-only', 'nym-typo'), ('--check-public-snowflake', 'inverted-snowflake')]:
            add(cohort.upper() + '-ordinary-' + label, cohort, [flag], message, {}, ORDINARY_TEST_ROLE)
    return rows


def mixed_role_cases():
    tor = 'com.ynxweb4.browser.qa.tor.public-search'
    snowflake = 'com.ynxweb4.browser.qa.tor.public-search.snowflake'
    common = {'YNXPublicSearchDiagnostic': True}
    launch_pin = 'a' * 64
    rows = []

    def add(label, identifier, markers, args, cohort='qa'):
        rows.append(dict(label=label, cohort=cohort, arguments=args, identifier=identifier,
                         markers=markers, message=PRODUCTION if cohort == 'normal' else ROLE_REJECTED))

    foreign_tor_keys = [
        ('url-handler', 'CFBundleURLTypes', [{'CFBundleURLSchemes': ['p05-inert-fixture']}]),
        ('routed-mode', 'YNXPrivacyRouteMode', 'tor'),
        ('proof-key-false', 'YNXNymProofHelper', False),
        ('nym-key-false', 'YNXPublicNymSearchDiagnostic', False),
    ]
    for label, identifier, markers, arguments in [
            ('direct-tor', tor, common, []),
            ('snowflake', snowflake, dict(common, YNXPublicSnowflakeSearchDiagnostic=True),
             ['--public-snowflake-check-only'])]:
        for conflict, key, value in foreign_tor_keys:
            add(label + '-' + conflict, identifier, dict(markers, **{key: value}), arguments)

    nym = dict(common, YNXPublicNymSearchDiagnostic=True)
    for label, key, value in [
            ('snowflake-key-false', 'YNXPublicSnowflakeSearchDiagnostic', False),
            ('snowflake-launch-pin', 'YNXPublicSnowflakeLaunchSHA256', launch_pin),
            ('derived-key-false', 'YNXPublicArtiChannelTimeoutExperiment', False)]:
        add('nym-' + label, ROLE, dict(nym, **{key: value}), ['--public-nym-check-only'])
    add('nym-proof-dispatch-conflict', ROLE, dict(nym, YNXNymProofHelper=True),
        ['--ynx-nym-normal-proof-v1'])

    for cohort in ('normal', 'qa'):
        for label, key, value in [
                ('snowflake-launch-pin', 'YNXPublicSnowflakeLaunchSHA256', launch_pin),
                ('derived-key-false', 'YNXPublicArtiChannelTimeoutExperiment', False)]:
            add(cohort + '-ordinary-' + label, ORDINARY_TEST_ROLE, {key: value}, [], cohort)
    return rows


def self_test(suite, rows):
    expected_count = 17 if suite == 'entry' else 16
    assert len({r['label'] for r in rows}) == len(rows) == expected_count
    assert all(r['cohort'] in ('normal', 'qa') and r['message'].endswith(b'\n') for r in rows)
    assert all(all(a.startswith('--') and '://' not in a for a in r['arguments']) for r in rows)
    for r in rows:
        decoded = plistlib.loads(plistlib.dumps(r['markers']))
        for key, value in r['markers'].items():
            assert type(decoded[key]) is type(value) and decoded[key] == value
    if suite == 'entry':
        number_case = next(r for r in rows if r['label'] == 'QA-public-marker-number-one')
        assert type(number_case['markers']['YNXPublicSearchDiagnostic']) is int
        assert type(rows[0]['markers']['YNXPublicSearchDiagnostic']) is bool
    else:
        assert {r['label'] for r in rows}.isdisjoint(r['label'] for r in cases())
        assert sum(r['cohort'] == 'normal' for r in rows) == 2
        assert sum(r['arguments'] == ['--ynx-nym-normal-proof-v1'] for r in rows) == 1
    print(json.dumps(dict(schema='P05_PUBLIC_QA_ENTRY_TEST_DATA_CONTROL_V1', suite=suite, cases=len(rows),
        exactPropertyListTypesPreserved=True, executableProcesses=0, codesignCalls=0,
        actualBinaryControls='NOT_RUN', qualificationConstructed=False)))


def run_case(out, row, source, source_hash):
    app = out / (row['label'] + '.app')
    binary = app / 'Contents/MacOS/YNXBrowserNative'; binary.parent.mkdir(parents=True, mode=0o700)
    shutil.copy2(source, binary); binary.chmod(0o700)
    if sha(binary) != source_hash: raise RuntimeError('copied-binary-drift')
    info = dict(CFBundleIdentifier=row['identifier'], CFBundleExecutable=binary.name,
        CFBundleName=row['label'], CFBundlePackageType='APPL', CFBundleInfoDictionaryVersion='6.0',
        CFBundleVersion='1', CFBundleShortVersionString='0.1', LSMinimumSystemVersion='14.0', **row['markers'])
    (app/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
    # No resources, normal profile, URL types, proof-helper role or inherited Info.
    seal = subprocess.run(['/usr/bin/codesign','--force','--sign','-','--timestamp=none',str(app)],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    (out/(row['label']+'.seal.stderr')).write_bytes(seal.stderr)
    if seal.returncode: raise RuntimeError('local-test-seal-failed')
    verified = subprocess.run(['/usr/bin/codesign','--verify','--strict',str(app)],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
    if verified.returncode: raise RuntimeError('local-test-seal-verification-failed')
    result = dict(label=row['label'], cohort=row['cohort'], originalBinarySHA256=source_hash,
        executedBinarySHA256=sha(binary), infoSHA256=sha(app/'Contents/Info.plist'),
        argv=[str(binary)]+row['arguments'], expectedExit=78, expectedMessage=row['message'].decode(),
        normalQualification=False, packetNonEmissionProved=False, status='PENDING')
    receipt = out/(row['label']+'.json')
    def save(): receipt.write_text(json.dumps(result,indent=2)+'\n')
    save()
    env={k:os.environ[k] for k in ('HOME','USER','LOGNAME','LANG') if k in os.environ};env['PATH']='/usr/bin:/bin'
    selector=selectors.DefaultSelector(); data=[bytearray(),bytearray()]; eof=[False,False]; child=None
    failure=None; began=time.monotonic()
    try:
        child=subprocess.Popen(result['argv'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE,env=env,start_new_session=True)
        result['pid']=child.pid;save()
        for index, pipe in enumerate((child.stdout,child.stderr)):
            os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,index)
        while child.poll() is None or selector.get_map():
            if time.monotonic()-began>4:raise RuntimeError('early-refusal-timeout-UNKNOWN')
            for key,_ in selector.select(.05):
                part=os.read(key.fileobj.fileno(),1024)
                if not part:
                    selector.unregister(key.fileobj);key.fileobj.close();eof[key.data]=True
                elif len(data[key.data])+len(part)>8192:raise RuntimeError('early-refusal-output-bound')
                else:data[key.data].extend(part)
        code=child.wait(timeout=1)
        if code!=78 or data[0] or bytes(data[1])!=row['message'] or not all(eof):
            raise RuntimeError('exact-pre-AppKit-refusal-not-proved')
        result['status']='PASS_EXACT_EARLY_REFUSAL'
    except BaseException as error:
        failure=error;result['firstFailure']=dict(type=type(error).__name__,fixedReason=str(error) if isinstance(error,RuntimeError) else 'harness-IO-or-process-error')
        result['status']='FAIL_OR_UNKNOWN_STOP_NO_RETRY'
    finally:
        # Only retained original Popen; never claim, signal or search an unknown
        # WK/launchd process. Timeout/observed descendants remain UNKNOWN.
        if child is not None:
            if child.poll() is None:
                try:child.terminate()
                except ProcessLookupError:pass
                try:child.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    try:child.kill()
                    except ProcessLookupError:pass
                    try:child.wait(timeout=2)
                    except subprocess.TimeoutExpired:result['reapingUnknown']=True
            else:child.wait()
            result.update(actualExit=child.returncode,originalChildWaited=child.returncode is not None,
                          stdoutEOF=eof[0],stderrEOF=eof[1])
            for pipe in (child.stdout,child.stderr):
                if pipe is not None and not pipe.closed:pipe.close()
            result['localFDsClosed']=all(p.closed for p in (child.stdout,child.stderr))
        selector.close();result['elapsedSeconds']=time.monotonic()-began
        result['descendantReap']='NOT_OBSERVED; exact early refusal is required, never inferred from parent exit'
        # Store only the finite expected message or hashes of unexpected output;
        # an accidental ordinary fallback cannot persist user text here.
        result['stdoutBytes']=len(data[0]);result['stderrBytes']=len(data[1])
        result['stdoutSHA256']=hashlib.sha256(data[0]).hexdigest();result['stderrSHA256']=hashlib.sha256(data[1]).hexdigest()
        save()
    if failure:raise failure
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--suite', choices=('entry', 'mixed-role'), default='entry')
    for mode in ('normal','qa'):
        p.add_argument('--'+mode+'-executable',type=Path)
        p.add_argument('--'+mode+'-sha256')
    p.add_argument('--output',type=Path)
    args=p.parse_args()
    rows = cases() if args.suite == 'entry' else mixed_role_cases()
    if args.self_test:self_test(args.suite, rows);return
    if not args.output or not args.output.is_absolute() or args.output.exists():p.error('Fresh absolute output required')
    sources={}
    for mode in ('normal','qa'):
        path=getattr(args,mode+'_executable');pin=getattr(args,mode+'_sha256')
        if path is None or not path.is_absolute() or path.resolve(strict=True)!=path or not path.is_file() or sha(path)!=pin:
            p.error('Exact immutable '+mode+' executable and SHA256 required')
        sources[mode]=(path,pin)
    args.output.mkdir(mode=0o700)
    result=dict(schema='P05_PUBLIC_QA_ENTRY_ACTUAL_BINARY_CONTROLS_V1',sourceSHA256=sha(Path(__file__)),
        suite=args.suite,
        suppliedExecutables={k:dict(path=str(v[0]),sha256=v[1]) for k,v in sources.items()},cases=[],
        targetsRequestedByHarness=[],packetCapture='NOT_RUN',normalQualification=False,status='RUNNING')
    try:
        for row in rows:
            path,pin=sources[row['cohort']]
            if sha(path)!=pin:raise RuntimeError('actual-input-drift')
            result['cases'].append(run_case(args.output,row,path,pin))
        result['status']='PASS_NEW_' + str(len(rows)) + '_EARLY_REFUSALS'
    except BaseException as error:
        result['status']='FAIL_OR_UNKNOWN_STOP_NO_RETRY';result['firstFailure']=dict(type=type(error).__name__,fixedReason=str(error) if isinstance(error,RuntimeError) else 'harness-error')
        raise
    finally:
        (args.output/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(receipt=str(args.output/'receipt.json'),cases=len(result['cases']),status=result['status'])))

if __name__=='__main__':main()
