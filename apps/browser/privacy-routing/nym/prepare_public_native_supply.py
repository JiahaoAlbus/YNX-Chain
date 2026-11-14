#!/usr/bin/env python3
"""Offline, fixed-byte PUBLIC Native supply staging; no download/build/sign/run.

prepare_supply(inputs, output) returns a DATA receipt. The enclosing app's owner
copies the resulting fresh resource tree before its normal package signing.
This producer never signs/mutates the two executor binaries or handles profiles.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat

PINS = {
    'directory': '6dce5c8d32932b8968f4a4e2db65db52c48aaf049ad75dad7c4f249f1e8ffda4',
    'runtime': '331afc307bd38c5a8adcddc25f0e333790bf332a61661ce1d800412917a9cb00',
    'directory_source': '0704783948054fc2c8f6ba8f82a12ab06bda85910c642a9374c509670a1773cf',
    'runtime_source': '4f0eab68be0fa772fae47fa4cee3a9ed9ab5373cd38d30367df1f24431deab01',
    'directory_receipt': '5ffcdbe897ef62843a05996501b9b2703e0533137e774303b1501df288400ebb',
    'runtime_receipt': 'b796d33f881cf34204a7f8e084c06134699a56e1ef522585a2610f5d142ce17c',
}
INTERACTIVE_PINS = {
    **PINS,
    'directory': '855806ef6f5d22ad00ca5f144f4b5fb1a06f21e5a082e44984d02642cecc5798',
    'directory_source': '65838e1371153c3ac7a497bf628082115c5b1a7fbe87426effe0a9d9c0951055',
    'directory_receipt': '842f5ae703082b8a1c0cda5a715cc8e74b4369ed9a09473f52a8564b6ab41906',
}
MANIFEST = {
    'schema': 'YNX_NYM_PUBLIC_DUAL_EXECUTOR_SUPPLY_V2',
    'directorySHA256': PINS['directory'], 'runtimeSHA256': PINS['runtime'],
    'directorySourceManifestSHA256': PINS['directory_source'],
    'runtimeSourceManifestSHA256': PINS['runtime_source'],
}
INTERACTIVE_MANIFEST = {
    **MANIFEST,
    'schema': 'YNX_NYM_INTERACTIVE_DUAL_EXECUTOR_SUPPLY_V1',
    'directorySHA256': INTERACTIVE_PINS['directory'],
    'directorySourceManifestSHA256': INTERACTIVE_PINS['directory_source'],
}
LICENSE_NAMES = {'Apache-2.0.txt', 'BSL-1.0', 'CC-BY-NC-SA-4.0.txt',
                 'CC0-1.0.txt', 'MIT.txt', 'gpl-3.0'}

class SupplyRejected(Exception):
    pass

def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_uid, info.st_gid,
            info.st_mode, info.st_nlink, info.st_mtime_ns, info.st_ctime_ns)

class _PinnedFile:
    """Hold the original verified descriptor through copying and final rehash."""
    def __init__(self, path, expected, limit, executable=False):
        self.path = Path(path).absolute()
        self.fd = None
        self.expected = expected
        if self.path.resolve(strict=True) != self.path:
            raise SupplyRejected('input-symlink')
        try:
            self.fd = os.open(self.path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
            self.info = os.fstat(self.fd)
            if (not stat.S_ISREG(self.info.st_mode) or self.info.st_nlink != 1
                    or self.info.st_uid != os.geteuid() or not 0 < self.info.st_size <= limit
                    or executable and not self.info.st_mode & 0o111):
                raise SupplyRejected('input-file-boundary')
            self.verify()
        except BaseException:
            self.close()
            raise

    def _chunks(self):
        os.lseek(self.fd, 0, os.SEEK_SET)
        remaining = self.info.st_size
        while remaining:
            block = os.read(self.fd, min(remaining, 1024 * 1024))
            if not block:
                raise SupplyRejected('input-short-read')
            remaining -= len(block)
            yield block
        if os.read(self.fd, 1):
            raise SupplyRejected('input-grown')

    def verify(self):
        if self.fd is None or _identity(os.fstat(self.fd)) != _identity(self.info):
            raise SupplyRejected('input-descriptor-changed')
        digest = hashlib.sha256()
        for block in self._chunks():
            digest.update(block)
        if digest.hexdigest() != self.expected or _identity(os.fstat(self.fd)) != _identity(self.info):
            raise SupplyRejected('input-byte-pin')
        return self.expected
    def data(self):
        self.verify()
        result = b''.join(self._chunks())
        self.verify()
        return result

    def copy(self, destination, mode):
        self.verify()
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
        digest = hashlib.sha256()
        count = 0
        try:
            os.fchmod(fd, mode)
            for block in self._chunks():
                digest.update(block)
                count += len(block)
                view = memoryview(block)
                while view:
                    written = os.write(fd, view)
                    if written <= 0:
                        raise SupplyRejected('output-write')
                    view = view[written:]
            os.fsync(fd)
        finally:
            os.close(fd)
        self.verify()
        if count != self.info.st_size or digest.hexdigest() != self.expected:
            raise SupplyRejected('copy-byte-pin')
        return {'SHA256': self.expected, 'bytes': count, 'mode': oct(mode)}
    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

def _json(data):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result: raise SupplyRejected('duplicate-json-field')
            result[key] = value
        return result
    try: return json.loads(data, object_pairs_hook=pairs)
    except (ValueError, TypeError, RecursionError) as error:
        raise SupplyRejected('pinned-json-shape') from error

def _write_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        view = memoryview(data)
        while view:
            size = os.write(fd, view)
            if size <= 0: raise SupplyRejected('output-write')
            view = view[size:]
        os.fsync(fd)
    finally: os.close(fd)

def _artifact(receipt, interactive_directory):
    if not interactive_directory:
        return receipt.get('newQAArtifact', {})
    steps = receipt.get('steps', [])
    if (receipt.get('schema') != 'P05_NYM_QA_BODY_DIAGNOSTIC_RELEASE_V1'
            or receipt.get('sourceStable') is not True or receipt.get('productionRelease') is not False
            or receipt.get('childOutcomeRecordingFailure') is not None
            or receipt.get('CargoLockSHA256') != '29275bf9e41f6d6acad87f4737b5640e89ada39e0d7752a9211d04fec7871558'
            or [step.get('name') for step in steps] !=
                ['qa-release-build', 'qa-release-code-signature', 'qa-release-version']
            or any(step.get('exit') != 0 or step.get('reaped') is not True for step in steps)
            or steps[0].get('terminalOutcome') != 'ORIGINAL_POPEN_WAIT'
            or steps[0].get('argv', [])[1:] !=
                ['build', '--offline', '--release', '--locked', '-p', 'nym-socks5-client',
                 '--jobs', '1', '--features', 'ynx-qa-directory']):
        raise SupplyRejected('interactive-directory-receipt')
    source = receipt.get('sourceManifest', {})
    if source.get('SHA256') != INTERACTIVE_PINS['directory_source'] or source.get('files') != 6615:
        raise SupplyRejected('interactive-directory-source')
    return receipt.get('artifact', {})


def prepare_supply(inputs, output, *, cohort='fixed-public'):
    """Use only a declared role-specific set of six exact pins and the notice directory."""
    pins, manifest = {'fixed-public': (PINS, MANIFEST),
                      'interactive': (INTERACTIVE_PINS, INTERACTIVE_MANIFEST)}[cohort]
    if set(inputs) != set(pins) | {'license_directory'}:
        raise SupplyRejected('closed-input-fields')
    output = Path(output).absolute()
    if output.exists() or output.is_symlink(): raise SupplyRejected('output-already-exists')
    if output.parent.resolve(strict=True) != output.parent:
        raise SupplyRejected('output-parent-symlink')
    opened = {}
    try:
        for name, expected in pins.items():
            opened[name] = _PinnedFile(inputs[name], expected,
                36_000_000 if name in ('directory', 'runtime') else 8_388_608,
                executable=name in ('directory','runtime'))
        for name in ('directory','runtime'):
            source = _json(opened[name+'_source'].data())
            receipt = _json(opened[name+'_receipt'].data())
            artifact = _artifact(receipt, cohort == 'interactive' and name == 'directory')
            if (receipt.get('firstFailure') is not None or receipt.get('cleanupFailure') is not None
                    or receipt.get('remainingOwned') != [] or artifact.get('SHA256') != pins[name]
                    or artifact.get('sourceManifestSHA256') != pins[name+'_source']):
                raise SupplyRejected('original-build-receipt-binding')
            if name == 'directory': first_source = source
            else: second_source = source
        notices = Path(inputs['license_directory']).absolute()
        if notices.resolve(strict=True) != notices or not notices.is_dir():
            raise SupplyRejected('license-directory-boundary')
        for name in sorted(LICENSE_NAMES):
            key = 'LICENSES/' + name
            expected = first_source.get(key, {}).get('sha256')
            if not expected or second_source.get(key, {}).get('sha256') != expected:
                raise SupplyRejected('original-source-license-pin')
            opened['license:'+name] = _PinnedFile(notices/name, expected, 262144)
        # All supply/source/receipt/notice inputs pass before any output exists.
        output.mkdir(mode=0o700)
        files = {}
        for name in ('directory','runtime'):
            (output/name).mkdir(mode=0o700)
            relative = name+'/nym-socks5-client'
            files[relative] = opened[name].copy(output/relative, 0o755)
        (output/'LICENSES').mkdir(mode=0o700)
        for name in sorted(LICENSE_NAMES):
            files['LICENSES/'+name] = opened['license:'+name].copy(output/'LICENSES'/name, 0o600)
        for file in opened.values():
            file.verify()
        data = (json.dumps(manifest, sort_keys=True, indent=2)+'\n').encode()
        _write_new(output/'manifest.json', data)
        files['manifest.json'] = {'SHA256': hashlib.sha256(data).hexdigest(), 'bytes':len(data), 'mode':'0o600'}
        for relative, expected in files.items():
            staged = _PinnedFile(output/relative, expected['SHA256'], expected['bytes'])
            try:
                if staged.info.st_size != expected['bytes'] or oct(stat.S_IMODE(staged.info.st_mode)) != expected['mode']:
                    raise SupplyRejected('staged-file-mode-or-size')
            finally:
                staged.close()
        return {'schema':'YNX_NYM_PUBLIC_NATIVE_SUPPLY_STAGED_V1',
                'resourceDirectory':str(output), 'files':files, 'inputSHA256':dict(pins), 'cohort':cohort,
                'NormalPrivacyAdmission':False, 'executorLaunched':False,
                'identityOrProfileCreated':False, 'packageSignedOrInstalled':False,
                'boundary':'Exact byte staging and original build/source provenance only; notices are preserved, not legal clearance. Enclosing sealed PUBLIC package and separate normal permission checks remain parent-owned.'}
    finally:
        for file in opened.values(): file.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cohort', choices=('fixed-public', 'interactive'), default='fixed-public')
    for key in PINS: parser.add_argument('--'+key.replace('_','-'), type=Path, required=True)
    parser.add_argument('--license-directory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args()
    if args.receipt.exists() or args.receipt.is_symlink(): raise SupplyRejected('receipt-already-exists')
    values = vars(args)
    result = prepare_supply({key:values[key] for key in set(PINS)|{'license_directory'}}, args.output, cohort=args.cohort)
    _write_new(args.receipt, (json.dumps(result,indent=2)+'\n').encode())
    print(json.dumps({'receipt':str(args.receipt),'resourceDirectory':str(args.output),
                      'status':'OFFLINE_STAGING_COMPLETE_NOT_PACKAGE_OR_NETWORK_PROOF'}))

if __name__ == '__main__': main()
