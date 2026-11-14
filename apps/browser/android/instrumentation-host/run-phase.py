#!/usr/bin/env python3
"""Run one owned Browser instrumentation phase and preserve the exact first result."""
import argparse
import json
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', type=Path, required=True)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--runner', choices=('journey', 'saf'), required=True)
    parser.add_argument('--phase', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--timeout', type=int, default=120)
    parser.add_argument('--require-pass', action='store_true', help='Fail this command unless the browser result explicitly reports PASS')
    parser.add_argument('--arg', action='append', default=[], help='Explicit instrumentation key=value')
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():
        raise ValueError('Use a fresh absolute result directory; never overwrite an earlier outcome')
    if not 1 <= args.timeout <= 300:
        raise ValueError('Use a bounded phase timeout')
    adb = [str(args.adb), '-s', args.serial]
    avd = subprocess.check_output(adb + ['emu', 'avd', 'name'], text=True, timeout=10)
    if avd.splitlines()[0] != 'YNX_BROWSER_API_36':
        raise ValueError('Only the original Browser AVD is allowed; never borrow Social devices')
    package = 'com.ynxweb4.browser.qa.' + ('instrumentation' if args.runner == 'journey' else 'safinstrumentation')
    runner = package + ('.BrowserJourneyInstrumentation' if args.runner == 'journey' else '.BrowserSafInstrumentation')
    command = adb + ['shell', 'am', 'instrument', '-w', '-r', '-e', 'phase', args.phase]
    for value in args.arg:
        key, separator, item = value.partition('=')
        if not separator or not key or key == 'phase':
            raise ValueError('Each extra argument needs an explicit unique key=value')
        # adb shell's remote command is parsed by the device shell: forbid shell metacharacters.
        if any(c in key + item for c in "\n\r\x00'\"`$;&|<>() "):
            raise ValueError('Unsafe instrumentation argument; use URL encoding for values')
        command += ['-e', key, item]
    command.append(package + '/' + runner)
    args.output.mkdir(parents=True)
    record = {'phase': args.phase, 'device': args.serial, 'runner': runner,
              'command': command, 'startedAt': time.time(), 'state': 'RUNNING', 'desktopGUI': False}
    receipt = args.output / 'RESULT.json'
    receipt.write_text(json.dumps(record, indent=2) + '\n')
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=args.timeout)
        (args.output / 'stdout.txt').write_text(result.stdout)
        (args.output / 'stderr.txt').write_text(result.stderr)
        record.update(exitCode=result.returncode, state='COMMAND_RETURNED', finishedAt=time.time())
        parsed = []
        for line in result.stdout.splitlines():
            if 'ynx_result=' in line:
                try:
                    parsed.append(json.loads(line.split('ynx_result=', 1)[1]))
                except json.JSONDecodeError:
                    record['resultDecodeError'] = True
        record['instrumentationResults'] = parsed
        # ADB exit zero alone never establishes a passing browser journey.
        record['hasStructuredBrowserResult'] = bool(parsed)
        receipt.write_text(json.dumps(record, indent=2) + '\n')
        print(json.dumps(record, ensure_ascii=False))
        passed = any(item.get('status') == 'PASS' or item.get('outcome') == 'PASS' for item in parsed)
        raise SystemExit(0 if result.returncode == 0 and parsed and (passed or not args.require_pass) else 1)
    except subprocess.TimeoutExpired as error:
        (args.output / 'stdout.txt').write_bytes(error.stdout or b'')
        (args.output / 'stderr.txt').write_bytes(error.stderr or b'')
        record.update(state='TIMEOUT_UNKNOWN', adbChildReaped=True, finishedAt=time.time(),
                      actualInstrumentationState='Must reconcile original target process before any retry; no automatic replay')
        receipt.write_text(json.dumps(record, indent=2) + '\n')
        raise SystemExit(2)


if __name__ == '__main__':
    main()
