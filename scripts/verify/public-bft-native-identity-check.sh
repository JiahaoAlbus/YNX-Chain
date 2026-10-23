#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
# Exercise the production reader/validator with explicit observation doubles.
# These pure controls do not inspect a real process, start a service or qualify
# any deployed native binary. The original operator must perform that readback.
python3 -B - <<'PY'
import copy, hashlib, json, os, runpy, tempfile
from pathlib import Path
from unittest.mock import patch

code = runpy.run_path('scripts/ops/remote/public-bft-native-identity.py', run_name='native_identity_controls')
inspect, validate = code['inspect'], code['source_identity']
full = '65efa82e06158f9616172144c3c9efdd8088f227'
release, binary = 'ynx-network-surgical-' + full[:12], 'a' * 64
candidate, tx = 'abcdef012345', 'native-source-controls'
paths = dict(statePath='/var/lib/ynx-chain/testnet/devnet-state.json',
    integrityMarkerPath='/var/lib/ynx-chain/testnet/devnet-state.integrity-version',
    pauseMarkerPath='/var/lib/ynx-chain/block-production-pause.json',
    mutationMarkerPath='/var/lib/ynx-chain/mutation-freeze.json')

class Observations:
    def __init__(self):
        # Deliberately unrelated to the build release name: never guess install
        # paths from labels. No actual executable or database is read here.
        self.exe = '/original/native/bin/ynx-chaind'
        self.digest, self.inode = binary, '2049:1234'
        self.argv = [self.exe]
        self.env = {'YNX_DATA_DIR': '/var/lib/ynx-chain/testnet',
                    'YNX_MUTATION_FREEZE_FILE': paths['mutationMarkerPath'],
                    'YNX_BLOCK_PRODUCTION_PAUSE_FILE': paths['pauseMarkerPath']}
        self.config = self.env.copy()
        self.unit = dict(ActiveState='active', SubState='running', MainPID='123',
            FragmentPath='/etc/systemd/system/ynx-chaind.service', DropInPaths='',
            EnvironmentFiles='/etc/ynx/ynx-chaind.env (ignore_errors=no)',
            ExecStart='{ path=' + self.exe + ' ; argv[]=' + self.exe + ' ; ignore_errors=no ; pid=123 ; status=0/0 }')
        self.payload = dict(chainId=6423, nativeCurrencySymbol='YNXT', build=dict(commit=full[:12], release=release),
            nodeIdentity=dict(replicationMode='authoritative_producer', blockProductionEnabled=True, validatorAddress='ynx_validator_primary'))
        self.reads, self.observations, self.shows = [], 0, 0
        self.race = None
        self.configuration_reads = {}
        self.files = {'/etc/systemd/system/ynx-chaind.service': b'original unit fixture bytes\n',
            '/etc/systemd/system/ynx-chaind.service.d/90-core-ecosystem-20260912.conf':
                b'[Service]\nEnvironment="PRIVATE_CANARY=never-print-dropin-values"\n',
            '/etc/systemd/system/ynx-chaind.service.d/99-native-controls.conf': b'[Service]\n# public control\n'}
    def show(self):
        self.shows += 1
        value = self.unit.copy()
        if self.race == 'pid' and self.shows == 2:
            value['MainPID'] = '456'
        return value
    def executable(self, pid):
        assert pid == '123'
        self.observations += 1
        inode = '2049:5678' if self.race == 'inode' and self.observations == 2 else self.inode
        return self.exe, self.digest, inode
    def listener(self):
        return {'999'} if self.race == 'listener' else {'123'}
    def canonical(self, filename):
        return filename
    def configuration(self, filename, maximum):
        raw = self.read(filename, maximum)
        count = self.configuration_reads.get(filename, 0) + 1
        self.configuration_reads[filename] = count
        changed = self.race == 'configuration-inode' and count > 1
        return raw, (1, 999 if changed else 123, 0o100644, 1, 0, 0, len(raw), 1, 1)
    def status(self):
        return copy.deepcopy(self.payload)
    def read(self, filename, maximum, proc=False):
        self.reads.append(filename)
        if self.race == 'permission':
            raise PermissionError('fixture protected original proc observation')
        if filename == '/proc/123/cmdline':
            return ('\0'.join(self.argv) + '\0').encode()
        if filename == '/proc/123/environ':
            return b'\0'.join((k + '=' + v).encode() for k, v in self.env.items()) + b'\0UNRELATED_PRIVATE_VALUE=\xff\0'
        if filename == '/proc/123/stat':
            ticks = b'987' if self.race == 'ticks' and self.observations == 2 else b'456'
            return b'123 (ynx-chaind) S ' + b'0 ' * 18 + ticks + b' 0'
        if filename == '/etc/ynx/ynx-chaind.env':
            return ('\n'.join(k + '=' + v for k, v in self.config.items()) + '\n').encode()
        if filename in self.files:
            return self.files[filename]
        raise AssertionError('unexpected/private file read: ' + filename)

def rejected(fn):
    try:
        fn()
    except (ValueError, PermissionError):
        return
    raise AssertionError('invalid original source identity accepted')

source = validate(paths.copy(), full, release, binary, tx, candidate)
assert set(source) == set(paths) and 'height' not in source
normal = Observations()
result = inspect(source, full, release, binary, 'primary', normal)
assert result['authoritativeCommit'] == full and result['authoritativeRelease'] == release
assert result['dataPath'] == '/var/lib/ynx-chain/testnet'
assert result['runningExecutablePath'] == normal.exe
assert result['readOnly'] is True and result['deployment'] is False and result['nativeRootAuthorized'] is False
assert 'PRIVATE' not in json.dumps(result) and 'environ' not in json.dumps(result)
assert not any('devnet-state' in name or 'key' in name or 'lock' in name for name in normal.reads)
# The profile is independent approval DATA, not loaded-unit self-attestation.
# Values in a pinned drop-in are hashed only, never decoded or returned.
with_dropins = Observations()
drop_paths = sorted(name for name in with_dropins.files if '/ynx-chaind.service.d/' in name)
profile = dict(fragmentSha256=hashlib.sha256(with_dropins.files[with_dropins.unit['FragmentPath']]).hexdigest(),
    dropIns=[dict(path=name, sha256=hashlib.sha256(with_dropins.files[name]).hexdigest()) for name in drop_paths])
with_dropins.unit['DropInPaths'] = ' '.join(drop_paths)
observed = inspect(source, full, release, binary, 'primary', with_dropins, profile)
assert observed['authoritativeSystemd'] == profile and observed['unitSHA256'] == profile['fragmentSha256']
assert all(with_dropins.configuration_reads[name] == 2 for name in with_dropins.files)
assert 'PRIVATE_CANARY' not in json.dumps(observed) and 'never-print' not in json.dumps(observed)
rejected(lambda: inspect(source, full, release, binary, 'primary', with_dropins))
single = Observations(); single.unit['DropInPaths'] = drop_paths[0]
single_profile = {**profile, 'dropIns': profile['dropIns'][:1]}
assert inspect(source, full, release, binary, 'primary', single, single_profile)['authoritativeSystemd'] == single_profile
for change in (
    lambda x: x.unit.update(DropInPaths=' '.join(reversed(drop_paths))),
    lambda x: x.unit.update(DropInPaths=' '.join(drop_paths + ['/etc/systemd/system/ynx-chaind.service.d/extra.conf'])),
    lambda x: x.unit.update(DropInPaths=drop_paths[0]),
    lambda x: setattr(x, 'race', 'configuration-inode'),
    lambda x: x.files.update({drop_paths[0]: b'changed original bytes\n'}),
    lambda x: x.files.update({x.unit['FragmentPath']: b'changed fragment\n'}),
):
    fixture = Observations(); fixture.unit['DropInPaths'] = ' '.join(drop_paths); change(fixture)
    rejected(lambda: inspect(source, full, release, binary, 'primary', fixture, profile))
for bad in (None, {}, {**profile, 'extra': True}, {**profile, 'fragmentSha256': '0' * 64},
        {**profile, 'dropIns': list(reversed(profile['dropIns']))},
        {**profile, 'dropIns': [profile['dropIns'][0]] * 2}, {**profile, 'dropIns': profile['dropIns'] * 9},
        {**profile, 'dropIns': [{**profile['dropIns'][0], 'sha256': 'f' * 64}]},
        {**profile, 'dropIns': [{'path': drop_paths[0]}]},
        *({**profile, 'dropIns': [dict(path=name, sha256='a' * 64)]} for name in
          ('/tmp/unapproved.conf', '/etc/systemd/system/ynx-chaind.service.d/../escape.conf',
           "/etc/systemd/system/ynx-chaind.service.d/quoted';id.conf", drop_paths[0] + '\n'))):
    if bad is not None and bad.get('dropIns') == [{**profile['dropIns'][0], 'sha256': 'f' * 64}]:
        fixture = Observations(); fixture.unit['DropInPaths'] = drop_paths[0]
        rejected(lambda: inspect(source, full, release, binary, 'primary', fixture, bad))
    else:
        rejected(lambda: code['systemd_identity'](bad))
# Exercise the real bounded/no-follow configuration reader against real files,
# including a same-byte inode replacement after opening the original file.
reader = code['OriginalProcess']()
with tempfile.TemporaryDirectory(prefix='ynx-native-systemd-read-') as directory:
    original = Path(directory).resolve() / 'original.conf'
    original.write_bytes(b'public exact fixture\n'); original.chmod(0o644)
    assert reader.configuration(str(original), 65536)[0] == original.read_bytes()
    link = original.with_name('symlink.conf'); link.symlink_to(original)
    rejected(lambda: reader.configuration(str(link), 65536)); link.unlink()
    link = original.with_name('hardlink.conf'); os.link(original, link)
    rejected(lambda: reader.configuration(str(original), 65536)); link.unlink()
    original.chmod(0o666); rejected(lambda: reader.configuration(str(original), 65536)); original.chmod(0o644)
    rejected(lambda: reader.configuration(str(original), 1))
    replacement = original.with_name('replacement.conf'); replacement.write_bytes(original.read_bytes()); replacement.chmod(0o644)
    actual_open = os.open
    def replacing_open(filename, flags, *args, **kwargs):
        fd = actual_open(filename, flags, *args, **kwargs)
        if filename == str(original):
            os.replace(replacement, original)
        return fd
    with patch.object(os, 'open', side_effect=replacing_open):
        rejected(lambda: reader.configuration(str(original), 65536))
# Reuse the original capture fixture and unchanged final reader. Only OS
# process observations are doubles; the real producer consumes the profile
# from its independently pinned preparation and emits the original 19 fields.
capture_controls = runpy.run_path('scripts/verify/test_public_bft_capture_snapshot_source.py',
                                run_name='native_systemd_capture_controls')
with tempfile.TemporaryDirectory(prefix='ynx-native-systemd-capture-') as directory:
    fixture = capture_controls['Fixture'](Path(directory).resolve(), 'profile')
    fixture.approval['authoritativeSystemd'] = copy.deepcopy(single_profile)
    role_base = {k: fixture.approval[k] for k in
        ('authoritativeCommit', 'authoritativeRelease', 'authoritativeBinarySha256', 'authoritativeSource')}
    fixture.approval['authoritativeRoles'] = {role: copy.deepcopy(role_base) for role in ('primary', 'singapore', 'silicon-valley', 'seoul')}
    fixture.approval['authoritativeRoles']['primary']['authoritativeSystemd'] = copy.deepcopy(single_profile)
    fixture.replace(fixture.approval_path, fixture.approval, 'preparation_approval_sha256')
    fixture.process.unit['DropInPaths'] = drop_paths[0]
    def pinned_configuration(filename, maximum):
        raw = single.files[filename]
        return raw, (1, 123, 0o100644, 1, 0, 0, len(raw), 1, 1)
    fixture.process.configuration = pinned_configuration
    receipt = fixture.run()
    output = Path(receipt['snapshotSourcePath']); raw = output.read_bytes()
    assert len(json.loads(raw)) == 19 and 'PRIVATE' not in raw.decode()
    identity = {**role_base, 'authoritativeSystemd': single_profile}
    original_reader = capture_controls['original_reader']()
    consumed, returned = original_reader['source_record'](output, hashlib.sha256(raw).hexdigest(),
        fixture.tx, fixture.commit, fixture.native, fixture.release, identity)
    assert returned == raw
    original_reader['check_source'](consumed, fixture.tx, fixture.commit, fixture.release, identity)
    assert receipt['exported'] is False and receipt['nativeRootAuthorized'] is False
follower = Observations()
follower.payload['nodeIdentity'] = dict(replicationMode='authoritative_follower', blockProductionEnabled=False, validatorAddress='ynx_validator_seoul')
assert inspect(source, full, release, binary, 'seoul', follower)['role'] == 'seoul'
for name, change in (
    ('inactive', lambda x: x.unit.update(ActiveState='inactive')),
    ('missingPID', lambda x: x.unit.update(MainPID='0')),
    ('dropin', lambda x: x.unit.update(DropInPaths='/unapproved.conf')),
    ('differentUnit', lambda x: x.unit.update(FragmentPath='/tmp/other.service')),
    ('missingEnvFile', lambda x: x.unit.update(EnvironmentFiles='')),
    ('optionalEnv', lambda x: x.unit.update(EnvironmentFiles='/etc/ynx/ynx-chaind.env (ignore_errors=yes)')),
    ('wrongELF', lambda x: setattr(x, 'digest', 'b' * 64)),
    ('wrongLoadedCommand', lambda x: x.unit.update(ExecStart=x.unit['ExecStart'].replace('/original/', '/other/'))),
    ('wrapper', lambda x: setattr(x, 'argv', ['/bin/sh', x.exe])),
    ('missingFreeze', lambda x: x.env.pop('YNX_MUTATION_FREEZE_FILE')),
    ('unloadedConfig', lambda x: x.config.update(YNX_DATA_DIR='/other-db')),
    ('wrongNativeCommit', lambda x: x.payload['build'].update(commit=candidate)),
    ('wrongNativeRelease', lambda x: x.payload['build'].update(release='ynx-chain-' + candidate)),
    ('wrongRole', lambda x: x.payload['nodeIdentity'].update(replicationMode='authoritative_follower')),
    ('wrongProduction', lambda x: x.payload['nodeIdentity'].update(blockProductionEnabled=False)),
    ('wrongValidator', lambda x: x.payload['nodeIdentity'].update(validatorAddress='ynx_validator_other')),
    ('wrongChain', lambda x: x.payload.update(chainId=1)),
    ('changedPID', lambda x: setattr(x, 'race', 'pid')),
    ('wrongListener', lambda x: setattr(x, 'race', 'listener')),
    ('changedInode', lambda x: setattr(x, 'race', 'inode')),
    ('changedProcess', lambda x: setattr(x, 'race', 'ticks')),
    ('permission', lambda x: setattr(x, 'race', 'permission')),
):
    fixture = Observations()
    change(fixture)
    rejected(lambda: inspect(source, full, release, binary, 'primary', fixture))
for args in (['--data-dir', '/new-empty-db'], ['-data-dir=/new-empty-db'],
             ['--block-production-pause-file=/wrong-marker'], ['-block-production-pause-file', '/wrong-marker'],
             ['positional', '--data-dir=/var/lib/ynx-chain/testnet'],
             ['--', '--data-dir=/var/lib/ynx-chain/testnet'], ['--unknown-option=true']):
    fixture = Observations()
    fixture.argv += args
    fixture.unit['ExecStart'] = '{ path=' + fixture.exe + ' ; argv[]=' + ' '.join(fixture.argv) + ' ; ignore_errors=no ; pid=123 ; status=0/0 }'
    rejected(lambda: inspect(source, full, release, binary, 'primary', fixture))
for args in (['--data-dir=/var/lib/ynx-chain/testnet'], ['-data-dir', '/var/lib/ynx-chain/testnet'],
             ['-block-production-pause-file=' + paths['pauseMarkerPath']]):
    fixture = Observations()
    fixture.argv += args
    fixture.unit['ExecStart'] = '{ path=' + fixture.exe + ' ; argv[]=' + ' '.join(fixture.argv) + ' ; ignore_errors=no ; pid=123 ; status=0/0 }'
    assert inspect(source, full, release, binary, 'primary', fixture)['dataPath'] == '/var/lib/ynx-chain/testnet'
for name, value in [('futureHeight', {**paths, 'height': '100'}), ('missingPath', {k:v for k,v in paths.items() if k != 'mutationMarkerPath'}),
                    ('symlinkSpelling', {**paths, 'statePath': '/original/../testnet/devnet-state.json'}),
                    ('conflictingMarker', {**paths, 'pauseMarkerPath': paths['mutationMarkerPath']})]:
    rejected(lambda: validate(value, full, release, binary, tx, candidate))
for bad_full, bad_release, bad_binary in [(candidate, release, binary), (full, 'ynx-chain-' + candidate, binary),
    ('0'*40, release, binary), (full, release, '0'*64), (full, release, 'A'*64)]:
    rejected(lambda: validate(paths, bad_full, bad_release, bad_binary, tx, candidate))
print('PUBLIC_BFT_NATIVE_IDENTITY_CONTROLS_DATA_ONLY: stable approved paths; mocked observations, no deployed process qualification')
PY

# Actual original remote helper programs, with only their HTTP boundary and
# filesystem replaced by isolated public orchestration fixtures. No daemon or
# systemd action is executed and no real ledger/proc qualification is claimed.
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import http from 'node:http';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {authoritativeIdentity,authoritativeSystemdIdentity,authoritativeRoleIdentities,roleAuthoritativeIdentity,validateAuthoritativeObservation} from './scripts/verify/lib/public-bft-native-source.mjs';
const run=promisify(execFile),repo=process.cwd(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-native-helper-controls-'));
const commit='abcdef012345',full='65efa82e06158f9616172144c3c9efdd8088f227',native='ynx-network-surgical-'+full.slice(0,12),bft='ynx-bft-gateway-'+commit,tx='native-helper-controls';
const source=path.join(tmp,'source'),evidence=path.join(tmp,'evidence'),freeze=path.join(tmp,'freeze.json'),pause=path.join(tmp,'pause.json');
const approved={commit,authoritativeCommit:full,authoritativeRelease:native,authoritativeBinarySha256:'a'.repeat(64),authoritativeSource:{statePath:'/var/lib/ynx-chain/testnet/devnet-state.json',integrityMarkerPath:'/var/lib/ynx-chain/testnet/devnet-state.integrity-version',pauseMarkerPath:'/var/lib/ynx-chain/block-production-pause.json',mutationMarkerPath:'/var/lib/ynx-chain/mutation-freeze.json'}};
const observed={version:'YNX-PUBLIC-BFT-NATIVE-IDENTITY/v1',transactionId:tx,commit,role:'primary',authoritativeCommit:full,authoritativeRelease:native,authoritativeBinarySha256:approved.authoritativeBinarySha256,dataPath:'/var/lib/ynx-chain/testnet',pauseMarkerPath:approved.authoritativeSource.pauseMarkerPath,mutationMarkerPath:approved.authoritativeSource.mutationMarkerPath,mainPid:'123',runningExecutablePath:'/original/bin/ynx-chaind',runningExecutableDeviceInode:'2049:1234',unitSHA256:'b'.repeat(64),readOnly:true,deployment:false,nativeRootAuthorized:false};
validateAuthoritativeObservation(observed,approved,'primary',tx);
for(const [name,value]of [['transactionId','another-transaction'],['commit','0'.repeat(12)],['role','seoul'],['authoritativeBinarySha256','f'.repeat(64)],['dataPath','/different-db'],['readOnly',false]])assert.throws(()=>validateAuthoritativeObservation({...observed,[name]:value},approved,'primary',tx));
assert.throws(()=>validateAuthoritativeObservation(observed,approved,'primary','another-transaction'));
const systemd={fragmentSha256:'b'.repeat(64),dropIns:[
  {path:'/etc/systemd/system/ynx-chaind.service.d/90-core-ecosystem-20260912.conf',sha256:'c'.repeat(64)},
  {path:'/etc/systemd/system/ynx-chaind.service.d/99-native-controls.conf',sha256:'d'.repeat(64)}]};
const systemdApproval={...approved,authoritativeSystemd:systemd},systemdObservation={...observed,authoritativeSystemd:structuredClone(systemd)};
assert.deepEqual(authoritativeIdentity(systemdApproval).authoritativeSystemd,systemd);
validateAuthoritativeObservation(systemdObservation,systemdApproval,'primary',tx);
assert.throws(()=>validateAuthoritativeObservation(systemdObservation,approved,'primary',tx));
assert.throws(()=>validateAuthoritativeObservation(observed,systemdApproval,'primary',tx));
assert.throws(()=>validateAuthoritativeObservation({...systemdObservation,unitSHA256:'f'.repeat(64)},systemdApproval,'primary',tx));
for(const profile of [null,{}, {...systemd,extra:true}, {...systemd,fragmentSha256:'0'.repeat(64)},
    {...systemd,dropIns:[...systemd.dropIns].reverse()}, {...systemd,dropIns:[systemd.dropIns[0],systemd.dropIns[0]]},
    {...systemd,dropIns:Array(17).fill(systemd.dropIns[0])}, {...systemd,dropIns:[{path:systemd.dropIns[0].path}]},
    ...['/tmp/foreign.conf',"/etc/systemd/system/ynx-chaind.service.d/inject';id.conf",'/etc/systemd/system/ynx-chaind.service.d/../other.conf',systemd.dropIns[0].path+'\n']
      .map(path=>({...systemd,dropIns:[{path,sha256:'c'.repeat(64)}]}))]){
  assert.throws(()=>authoritativeSystemdIdentity(profile));
  assert.throws(()=>authoritativeIdentity({...approved,authoritativeSystemd:profile}));
}
for(const profile of [{...systemd,fragmentSha256:'e'.repeat(64)}, {...systemd,dropIns:[]},
    {...systemd,dropIns:[{...systemd.dropIns[0],sha256:'e'.repeat(64)},systemd.dropIns[1]]}])
  assert.throws(()=>validateAuthoritativeObservation({...systemdObservation,authoritativeSystemd:profile},systemdApproval,'primary',tx));
const copied=authoritativeIdentity(systemdApproval);copied.authoritativeSystemd.dropIns[0].sha256='f'.repeat(64);
assert.equal(systemd.dropIns[0].sha256,'c'.repeat(64));assert.equal(Object.keys(copied.authoritativeSource).length,4);
const primary=JSON.parse(JSON.stringify(approved));delete primary.commit;
const roleNames=['primary','singapore','silicon-valley','seoul'];
const mixed={...approved,authoritativeRoles:Object.fromEntries(roleNames.map((role,index)=>[role,index===0?primary:{...primary,authoritativeCommit:String(index).repeat(40),authoritativeRelease:'ynx-chain-'+String(index).repeat(12),authoritativeBinarySha256:String(index).repeat(64)}]))};
assert.equal(authoritativeRoleIdentities(mixed).authoritativeRoles.primary.authoritativeCommit,full);
const systemdMixed=structuredClone(mixed);systemdMixed.authoritativeSystemd=structuredClone(systemd);
systemdMixed.authoritativeRoles.primary.authoritativeSystemd=structuredClone(systemd);
systemdMixed.authoritativeRoles.singapore.authoritativeSystemd={fragmentSha256:'e'.repeat(64),dropIns:[]};
assert.deepEqual(roleAuthoritativeIdentity(systemdMixed,'primary').authoritativeSystemd,systemd);
assert.deepEqual(roleAuthoritativeIdentity(systemdMixed,'singapore').authoritativeSystemd,{fragmentSha256:'e'.repeat(64),dropIns:[]});
validateAuthoritativeObservation(systemdObservation,systemdMixed,'primary',tx);
const missingPrimary=structuredClone(systemdMixed);delete missingPrimary.authoritativeRoles.primary.authoritativeSystemd;
assert.throws(()=>authoritativeRoleIdentities(missingPrimary));
for(const role of roleNames){
  const own=roleAuthoritativeIdentity(mixed,role),actual={...observed,role,...own};delete actual.authoritativeSource;
  validateAuthoritativeObservation(actual,mixed,role,tx);
  if(role!=='primary')assert.throws(()=>validateAuthoritativeObservation({...observed,role},mixed,role,tx));
}
for(const mutate of [x=>{delete x.authoritativeRoles.seoul;},x=>{x.authoritativeRoles.extra=primary;},x=>{x.authoritativeRoles.primary=x.authoritativeRoles.singapore;},x=>{x.authoritativeRoles.singapore.authoritativeCommit='0'.repeat(40);},x=>{x.authoritativeRoles.singapore.authoritativeBinarySha256='0'.repeat(64);},x=>{x.authoritativeRoles.singapore.height='42';},x=>{x.authoritativeRoles.singapore.authoritativeSource={...x.authoritativeSource,pauseMarkerPath:'/other/pause.json'};}]){
  const bad=JSON.parse(JSON.stringify(mixed));mutate(bad);
  if(bad.authoritativeRoles.singapore?.authoritativeSource?.pauseMarkerPath==='/other/pause.json')assert.throws(()=>validateAuthoritativeObservation({...observed,role:'singapore',...bad.authoritativeRoles.singapore},bad,'singapore',tx));
  else assert.throws(()=>authoritativeRoleIdentities(bad));
}
const write=(p,raw)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,raw,{flag:'wx',mode:0o600});};
write(path.join(source,'var/lib/ynx-chain/testnet/devnet-state.json'),'ORIGINAL DATA FIXTURE\n');
write(path.join(source,'etc/ynx/ynx-chaind.env'),`YNX_MUTATION_FREEZE_FILE=${freeze}\nYNX_BLOCK_PRODUCTION_PAUSE_FILE=${pause}\n`);
for(const service of ['chaind','faucetd','ai-gatewayd','payd','trustd','resourced'])write(path.join(source,'etc/systemd/system/ynx-'+service+'.service'),'EnvironmentFile=/etc/ynx/ynx-chaind.env\n');
const original=fs.readFileSync(path.join(source,'var/lib/ynx-chain/testnet/devnet-state.json'));
const requests=[];
const server=http.createServer((req,res)=>{requests.push([req.method,req.url]);res.setHeader('Content-Type','application/json');
  if(req.method==='GET'&&req.url==='/status'){res.end('{"height":41}');return;}
  if(req.method==='POST'&&req.url==='/evm'){res.end('{"jsonrpc":"2.0","id":1,"result":"0x1917"}');return;}
  if(req.method==='POST'&&req.url==='/__ynx_mutation_freeze_probe__'){res.statusCode=fs.existsSync(freeze)?503:400;res.end(fs.existsSync(freeze)?'{"status":"mutation_frozen"}':'{}');return;}
  res.statusCode=404;res.end('{}');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
const helper=name=>path.join(repo,'scripts/ops/remote/public-bft-'+name+'.sh');
async function call(name,args,ok=true){let result;try{result=await run('bash',[helper(name),...args],{timeout:15000,maxBuffer:1<<20});}catch(error){if(ok)throw error;assert.notEqual(error.code,0);return error;}assert.equal(ok,true,'invalid native helper input accepted');return result;}
try{
  // Normal rehearsal/recovery validators consume mixed, explicitly pinned
  // role observations. These are serializer/transport DATA doubles, never a
  // deployed process or an authorization packet.
  const observations=path.join(tmp,'mixed-role-observations'),approvalFile=path.join(tmp,'mixed-role-approval.json');
  write(approvalFile,JSON.stringify(mixed)+'\n');
  const addresses={primary:'ynx_validator_primary',singapore:'ynx_validator_singapore','silicon-valley':'ynx_validator_silicon_valley',seoul:'ynx_validator_seoul'};
  write(path.join(observations,'prebuilt.sha256'),['a','b','c','d'].map(x=>'1'.repeat(64)+'  '+x).join('\n')+'\n');
  for(const [index,role]of roleNames.entries()){
    const own=roleAuthoritativeIdentity(mixed,role),roleDir=path.join(observations,'roles',role);
    const status={chainId:6423,nativeCurrencySymbol:'YNXT',build:{commit:own.authoritativeCommit.slice(0,12),release:own.authoritativeRelease},nodeIdentity:{validatorAddress:addresses[role],replicationMode:role==='primary'?'authoritative_producer':'authoritative_follower',blockProductionEnabled:role==='primary'},height:40+index};
    const observation={...observed,role,authoritativeCommit:own.authoritativeCommit,authoritativeRelease:own.authoritativeRelease,authoritativeBinarySha256:own.authoritativeBinarySha256};
    const block={height:40,hash:'2'.repeat(64)};
    write(path.join(roleDir,'status.json'),JSON.stringify(status)+'\n');write(path.join(roleDir,'block.json'),JSON.stringify(block)+'\n');write(path.join(roleDir,'native-identity.json'),JSON.stringify(observation)+'\n');
    write(path.join(roleDir,'preflight.txt'),[`role=${role}`,`validator=${addresses[role]}`,`release=${own.authoritativeRelease}`,'services=active','overlay=active','keys=restricted','candidate=absent','freeze=absent','ports=free','disk=ready','backup=present',`native_running_sha256=${own.authoritativeBinarySha256}`].join('\n')+'\n');
    write(path.join(observations,'roles',role+'-before-status.json'),JSON.stringify(status)+'\n');write(path.join(observations,'roles',role+'-after-status.json'),JSON.stringify({...status,height:status.height+1})+'\n');
    for(const stage of ['before','after'])write(path.join(observations,'roles',role+'-'+stage+'-native-identity.json'),JSON.stringify(observation)+'\n');
    write(path.join(observations,'roles',role+'-block.json'),JSON.stringify(block)+'\n');write(path.join(observations,'roles',role+'-recovery.txt'),[`role=${role}`,'freeze=absent','services=active','status_read=200','evm_read=200','mutations=unfrozen'].join('\n')+'\n');
  }
  for(const name of ['rehearsal','recovery']){
    const args=[path.join(repo,'scripts/verify/validate-public-bft-production-'+name+'.mjs'),observations,full.slice(0,12),native,approvalFile,tx];
    const result=await run(process.execPath,args,{timeout:10000,maxBuffer:1<<20});assert.equal(JSON.parse(result.stdout).status,'passed');
    const file=name==='rehearsal'?path.join(observations,'roles/singapore/status.json'):path.join(observations,'roles/singapore-before-status.json'),originalStatus=fs.readFileSync(file),bad=JSON.parse(originalStatus);bad.build={commit:full.slice(0,12),release:native};fs.writeFileSync(file,JSON.stringify(bad)+'\n');
    await assert.rejects(run(process.execPath,args,{timeout:10000,maxBuffer:1<<20}),/release mismatch/);assert.deepEqual(fs.readFileSync(file),Buffer.from(JSON.stringify(bad)+'\n'));fs.writeFileSync(file,originalStatus);
  }
  const backup=[tx,'primary',commit,native,bft,evidence,'false',source,full];
  const retainedRoot=path.join(tmp,'retained-backup'),retainedPartial=path.join(retainedRoot,'.primary.tar.gz.partial');write(retainedPartial,'ORIGINAL UNKNOWN BACKUP\n');
  const blocked=await call('scoped-backup',[...backup.slice(0,5),retainedRoot,...backup.slice(6)],false);assert.match(blocked.stderr,/existing native backup\/partial\/UNKNOWN/);assert.equal(fs.readFileSync(retainedPartial,'utf8'),'ORIGINAL UNKNOWN BACKUP\n');assert.equal(fs.existsSync(path.join(retainedRoot,'primary.tar.gz')),false);
  await call('scoped-backup',backup);
  const savedBackup=JSON.parse(fs.readFileSync(path.join(evidence,'primary.json')));assert.equal(savedBackup.commit,commit);assert.equal(savedBackup.authoritativeCommit,full);assert.equal(savedBackup.authoritativeRelease,native);assert.equal(savedBackup.validated,true);
  const sg=roleAuthoritativeIdentity(mixed,'singapore'),sgBackupRoot=path.join(tmp,'singapore-backup');
  await call('scoped-backup',[tx,'singapore',commit,sg.authoritativeRelease,bft,sgBackupRoot,'false',source,sg.authoritativeCommit]);
  const sgBackup=JSON.parse(fs.readFileSync(path.join(sgBackupRoot,'singapore.json')));assert.equal(sgBackup.authoritativeCommit,sg.authoritativeCommit);assert.equal(sgBackup.authoritativeRelease,sg.authoritativeRelease);assert.notEqual(sgBackup.authoritativeCommit,savedBackup.authoritativeCommit);
  const frozen=['freeze',tx,'primary',commit,native,bft,freeze,evidence,url,url,source,full];
  await call('mutation-freeze',frozen);
  const originalFreeze=fs.readFileSync(freeze),record=JSON.parse(originalFreeze);assert.equal(record.commit,commit);assert.equal(record.authoritativeCommit,full);assert.equal(record.authoritativeRelease,native);
  const paused=['pause',tx,commit,native,bft,pause,freeze,evidence,url,source,'1',full];
  await call('authoritative-pause',paused);
  const originalPause=fs.readFileSync(pause),pauseRecord=JSON.parse(fs.readFileSync(path.join(evidence,'primary-pause-authoritative.json')));
  assert.equal(pauseRecord.heightBefore,41);assert.equal(pauseRecord.heightAfter,41);assert.equal(pauseRecord.authoritativeCommit,full);
  for(const [name,args] of [['scoped-backup',backup.slice(0,-1)],['mutation-freeze',frozen.slice(0,-1)],['authoritative-pause',paused.slice(0,-1)],['mutation-freeze',[...frozen.slice(0,-1),'f'.repeat(40)]],['authoritative-pause',[...paused.slice(0,-1),'bad']]]){
    const count=requests.length;await call(name,args,false);assert.equal(requests.length,count,'invalid native identity reached HTTP');
    assert.deepEqual(fs.readFileSync(freeze),originalFreeze);assert.deepEqual(fs.readFileSync(pause),originalPause);
  }
  const wrong=JSON.stringify({...record,authoritativeCommit:'f'.repeat(40)})+'\n';fs.writeFileSync(freeze,wrong);
  await call('mutation-freeze',['unfreeze',...frozen.slice(1)],false);await call('authoritative-pause',paused,false);
  assert.equal(fs.readFileSync(freeze,'utf8'),wrong);assert.deepEqual(fs.readFileSync(pause),originalPause);
  const badPause=JSON.stringify({...JSON.parse(originalPause),authoritativeCommit:'f'.repeat(40)})+'\n';fs.writeFileSync(pause,badPause);
  const priorReads=requests.length;await call('authoritative-pause',['resume',...paused.slice(1)],false);assert.equal(requests.length,priorReads);assert.equal(fs.readFileSync(pause,'utf8'),badPause);
  assert.deepEqual(fs.readFileSync(path.join(source,'var/lib/ynx-chain/testnet/devnet-state.json')),original);
  assert.ok(requests.every(([method,url])=>method==='GET'&&url==='/status'||method==='POST'&&(url==='/evm'||url==='/__ynx_mutation_freeze_probe__')));
  console.log('PUBLIC_BFT_NATIVE_HELPERS_DATA_ONLY: original backup/freeze/pause entry points; independent native commit; unchanged original bytes; no real service/ledger');
}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(tmp,{recursive:true,force:true});}
NODE
