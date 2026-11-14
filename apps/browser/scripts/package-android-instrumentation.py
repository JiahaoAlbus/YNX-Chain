#!/usr/bin/env python3
"""Build an owned platform-only Android test APK with the existing public QA key."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

CERT = 'bf4981ad3f7d0fb2f087ba76f179280475727c08a80abbd58adcf3fe7180150b'
A = '{http://schemas.android.com/apk/res/android}'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--java-home', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():
        raise ValueError('Use a fresh absolute output directory')
    source = args.source.resolve(strict=True)
    manifest = source / 'AndroidManifest.xml'
    root = ET.parse(manifest).getroot()
    runner = root.find('instrumentation')
    package = root.get('package')
    if runner is None or runner.get(A + 'targetPackage') != 'com.ynxweb4.browser.qa':
        raise ValueError('Only the isolated Browser QA target is allowed')
    if package not in ('com.ynxweb4.browser.qa.instrumentation', 'com.ynxweb4.browser.qa.safinstrumentation'):
        raise ValueError('Unreviewed test package')
    files = [manifest] + sorted((source / 'src').rglob('*.java'))
    pins = {str(p.relative_to(source)): sha(p) for p in files}
    tools = args.sdk / 'build-tools/36.0.0'
    platform = args.sdk / 'platforms/android-36/android.jar'
    java = args.java_home / 'bin/java'
    key = Path(__file__).resolve().parents[1] / 'android/testnet-signing/YNX_BROWSER_PUBLIC_TEST_ONLY.keystore'
    args.output.mkdir(parents=True)
    for name in ('classes', 'dex', 'tmp'):
        (args.output / name).mkdir()
    apk = args.output / (package + '.apk')
    receipt = {'source': str(source), 'sourceSHA256': pins, 'target': 'com.ynxweb4.browser.qa',
               'package': package, 'runner': runner.get(A + 'name'), 'state': 'BUILDING',
               'installed': False, 'commands': [], 'startedAt': time.time()}
    receipt_path = args.output / 'BUILD.json'

    def save():
        receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')

    def run(name, command):
        receipt['stage'] = name
        receipt['commands'].append([str(x) for x in command])
        save()
        result = subprocess.run([str(x) for x in command], text=True, capture_output=True, timeout=120)
        (args.output / (name + '.stdout')).write_text(result.stdout)
        (args.output / (name + '.stderr')).write_text(result.stderr)
        receipt[name + 'Exit'] = result.returncode
        save()
        result.check_returncode()
        return result.stdout

    try:
        run('manifest', [tools / 'aapt2', 'link', '-o', args.output / 'base.apk', '-I', platform,
                         '--manifest', manifest, '--min-sdk-version', '28', '--target-sdk-version', '36'])
        run('javac', [args.java_home / 'bin/javac', '-J-Xmx512m', '-source', '11', '-target', '11',
                      '-encoding', 'UTF-8', '-cp', platform, '-d', args.output / 'classes', *files[1:]])
        run('jar', [args.java_home / 'bin/jar', '-J-Xmx256m', 'cf', args.output / 'classes.jar', '-C', args.output / 'classes', '.'])
        run('dex', [java, '-Xmx512m', '-Djava.io.tmpdir=' + str(args.output / 'tmp'), '-cp', tools / 'lib/d8.jar',
                    'com.android.tools.r8.D8', '--lib', platform, '--min-api', '28', '--output', args.output / 'dex', args.output / 'classes.jar'])
        shutil.copyfile(args.output / 'base.apk', args.output / 'dex.apk')
        with zipfile.ZipFile(args.output / 'dex.apk', 'a', zipfile.ZIP_DEFLATED) as z:
            for p in sorted((args.output / 'dex').glob('*.dex')):
                z.write(p, p.name)
        run('align', [tools / 'zipalign', '4', args.output / 'dex.apk', args.output / 'aligned.apk'])
        run('sign', [java, '-Xmx256m', '-jar', tools / 'lib/apksigner.jar', 'sign', '--ks', key,
                     '--ks-key-alias', 'ynxbrowserpreview', '--ks-pass', 'pass:android', '--key-pass', 'pass:android',
                     '--out', apk, args.output / 'aligned.apk'])
        result = run('verify', [java, '-Xmx256m', '-jar', tools / 'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', apk])
        if 'Signer #1 certificate SHA-256 digest: ' + CERT not in result:
            raise ValueError('Test signature differs from target QA identity')
        if pins != {str(p.relative_to(source)): sha(p) for p in files}:
            raise ValueError('Test source drift during build')
        receipt.update(state='PACKAGE_VERIFIED_NOT_INSTALLED', APK=str(apk), APKBytes=apk.stat().st_size,
                       APKSHA256=sha(apk), certificateSHA256=CERT)
        save()
        print(json.dumps({k: receipt[k] for k in ('APK', 'APKSHA256', 'runner')}))
    except Exception as error:
        receipt.update(state='FAILED', firstFailure=type(error).__name__ + ': ' + str(error))
        save()
        raise


if __name__ == '__main__':
    main()
