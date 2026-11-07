#!/usr/bin/env python3
"""Actual production compiler checks plus explicitly PUBLIC Android OS doubles."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

p = argparse.ArgumentParser()
p.add_argument('--output-dir', required=True)
p.add_argument('--sdk', default=os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT')))
p.add_argument('--gradle-cache', default=str(Path.home() / '.gradle/caches/modules-2/files-2.1'))
p.add_argument('--json-jar', required=True)
a = p.parse_args()
app = Path(__file__).resolve().parent.parent
out = Path(a.output_dir).resolve()
out.mkdir(parents=True, exist_ok=False)
steps = []

def run(name, cmd):
    result = subprocess.run([str(v) for v in cmd], cwd=app, capture_output=True, text=True)
    (out / (name + '.stdout')).write_text(result.stdout)
    (out / (name + '.stderr')).write_text(result.stderr)
    steps.append({'name': name, 'command': [str(v) for v in cmd], 'exitCode': result.returncode})
    if result.returncode:
        raise RuntimeError(name + ' failed; original stdout/stderr retained')

def version(path):
    return tuple(int(v) for v in re.findall(r'\d+', path.name))

def jar(group, name, wanted=None):
    root = Path(a.gradle_cache) / group / name
    dirs = sorted((d for d in root.iterdir() if d.is_dir()), key=version)
    if wanted and (root / wanted).is_dir():
        dirs = [root / wanted]
    for directory in reversed(dirs):
        candidates = [v for v in directory.rglob('*.jar') if not v.name.endswith(('-sources.jar', '-javadoc.jar'))]
        if candidates:
            return sorted(candidates)[0]
    raise RuntimeError('Actual compiler dependency missing: ' + str(root))

try:
    sdk = Path(a.sdk or '')
    ndk = sorted((sdk / 'ndk').iterdir(), key=version)[-1]
    toolchain = next(v for v in (ndk / 'toolchains/llvm/prebuilt').iterdir() if v.is_dir()) / 'bin'
    includes = app / 'contracts/sdk-mobile-application-v6'
    provenance = json.loads((includes / 'PROVENANCE.json').read_text())
    for row in provenance['files']:
        data = (includes / row['file']).read_bytes()
        assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256']
    for target in ['aarch64-linux-android28', 'x86_64-linux-android28']:
        run(target, [toolchain / (target + '-clang++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-fPIC', '-I', includes,
                     '-c', app / 'native/installed-application/InstalledApplicationOriginal.android.cpp', '-o', out / (target + '.o')])
    compiler = jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable')
    selected_version = compiler.parent.parent.name
    stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', selected_version)
    annotations = jar('org.jetbrains', 'annotations')
    runtime = [stdlib, annotations]
    compiler_jars = [compiler, stdlib, annotations,
                     jar('org.jetbrains.kotlin', 'kotlin-script-runtime', selected_version),
                     jar('org.jetbrains.kotlin', 'kotlin-reflect', selected_version),
                     jar('org.jetbrains.intellij.deps', 'trove4j'),
                     jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm')]
    command = ['java', '-cp', os.pathsep.join(map(str, compiler_jars)), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
               '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-Werror']
    android_jar = sorted((sdk / 'platforms').glob('*/android.jar'), key=lambda f: version(f.parent))[-1]
    production = app / 'android/app/src/main/java/com/ynxweb4/ai/NativeInstalledApplication.kt'
    run('normal-kotlin', command + ['-classpath', os.pathsep.join(map(str, [android_jar] + runtime)), '-d', out / 'normal-kotlin.jar', production])
    react_root = Path(a.gradle_cache) / 'com.facebook.react/react-android/0.86.0'
    react_aar = next(react_root.rglob('*-release.aar'))
    react_classes = out / 'actual-react-android-0.86.0.jar'
    with zipfile.ZipFile(react_aar) as archive:
        react_classes.write_bytes(archive.read('classes.jar'))
    flag = out / 'BuildConfig.PUBLIC.kt'
    flag.write_text('package com.ynxweb4.ai\ninternal object BuildConfig { const val YNX_AI_MATCHED_NATIVE_V6 = true }\n')
    host = app / 'android/app/src/main/java/com/ynxweb4/ai/NativeAIHostLifecycle.kt'
    registrar = app / 'android/app/src/main/java/com/ynx/wallet/ai/YNXOriginalAIMobileV6Registration.kt'
    run('normal-RN-host-interface', command + ['-classpath', os.pathsep.join(map(str, [android_jar, react_classes] + runtime)),
                                             '-d', out / 'normal-RN-host-interface.jar', production, host, registrar, flag])
    model_sources = sorted((app / 'native/installed-application/test/android-model').rglob('*.kt'))
    run('PUBLIC-model-compile', command + ['-classpath', os.pathsep.join(map(str, runtime + [Path(a.json_jar)])),
                                          '-d', out / 'PUBLIC-model.jar', production] + model_sources)
    run('PUBLIC-model', ['java', '--add-opens=java.base/java.io=ALL-UNNAMED', '-cp', os.pathsep.join(map(str, [out / 'PUBLIC-model.jar', Path(a.json_jar)] + runtime)), 'ControlsKt'])
    host_model = sorted((app / 'native/installed-application/test/host-model').rglob('*.kt'))
    run('PUBLIC-host-compile', command + ['-classpath', os.pathsep.join(map(str, runtime)),
                                         '-d', out / 'PUBLIC-host.jar', host] + host_model)
    host_cp = os.pathsep.join(map(str, [out / 'PUBLIC-host.jar'] + runtime))
    run('PUBLIC-host-lifecycle', ['java', '-cp', host_cp, 'HostControlsKt'])
    run('PUBLIC-host-first-failure', ['java', '-cp', host_cp, 'HostControlsKt', 'bootstrap-error'])
finally:
    (out / 'RESULT.json').write_text(json.dumps({'steps': steps,
        'scope': 'actual NDK arm64/x86_64 and Android SDK Kotlin compiler; PUBLIC OS-double real-file controls',
        'installed': False, 'RootAdmission': False, 'SourceAdmission': False,
        'realApproval': False, 'realSigning': False, 'realBusinessCompletion': False}, indent=2) + '\n')
