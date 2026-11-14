#!/usr/bin/env python3
"""One bounded, sequential Browser QA device journey. No result retries or data clearing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

TARGET = 'com.ynxweb4.browser.qa'
AVD = 'YNX_BROWSER_API_36'
CERT = 'bf4981ad3f7d0fb2f087ba76f179280475727c08a80abbd58adcf3fe7180150b'
PDF_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
PDF_SHA = '3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4'
SCHEMAS = {'journey': 'ynx-android-standard-ui-journey-v1', 'saf': 'YNX_ANDROID_ACTUAL_SAF_V1'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def structured_result(receipt, runner, phase):
    """Strictly require one bound final JSON; neither adb0 nor missing output is a PASS."""
    rows = receipt.get('instrumentationResults', [])
    if receipt.get('state') != 'COMMAND_RETURNED' or receipt.get('exitCode') != 0 or receipt.get('resultDecodeError'):
        raise ValueError('Unknown/failed instrumentation transport; preserve original operation')
    if len(rows) != 1 or not isinstance(rows[0], dict):
        raise ValueError('Exactly one final structured result required')
    result = rows[0]
    if result.get('schema') != SCHEMAS[runner] or result.get('phase') != phase:
        raise ValueError('Instrumentation schema/phase binding mismatch')
    allowed = ('PASS', 'FAIL', 'UNREACHABLE', 'CAPTCHA') if runner == 'journey' else ('PASS', 'FAIL', 'INCOMPLETE')
    if result.get('status') not in allowed:
        raise ValueError('Unknown browser status')
    return result


def reopen_binding(result, requested_filename):
    if result.get('status') != 'PASS':
        raise ValueError('A nonpassing/UNKNOWN save can never be replayed or reopened')
    grant = result.get('savedGrantSHA256', '')
    name = result.get('savedFilename', '')
    start = result.get('processStartElapsed')
    document = result.get('document', {})
    if not isinstance(grant, str) or not re.fullmatch('[0-9a-f]{64}', grant) or name != requested_filename:
        raise ValueError('Missing original save grant/name binding')
    if type(start) is not int or start < 0 or document.get('sha256') != PDF_SHA or document.get('bytes') != 13264:
        raise ValueError('Missing actual saved byte/cold-process evidence')
    return {'savedGrantSHA256': grant, 'savedFilename': name, 'previousProcessStartElapsed': str(start)}


class Journey:
    def __init__(self, args):
        self.args = args
        self.root = Path(__file__).resolve().parents[2]
        self.host = Path(__file__).resolve().parent
        self.out = args.output
        self.adb = [str(args.adb), '-s', args.serial]
        self.summary = {'schema': 'YNX_ANDROID_CI_ACTUAL_JOURNEY_V1', 'target': TARGET, 'avd': AVD,
                        'serial': args.serial, 'startedAt': time.time(), 'phases': {}, 'commands': [],
                        'privacy': 'Private/Tor/Nym UNAVAILABLE; no route acceptance',
                        'sourceBuildIsRuntimeAcceptance': False, 'state': 'RUNNING'}
        self.fixture = None
        self.fixture_log = None
        self.unknown = None
        self.device_validated = False

    def save(self):
        write(self.out / 'SUMMARY.json', self.summary)

    def command(self, name, argv, timeout=30, required=True, binary=False):
        with (self.out / (name + '.stdout')).open('wb') as stdout, (self.out / (name + '.stderr')).open('wb') as stderr:
            child = subprocess.Popen([str(x) for x in argv], stdout=stdout, stderr=stderr, start_new_session=True)
            record = {'name': name, 'argv': [str(x) for x in argv], 'pid': child.pid, 'startedAt': time.time()}
            self.summary['commands'].append(record)
            self.save()
            try:
                code = child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                record['timedOut'] = True
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    code = child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    code = child.wait(timeout=5)
                record.update(exitCode=code, childReaped=True, finishedAt=time.time())
                self.save()
                raise RuntimeError('Owned command timed out: ' + name)
            record.update(exitCode=code, childReaped=True, finishedAt=time.time())
            self.save()
        data = (self.out / (name + '.stdout')).read_bytes()
        if binary:
            (self.out / (name + '.png')).write_bytes(data)
        if required and code != 0:
            raise RuntimeError('Command failed: ' + name)
        return code, data.decode('utf-8', errors='replace') if not binary else data

    def not_run(self, name, reason):
        self.summary['phases'][name] = {'status': 'NOT_RUN', 'reason': reason}
        self.save()
        return None

    def phase(self, runner, phase, arguments=None, require_pass=False, timeout=180):
        name = runner + '-' + phase
        if self.unknown:
            return self.not_run(name, self.unknown)
        argv = [sys.executable, self.host / 'run-phase.py', '--adb', self.args.adb, '--serial', self.args.serial,
                '--runner', runner, '--phase', phase, '--output', self.out / name, '--timeout', str(timeout)]
        if require_pass:
            argv.append('--require-pass')
        for key, value in (arguments or {}).items():
            argv += ['--arg', key + '=' + str(value)]
        try:
            # The helper has its own bounded adb wait; this outer deadline only catches a stuck helper.
            code, _ = self.command(name, argv, timeout=timeout + 35, required=False)
            receipt = json.loads((self.out / name / 'RESULT.json').read_text())
            result = structured_result(receipt, runner, phase)
            if code != 0 and result['status'] == 'PASS':
                raise ValueError('Helper failure contradicts claimed PASS')
            self.summary['phases'][name] = {'status': result['status'], 'helperExit': code,
                                           'requiredPass': require_pass, 'receipt': name + '/RESULT.json',
                                           'receiptSHA256': sha(self.out / name / 'RESULT.json')}
            self.save()
            return result
        except Exception as error:
            # A timeout/malformed transport is UNKNOWN. Do not run a successor operation or retry a save.
            self.unknown = 'Original phase must be reconciled: ' + name + ': ' + str(error)
            self.summary['phases'][name] = {'status': 'UNKNOWN', 'firstFailure': str(error)}
            self.save()
            return None
        finally:
            self.command(name + '-screenshot', self.adb + ['exec-out', 'screencap', '-p'], required=False, binary=True)

    def stop_target(self, name):
        self.command(name, self.adb + ['shell', 'am', 'force-stop', TARGET])
        for i in range(10):
            code, _ = self.command(name + '-pid-' + str(i), self.adb + ['shell', 'pidof', TARGET], required=False)
            if code == 1:
                return
            if code != 0:
                raise RuntimeError('Cannot observe stopped QA process')
            time.sleep(0.2)
        raise RuntimeError('Original QA process still running; no successor phase')

    def fixture_start(self):
        self.fixture_log = (self.out / 'fixture.log').open('wb')
        argv = [sys.executable, self.host / 'fixture-server.py', '--receipt', self.out / 'fixture.json', '--max-seconds', '2700']
        self.fixture = subprocess.Popen([str(x) for x in argv], stdout=self.fixture_log, stderr=subprocess.STDOUT)
        write(self.out / 'fixture-owner.json', {'pid': self.fixture.pid, 'argv': [str(x) for x in argv], 'state': 'RUNNING'})
        for _ in range(50):
            if self.fixture.poll() is not None:
                raise RuntimeError('Owned fixture exited before receipt')
            if (self.out / 'fixture.json').exists():
                config = json.loads((self.out / 'fixture.json').read_text())
                expected = 'http://10.0.2.2:' + str(config['port'])
                if config.get('host') != '127.0.0.1' or config.get('emulatorBase') != expected or not config.get('syntheticOnly'):
                    raise RuntimeError('Unsafe fixture receipt')
                return expected
            time.sleep(0.1)
        raise RuntimeError('Owned fixture receipt missing')

    def run(self):
        if self.out.exists() or not self.out.is_absolute() or not re.fullmatch(r'emulator-[0-9]{4,5}', self.args.serial):
            raise ValueError('Fresh absolute evidence output and explicit emulator serial required')
        if os.environ.get('ANDROID_SERIAL', self.args.serial) != self.args.serial:
            raise ValueError('Action serial and requested serial differ')
        self.out.mkdir(parents=True)
        self.save()
        try:
            _, avd = self.command('avd-name', self.adb + ['emu', 'avd', 'name'])
            if avd.splitlines()[0] != AVD:
                raise ValueError('Never borrow another product AVD')
            _, sdk = self.command('device-sdk', self.adb + ['shell', 'getprop', 'ro.build.version.sdk'])
            if sdk.strip() != '36':
                raise ValueError('Expected Android36 device')
            self.device_validated = True
            inputs = {str(p.relative_to(self.root)): sha(p) for area in ('android', 'scripts')
                      for p in (self.root / area).rglob('*') if p.is_file() and p.suffix in ('.java', '.xml', '.py', '.sh')}
            inputs['targetAPK'] = sha(self.args.target_apk)
            inputs['workflow'] = sha(self.root.parents[1] / '.github/workflows/browser-platform-evidence.yml')
            inputs['gitCommit'] = os.environ.get('GITHUB_SHA', 'NOT_SUPPLIED')
            write(self.out / 'inputs.json', inputs)
            self.command('install-target', self.adb + ['install', '-r', self.args.target_apk], timeout=120)
            for label, directory in [('journey', self.args.journey_build), ('saf', self.args.saf_build)]:
                receipt = json.loads((directory / 'BUILD.json').read_text())
                package = TARGET + ('.instrumentation' if label == 'journey' else '.safinstrumentation')
                if (receipt.get('state') != 'PACKAGE_VERIFIED_NOT_INSTALLED' or receipt.get('target') != TARGET
                        or receipt.get('package') != package or receipt.get('certificateSHA256') != CERT):
                    raise ValueError('Unverified instrumentation package')
                apk = Path(receipt['APK'])
                if sha(apk) != receipt.get('APKSHA256'):
                    raise ValueError('Instrumentation APK changed')
                inputs[label + 'APK'] = sha(apk)
                self.command('install-' + label, self.adb + ['install', '-r', apk], timeout=120)
            write(self.out / 'inputs.json', inputs)
            self.stop_target('initial-cold-stop')
            self.command('cold-launch', self.adb + ['shell', 'monkey', '-p', TARGET, '-c', 'android.intent.category.LAUNCHER', '1'])
            self.command('private-export-negative', self.adb + ['shell', 'am', 'start', '-n', TARGET + '/com.ynxweb4.browser.PrivateActivity'], required=False)
            denial = (self.out / 'private-export-negative.stdout').read_text() + (self.out / 'private-export-negative.stderr').read_text()
            if not re.search(r'Permission Denial|SecurityException|not exported', denial):
                raise RuntimeError('No actual nonexported-Private denial observed')
            code, _ = self.command('private-process-negative', self.adb + ['shell', 'pidof', TARGET + ':private'], required=False)
            if code != 1:
                raise RuntimeError('Private process absent not confirmed')
            fixture = self.fixture_start()
            local = {'fixture_base': fixture}
            self.phase('journey', 'core', local, require_pass=True, timeout=300)
            self.phase('journey', 'https', timeout=180)
            self.phase('journey', 'search', timeout=180)
            bing = self.phase('journey', 'search_bing', timeout=180)
            restored_ddg = bool(bing and any(s.get('name') == 'restore_default_ddg_via_menu' and s.get('status') == 'PASS' for s in bing.get('steps', [])))
            self.summary['explicitBingFinallyRestoredDDG'] = restored_ddg
            if bing and not restored_ddg:
                self.unknown = 'Explicit Bing phase did not prove its finally DDG menu restoration; no further UI operation'
            seed = self.phase('journey', 'restore_seed', local, require_pass=True, timeout=180)
            if seed and seed['status'] == 'PASS':
                self.stop_target('restore-cold-stop')
                self.phase('journey', 'restore_verify', local, require_pass=True, timeout=180)
            else:
                self.not_run('journey-restore_verify', 'Original restore_seed did not PASS; no synthetic state or retry')
            filename = 'YNX-CI-' + os.environ.get('GITHUB_RUN_ID', str(os.getpid())) + '-' + os.environ.get('GITHUB_RUN_ATTEMPT', '1') + '.pdf'
            saf_args = {'downloadUrl': PDF_URL, 'expectedSHA': PDF_SHA, 'expectedBytes': '13264',
                        'expectedFilename': 'dummy.pdf', 'fixturePage': fixture + '/page-a', 'timeoutSeconds': '120'}
            cancelled = self.phase('saf', 'cancel', saf_args, timeout=180)
            if cancelled and cancelled['status'] == 'PASS':
                saved = self.phase('saf', 'save', dict(saf_args, savedFilename=filename), timeout=180)
            else:
                saved = self.not_run('saf-save', 'Cancellation did not PASS; preserve actual picker/library state')
            if saved and saved['status'] == 'PASS':
                binding = reopen_binding(saved, filename)
                self.stop_target('saf-cold-stop')
                self.phase('saf', 'reopen', dict(saf_args, **binding), timeout=180)
            else:
                self.not_run('saf-reopen', 'No verified successful original save; never retry or infer a grant')
            # Locale smoke remains after the actual journeys so it cannot alter their exact labels.
            if not self.unknown:
                self.stop_target('locale-stop')
                self.command('arabic-locale', self.adb + ['shell', 'cmd', 'locale', 'set-app-locales', TARGET, '--user', '0', 'ar'])
                self.command('large-font', self.adb + ['shell', 'settings', 'put', 'system', 'font_scale', '1.5'])
                self.command('arabic-launch', self.adb + ['shell', 'monkey', '-p', TARGET, '-c', 'android.intent.category.LAUNCHER', '1'])
                time.sleep(3)
                self.command('arabic-large-text', self.adb + ['exec-out', 'screencap', '-p'], binary=True)
            self.command('package', self.adb + ['shell', 'dumpsys', 'package', TARGET])
            self.command('logcat', self.adb + ['logcat', '-d', '-t', '2500'], required=False)
        except Exception as error:
            self.summary['firstFailure'] = type(error).__name__ + ': ' + str(error)
        finally:
            # Reap the exact listener before any device cleanup that might itself be unavailable.
            if self.fixture is not None:
                if self.fixture.poll() is None:
                    self.fixture.terminate()
                try:
                    code = self.fixture.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.fixture.kill()
                    code = self.fixture.wait(timeout=5)
                owner = json.loads((self.out / 'fixture-owner.json').read_text())
                owner.update(exitCode=code, childReaped=True, state='STOPPED', finishedAt=time.time())
                write(self.out / 'fixture-owner.json', owner)
            if self.fixture_log is not None:
                self.fixture_log.close()
            try:
                if self.device_validated:
                    self.stop_target('final-owned-target-stop')
            except Exception as error:
                self.summary['cleanupFailure'] = str(error)
            expected = ['journey-' + p for p in ('core', 'https', 'search', 'search_bing', 'restore_seed', 'restore_verify')] + ['saf-' + p for p in ('cancel', 'save', 'reopen')]
            for name in expected:
                if name not in self.summary['phases']:
                    self.not_run(name, 'Earlier first failure; no automatic retry')
            phases = self.summary['phases']
            self.summary['localCoreAndColdRestorePASS'] = all(phases[name]['status'] == 'PASS' for name in ('journey-core', 'journey-restore_seed', 'journey-restore_verify'))
            self.summary['allRequestedAcceptancePASS'] = (all(phases[name]['status'] == 'PASS' for name in expected)
                                                         and self.summary.get('explicitBingFinallyRestoredDDG', False)
                                                         and 'firstFailure' not in self.summary and 'cleanupFailure' not in self.summary)
            self.summary['state'] = 'PASS' if self.summary['allRequestedAcceptancePASS'] else 'INCOMPLETE_OR_FAILED'
            self.summary['finishedAt'] = time.time()
            self.save()
            print(json.dumps(self.summary, ensure_ascii=False))
            step_summary = os.environ.get('GITHUB_STEP_SUMMARY')
            if step_summary:
                with open(step_summary, 'a') as f:
                    f.write('### Android actual journey: ' + self.summary['state'] + '\n\n| Phase | Actual status |\n|---|---|\n')
                    for name in expected:
                        f.write('| ' + name + ' | ' + phases[name]['status'] + ' |\n')
                    f.write('\nExternal UNREACHABLE/CAPTCHA, unknown save, or missing structured result is never PASS. Private/Tor/Nym remain unavailable.\n')
        return 0 if self.summary['allRequestedAcceptancePASS'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', type=Path, required=True)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--target-apk', type=Path, required=True)
    parser.add_argument('--journey-build', type=Path, required=True)
    parser.add_argument('--saf-build', type=Path, required=True)
    args = parser.parse_args()
    def interrupted(signum, _frame):
        # Enter run's finally block on normal CI termination; never use broad process-name kills.
        signal.signal(signum, signal.SIG_IGN)
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    raise SystemExit(Journey(args).run())


if __name__ == '__main__':
    main()
