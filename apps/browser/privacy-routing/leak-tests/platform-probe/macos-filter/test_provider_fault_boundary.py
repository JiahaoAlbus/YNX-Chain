#!/usr/bin/env python3
"""Reuse only an exact new self-fault Core module; typecheck actual Native, no runtime/NE/WK."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
CORE = ROOT / 'native/Sources/YNXBrowserCore'
NATIVE = ROOT / 'native/Sources/YNXBrowserNative'
NAMES = ['BrowserRouteProtection.swift','RoutedBrowserPage.swift','PrivacyTorPlatform.swift',
    'BundledTorBackend.swift','TorExternalTransport.swift','TorProtectedRouteProvider.swift','NymProtectedRouteProvider.swift',
    'ProtectedAcceptanceConsumer.swift','ProtectedAcceptanceDispatcher.swift','ProtectedSyntheticCanary.swift',
    'ProtectedSyntheticWindow.swift','TorPublicSearchDiagnostic.swift','TorSnowflakePublicBrowserBackend.swift','SnowflakeSafePhaseRecorder.swift',
    'NymPublicSearchRuntime.swift','NymPublicDirectoryData.swift']
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core-products', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); out = args.output
    if not out.is_absolute() or out.exists(): parser.error('Fresh absolute output required')
    prior = json.loads((args.core_products / 'receipt.json').read_text())
    if prior.get('sourceDrift') != {} or prior.get('newChecks',{}).get('count',0) < 30:
        raise RuntimeError('Exact new self-fault Core receipt required')
    for path in CORE.glob('*.swift'):
        if prior['inputs'].get(str(path)) != sha(path): raise RuntimeError('Current Core/module source mismatch')
    module = args.core_products / 'YNXBrowserCore.swiftmodule'
    if not module.is_file(): raise RuntimeError('Matching actual Core module required')
    out.mkdir(mode=0o700); (out/'tmp').mkdir(); (out/'Native').mkdir()
    inputs = {str(path):sha(path) for path in [module, args.core_products/'receipt.json']}
    for name in NAMES:
        path=NATIVE/name; inputs[str(path)]=sha(path); shutil.copy2(path,out/'Native'/name)
    result = {'schema':'P05_PROVIDER_FAULT_NATIVE_BOUNDARY_V1','inputs':inputs,'commands':[],
              'actualSignedXPC':'NOT_RUN','NEOrWKOrNetwork':False,'oldGroupsRerun':False}
    def save(): (out/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    alias_dir=Path(tempfile.mkdtemp(prefix='p05-fault-native-',dir='/tmp'));alias=alias_dir/'external';os.symlink(out,alias)
    env=dict(os.environ,TMPDIR=str(alias/'tmp'))
    def run(label,command,expected=0,contains=None):
        row={'label':label,'argv':command};result['commands'].append(row);save()
        child=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env);row['pid']=child.pid;save()
        try: stdout,stderr=child.communicate(timeout=60)
        except subprocess.TimeoutExpired:
            row['timedOut']=True;child.kill();stdout,stderr=child.communicate(timeout=5)
        row.update(exit=child.returncode,originalReaped=child.returncode is not None)
        (out/(label+'.stdout')).write_bytes(stdout);(out/(label+'.stderr')).write_bytes(stderr);save()
        if child.returncode!=expected or row.get('timedOut') or (contains and not any(s in stderr.decode(errors='replace') for s in contains)):
            raise RuntimeError(label+' failed')
    try:
        sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip()
        if sdk!=prior['sdk']:raise RuntimeError('Module SDK mismatch')
        swift=subprocess.check_output(['xcrun','--find','swiftc'],text=True).strip()
        base=[swift,'-frontend','-typecheck','-parse-as-library','-swift-version','6','-sdk',sdk,
              '-target',platform.machine()+'-apple-macosx14.0','-module-cache-path',str(alias/'cache')]
        run('actual-Native-dispatcher-typecheck',base+['-D','YNX_PRIVACY_ACCEPTANCE','-I',str(args.core_products)]+
            [str(alias/'Native'/name) for name in NAMES])
        (out/'CannotConstruct.swift').write_text('import YNXBrowserCore\nfunc fake() { _ = SyntheticProviderSelfFaultAttempt() }\n')
        run('external-cannot-construct-owner',base+['-I',str(args.core_products),str(alias/'CannotConstruct.swift')],1,
            ['cannot be constructed','inaccessible'])
        (out/'CannotDecode.swift').write_text('import Foundation\nimport YNXBrowserCore\nfunc fake() throws { _ = try JSONDecoder().decode(SyntheticProviderSelfFaultAttempt.self, from: Data()) }\n')
        run('external-cannot-decode-owner',base+['-I',str(args.core_products),str(alias/'CannotDecode.swift')],1,['Decodable'])
        (out/'NormalCannotName.swift').write_text('func fake() { _ = SyntheticProviderSelfFaultAttempt.self }\n')
        run('normal-flag-hides-fault-owner',base+[str(CORE/'SyntheticProviderFaultProtocol.swift'),
            str(CORE/'SyntheticProviderFaultAuthority.swift'),str(alias/'NormalCannotName.swift')],1,['cannot find'])
        result['sourceDrift']={p:sha(Path(p)) for p in inputs if sha(Path(p))!=inputs[p]}
        if result['sourceDrift']:raise RuntimeError('Source drift')
    except Exception as error:
        result.setdefault('firstFailure',str(error));raise
    finally:
        save();alias.unlink();alias_dir.rmdir()
    print(json.dumps({'receipt':str(out/'receipt.json'),'actualNE':'NOT_RUN'}))
if __name__=='__main__':main()
