#!/usr/bin/env python3
"""Normal capsule caller controls; inert DATA and explicit remote-boundary model.

No SSH, crypto provider, credential, Go, key generation or service is used.
The unchanged original full eight-ELF parser consumes the existing inert fixture.
The separate pipe control executes the exact production FD3 command with two
bounded inert process doubles; it does not qualify a real host/custodian.
"""
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
COMMIT = 'abcdef0123456789abcdef0123456789abcdef01'
ROLES = ('primary', 'singapore', 'silicon-valley', 'seoul')
REQUIRED_MARKER = 'PQ_CAPSULE_OPS_REQUIRED_CONTROLS_DATA_ONLY: 16 tops; no real credential, crypto, SSH, signing or host qualification'
REQUIRED_HOOK = 'python3 -B "$repo/scripts/ops/test_consensus_recovery_capsule.py" --required-controls | tee "$tmp/capsule-controls.stdout"'
REQUIRED_ASSERTION = 'test "$(grep -Fxc '+shlex.quote(REQUIRED_MARKER)+' "$tmp/capsule-controls.stdout")" -eq 1'
REQUIRED_NAMES = (
    'CapsuleOpsControls.test_export_complete_public_transport',
    'CapsuleOpsControls.test_verify_all_four_fixed_custodians',
    'CapsuleOpsControls.test_missing_changed_and_cross_phase_inputs_refused',
    'CapsuleOpsControls.test_verify_manifest_independent_pins_and_aad',
    'CapsuleOpsControls.test_late_failure_and_lost_ack_retain_without_replay',
    'CapsuleOpsControls.test_no_authority_incomplete_hrs_or_changed_aad_receipt',
    'CapsuleOpsControls.test_export_readback_unknown_retains_same_attempt',
    'CapsuleOpsControls.test_alias_and_foreign_runtime_never_reach_transport',
    'CapsuleOpsControls.test_dry_run_does_not_contact_host',
    'CapsuleOpsControls.test_real_fd3_pipeline_and_late_producer_exit',
    'CapsuleOpsControls.test_fixed_remote_guards_and_original_cli_options',
    'CapsuleOpsControls.test_new_epoch_original_public_bytes_feed_capsule',
    'CapsuleOpsControls.test_new_epoch_readback_failure_preserves_unknown',
    'CapsuleCIControls.test_normal_ci_required_entry',
    'CapsuleCIControls.test_trigger_and_mandatory_call_mutations',
    'CapsuleCIControls.test_required_result_rejects_missing_skip_or_failure',
)


def validate_ci_contract(workflow, verify):
    for block in (workflow.split('  push:\n',1)[1].split('  pull_request:\n',1)[0], workflow.split('  pull_request:\n',1)[1].split('  workflow_dispatch:\n',1)[0]):
        for name in ('scripts/ops/init-consensus-candidate-keys.sh', 'scripts/verify/init-consensus-candidate-keys-check.sh', 'scripts/ops/consensus-recovery-capsule.sh', 'scripts/ops/test_consensus_recovery_capsule.py'):
            assert block.count("      - '"+name+"'\n") == 1, 'normal caller/controls must trigger push and PR exactly once'
    assert workflow.count('\n          bash scripts/verify/init-consensus-candidate-keys-check.sh\n') == 1, 'original shell gate must run without an allow-failure suffix'
    assert verify.count(REQUIRED_HOOK) == 1 and verify.count(REQUIRED_ASSERTION) == 1
    assert verify.endswith(REQUIRED_HOOK+'\n'+REQUIRED_ASSERTION+'\n'), 'mandatory all-controls call and single success assertion required'
    assert 'set -Eeuo pipefail\n' in verify


def required_result_passed(result, expected):
    return result.wasSuccessful() and result.testsRun == expected and not result.skipped and not result.unexpectedSuccesses


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def write_json(path, value):
    raw = json.dumps(value, separators=(',', ':')).encode()
    path.write_bytes(raw)
    return digest(raw)


REMOTE_MODEL = r'''#!/usr/bin/env python3
import hashlib,json,os,pathlib,shlex,sys
root=pathlib.Path(os.environ['FIXTURE_ROOT']); command=sys.argv[-1]
target=next(x.split('@',1)[1].removesuffix('.invalid') for x in sys.argv[1:] if x.startswith('fixture@'))
def sha(raw): return hashlib.sha256(raw).hexdigest()
def mapped(path):
    assert path.startswith(('/var/tmp/ynx-consensus-pq-capsule-', '/var/tmp/ynx-consensus-pq-ceremony-', '/var/lib/ynx-fixture/'))
    return root/'hosts'/target/path.lstrip('/')
with (root/'events.jsonl').open('a') as f: f.write(json.dumps(dict(target=target,command=command))+'\n')
if command.startswith('umask 077; mkdir -m 0700 '):
    p=mapped(shlex.split(command)[-1]); p.parent.mkdir(parents=True,exist_ok=True); p.mkdir(mode=0o700)
elif command.startswith('umask 077; cat > '):
    p=mapped(shlex.split(command)[-1])
    with p.open('xb') as f: f.write(sys.stdin.buffer.read())
elif command.startswith('sudo -n /usr/bin/timeout --signal=TERM --kill-after=1 25 '):
    argv=shlex.split(command); args=argv[argv.index('--')+1:]
    if len(args)==13:
        phase,role,stage,binary,binary_pin,out,state,approval,input_pin,gp,credential_pin,recovery_parent,recovery_manifest=args
        assert phase=='pq-new-epoch' and role==target=='primary'
        assert sha((mapped(stage)/binary).read_bytes())==binary_pin
        assert sha((mapped(stage)/'public-input.json').read_bytes())==input_pin
        assert sha((mapped(stage)/'genesis.json').read_bytes())==gp
        body=sys.stdin.buffer.read(); (root/'new-epoch-remote-body.sh').write_bytes(body)
        d=mapped(out); h=mapped(state)
        d.parent.mkdir(parents=True,exist_ok=True); h.parent.mkdir(parents=True,exist_ok=True)
        d.mkdir(mode=0o700); h.mkdir(mode=0o700)
        b=json.loads((root/'binding.json').read_bytes()); b['SignerStatePath']=state+'/original-sign-state.json'
        binding=json.dumps(b,separators=(',',':')).encode(); (d/'validator-binding.json').write_bytes(binding)
        record=json.loads((root/'record.json').read_bytes()); record['binding']=b
        record['paths']=dict(directory=out,state=b['SignerStatePath'],binding=out+'/validator-binding.json',publicRecord=out+'/new-epoch-public.json')
        record['fileSHA256']={out+'/validator-binding.json':sha(binding)}
        raw=json.dumps(record,separators=(',',':')).encode(); (d/'new-epoch-public.json').write_bytes(raw)
        sys.stdout.buffer.write(raw+b'\n'); sys.exit(0)
    assert len(args)==17
    phase,role,selected,stage,binary,out,state,destination,operation,gp,bp,rp,cp,hp,producer,ap,mp=args
    assert selected==target and role in ('primary','singapore','silicon-valley','seoul')
    assert target==(role if phase=='export-recovery-capsule' else ('singapore' if role=='primary' else 'primary'))
    body=sys.stdin.buffer.read(); (root/'remote-body.sh').write_bytes(body)
    (root/'remote-argv.json').write_text(json.dumps(args))
    for name,pin in [('ynx-consensus-pq-key-init',binary),('genesis.json',gp),('binding.json',bp),('record.json',rp)]:
        assert sha((mapped(stage)/name).read_bytes())==pin
    if phase=='verify-recovery-capsule':
        for name,pin in [('capsule.tar',ap),('MANIFEST.json',mp)]: assert sha((mapped(stage)/name).read_bytes())==pin
    dest=mapped(destination); dest.parent.mkdir(parents=True,exist_ok=True); dest.mkdir(mode=0o700)
    capsule=(root/'archive.bin').read_bytes(); manifest=(root/'manifest.json').read_bytes()
    binding=json.loads((root/'binding.json').read_bytes())
    snap=dict(stateSHA256=hp,originalSignerStatePath=binding['SignerStatePath'],vaultAuthenticated=True,completeHRSValidated=True,publicStateOnly=True)
    for name in ('registryMembershipVerified','antiRollbackFreshness','offHostSourceVerified','signingReady','authorityGranted','filesWritten','signaturesProduced'): snap[name]=False
    result=dict(version='YNX-CONSENSUS-PQ-RECOVERY-CAPSULE/v1',operationId=operation,manifestSHA256=sha(manifest),archiveSHA256=sha(capsule),cryptographicRecoveryVerified=True,snapshot=snap)
    for name in ('offHostSourceVerified','registryMembershipVerified','antiRollbackFreshness','authorityGranted','signingReady','runtimeResume','signaturesProduced','epochCreated','originalHRSWritten'): result[name]=False
    bad=os.environ.get('MODEL_BAD_RESULT','')
    if bad=='authority': result['authorityGranted']=True
    if bad=='hrs': result['snapshot']['stateSHA256']='f'*64
    if bad=='aad': result['snapshot']['originalSignerStatePath']=destination+'/original-sign-state.json'
    if bad=='incomplete': result['snapshot']['completeHRSValidated']=False
    if phase=='export-recovery-capsule':
        (dest/'capsule.tar').write_bytes(capsule); (dest/'MANIFEST.json').write_bytes(manifest)
    (dest/'RESULT.json').write_text(json.dumps(result))
    print(json.dumps(result),flush=True)
    if os.environ.get('MODEL_LATE_FAIL')=='yes': sys.exit(7)
    if os.environ.get('MODEL_LOST_ACK')=='yes': sys.exit(255)
elif command.startswith('sudo -n /usr/sbin/runuser -u ynx-pq-signer -- /usr/bin/head -c '):
    args=shlex.split(command); cap=int(args[args.index('-c')+1]); p=mapped(args[-1])
    assert p.name in ('capsule.tar','MANIFEST.json','validator-binding.json','new-epoch-public.json')
    data=p.read_bytes()[:cap]
    if os.environ.get('MODEL_BAD_PUBLIC')=='yes' and p.name=='validator-binding.json': data+=b' '
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()
    if os.environ.get('MODEL_READBACK_LOST_ACK')=='yes': sys.exit(255)
else: raise AssertionError('unapproved model transport command')
'''


class CapsuleOpsControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='capsule-ops-controls-')
        cls.root = Path(cls.temporary.name).resolve()
        cls.repo = cls.root/'repo'
        for name in ('scripts/ops/init-consensus-candidate-keys.sh', 'scripts/ops/consensus-recovery-capsule.sh', 'scripts/ops/lib.sh', 'scripts/deploy/lib.sh', 'scripts/deploy/deploy-consensus-candidate.sh'):
            destination = cls.repo/name
            destination.parent.mkdir(parents=True, exist_ok=True)
            source = Path(os.environ['CAPSULE_TEST_CALLER']) if name.endswith('init-consensus-candidate-keys.sh') and os.environ.get('CAPSULE_TEST_CALLER') else REPO/name
            shutil.copyfile(source, destination)
        cls.bin = cls.root/'bin'; cls.bin.mkdir()
        (cls.bin/'git').write_text('#!/bin/sh\n[ "$*" = "rev-parse HEAD" ] || exit 90\nprintf "'+COMMIT+'\\n"\n')
        (cls.bin/'ssh').write_text(REMOTE_MODEL.replace('#!/usr/bin/env python3', '#!'+sys.executable, 1))
        (cls.bin/'python3').symlink_to(sys.executable)
        for path in (cls.bin/'git', cls.bin/'ssh'): path.chmod(0o700)
        # Reuse the existing normal CI inert full-runtime fixture verbatim.
        check = (REPO/'scripts/verify/init-consensus-candidate-keys-check.sh').read_text()
        fixture = check.split("<<'PQ_RUNTIME_DATA'\n", 1)[1].split('\nPQ_RUNTIME_DATA', 1)[0]
        cls.runtime = cls.root/'runtime'
        subprocess.run([sys.executable, '-B', '-', str(cls.runtime)], input=fixture, text=True, check=True, capture_output=True)
        cls.runtime_pin = digest((cls.runtime/'SOURCE.json').read_bytes())
        cls.binary_pin = json.loads((cls.runtime/'SOURCE.json').read_bytes())['binaries']['ynx-consensus-pq-key-init']['sha256']

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.case = self.root/self.id().split('.')[-1]; self.case.mkdir()
        self.binding = dict(SignerStatePath='/var/lib/ynx-fixture/primary/history/original-sign-state.json', Policy={'ChainID':'PUBLIC-FIXTURE-NOT-AUTHORITY'}, Epoch=1, MLDSA87PublicKey='INERT-PUBLIC-DATA', SLHDSASHA2256fPublicKey='INERT-PUBLIC-DATA')
        bp = write_json(self.case/'binding.json', self.binding)
        rp = write_json(self.case/'record.json', dict(format='YNX-CONSENSUS-PQ-CEREMONY-PUBLIC/v1', status='new_epoch_files_durable_registration_not_authorized', binding=self.binding, paths=dict(directory='/var/lib/ynx-fixture/primary/custody', state=self.binding['SignerStatePath'])))
        gp = write_json(self.case/'genesis.json', dict(purpose='INERT PUBLIC GENESIS DATA'))
        hp = digest(b'INERT COMPLETE-HRS TEST DATA; NO SIGNER')
        self.operation = 'pq-capsule-public-control'
        self.manifest = dict(schema='YNX_OFFHOST_RECOVERY_RECEIVE/v1',operationId=self.operation,purpose='NORMAL_ENCRYPTED_BACKUP_TRANSPORT',producer=dict(tool='ynx-consensus-pq-key-init',contract='YNX-CONSENSUS-PQ-RECOVERY-CAPSULE/v1',binarySHA256=self.binary_pin),epoch=dict(genesisSHA256=gp,chainId='PUBLIC-FIXTURE-NOT-AUTHORITY',epoch=1),members=[dict(path=p,sha256=h) for p,h in [('epoch/validator.encrypted','d'*64),('epoch/validator-binding.json',bp),('epoch/original-sign-state.json',hp),('epoch/new-epoch-public.json',rp),('epoch/new-epoch-intent.json','e'*64),('public/export-receipt.json','f'*64)]])
        mp = write_json(self.case/'manifest.json', self.manifest)
        archive = b'INERT ENCRYPTED-ARCHIVE TRANSPORT DATA; NOT A REAL CAPSULE\n'
        (self.case/'archive.bin').write_bytes(archive)
        envfile = self.case/'deploy.env'
        envfile.write_text('\n'.join(f'{prefix}_NODE_{suffix}={shlex.quote(value)}' for prefix,role in [('PRIMARY','primary'),('SG','singapore'),('SILICON_VALLEY','silicon-valley'),('SEOUL','seoul')] for suffix,value in [('HOST',role+'.invalid'),('USER','fixture'),('SSH_KEY',str(self.case/'inert-ssh-key'))])+'\n')
        self.env = dict(PATH=str(self.bin)+':/usr/bin:/bin', ENV_FILE=str(envfile), FIXTURE_ROOT=str(self.case), YNX_SSH_CONTROL_DIR=str(self.case/'control'), YNX_DEPLOY_CONNECTION_ATTEMPTS='5', YNX_DEPLOY_CONNECTION_RETRY_DELAY_SECONDS='0', CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED='yes', CONSENSUS_CANDIDATE_KEY_PHASE='export-recovery-capsule', CONSENSUS_CANDIDATE_KEY_ROLE='primary', CONSENSUS_CANDIDATE_RUNTIME_BUNDLE=str(self.runtime), CONSENSUS_CANDIDATE_RUNTIME_COMMIT=COMMIT, CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256=self.runtime_pin, CONSENSUS_CANDIDATE_KEY_WORK_ROOT=str(self.case/'work'), CONSENSUS_PQ_KEY_DIRECTORY='/var/lib/ynx-fixture/primary/custody', CONSENSUS_PQ_STATE_DIRECTORY='/var/lib/ynx-fixture/primary/history', CONSENSUS_PQ_BINDING=str(self.case/'binding.json'), CONSENSUS_PQ_BINDING_SHA256=bp, CONSENSUS_PQ_PUBLIC_RECORD=str(self.case/'record.json'), CONSENSUS_PQ_PUBLIC_RECORD_SHA256=rp, CONSENSUS_PQ_CONSENSUS_GENESIS=str(self.case/'genesis.json'), CONSENSUS_PQ_CONSENSUS_GENESIS_SHA256=gp, CONSENSUS_PQ_ENCRYPTED_CREDENTIAL_SHA256='c'*64, CONSENSUS_PQ_HRS_SHA256=hp, CONSENSUS_PQ_CAPSULE_PRODUCER_BINARY_SHA256=self.binary_pin, CONSENSUS_PQ_CAPSULE_OPERATION_ID=self.operation, CONSENSUS_PQ_CAPSULE_EXPORT_DIRECTORY='/var/lib/ynx-fixture/primary/export')
        self.archive_pin, self.manifest_pin = digest(archive), mp

    def run_caller(self):
        return subprocess.run(['/bin/bash', str(self.repo/'scripts/ops/init-consensus-candidate-keys.sh')], cwd=self.repo, env=self.env, capture_output=True, text=True, timeout=20)

    def events(self):
        path = self.case/'events.jsonl'
        return [json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []

    def verification(self, role='primary'):
        self.env.update(CONSENSUS_CANDIDATE_KEY_PHASE='verify-recovery-capsule', CONSENSUS_CANDIDATE_KEY_ROLE=role, CONSENSUS_PQ_KEY_DIRECTORY='', CONSENSUS_PQ_STATE_DIRECTORY='', CONSENSUS_PQ_CAPSULE_EXPORT_DIRECTORY='', CONSENSUS_PQ_CAPSULE_SCRATCH_DIRECTORY='/var/lib/ynx-fixture/'+role+'/scratch', CONSENSUS_PQ_CAPSULE_ARCHIVE=str(self.case/'archive.bin'), CONSENSUS_PQ_CAPSULE_ARCHIVE_SHA256=self.archive_pin, CONSENSUS_PQ_CAPSULE_MANIFEST=str(self.case/'manifest.json'), CONSENSUS_PQ_CAPSULE_MANIFEST_SHA256=self.manifest_pin)

    def test_export_complete_public_transport(self):
        result = self.run_caller()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual({e['target'] for e in self.events()}, {'primary'})
        self.assertEqual(len(self.events()), 8)
        self.assertEqual((self.case/'work/ciphertext/capsule.tar').read_bytes(), (self.case/'archive.bin').read_bytes())
        self.assertTrue((self.case/'work/public/primary.json').is_file())

    def test_verify_all_four_fixed_custodians(self):
        for role in ROLES:
            with self.subTest(role=role):
                self.verification(role)
                self.env['CONSENSUS_CANDIDATE_KEY_WORK_ROOT'] = str(self.case/('work-'+role))
                result = self.run_caller()
                self.assertEqual(result.returncode, 0, result.stderr)
                args = json.loads((self.case/'remote-argv.json').read_text())
                self.assertEqual(args[2], 'singapore' if role=='primary' else 'primary')
                self.assertEqual(args[5:7], ['', ''])
                self.assertEqual(args[13], self.env['CONSENSUS_PQ_HRS_SHA256'])

    def test_missing_changed_and_cross_phase_inputs_refused(self):
        original = self.env.copy()
        for name,value in [('CONSENSUS_PQ_ENCRYPTED_CREDENTIAL_SHA256',''), ('CONSENSUS_PQ_HRS_SHA256','0'*64), ('CONSENSUS_PQ_BINDING_SHA256','f'*64), ('CONSENSUS_PQ_PUBLIC_RECORD_SHA256','f'*64), ('CONSENSUS_PQ_CONSENSUS_GENESIS_SHA256','f'*64), ('CONSENSUS_PQ_CAPSULE_PRODUCER_BINARY_SHA256',''), ('CONSENSUS_PQ_CAPSULE_OPERATION_ID','normal-csp-primary-20261101t062410z-00038e'), ('CONSENSUS_PQ_CAPSULE_EXPORT_DIRECTORY','/var/lib/ynx-fixture/primary/history/sub'), ('CONSENSUS_PQ_CAPSULE_CREDENTIAL_PATH','/tmp/foreign'), ('CONSENSUS_PQ_EPOCH_REQUEST','/tmp/foreign'), ('CONSENSUS_CANDIDATE_KEY_ROLE','all'), ('CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME','yes'), ('CONSENSUS_PQ_CAPSULE_SCRATCH_DIRECTORY','/tmp/other')]:
            with self.subTest(field=name):
                self.env = dict(original, **{name:value})
                result = self.run_caller()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.events(), [])
                self.assertFalse((self.case/'work').exists())

    def test_verify_manifest_independent_pins_and_aad(self):
        self.verification()
        original = self.env.copy()
        for name,value in [('CONSENSUS_PQ_CAPSULE_ARCHIVE_SHA256','f'*64), ('CONSENSUS_PQ_CAPSULE_MANIFEST_SHA256','f'*64), ('CONSENSUS_PQ_CAPSULE_PRODUCER_BINARY_SHA256','f'*64), ('CONSENSUS_PQ_HRS_SHA256','f'*64), ('CONSENSUS_PQ_CAPSULE_OPERATION_ID','different-operation'), ('CONSENSUS_PQ_KEY_DIRECTORY','/tmp/new-aad'), ('CONSENSUS_PQ_CAPSULE_SCRATCH_DIRECTORY','/var/lib/ynx-fixture/primary/history')]:
            with self.subTest(field=name):
                self.env = dict(original, **{name:value})
                self.assertNotEqual(self.run_caller().returncode, 0)
                self.assertEqual(self.events(), [])

    def test_late_failure_and_lost_ack_retain_without_replay(self):
        for variable in ('MODEL_LATE_FAIL','MODEL_LOST_ACK'):
            with self.subTest(mode=variable):
                self.env.pop('MODEL_LATE_FAIL', None); self.env.pop('MODEL_LOST_ACK', None)
                self.env[variable]='yes'
                work = self.case/variable
                self.env['CONSENSUS_CANDIDATE_KEY_WORK_ROOT']=str(work)
                self.env['CONSENSUS_PQ_CAPSULE_EXPORT_DIRECTORY']='/var/lib/ynx-fixture/primary/'+variable
                self.assertNotEqual(self.run_caller().returncode, 0)
                self.assertTrue((work/'public/primary.json.partial').is_file())
                self.assertFalse((work/'public/primary.json').exists())
                before = self.events()
                self.assertNotEqual(self.run_caller().returncode, 0)
                self.assertEqual(self.events(), before)
                self.assertEqual(sum(e['command'].startswith('sudo -n /usr/bin/timeout') for e in before), 1 if variable=='MODEL_LATE_FAIL' else 2)

    def test_no_authority_incomplete_hrs_or_changed_aad_receipt(self):
        for mode in ('authority','hrs','aad','incomplete'):
            with self.subTest(mode=mode):
                work = self.case/('bad-'+mode)
                self.env.update(MODEL_BAD_RESULT=mode, CONSENSUS_CANDIDATE_KEY_WORK_ROOT=str(work), CONSENSUS_PQ_CAPSULE_EXPORT_DIRECTORY='/var/lib/ynx-fixture/primary/'+mode)
                self.assertNotEqual(self.run_caller().returncode, 0)
                self.assertTrue((work/'public/primary.json.partial').exists())
                self.assertFalse((work/'public/primary.json').exists())

    def test_export_readback_unknown_retains_same_attempt(self):
        self.env['MODEL_READBACK_LOST_ACK']='yes'
        result = self.run_caller()
        self.assertNotEqual(result.returncode, 0)
        work = self.case/'work'
        self.assertTrue((work/'public/primary.json.partial').is_file())
        self.assertEqual((work/'ciphertext/capsule.tar.partial').read_bytes(), (self.case/'archive.bin').read_bytes())
        self.assertFalse((work/'public/primary.json').exists())
        before = self.events()
        self.assertNotEqual(self.run_caller().returncode, 0)
        self.assertEqual(self.events(), before)
        self.assertEqual(sum(e['command'].startswith('sudo -n /usr/sbin/runuser') for e in before), 1)

    def test_alias_and_foreign_runtime_never_reach_transport(self):
        original = self.env.copy()
        alias = self.case/'binding-alias.json'; alias.symlink_to(self.case/'binding.json')
        hardlink = self.case/'binding-hardlink.json'; hardlink.hardlink_to(self.case/'binding.json')
        for name,value in [('CONSENSUS_PQ_BINDING',str(alias)),('CONSENSUS_PQ_BINDING',str(hardlink)),('CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256','f'*64),('CONSENSUS_CANDIDATE_RUNTIME_COMMIT','0'*40)]:
            with self.subTest(field=name, value=value):
                if name.startswith('CONSENSUS_CANDIDATE') and hardlink.exists(): hardlink.unlink()
                self.env = dict(original, **{name:value})
                self.assertNotEqual(self.run_caller().returncode, 0)
                self.assertEqual(self.events(), [])
                self.assertFalse((self.case/'work').exists())

    def test_dry_run_does_not_contact_host(self):
        self.env['DEPLOY_DRY_RUN']='1'
        result = self.run_caller()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events(), [])
        self.assertIn('no credential, SSH, recovery or authority', result.stdout)

    def test_real_fd3_pipeline_and_late_producer_exit(self):
        helper = (REPO/'scripts/ops/consensus-recovery-capsule.sh').read_text()
        line = next(x for x in helper.splitlines() if x.startswith('/usr/bin/systemd-creds decrypt '))
        self.assertIn('exec 3<&0; exec 0</dev/null; exec "$@"', line)
        decrypt = self.case/'decrypt'; runuser = self.case/'runuser'; cli = self.case/'inert-cli'
        decrypt.write_text('#!/bin/sh\nprintf "INERT PIPE CONTROL - NOT A CREDENTIAL"\n[ ! -f "'+str(self.case/'producer-fails')+'" ]\n')
        runuser.write_text('#!/bin/sh\n[ "$1" = -u ] && [ "$2" = ynx-pq-signer ] && [ "$3" = -- ] || exit 80\nshift 3\nexec "$@"\n')
        cli.write_text('#!'+sys.executable+'\nimport os,pathlib,sys\nassert sys.argv[1:]==["--recovery-fd","3"]\nassert os.read(0,1)==b""\nassert os.read(3,80)==b"INERT PIPE CONTROL - NOT A CREDENTIAL"\nassert os.read(3,1)==b""\npathlib.Path('+repr(str(self.case/'consumer-completed'))+').write_text("INERT FD CONTROL COMPLETED")\n')
        for path in (decrypt,runuser,cli): path.chmod(0o700)
        actual = line.replace('/usr/bin/systemd-creds', shlex.quote(str(decrypt))).replace('/usr/sbin/runuser', shlex.quote(str(runuser)))
        body = 'set -Eeuo pipefail\nstage='+shlex.quote(str(self.case))+'\nbinary=inert-cli\ncredential=INERT-NONFILE\nargs=(--recovery-fd 3)\n'+actual+'\n'
        good = subprocess.run(['/bin/bash','-c',body], capture_output=True, timeout=5)
        self.assertEqual(good.returncode, 0, good.stderr)
        self.assertEqual(good.stdout, b'')
        (self.case/'producer-fails').write_text('INERT LATE FAILURE')
        bad = subprocess.run(['/bin/bash','-c',body], capture_output=True, timeout=5)
        self.assertNotEqual(bad.returncode, 0)
        self.assertTrue((self.case/'consumer-completed').exists())
        self.assertEqual(bad.stdout, b'')

    def test_fixed_remote_guards_and_original_cli_options(self):
        helper = (REPO/'scripts/ops/consensus-recovery-capsule.sh').read_text()
        body = helper.split("<<'REMOTE_CAPSULE'\n",1)[1].split('\nREMOTE_CAPSULE',1)[0]
        for text in ('[[ $EUID == 0 && $(uname -s):$(uname -m) == Linux:x86_64 ]]', 'credential=/etc/credstore.encrypted/ynx-pq-recovery', 'credential="/etc/credstore.encrypted/ynx-pq-offhost/$role/ynx-pq-recovery"', 'expected=primary; [[ $role != primary ]] || expected=singapore', '== 0:600:1', '== "$uid:600:1"', '--producer-binary-sha256 "$producer_pin"', '--recovery-fd 3', '== "$credential_identity"', 'original-sign-state.json:$hrs_pin', '! -e $destination && ! -L $destination'):
            self.assertIn(text, body)
        for forbidden in ('KeyGen','--new-epoch','approve-first-validator-registration','systemctl','rm -','recovery-credential --'):
            self.assertNotIn(forbidden, body)
        self.assertIn('prepare_runtime_tool "$bundle" "$full_commit" "$runtime_manifest_pin" "$work" "$binary"', helper)
        self.assertIn('--kill-after=1 25', helper)

    def new_epoch(self):
        request = self.case/'request.json'
        request_pin = write_json(request, dict(purpose='INERT PUBLIC REQUEST DATA; NO KEYGEN'))
        self.env.update(CONSENSUS_CANDIDATE_KEY_PHASE='pq-new-epoch', CONSENSUS_PQ_EPOCH_REQUEST=str(request), CONSENSUS_PQ_EPOCH_REQUEST_SHA256=request_pin)

    def test_new_epoch_original_public_bytes_feed_capsule(self):
        self.new_epoch()
        result = self.run_caller()
        self.assertEqual(result.returncode, 0, result.stderr)
        work = self.case/'work'
        original_record = work/'public/primary.epoch-public.json'
        original_binding = work/'public/primary.binding.json'
        self.assertEqual((work/'public/primary.json').read_bytes(), original_record.read_bytes()+b'\n')
        self.assertNotEqual(digest((work/'public/primary.json').read_bytes()), digest(original_record.read_bytes()))
        self.assertEqual(original_binding.read_bytes(), (self.case/'binding.json').read_bytes())
        self.env.update(CONSENSUS_CANDIDATE_KEY_PHASE='export-recovery-capsule', CONSENSUS_CANDIDATE_KEY_WORK_ROOT=str(self.case/'export-work'), CONSENSUS_PQ_EPOCH_REQUEST='', CONSENSUS_PQ_EPOCH_REQUEST_SHA256='', CONSENSUS_PQ_BINDING=str(original_binding), CONSENSUS_PQ_BINDING_SHA256=digest(original_binding.read_bytes()), CONSENSUS_PQ_PUBLIC_RECORD=str(original_record), CONSENSUS_PQ_PUBLIC_RECORD_SHA256=digest(original_record.read_bytes()))
        # The unchanged capsule CLI enforces the on-disk record hash; the
        # original raw public handoff now supplies exactly that input.
        self.manifest['members'][3]['sha256'] = self.env['CONSENSUS_PQ_PUBLIC_RECORD_SHA256']
        self.manifest_pin = write_json(self.case/'manifest.json', self.manifest)
        result = self.run_caller()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.verification()
        self.env['CONSENSUS_CANDIDATE_KEY_WORK_ROOT']=str(self.case/'verify-work')
        result = self.run_caller()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_new_epoch_readback_failure_preserves_unknown(self):
        for mode in ('MODEL_READBACK_LOST_ACK','MODEL_BAD_PUBLIC'):
            with self.subTest(mode=mode):
                self.env.pop('MODEL_READBACK_LOST_ACK',None); self.env.pop('MODEL_BAD_PUBLIC',None)
                self.new_epoch()
                work = self.case/mode
                self.env.update({mode:'yes', 'CONSENSUS_CANDIDATE_KEY_WORK_ROOT':str(work), 'CONSENSUS_PQ_KEY_DIRECTORY':'/var/lib/ynx-fixture/primary/'+mode+'/custody','CONSENSUS_PQ_STATE_DIRECTORY':'/var/lib/ynx-fixture/primary/'+mode+'/history'})
                self.assertNotEqual(self.run_caller().returncode,0)
                self.assertTrue((work/'public/primary.json.partial').exists())
                self.assertFalse((work/'public/primary.json').exists())
                events=self.events()
                self.assertNotEqual(self.run_caller().returncode,0)
                self.assertEqual(self.events(),events)


class CapsuleCIControls(unittest.TestCase):
    def sources(self):
        path = Path(os.environ.get('CAPSULE_TEST_WORKFLOW',str(REPO/'.github/workflows/resource-market-ci.yml')))
        return path.read_text(), (REPO/'scripts/verify/init-consensus-candidate-keys-check.sh').read_text()

    def test_normal_ci_required_entry(self):
        validate_ci_contract(*self.sources())

    def test_trigger_and_mandatory_call_mutations(self):
        workflow, verify = self.sources()
        changes=[]
        for name in ('scripts/ops/init-consensus-candidate-keys.sh','scripts/verify/init-consensus-candidate-keys-check.sh','scripts/ops/consensus-recovery-capsule.sh','scripts/ops/test_consensus_recovery_capsule.py'):
            line="      - '"+name+"'\n"
            for start in (0,workflow.index('  pull_request:\n')):
                at=workflow.index(line,start)
                changes.extend([(workflow[:at]+workflow[at+len(line):],verify),(workflow[:at]+line+workflow[at:],verify)])
        command='          bash scripts/verify/init-consensus-candidate-keys-check.sh\n'
        changes.extend([(workflow.replace(command,''),verify),(workflow.replace(command,command.rstrip()+' || true\n'),verify),(workflow,verify.replace(REQUIRED_HOOK,'')),(workflow,verify.replace(REQUIRED_HOOK,REQUIRED_HOOK+' || true')),(workflow,verify.replace(REQUIRED_HOOK,REQUIRED_HOOK+'\n'+REQUIRED_HOOK)),(workflow,verify.replace(' --required-controls |',' |')),(workflow,verify.replace(REQUIRED_ASSERTION,'')),(workflow,verify.replace(REQUIRED_ASSERTION,REQUIRED_ASSERTION+' || true'))])
        for index, pair in enumerate(changes):
            with self.subTest(mutation=index):
                with self.assertRaises((AssertionError,IndexError,ValueError)): validate_ci_contract(*pair)

    def test_required_result_rejects_missing_skip_or_failure(self):
        result=unittest.TestResult(); result.testsRun=len(REQUIRED_NAMES)
        self.assertTrue(required_result_passed(result,len(REQUIRED_NAMES)))
        for name,value in [('testsRun',0),('testsRun',len(REQUIRED_NAMES)-1),('skipped',[('test','missing input')]),('failures',[('test','failure')]),('errors',[('test','error')]),('unexpectedSuccesses',['test'])]:
            with self.subTest(field=name):
                changed=unittest.TestResult(); changed.testsRun=len(REQUIRED_NAMES); setattr(changed,name,value)
                self.assertFalse(required_result_passed(changed,len(REQUIRED_NAMES)))


if __name__ == '__main__':
    if sys.argv[1:]==['--required-controls']:
        suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in (CapsuleOpsControls,CapsuleCIControls))
        def names(suite):
            for item in suite:
                if isinstance(item,unittest.TestSuite): yield from names(item)
                else: yield '.'.join(item.id().split('.')[-2:])
        observed=list(names(suite))
        if len(observed)!=len(REQUIRED_NAMES) or len(set(observed))!=len(observed) or set(observed)!=set(REQUIRED_NAMES):
            sys.exit('mandatory capsule controls inventory differs')
        result=unittest.TextTestRunner(verbosity=2).run(suite)
        if not required_result_passed(result,len(REQUIRED_NAMES)): sys.exit(1)
        print(REQUIRED_MARKER)
    else:
        unittest.main()
