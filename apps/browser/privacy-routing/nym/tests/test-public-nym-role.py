#!/usr/bin/env python3
"""Exercise the actual Nym role predicate on owned test bundles."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.absolute()
    output.mkdir(mode=0o700)
    tmp = output/'tmp'
    tmp.mkdir(mode=0o700)
    runtime = Path(__file__).resolve().parents[3]/'native/Sources/YNXBrowserNative/NymPublicSearchRuntime.swift'
    original = runtime.read_bytes()
    role = original.decode().split('enum NymPublicSearchRole {', 1)[1].split('enum NymPublicRuntimeFailure:', 1)[0]
    # Include the exact real predicate and the enum used by require().
    failures = original.decode().split('enum NymPublicRuntimeFailure:', 1)[1].split('/// Local PUBLIC diagnostic', 1)[0]
    component = output/'main.swift'
    component.write_text('import Foundation\nimport CoreFoundation\nenum NymPublicSearchRole {' + role
                         + 'enum NymPublicRuntimeFailure:' + failures
                         + '''
var checks = 0
for argument in CommandLine.arguments.dropFirst() {
    let fields = argument.split(separator: "=", maxSplits: 1)
    guard fields.count == 2,
          let bundle = Bundle(url: URL(fileURLWithPath: String(fields[1]))) else { fatalError("fixture bundle") }
    guard NymPublicSearchRole.claims(bundle) == (fields[0] == "fixed"),
          NymInteractiveRouteRole.claims(bundle) == (fields[0] == "interactive") else { fatalError("unexpected role") }
    do {
        try NymPublicSearchRole.require(bundle)
        fatalError("non-main Bundle passed require")
    } catch NymPublicRuntimeFailure.wrongRole {}
    do {
        try NymInteractiveRouteRole.require(bundle)
        fatalError("non-main Bundle passed interactive require")
    } catch NymPublicRuntimeFailure.wrongRole {}
    checks += 1
}
print("PASS \(checks) Nym role bundles")
''')
    accepted = {'CFBundleIdentifier':'com.ynxweb4.browser.qa.nym.public-search', 'CFBundlePackageType':'APPL',
                'YNXPublicSearchDiagnostic':True, 'YNXPublicNymSearchDiagnostic':True}
    cases = [('fixed', accepted)]
    for name, value in [('YNXPublicSnowflakeSearchDiagnostic',False), ('YNXPublicSnowflakeLaunchSHA256',''),
                        ('YNXPublicArtiChannelTimeoutExperiment',False), ('YNXNymProofHelper',False),
                        ('YNXPrivacyRouteMode',''), ('CFBundleURLTypes',[]),
                        ('YNXPublicNymSearchDiagnostic',1), ('YNXPublicSearchDiagnostic',1),
                        ('YNXInteractiveRouteExperiment',False), ('YNXInteractiveRouteExperiment',True)]:
        cases.append(('deny', dict(accepted, **{name:value})))
    interactive = {'CFBundleIdentifier':'com.ynxweb4.browser.qa.nym.interactive', 'CFBundlePackageType':'APPL',
                   'YNXInteractiveRouteExperiment':True}
    cases.append(('interactive', interactive))
    for name, value in [('YNXInteractiveRouteExperiment',False), ('YNXInteractiveRouteExperiment',1),
                        ('YNXInteractiveRouteExperiment','true'), ('CFBundleIdentifier','com.ynxweb4.browser'),
                        ('CFBundleIdentifier',accepted['CFBundleIdentifier']), ('CFBundleURLTypes',[]),
                        ('YNXPrivacyRouteMode',''), ('YNXNymProofHelper',False), ('YNXNymProofHelperSHA256',''),
                        ('YNXPublicSearchDiagnostic',False), ('YNXPublicNymSearchDiagnostic',False),
                        ('YNXPublicSnowflakeSearchDiagnostic',False), ('YNXPublicSnowflakeLaunchSHA256',''),
                        ('YNXPublicArtiChannelTimeoutExperiment',False), ('YNXNormalArtifactCaptureRole',False),
                        ('YNXRouteFilterProviderSHA256','')]:
        cases.append(('deny', dict(interactive, **{name:value})))
    cases.append(('deny', {key:value for key,value in interactive.items() if key != 'YNXInteractiveRouteExperiment'}))
    fixture_args = []
    for idx, (expected, fields) in enumerate(cases):
        app = output/f'{idx}.app'
        (app/'Contents').mkdir(parents=True)
        (app/'Contents/Info.plist').write_bytes(plistlib.dumps(fields))
        fixture_args.append(expected+'='+str(app))
    executable = output/'fixture'
    compiler = subprocess.check_output(['/usr/bin/xcrun','--find','swiftc'],text=True,timeout=5).strip()
    sdk = subprocess.check_output(['/usr/bin/xcrun','--sdk','macosx','--show-sdk-path'],text=True,timeout=5).strip()
    arch = subprocess.check_output(['/usr/bin/uname','-m'],text=True,timeout=5).strip()
    steps = []
    with tempfile.TemporaryDirectory(prefix='ynx-nym-role-',dir='/tmp') as ascii_tmp:
        os.symlink(tmp, Path(ascii_tmp)/'tmp')
        environment = dict(os.environ, TMPDIR=str(Path(ascii_tmp)/'tmp')+'/')
        for label, argv, cap in [('compile',[compiler,'-swift-version','6','-sdk',sdk,'-target',arch+'-apple-macosx14.0',
                                           '-module-cache-path',str(output/'cache'),str(component),'-o',str(executable)],15),
                                 ('fixture',[str(executable),*fixture_args],3)]:
            with (output/(label+'.stdout')).open('xb') as out, (output/(label+'.stderr')).open('xb') as err:
                with subprocess.Popen(argv,env=environment,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True) as child:
                    try:
                        status = child.wait(timeout=cap)
                    except subprocess.TimeoutExpired:
                        if os.getpgid(child.pid) == child.pid:
                            os.killpg(child.pid, 9)
                        status = child.wait(timeout=3)
                    steps.append({'label':label,'pid':child.pid,'status':status,'reaped':True})
            if status:
                break
    after = runtime.read_bytes()
    (output/'RESULT.json').write_text(json.dumps({'runtimeSHA256':hashlib.sha256(original).hexdigest(),
        'sourceUnchanged':original==after,'checks':len(cases),'steps':steps},indent=2)+'\n')
    if any(step['status'] for step in steps) or original != after:
        return 1
    line = (output/'fixture.stdout').read_text()
    if line != f'PASS {len(cases)} Nym role bundles\n':
        return 1
    print(line.strip())
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
