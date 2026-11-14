#!/usr/bin/env python3
"""PUBLIC transport controls, not Linux math/deployment qualification.

The separate --actual-smoke entry consumes the CI's already built original
runtime and its fresh public proof fixture. Normal unittest mode never executes
ELF, SSH, a node, keys, services, or a mocked proof reported as real validation.
"""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location('public_tools',HERE/'public-bft-linux-public-tools.py')
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)
ROOT=HERE.parent.parent

class PublicBridgeControls(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='ynx-public-tools-controls-')
        self.root=Path(self.tmp.name).resolve()
        self.addCleanup(self.tmp.cleanup)
    def request(self,operation='inventory',arguments=None):
        return dict(version=m.VERSION,transaction='original-transaction-001',role='primary',
            runtime='/var/tmp/ynx-pq-runtime-source-primary-original/verified',commit='a'*40,sourceSHA256='b'*64,
            operation=operation,arguments=arguments or {},inputs=[],phase='initialize_candidate',destination='',
            transportSources={n:dict(bytes=1,sha256='c'*64) for n in ('controller.py','runtime-validator.sh','exporter-validator.sh')})
    def test_closed_request_no_arbitrary_command_or_cross_role(self):
        m.validate_request(self.request())
        mutations=[lambda r:r.update(command='/bin/sh'),lambda r:r.update(operation='sign'),lambda r:r.update(role='other'),
            lambda r:r.update(runtime='/etc/ynx/keys'),lambda r:r.update(runtime='/var/tmp/ynx-pq-runtime-source-seoul-original/verified'),
            lambda r:r.update(sourceSHA256='0'*64),lambda r:r.update(phase='../escape'),lambda r:r.update(arguments={'argv':['-h']})]
        for f in mutations:
            r=self.request();f(r)
            with self.subTest(r=r),self.assertRaises((ValueError,TypeError)):m.validate_request(r)
    def test_duplicate_and_nonfinite_json(self):
        for raw in (b'{"role":"primary","role":"seoul"}',b'{"x":NaN}',b'{}{}',b'"\xff"'):
            with self.subTest(raw=raw),self.assertRaises((ValueError,UnicodeError)):m.decode(raw)
    def test_public_stage_fixed_paths_and_no_services(self):
        for profile in ('initialize','deploy','gateway'):
            m.validate_request(self.request('stage-public',{'profile':profile}))
        for profile in ('start','sign','/etc','runtime','../deploy'):
            with self.subTest(profile=profile),self.assertRaises(ValueError):m.validate_request(self.request('stage-public',{'profile':profile}))
        r=self.request('stage-public',{'profile':'gateway'});r['role']='seoul';r['runtime']=r['runtime'].replace('-primary-','-seoul-')
        with self.assertRaises(ValueError):m.validate_request(r)
    def test_tar_links_traversal_duplicates_and_unknown_preserved(self):
        for kind in ('symlink','traversal','duplicate'):
            archive=self.root/(kind+'.tar')
            with tarfile.open(archive,'w',format=tarfile.USTAR_FORMAT) as out:
                n='../outside' if kind=='traversal' else 'input'
                info=tarfile.TarInfo(n)
                if kind=='symlink':info.type=tarfile.SYMTYPE;info.linkname='/etc/passwd'
                else:info.size=1
                out.addfile(info,None if kind=='symlink' else io.BytesIO(b'x'))
                if kind=='duplicate':out.addfile(info,io.BytesIO(b'x'))
            dest=m.fresh(self.root/kind)
            with self.subTest(kind=kind),self.assertRaises((ValueError,FileExistsError)):m.unpack(archive,dest)
            self.assertTrue(archive.exists());self.assertFalse((self.root/'outside').exists())
    def test_original_inode_alias_and_exclusive_output(self):
        source=self.root/'original';m.durable(source,b'PUBLIC')
        alias=self.root/'alias';alias.symlink_to(source)
        with self.assertRaises(ValueError):m.read(alias)
        target=self.root/'copy';m.checked_copy(source,target,m.read(source)[0])
        with self.assertRaises(FileExistsError):m.checked_copy(source,target,m.read(source)[0])
        self.assertEqual(target.read_bytes(),b'PUBLIC')
        os.link(source,self.root/'second-link')
        with self.assertRaises(ValueError):m.read(source)
    def test_exact_input_catalog_pin_and_plan_fail_before_math(self):
        inp=m.fresh(self.root/'inputs');m.durable(inp/'migration.json',b'{}')
        r=self.request('migration-summary');r['inputs']=[{'path':'inputs/migration.json',**m.read(inp/'migration.json')[0]}]
        m.validate_inputs(self.root,r)
        r['inputs'][0]['sha256']='e'*64
        with patch.object(m,'original_validator') as callee,self.assertRaises(ValueError):m.execute(self.root,r)
        callee.assert_not_called()
        m.durable(inp/'extra',b'x')
        with self.assertRaises(ValueError):m.validate_inputs(self.root,r)
    def test_proof_original_paths_and_context_bytes_never_rewritten(self):
        context=dict((k,'/original/public/'+k) for k in m.PROOF_FIELDS);context['runtimePlanFile']=''
        raw=m.encode(context);inputs=m.fresh(self.root/'inputs');m.durable(inputs/'context.json',raw);m.durable(inputs/'request.json',b'{}')
        for k,v in context.items():
            if v:m.durable(inputs/k,b'{}')
        r=self.request('proof',{'contextPath':'/original/public/trust-context.json','contextSHA256':m.sha(raw),'proofPaths':context})
        r['inputs']=[{**v,'path':'inputs/'+v['path']} for v in m.catalog(inputs)]
        m.validate_request(r);m.validate_inputs(self.root,r)
        self.assertEqual((inputs/'context.json').read_bytes(),raw)
        bad=copy.deepcopy(r);bad['arguments']['proofPaths']['migrationFile']='/different/migration'
        with self.assertRaises(ValueError):m.validate_inputs(self.root,bad)
        bad=copy.deepcopy(r);bad['arguments']['proofPaths']['stateFile']='/proc/self/mem'
        with self.assertRaises(ValueError):m.validate_request(bad)
    def test_partial_result_cannot_be_success_or_wrong_request(self):
        r=self.request();local=m.fresh(self.root/'case');remote=m.fresh(self.root/'remote');out=m.fresh(remote/'outputs')
        m.durable(out/'stdout',b'original\n');m.durable(out/'stderr',b'')
        record=dict(version=m.VERSION,requestSHA256='d'*64,role=r['role'],commit=r['commit'],sourceSHA256=r['sourceSHA256'],operation=r['operation'],exitCode=0,outputs=m.catalog(out),sourceGrant=False,deployment=False,runtimeStarted=False,mathStartedUnixNanoseconds=None,mathFinishedUnixNanoseconds=None)
        m.durable(remote/'RESULT.json',m.encode(record))
        m.pack(remote,m.catalog(remote),local/'response.tar')
        with self.assertRaises(ValueError):m.accept_result(local,r)
        self.assertTrue((local/'response.tar').exists());self.assertFalse((local/'RESULT.json').exists())
    def test_matching_result_preserves_nonzero_and_raw_stdout(self):
        r=self.request();local=m.fresh(self.root/'case');remote=m.fresh(self.root/'remote');out=m.fresh(remote/'outputs')
        raw=b'{"code":"PROOF_REJECTED"}\n';m.durable(out/'stdout',raw);m.durable(out/'stderr',b'')
        record=dict(version=m.VERSION,requestSHA256=m.sha(m.encode(r)),role=r['role'],commit=r['commit'],sourceSHA256=r['sourceSHA256'],operation=r['operation'],exitCode=1,outputs=m.catalog(out),sourceGrant=False,deployment=False,runtimeStarted=False,mathStartedUnixNanoseconds=None,mathFinishedUnixNanoseconds=None)
        m.durable(remote/'RESULT.json',m.encode(record));m.pack(remote,m.catalog(remote),local/'response.tar')
        files,status=m.accept_result(local,r);self.assertEqual(status,1);self.assertEqual((files/'stdout').read_bytes(),raw)
    def test_real_shell_exact_argv_adapter_default_and_optin(self):
        script='source "$1"; PUBLIC_BFT_LINUX_TOOL_ROLE=primary; public_bft_linux_tool(){ printf "%s\\n" "$@"; }; public_bft_package_call unused "${@:2}"'
        shell=HERE/'public-bft-linux-public-tools.sh'
        result=subprocess.run(['bash','-c',script,'test',str(shell),'-verify-migration-state','/public/migration.json','-migration-public-summary','json'],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout,'migration-summary\n/public/migration.json\n')
        result=subprocess.run(['bash','-c',script,'test',str(shell),'-verify-migration-state','/public/migration.json','-migration-public-summary','json-account'],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout,'migration-account-summary\n/public/migration.json\n')
        for args in (['-h'],['-verify-migration-state','/public/migration.json','-migration-public-summary','arbitrary'],['-verify-package','/x'],['-verify-package','/x','-operator-plan-hash','a'*64,'extra'],[';','id']):
            result=subprocess.run(['bash','-c',script,'test',str(shell),*args],capture_output=True,text=True)
            self.assertEqual(result.returncode,64);self.assertEqual(result.stdout,'')
        # Unconfigured Linux behavior is still the exact original executable.
        result=subprocess.run(['bash','-c','source "$1"; unset PUBLIC_BFT_LINUX_TOOL_ROLE; public_bft_package_call /usr/bin/printf "%s\\n" original','test',str(shell)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0);self.assertEqual(result.stdout,'original\n')
    def test_transport_has_no_retry_or_agent_and_read_is_nonexecuting(self):
        shell=(HERE/'public-bft-linux-public-tools.sh').read_text()
        self.assertIn('YNX_DEPLOY_CONNECTION_ATTEMPTS=1 ynx_ops_ssh',shell);self.assertIn('-a -o ForwardAgent=no',shell)
        read_branch=m.BOOTSTRAP.split("if action=='read':",1)[1].split("assert action=='execute'",1)[0]
        self.assertNotIn('execve',read_branch);self.assertNotIn('mkdir',read_branch);self.assertIn('COMPLETE.json',read_branch)
        self.assertNotIn('mount ',m.BOOTSTRAP)
    def test_owned_output_reader_preserves_nonzero_and_joins(self):
        case=m.fresh(self.root/'child')
        code=m.bounded_math(['/bin/sh','-c','printf original; printf denied >&2; exit 7','1'],case)
        self.assertEqual(code,7);self.assertEqual((case/'stdout').read_bytes(),b'original');self.assertEqual((case/'stderr').read_bytes(),b'denied')
    def test_owned_output_overflow_keeps_partial_and_reaps(self):
        case=m.fresh(self.root/'child')
        # A harmless local Python byte writer, explicitly not a Go verifier.
        command=['/bin/sh', '-c', 'exec "$1" -c "import os; os.write(1,bytes([120])*2097152)"', '1',sys.executable]
        children=[];popen=m.subprocess.Popen
        def started(*args,**kwargs):
            child=popen(*args,**kwargs);children.append(child);return child
        with patch.object(m.subprocess,'Popen',started),self.assertRaisesRegex(ValueError,'output exceeded'):m.bounded_math(command,case)
        self.assertTrue((case/'stdout').exists());self.assertFalse((case/'RESULT.json').exists())
        self.assertLessEqual((case/'stdout').stat().st_size,1<<20)
        self.assertIsNotNone(children[0].poll());self.assertTrue(children[0].stdout.closed);self.assertTrue(children[0].stderr.closed)
    def test_copy_exclusive_failure_closes_source_descriptor(self):
        source=self.root/'original';target=self.root/'existing';m.durable(source,b'PUBLIC');m.durable(target,b'keep')
        opened=[];original_open=m.os.open
        def tracked(path,*args,**kwargs):
            fd=original_open(path,*args,**kwargs)
            if path==source:opened.append(fd)
            return fd
        with patch.object(m.os,'open',tracked),self.assertRaises(FileExistsError):m.checked_copy(source,target,m.read(source)[0])
        for fd in opened:
            with self.assertRaises(OSError):os.fstat(fd)
        self.assertEqual(target.read_bytes(),b'keep')
    def test_full_runtime_identity_retains_closed_catalog_and_directories(self):
        bundle=m.fresh(self.root/'runtime');m.fresh(bundle/'operator')
        for name in (*m.BINARIES,'SOURCE.json'):m.durable(bundle/name,b'PUBLIC')
        for name in m.OPERATORS:m.durable(bundle/'operator'/name,b'PUBLIC')
        before=m.runtime_identity(bundle);self.assertEqual(m.runtime_identity(bundle),before)
        extra=bundle/'unapproved';m.durable(extra,b'PUBLIC')
        with self.assertRaisesRegex(ValueError,'catalog changed'):m.runtime_identity(bundle)
        # Removing only this test's own new file demonstrates the directory
        # identity also detects a transient extra member, not just final names.
        extra.unlink();self.assertNotEqual(m.runtime_identity(bundle),before)
        os.chmod(bundle/'operator',0o777)
        with self.assertRaisesRegex(ValueError,'became writable'):m.runtime_identity(bundle)
    def test_public_package_excludes_private_members_before_read_or_transport(self):
        package=m.fresh(self.root/'package');m.durable(package/'package-manifest.json',b'PUBLIC')
        role=package/'roles/primary/config';role.mkdir(parents=True,mode=0o700)
        m.durable(role/'genesis.json',b'PUBLIC')
        self.assertEqual(len(m.public_package_catalog(package)),2)
        private=role/'priv_validator_key.json';m.durable(private,b'not-a-key-test-only')
        with patch.object(m,'read') as read,self.assertRaisesRegex(ValueError,'nonpublic package member'):m.public_package_catalog(package)
        read.assert_not_called()
    def test_normal_full_validator_body_unchanged(self):
        # Select the original same function, not a duplicate weak parser.
        script=(ROOT/'scripts/deploy/deploy-consensus-candidate.sh').read_text()
        body=script.split('validate_runtime_bundle() {',1)[1].split('\n}\n',1)[0]
        self.assertIn('set(p.name for p in root.iterdir())',body)
        self.assertIn("{'SOURCE.json', 'operator'}",body)
        self.assertIn("header[:7] == b\'\\x7fELF\\x02\\x01\\x01\'",body)
        self.assertIn('original_validator(root, r)',(HERE/'public-bft-linux-public-tools.py').read_text())
    def test_stub_math_execution_preserves_exact_original_command_and_nonzero(self):
        # This exercises the real framing/copy/receipt path; the maths process
        # alone is a labelled stub and does not qualify a proof or fake ELF.
        bundle=m.fresh(self.root/'runtime');m.fresh(bundle/'operator')
        source={'binaries':{},'operator':{}}
        for name in m.BINARIES:
            m.durable(bundle/name,b'PUBLIC synthetic '+name.encode());source['binaries'][name]=m.read(bundle/name)[0]
        for name in m.OPERATORS:
            m.durable(bundle/'operator'/name,b'PUBLIC operator');source['operator'][name]=m.read(bundle/'operator'/name)[0]
        m.durable(bundle/'SOURCE.json',m.encode(source))
        root=m.fresh(self.root/'op');m.fresh(root/'inputs');m.durable(root/'inputs/migration.json',b'{}')
        r=self.request('migration-summary');r['sourceSHA256']=m.read(bundle/'SOURCE.json')[0]['sha256']
        r['inputs']=[{'path':'inputs/migration.json',**m.read(root/'inputs/migration.json')[0]}]
        for name in r['transportSources']:
            m.durable(root/name,b'original');r['transportSources'][name]=m.read(root/name)[0]
        m.durable(root/'request.json',m.encode(r))
        actual_original=m.original
        def map_original(path):
            return bundle if str(path)==r['runtime'] else actual_original(path)
        commands=[]
        def fake(command, target, input_file=None):
            commands.append(command)
            self.assertEqual((target/'public-root/inputs/migration.json').read_bytes(),b'{}')
            m.durable(target/'stdout',b'original nonzero stdout\n');m.durable(target/'stderr',b'rejected\n');return 1
        with patch.object(m,'original_validator') as validation,patch.object(m,'original',map_original),patch.object(m,'bounded_math',fake):
            self.assertEqual(m.execute(root,r),1)
        validation.assert_called_once()
        self.assertEqual(commands[0][:5],['/usr/bin/timeout','--signal=TERM','--kill-after=5','120','/usr/sbin/chroot'])
        self.assertEqual(commands[0][6:],['/tool/ynx-consensus-package','-verify-migration-state','/inputs/migration.json','-migration-public-summary','json'])
        self.assertTrue((root/'COMPLETE.json').is_file())
        receiver=m.fresh(self.root/'receiver');m.checked_copy(root/'response.tar',receiver/'response.tar',m.read(root/'response.tar',material=False)[0])
        out,status=m.accept_result(receiver,r);self.assertEqual(status,1);self.assertEqual((out/'stdout').read_bytes(),b'original nonzero stdout\n')
        with patch.object(m,'original_validator'),patch.object(m,'original',map_original),patch.object(m,'bounded_math') as child, self.assertRaises(FileExistsError):m.execute(root,r)
        child.assert_not_called()

    def test_normal_callers_are_connected_and_no_new_transaction_phase(self):
        driver=(HERE/'public-bft-production-driver.sh').read_text()
        self.assertIn('public_bft_package_call "$public_package_verifier"',driver)
        self.assertIn('proof-capture "$capture_root" "$capture_pin" "$source_plan_pin"',driver)
        self.assertIn('--export-receipt-dir "$delivery_case"',driver)
        self.assertNotIn('operator_light_capture_driver capture',driver)
        self.assertIn('/usr/bin/timeout --signal=TERM --kill-after=5 60 "$proof_verifier"',driver)
        self.assertIn('public_bft_linux_stage "$role" initialize',driver)
        self.assertIn('public_bft_linux_stage primary gateway',driver)
        self.assertIn('for file in ynx-comet ynx-consensus-package; do',driver)
        deploy=(ROOT/'scripts/deploy/deploy-consensus-candidate.sh').read_text()
        self.assertIn('public_bft_linux_stage "$role" deploy',deploy)
        self.assertIn('public_bft_linux_tool inventory',deploy)
        gate=(ROOT/'scripts/verify/consensus-candidate-deploy-gate.sh').read_text()
        self.assertIn('scripts/verify/public-bft-release-source.mjs',gate)
        self.assertIn('execute|continue-native|continue-pq-native',gate)
        self.assertNotIn('sourceEligible=true',gate)
        self.assertIn('verify_candidate_package',gate)
        fixture=(ROOT/'scripts/verify/public-bft-production-driver-check.sh').read_text()
        self.assertIn('source scripts/ops/public-bft-linux-public-tools.sh',fixture)

    def test_private_jail_temp_and_failed_public_scratch_retention(self):
        # Only the maths process is a labelled stub. This checks the actual
        # jail/receipt lifecycle, not Go package validation or Linux execution.
        bundle=m.fresh(self.root/'runtime');m.fresh(bundle/'operator')
        source={'binaries':{},'operator':{}}
        for group,names in (('binaries',m.BINARIES),('operator',m.OPERATORS)):
            for name in names:
                path=bundle/name if group=='binaries' else bundle/'operator'/name
                m.durable(path,b'PUBLIC synthetic '+name.encode());source[group][name]=m.read(path)[0]
        m.durable(bundle/'SOURCE.json',m.encode(source))
        host_tmp=m.fresh(self.root/'unrelated-host-temp');m.durable(host_tmp/'original',b'PUBLIC host sentinel')
        host_before=m.catalog(host_tmp)
        for status in (0,1):
            with self.subTest(exitCode=status):
                root=m.fresh(self.root/('operation-'+str(status)));m.fresh(root/'inputs')
                for name in ('migration.json','validators.json','operator-plan.json'):m.durable(root/'inputs'/name,b'{}')
                r=self.request('generate-package',{'genesisTime':'2026-01-01T00:00:00Z','planSHA256':m.sha(b'{}')})
                r['sourceSHA256']=m.read(bundle/'SOURCE.json')[0]['sha256']
                r['inputs']=[{'path':'inputs/'+v['path'],'bytes':v['bytes'],'sha256':v['sha256']} for v in m.catalog(root/'inputs')]
                for name in r['transportSources']:
                    m.durable(root/name,b'original');r['transportSources'][name]=m.read(root/name)[0]
                m.durable(root/'request.json',m.encode(r))
                actual_original=m.original
                def map_original(path):return bundle if str(path)==r['runtime'] else actual_original(path)
                def fake(command,target,input_file=None):
                    scratch=target/'public-root/tmp';info=scratch.lstat()
                    self.assertEqual(m.original(scratch),scratch)
                    self.assertEqual(info.st_mode&0o777,0o700);self.assertEqual(info.st_uid,os.geteuid())
                    self.assertEqual(list(scratch.iterdir()),[])
                    self.assertNotEqual((info.st_dev,info.st_ino),(host_tmp.stat().st_dev,host_tmp.stat().st_ino))
                    self.assertNotIn('TMPDIR',m.CLEAN_ENV)
                    temporary=m.fresh(scratch/'ynx-operator-public-config-synthetic')
                    m.durable(temporary/'config.toml',b'PUBLIC synthetic config')
                    if status==0:
                        (temporary/'config.toml').unlink();temporary.rmdir()
                    package=m.fresh(target/'public-root/package');m.durable(package/'public-partial',b'PUBLIC original')
                    m.durable(target/'stdout',b'');m.durable(target/'stderr',b'rejected\n' if status else b'')
                    return status
                with patch.dict(os.environ,{'TMPDIR':str(host_tmp)}),patch.object(m,'original_validator'),patch.object(m,'original',map_original),patch.object(m,'bounded_math',fake):
                    self.assertEqual(m.execute(root,r),status)
                self.assertEqual(m.catalog(host_tmp),host_before)
                self.assertEqual((root/'outputs/package/public-partial').read_bytes(),b'PUBLIC original')
                self.assertEqual(m.decode((root/'RESULT.json').read_bytes())['exitCode'],status)
                self.assertEqual(m.decode((root/'command.json').read_bytes())['mounts'],[])
                with tarfile.open(root/'response.tar') as archive:
                    self.assertFalse(any('/tmp/' in name or 'public-root' in name for name in archive.getnames()))
                self.assertEqual(bool(list((root/'public-root/tmp').iterdir())),status==1)
                with patch.object(m,'original_validator'),patch.object(m,'original',map_original),patch.object(m,'bounded_math') as child,self.assertRaises(FileExistsError):
                    m.execute(root,r)
                child.assert_not_called()

    def test_normal_ci_reuses_actual_same_job_tools_and_fresh_public_inputs(self):
        workflow=(ROOT/'.github/workflows/resource-market-ci.yml').read_text()
        start=workflow.index('      - name: Verify original Linux public math bridge with the same built tools\n')
        end=workflow.index('      - name: Retain original Linux public math bridge evidence\n',start)
        block=workflow[start:end]
        for value in ('timeout-minutes: 2','--actual-smoke','ynx-pq-linux-runtime-candidate','ynx-pq-offline-migration-tools','ynx-pq-proof-cli-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT','ynx-operator-cli-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT','ynx-consensus-operator-public-inputs'):
            self.assertIn(value,block)
        for forbidden in ('go build','go test','Node.Start','--trusting-period','ssh '):self.assertNotIn(forbidden,block)
        self.assertLess(workflow.index('id: pqproofcli'),start)
        self.assertLess(workflow.index('id: pqoperatorcli'),start)
        self.assertIn('timeout 25s python3 -B scripts/ops/test_public_bft_linux_public_tools.py -v',workflow)
        for section in (workflow.split('  push:',1)[1].split('  pull_request:',1)[0],workflow.split('  pull_request:',1)[1].split('  workflow_dispatch:',1)[0]):
            for name in ('public-bft-linux-public-tools.py','public-bft-linux-public-tools.sh','test_public_bft_linux_public_tools.py','test_public_bft_linux_release_gate.mjs'):
                self.assertIn("'scripts/ops/"+name+"'",section)


class PublicSuccessorControls(unittest.TestCase):
    setUp=PublicBridgeControls.setUp
    request=PublicBridgeControls.request
    # Inherit the already existing transport invariants; new controls exercise
    # the three observed failures. No real key, SSH, ELF or node is used.
    def prepare_data(self):
        tx=m.fresh(self.root/'original-transaction-001');parent=m.fresh(self.root/'外置 PUBLIC 数据')
        self.env=patch.dict(os.environ,{'PUBLIC_BFT_LINUX_TOOL_DATA_ROOT':str(parent),'PUBLIC_BFT_LINUX_TOOL_PHASE':'initialize_candidate'})
        self.env.start();self.addCleanup(self.env.stop)
        return tx,m.data_root(tx)

    def test_private_context_member_rejected_before_read_and_pack(self):
        tx,data=self.prepare_data();public=m.fresh(self.root/'self-declared-public')
        private=self.root/'priv_validator_key.json';m.durable(private,b'{"priv_key":"SYNTHETIC_SENTINEL_NO_REAL_KEY"}')
        context={k:str(private) for k in m.PROOF_FIELDS}
        context.update(version='YNX-CONSENSUS-PROOF-TRUST/v1',chainId='public-chain',scheduleHash='a'*64,
            consensusGenesisSHA256='b'*64,originalGenesisHash='c'*64,migrationStateHash='d'*64,runtimePlanHash='e'*64,
            engineHeight='12',engineAppHash='f'*64,expectedHeaderHeight='11',expectedBlockHash='a'*64,
            expectedStateHeight='10',expectedStateAppHash='b'*64,trustedLightBlockSHA256='c'*64,
            trustingPeriodNanoseconds='600000000000',maxClockDriftNanoseconds='1000000000',trustLevelNumerator='1',trustLevelDenominator='3')
        self.assertEqual(len(context),24)
        raw=m.encode(context);m.durable(public/'trust-context.json',raw);m.durable(public/'request.json',b'{}')
        # An adjacent self-made "public" catalog cannot qualify private bytes.
        m.durable(public/'delivery.json',m.encode({'publicDataOnly':True,'files':[]}))
        observed=[];read=m.read
        def seen(path,*a,**kw):
            observed.append(Path(path));return read(path,*a,**kw)
        with patch.object(m,'read',seen),patch.object(m,'pack') as pack,patch.object(m,'receive_transport') as transport,self.assertRaisesRegex(ValueError,'no original PUBLIC producer'):
            m.client([str(tx),'primary','/var/tmp/ynx-pq-runtime-source-primary-original/verified','a'*40,'b'*64,'proof',str(public/'trust-context.json'),m.sha(raw),str(public/'request.json')])
        self.assertNotIn(private,observed);pack.assert_not_called();transport.assert_not_called()
        self.assertFalse(any(data.rglob('request.tar')))

    def test_migration_arbitrary_selected_path_never_opened(self):
        tx,_=self.prepare_data();private=self.root/'migration.json';m.durable(private,b'{"priv_key":"SYNTHETIC"}')
        seen=[];original_read=m.read
        def read(path,*args,**kwargs):
            seen.append(Path(path));return original_read(path,*args,**kwargs)
        with patch.object(m,'read',read),self.assertRaisesRegex(ValueError,'outside the original'):
            m.original_migration(tx,private,'a'*40)
        self.assertNotIn(private,seen)

    def test_package_public_names_alone_do_not_make_producer(self):
        tx,_=self.prepare_data();package=m.fresh(self.root/'package');m.durable(package/'package-manifest.json',b'{}')
        with patch.object(m,'public_package_catalog') as material,self.assertRaisesRegex(ValueError,'successful public producer'):
            m.client([str(tx),'primary','/var/tmp/ynx-pq-runtime-source-primary-original/verified','a'*40,'b'*64,'verify-package',str(package),'c'*64])
        material.assert_not_called()

    def test_full_five_copy_bound_and_actual_filesystem_admission(self):
        real=683131154;self.assertEqual(real*5,3415655770);self.assertGreater(real*5,2<<30)
        r=self.request('generate-package',{'genesisTime':'2026-01-01T00:00:00Z','planSHA256':'c'*64})
        r['inputs']=[{'path':'inputs/migration.json','bytes':real,'sha256':'a'*64},{'path':'inputs/operator-plan.json','bytes':65536,'sha256':'b'*64},{'path':'inputs/validators.json','bytes':1455,'sha256':'c'*64}]
        self.assertGreaterEqual(m.output_bound(r),5*real);self.assertLess(m.output_bound(r),m.MAX_TOTAL)
        m.validate_request(r)
        class FS:
            f_frsize=1
            f_bavail=3332014080
        with patch.object(m.os,'statvfs',return_value=FS()),self.assertRaisesRegex(ValueError,'available=3332014080'):
            m.disk_required(self.root,m.operation_space(r),'local')
        FS.f_bavail=1312585269248
        with patch.object(m.os,'statvfs',return_value=FS()):
            actual=m.disk_required(self.root,m.operation_space(r),'external')
        self.assertEqual(actual['availableBytes'],1312585269248)
        self.assertGreater(actual['requiredBytes'],real*5*3)
        self.assertIn(str(m.MAX_ARCHIVE),m.BOOTSTRAP);self.assertIn(str(m.MAX_TOTAL),m.BOOTSTRAP)
        self.assertNotIn('2147483648',m.BOOTSTRAP)

    def test_external_utf8_data_path_and_original_journal_do_not_alias(self):
        tx,data=self.prepare_data();self.assertIn('外置',str(data));self.assertEqual(data.name,tx.name)
        before=(tx/'linux-public-data-root.json').read_bytes();self.assertEqual(m.data_root(tx),data)
        second=m.fresh(self.root/'different')
        with patch.dict(os.environ,{'PUBLIC_BFT_LINUX_TOOL_DATA_ROOT':str(second)}),self.assertRaisesRegex(ValueError,'no retarget'):m.data_root(tx)
        self.assertEqual((tx/'linux-public-data-root.json').read_bytes(),before)
        alias=self.root/'alias';alias.symlink_to(data.parent)
        with patch.dict(os.environ,{'PUBLIC_BFT_LINUX_TOOL_DATA_ROOT':str(alias)}),self.assertRaisesRegex(ValueError,'aliased'):m.data_root(tx)
        self.assertFalse((tx/'linux-public-tools').exists())

    def result_archive(self,request,parent):
        remote=m.fresh(parent/'remote');outputs=m.fresh(remote/'outputs')
        m.durable(outputs/'SOURCE.json',b'PUBLIC_SOURCE_ORIGINAL');m.durable(outputs/'stdout',b'original result\n');m.durable(outputs/'stderr',b'')
        result=dict(version=m.VERSION,requestSHA256=m.sha(m.encode(request)),role=request['role'],commit=request['commit'],sourceSHA256=request['sourceSHA256'],operation=request['operation'],exitCode=0,outputs=m.catalog(outputs),sourceGrant=False,deployment=False,runtimeStarted=False,mathStartedUnixNanoseconds=None,mathFinishedUnixNanoseconds=None)
        m.durable(remote/'RESULT.json',m.encode(result));archive=parent/'actual-public-response.tar';m.pack(remote,m.catalog(remote),archive)
        return archive

    def test_lost_ack_same_operation_restores_normal_destination(self):
        tx,data=self.prepare_data();work=m.fresh(data/'linux-public-tools');destination=self.root/'normal-caller-output'
        r=self.request();r['destination']=str(destination)
        r['transportSources']={name:m.read(path,1<<20,False)[0] for name,path in {'controller.py':HERE/'public-bft-linux-public-tools.py','runtime-validator.sh':ROOT/'scripts/deploy/deploy-consensus-candidate.sh','exporter-validator.sh':HERE/'remote/public-bft-final-snapshot.sh'}.items()}
        local=m.fresh(work/m.sha(m.encode(r)));m.durable(local/'request.json',m.encode(r));m.durable(local/'INTENT.json',b'UNKNOWN original');m.durable(local/'response.tar',b'original short response')
        archive=self.result_archive(r,self.root)
        def receive(command,stdin,output,errors,limit):
            self.assertEqual(command[-2:],['read','0']);self.assertIs(stdin,subprocess.DEVNULL)
            m.checked_copy(archive,output,m.read(archive,m.MAX_ARCHIVE,False)[0]);m.durable(errors,b'');return 0
        out=io.BytesIO();err=io.BytesIO()
        class Stream:
            def __init__(self,b):self.buffer=b
        with patch.object(m,'receive_transport',receive),patch.object(m.sys,'stdout',Stream(out)),patch.object(m.sys,'stderr',Stream(err)):
            self.assertEqual(m.reconcile(str(local)),0)
        self.assertEqual((destination/'SOURCE.json').read_bytes(),b'PUBLIC_SOURCE_ORIGINAL')
        self.assertEqual((local/'response.tar').read_bytes(),b'original short response');self.assertEqual((local/'INTENT.json').read_bytes(),b'UNKNOWN original')
        with patch.object(m,'receive_transport') as no_retry,patch.object(m.sys,'stdout',Stream(io.BytesIO())),patch.object(m.sys,'stderr',Stream(io.BytesIO())):
            self.assertEqual(m.client([str(tx),r['role'],r['runtime'],r['commit'],r['sourceSHA256'],'inventory',str(destination)]),0)
        no_retry.assert_not_called()
        (destination/'SOURCE.json').write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError,'destination changed'):m.retained_result(local,r)

    def test_reconcile_resumes_original_local_publication_without_second_read(self):
        tx,data=self.prepare_data();work=m.fresh(data/'linux-public-tools')
        r=self.request();r['destination']=str(self.root/'caller-restored')
        local=m.fresh(work/m.sha(m.encode(r)));m.durable(local/'request.json',m.encode(r))
        m.durable(local/'RECONCILE.json',m.encode(dict(exitCode=0,effect='read-only-original-result',automaticRetry=False)))
        archive=self.result_archive(r,self.root);recovered=m.fresh(local/'reconciled')
        outputs,status=m.accept_result(recovered,r,archive)
        actual=m.checked_copy
        def failed(source,destination,pin):
            if str(destination).startswith(r['destination']+'/'):raise OSError('synthetic publication IO failure')
            return actual(source,destination,pin)
        with patch.object(m,'checked_copy',failed),self.assertRaisesRegex(OSError,'publication IO'):
            m.publish_result(local,r,outputs,status,True)
        self.assertTrue((local/'DESTINATION-INTENT.json').exists());self.assertFalse((local/'PUBLISHED.json').exists())
        class Stream:
            buffer=io.BytesIO()
        with patch.object(m,'receive_transport') as transport,patch.object(m.sys,'stdout',Stream()),patch.object(m.sys,'stderr',Stream()):
            self.assertEqual(m.reconcile(str(local)),0)
        transport.assert_not_called();self.assertEqual((Path(r['destination'])/'SOURCE.json').read_bytes(),b'PUBLIC_SOURCE_ORIGINAL')
        self.assertTrue(m.decode((local/'PUBLISHED.json').read_bytes())['reconciled'])

    def test_reconcile_never_adopts_foreign_or_overwrites_partial(self):
        r=self.request();r['destination']=str(self.root/'existing');destination=m.fresh(Path(r['destination']));m.durable(destination/'SOURCE.json',b'foreign')
        local=m.fresh(self.root/'case');remote=m.fresh(self.root/'response');out=m.fresh(remote/'outputs');m.durable(out/'SOURCE.json',b'PUBLIC');m.durable(out/'stdout',b'');m.durable(out/'stderr',b'')
        m.durable(remote/'RESULT.json',b'{}')
        with self.assertRaises(FileExistsError):m.publish_result(local,r,out,0,True)
        self.assertEqual((destination/'SOURCE.json').read_bytes(),b'foreign');self.assertFalse((local/'PUBLISHED.json').exists())


    def public_delivery(self, runtime=True, mutation=None):
        root=m.fresh(self.root/('delivery-runtime' if runtime else 'delivery-bootstrap'))
        remote='/var/tmp/ynx-public-light-original-transaction-001-primary/delivery'
        context={k:remote+'/'+name for _,name,k in m.LIGHT_NAMES if k}
        if not runtime:context['runtimePlanFile']=''
        materials={name:b'PUBLIC_SYNTHETIC_'+name.encode() for role,name,_ in m.LIGHT_NAMES if role not in ('request','context') and (role!='runtime' or runtime)}
        context.update(version='YNX-CONSENSUS-PROOF-TRUST/v1',chainId='public-chain',scheduleHash='a'*64,
            consensusGenesisSHA256='b'*64,originalGenesisHash='c'*64,migrationStateHash='d'*64,runtimePlanHash='e'*64 if runtime else '',
            engineHeight='12',engineAppHash='f'*64,expectedHeaderHeight='11',expectedBlockHash='a'*64,
            expectedStateHeight='10',expectedStateAppHash='b'*64,trustedLightBlockSHA256=m.sha(materials['trusted-light-block.json']),
            trustingPeriodNanoseconds='600000000000',maxClockDriftNanoseconds='1000000000',trustLevelNumerator='1',trustLevelDenominator='3')
        if mutation:mutation(context)
        materials['request.json']=b'{"PUBLIC_DATA_ONLY":true}';materials['trust-context.json']=m.encode(context)
        files=[]
        for role,name,_ in m.LIGHT_NAMES:
            if role=='runtime' and not runtime:continue
            m.durable(root/name,materials[name]);files.append(dict(role=role,name=name,bytes=str(len(materials[name])),sha256=m.sha(materials[name])))
        manifest=dict(version='YNX-PQ-LIGHT-SOURCE-DELIVERY/v1',planSHA256='a'*64,engineHeight='12',engineAppHash='f'*64,
            verification={'classification':'synthetic-shape-only-no-math'},files=files,publicDataOnly=True)
        manifest_raw=m.encode(manifest);m.durable(root/'delivery.json',manifest_raw)
        receipt=dict(version='YNX-PQ-LIGHT-SOURCE-EXPORT/v1',planSHA256='a'*64,manifestPath=remote+'/delivery.json',manifestSHA256=m.sha(manifest_raw),
            contextPath=remote+'/trust-context.json',contextSHA256=m.sha(materials['trust-context.json']),requestPath=remote+'/request.json',requestSHA256=m.sha(materials['request.json']),
            engineHeight='12',engineAppHash='f'*64,verification=manifest['verification'],publicDataOnly=True,sourceReadOnly=True,nativeRootAuthorized=False,deploymentVerified=False)
        return root,remote,m.encode(receipt),m.sha(manifest_raw)

    def test_original_public_six_material_closed_catalog_and_raw_parity(self):
        root,remote,receipt,pin=self.public_delivery()
        original={p.name:p.read_bytes() for p in root.iterdir()}
        result,context,pins=m.light_delivery(root,remote,receipt,pin,'a'*64)
        self.assertEqual(len(pins),8);self.assertEqual(len([k for k in m.PROOF_FIELDS if context[k]]),6)
        self.assertEqual(original,{p.name:p.read_bytes() for p in root.iterdir()})
        empty,remote,receipt,pin=self.public_delivery(False)
        _,context,pins=m.light_delivery(empty,remote,receipt,pin,'a'*64)
        self.assertEqual(context['runtimePlanFile'],'');self.assertEqual(context['runtimePlanHash'],'');self.assertNotIn('runtime-plan.json',pins)

    def test_closed_export_context_escape_is_refused_before_material_read(self):
        root,remote,receipt,pin=self.public_delivery(mutation=lambda c:c.update(migrationFile='/private/priv_validator_key.json'))
        opened=[];read=m.read
        def observed(path,*a,**kw):opened.append(Path(path));return read(path,*a,**kw)
        with patch.object(m,'read',observed),self.assertRaisesRegex(ValueError,'outside the actual original PUBLIC'):
            m.light_delivery(root,remote,receipt,pin,'a'*64)
        self.assertNotIn(root/'migration.json',opened);self.assertNotIn(Path('/private/priv_validator_key.json'),opened)

    def test_actual_catalog_partial_extra_alias_and_renamed_private_bytes_reject(self):
        root,remote,receipt,pin=self.public_delivery()
        original=(root/'migration.json').read_bytes();(root/'migration.json').write_bytes(b'{"priv_key":"SYNTHETIC_RENAMED"}')
        with self.assertRaisesRegex(ValueError,'material changed'):m.light_delivery(root,remote,receipt,pin,'a'*64)
        (root/'migration.json').write_bytes(original)
        extra=root/'unexpected';m.durable(extra,b'PUBLIC')
        with self.assertRaisesRegex(ValueError,'extra or partial'):m.light_delivery(root,remote,receipt,pin,'a'*64)
        extra.unlink();(root/'migration.json').unlink();(root/'migration.json').symlink_to(root/'genesis.json')
        with self.assertRaisesRegex(ValueError,'symlink or aliased'):m.light_delivery(root,remote,receipt,pin,'a'*64)

    def test_reconciled_original_proof_keeps_absolute_expiry_and_clock_boundary(self):
        case=m.fresh(self.root/'original-proof');inputs=m.fresh(case/'inputs')
        context={k:'/original/public/'+k for k in m.PROOF_FIELDS};context.update(trustingPeriodNanoseconds='600000000000')
        m.durable(inputs/'context.json',m.encode(context));m.durable(inputs/'request.json',b'{}')
        for k in m.PROOF_FIELDS:
            raw=m.encode({'signed_header':{'header':{'time':'2026-11-08T01:00:00.000000123Z'}}}) if k=='trustedLightBlockFile' else b'PUBLIC'
            m.durable(inputs/k,raw)
        r=self.request('proof',{'contextPath':'/original/public/context.json','contextSHA256':m.sha(m.encode(context)),'proofPaths':{k:context[k] for k in m.PROOF_FIELDS}})
        r['inputs']=[{**v,'path':'inputs/'+v['path']} for v in m.catalog(inputs)]
        import calendar,datetime
        base=calendar.timegm(datetime.datetime(2026,11,8,1,0,0).utctimetuple())*1000000000+123
        result={'mathStartedUnixNanoseconds':str(base+100),'mathFinishedUnixNanoseconds':str(base+200)}
        with patch.object(m.time,'time_ns',return_value=base+300):
            guard=m.proof_reconcile_freshness(case,r,result)
        self.assertEqual(guard['trustExpiresUnixNanoseconds'],str(base+600000000000));self.assertFalse(guard['mathReexecuted'])
        for now in (base+199,base+600000000000,base+600000000001):
            with self.subTest(now=now),patch.object(m.time,'time_ns',return_value=now),self.assertRaisesRegex(ValueError,'historical DATA only'):
                m.proof_reconcile_freshness(case,r,result)
        self.assertEqual((inputs/'context.json').read_bytes(),m.encode(context))


    def test_same_origin_migration_request_never_uploads_full_body(self):
        tx,data=self.prepare_data();m.fresh(tx/'roles');m.fresh(tx/'final-snapshot');m.fresh(data/'final-snapshot')
        raw=b'PUBLIC synthetic migration transport only, not math'
        migration=data/'final-snapshot/migration.json';m.durable(migration,raw)
        evidence=dict(transactionId=tx.name,exporterCommit='a'*40,sha256=m.sha(raw),validated=True,sourceUnchanged=True,
            pauseVerified=True,mutationFreezeVerified=True,runtimeStarted=False,deployment=False)
        m.durable(tx/'final-snapshot/remote-evidence.json',m.encode(evidence))
        m.durable(tx/'roles/primary-export-final-snapshot.txt',('sha256='+m.sha(raw)+'\n').encode())
        calls=[]
        def receive(command,stream,out,err,limit):
            with tarfile.open(fileobj=stream,mode='r:') as archive:
                names=archive.getnames();request=m.decode(archive.extractfile('request.json').read())
                self.assertNotIn('inputs/migration.json',names)
                self.assertEqual(request['inputs'],[{'path':'inputs/migration.json','bytes':len(raw),'sha256':m.sha(raw)}])
                self.assertEqual(request['arguments'],{'migrationEvidenceSHA256':m.sha(m.encode(evidence))})
                calls.append(request)
            raise ValueError('controlled lost acknowledgement; no network')
        with patch.object(m,'receive_transport',receive),self.assertRaisesRegex(ValueError,'controlled lost acknowledgement'):
            m.client([str(tx),'primary','/var/tmp/ynx-pq-runtime-source-primary-original/verified','a'*40,'b'*64,'migration-summary',str(migration)])
        self.assertEqual(len(calls),1)
        local=data/'linux-public-tools'/m.sha(m.encode(calls[0]))
        self.assertFalse((local/'inputs/migration.json').exists());self.assertTrue((local/'INTENT.json').exists());self.assertFalse((local/'PUBLISHED.json').exists())
        self.assertEqual(migration.read_bytes(),raw)

    def test_same_origin_descriptors_cannot_select_other_role_or_free_path(self):
        r=self.request('migration-summary',{'migrationEvidenceSHA256':'a'*64});m.validate_request(r)
        r['role']='seoul';r['runtime']=r['runtime'].replace('-primary-','-seoul-')
        with self.assertRaisesRegex(ValueError,'original primary'):m.validate_request(r)
        for op in ('light-files','light-metadata','proof-capture'):
            a={'captureRoot':'/var/lib/ynx-chain/operator-transitions/original-transaction-001/primary/capture-attempt','captureReceiptSHA256':'a'*64,'sourcePlanSHA256':'b'*64}
            m.validate_request(self.request(op,a))
            for key,value in (('captureRoot','/etc/ynx/custody'),('sourcePlanSHA256','0'*64),('skipValidation',True)):
                bad={**a,key:value}
                with self.subTest(op=op,key=key),self.assertRaises(ValueError):m.validate_request(self.request(op,bad))

    def test_small_metadata_requires_all_original_public_catalog_pins(self):
        root,remote,receipt,pin=self.public_delivery()
        small=m.fresh(self.root/'metadata')
        for name in ('delivery.json','trust-context.json','request.json','trusted-light-block.json'):
            m.checked_copy(root/name,small/name,m.read(root/name)[0])
        result,context,pins=m.light_delivery(small,remote,receipt,pin,'a'*64,metadata_only=True)
        self.assertEqual(len(pins),8);self.assertFalse((small/'migration.json').exists())
        with self.assertRaisesRegex(ValueError,'extra or partial'):m.light_delivery(small,remote,receipt,pin,'a'*64)
        m.durable(small/'migration.json',b'SYNTHETIC_PRIV_KEY_SHAPE')
        with self.assertRaisesRegex(ValueError,'extra or partial'):m.light_delivery(small,remote,receipt,pin,'a'*64,metadata_only=True)

    def test_bounded_original_migration_retention_preserves_wrong_sha(self):
        tx,data=self.prepare_data();m.fresh(tx/'roles');m.fresh(tx/'final-snapshot');m.fresh(data/'final-snapshot')
        raw=b'PUBLIC bytes';expected=m.sha(raw)
        evidence=dict(transactionId=tx.name,exporterCommit='a'*40,sha256=expected,validated=True,sourceUnchanged=True,
            pauseVerified=True,mutationFreezeVerified=True,runtimeStarted=False,deployment=False)
        m.durable(tx/'final-snapshot/remote-evidence.json',m.encode(evidence));m.durable(tx/'roles/primary-export-final-snapshot.txt',('sha256='+expected+'\n').encode())
        target=m.retain_migration(str(tx),expected,'a'*40,io.BytesIO(raw));self.assertEqual(target.read_bytes(),raw)
        with self.assertRaises(FileExistsError):m.retain_migration(str(tx),expected,'a'*40,io.BytesIO(raw))
        self.assertEqual(target.read_bytes(),raw)
        bad_tx=m.fresh(self.root/'wrong-sha-transaction')
        bad_data=m.data_root(bad_tx);m.fresh(bad_data/'final-snapshot')
        with self.assertRaisesRegex(ValueError,'pin differs'):
            m.retain_migration(str(bad_tx),'f'*64,'a'*40,io.BytesIO(raw))
        self.assertEqual((bad_data/'final-snapshot/migration.json').read_bytes(),raw)
        with self.assertRaises(FileExistsError):
            m.retain_migration(str(bad_tx),'f'*64,'a'*40,io.BytesIO(raw))


    def test_derive_bootstrap_closed_shell_and_request(self):
        shell=HERE/'public-bft-linux-public-tools.sh'
        script='source "$1"; PUBLIC_BFT_LINUX_TOOL_ROLE=primary; public_bft_linux_tool(){ printf "%s\\n" "$@"; }; public_bft_package_call unused "${@:2}"'
        args=['-derive-bootstrap','-migration-state','/public/M','-validator-manifest','/public/V','-validator-manifest-sha256','c'*64,'-genesis-time','2026-11-13T01:02:03Z']
        result=subprocess.run(['bash','-c',script,'test',str(shell),*args],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout,'derive-bootstrap\n/public/M\n/public/V\n'+'c'*64+'\n2026-11-13T01:02:03Z\n')
        a=dict(genesisTime='2026-11-13T01:02:03Z',validatorManifestSHA256='c'*64,migrationEvidenceSHA256='d'*64)
        r=self.request('derive-bootstrap',a);m.validate_request(r)
        for changed in (args+['-output','/new'],args[:-2],args[:5]+args[7:]+args[5:7],args+['-operator-plan','/x']):
            result=subprocess.run(['bash','-c',script,'test',str(shell),*changed],capture_output=True,text=True)
            self.assertEqual(result.returncode,64);self.assertEqual(result.stdout,'')
        for change in (lambda r:r['arguments'].pop('migrationEvidenceSHA256'),lambda r:r['arguments'].update(output='/new'),
                       lambda r:r['arguments'].update(validatorManifestSHA256='0'*64),lambda r:r.update(destination='/new'),
                       lambda r:r.update(role='seoul',runtime=r['runtime'].replace('-primary-','-seoul-'))):
            bad=copy.deepcopy(r);change(bad)
            with self.subTest(bad=bad),self.assertRaises(ValueError):m.validate_request(bad)


    def _derivation_manifest(self):
        fields=('validatorAddress','role','privateP2PHost','p2pPort','nodeId','consensusKeyType','consensusPubKey','consensusAddress')
        value=dict(version='PUBLIC_SYNTHETIC_NOT_MATH',purpose='PUBLIC',chainId='public-test',validators=[])
        for role in sorted(m.ROLES):
            v=dict(zip(fields,('public',role,'127.0.0.1',26656,'public','public','public','public')))
            value['validators'].append(v)
        return json.dumps(value,separators=(',',':'),ensure_ascii=False).encode()

    def _derivation_stdout(self):
        genesis=b'{\n  "PUBLIC": "synthetic transport bytes, not a genesis proof"\n}\n'
        value=dict(version='YNX-PUBLIC-BFT-BOOTSTRAP-DERIVATION/v1',originalGenesisHash='a'*64,
            boundMigrationStateHash='b'*64,consensusGenesisSHA256=m.sha(genesis),
            consensusGenesis=m.base64.b64encode(genesis).decode(),genesisTime='2026-11-13T01:02:03Z')
        return (json.dumps(value,indent=2)+'\n').encode()

    def _derivation_client(self):
        tx,data=self.prepare_data();m.fresh(tx/'roles');m.fresh(tx/'final-snapshot');m.fresh(data/'final-snapshot')
        migration=data/'final-snapshot/migration.json';m.durable(migration,b'PUBLIC synthetic completed migration; not math')
        evidence=dict(transactionId=tx.name,exporterCommit='a'*40,sha256=m.read(migration)[0]['sha256'],validated=True,sourceUnchanged=True,
            pauseVerified=True,mutationFreezeVerified=True,runtimeStarted=False,deployment=False)
        m.durable(tx/'final-snapshot/remote-evidence.json',m.encode(evidence))
        m.durable(tx/'roles/primary-export-final-snapshot.txt',('sha256='+evidence['sha256']+'\n').encode())
        validators=self.root/'validators.json';m.durable(validators,self._derivation_manifest())
        selection=patch.dict(os.environ,{'PUBLIC_BFT_PRODUCTION_VALIDATOR_MANIFEST':str(validators)})
        selection.start();self.addCleanup(selection.stop)
        args=[str(tx),'primary','/var/tmp/ynx-pq-runtime-source-primary-original/verified','a'*40,'b'*64,'derive-bootstrap',
            str(migration),str(validators),m.read(validators)[0]['sha256'],'2026-11-13T01:02:03Z']
        return tx,data,migration,validators,args

    def test_derive_bootstrap_original_manifest_and_input_closure(self):
        tx,data,migration,validators,args=self._derivation_client()
        raw=validators.read_bytes();expected=m.sha(raw)
        self.assertEqual(m.original_derivation_inputs(tx,str(migration),str(validators),expected,'a'*40),migration)
        self.assertEqual(m.validator_manifest_pin(raw),expected)
        r=self.request('derive-bootstrap',dict(genesisTime=args[-1],validatorManifestSHA256=expected,migrationEvidenceSHA256='d'*64))
        root=m.fresh(self.root/'inputs-case');m.fresh(root/'inputs')
        m.durable(root/'inputs/migration.json',migration.read_bytes());m.durable(root/'inputs/validators.json',raw)
        r['inputs']=[{'path':'inputs/'+v['path'],'bytes':v['bytes'],'sha256':v['sha256']} for v in m.catalog(root/'inputs')]
        m.validate_inputs(root,r)
        # Canonical-only equality cannot replace the same approved raw bytes.
        for altered in (raw+b'\n',json.dumps(m.decode(raw),sort_keys=True).encode(),m.encode({**m.decode(raw),'privateKey':'PUBLIC_SENTINEL'})):
            with self.subTest(shape=len(altered)):
                validators.write_bytes(altered)
                with self.assertRaises(ValueError):m.original_derivation_inputs(tx,str(migration),str(validators),m.sha(altered),'a'*40)
        validators.write_bytes(raw)
        with self.assertRaises(ValueError):m.original_derivation_inputs(tx,str(migration),str(validators),'e'*64,'a'*40)
        other=self.root/'not-selected.json';m.durable(other,raw)
        with patch.object(m,'read',wraps=m.read) as read,self.assertRaisesRegex(ValueError,'public selection'):
            m.original_derivation_inputs(tx,str(migration),str(other),expected,'a'*40)
        self.assertFalse(any(Path(c.args[0])==other for c in read.call_args_list))
        m.durable(root/'inputs/operator-plan.json',b'{}');r['inputs'].append({'path':'inputs/operator-plan.json',**m.read(root/'inputs/operator-plan.json')[0]})
        with self.assertRaisesRegex(ValueError,'exact bootstrap'):m.validate_inputs(root,r)
        self.assertEqual(validators.read_bytes(),raw)

    def test_derive_bootstrap_no_migration_upload_or_unknown_reexecution(self):
        tx,data,migration,validators,args=self._derivation_client();calls=[]
        def receive(command,stream,out,err,limit):
            with tarfile.open(fileobj=stream,mode='r:') as archive:
                names=archive.getnames();r=m.decode(archive.extractfile('request.json').read())
                self.assertNotIn('inputs/migration.json',names)
                self.assertEqual(archive.extractfile('inputs/validators.json').read(),validators.read_bytes())
                self.assertEqual({p['path'] for p in r['inputs']},{'inputs/migration.json','inputs/validators.json'})
                self.assertEqual(r['arguments']['validatorManifestSHA256'],args[-2]);self.assertEqual(r['destination'],'')
                self.assertEqual(r['arguments']['migrationEvidenceSHA256'],m.read(tx/'final-snapshot/remote-evidence.json')[0]['sha256'])
                calls.append(r)
            raise ValueError('controlled lost acknowledgement; no SSH')
        before=migration.read_bytes()
        with patch.object(m,'receive_transport',receive),self.assertRaisesRegex(ValueError,'controlled lost acknowledgement'):m.client(args)
        local=data/'linux-public-tools'/m.sha(m.encode(calls[0]))
        retained=m.catalog(local)
        with patch.object(m,'receive_transport') as transport,self.assertRaisesRegex(ValueError,'UNKNOWN preserved'):m.client(args)
        transport.assert_not_called();self.assertEqual(m.catalog(local),retained);self.assertEqual(migration.read_bytes(),before)
        self.assertFalse((local/'inputs/migration.json').exists());self.assertTrue((local/'INTENT.json').exists());self.assertFalse((local/'PUBLISHED.json').exists())
        inputs=sum(p['bytes'] for p in calls[0]['inputs'])
        self.assertEqual(m.operation_space(calls[0],True),3*inputs+2*(3<<20)+(144<<20))
        self.assertEqual(m.operation_space(calls[0]),2*inputs+3*(3<<20)+(144<<20))

    def test_derive_bootstrap_bounded_original_stdout_contract(self):
        raw=self._derivation_stdout();value=m.decode(raw);t=value['genesisTime']
        self.assertEqual(m.validate_bootstrap_derivation(raw,t),value)
        changes=[dict(extra='no'),dict(version='other'),dict(genesisTime='2026-11-13T01:02:04Z'),dict(originalGenesisHash='0'*64),
            dict(boundMigrationStateHash=7),dict(consensusGenesisSHA256='f'*64),dict(consensusGenesis=''),
            dict(consensusGenesis=value['consensusGenesis']+'\n'),dict(consensusGenesis=value['consensusGenesis'].rstrip('=')),
            dict(consensusGenesis='e31=')]
        # e31= decodes but is noncanonical pad-bit encoding of e30=.
        for change in changes:
            with self.subTest(fields=list(change)),self.assertRaises(ValueError):m.validate_bootstrap_derivation(m.encode({**value,**change}),t)
        for bad in (m.encode({k:v for k,v in value.items() if k!='boundMigrationStateHash'}),raw+b'{}',b' '*(1<<20)+raw):
            with self.assertRaises(ValueError):m.validate_bootstrap_derivation(bad,t)
        self.assertEqual(self._derivation_stdout(),raw)

    def test_derive_bootstrap_fixed_execution_and_failed_original_retention(self):
        # Original hydrate/jail/framing run; only privileged ownership, runtime
        # admission and the math subprocess are controlled synthetic fixtures.
        from types import SimpleNamespace
        class OwnedDirectory(type(Path())):
            def stat(self,*a,**kw):
                real=super().stat(*a,**kw)
                return SimpleNamespace(st_uid=0,st_mode=real.st_mode)
        bundle=m.fresh(self.root/'runtime');m.fresh(bundle/'operator');source={'binaries':{},'operator':{}}
        for group,names in (('binaries',m.BINARIES),('operator',m.OPERATORS)):
            for name in names:
                p=bundle/name if group=='binaries' else bundle/'operator'/name
                m.durable(p,b'PUBLIC SYNTHETIC '+name.encode());source[group][name]=m.read(p)[0]
        m.durable(bundle/'SOURCE.json',m.encode(source))
        for mode in ('success','nonzero','malformed'):
            with self.subTest(mode=mode):
                root=m.fresh(self.root/('execute-'+mode));m.fresh(root/'inputs')
                original=m.fresh(self.root/('snapshot-'+mode));migration=b'PUBLIC original migration '+mode.encode()
                evidence=dict(transactionId='original-transaction-001',exporterCommit='a'*40,sha256=m.sha(migration),validated=True,
                    sourceUnchanged=True,pauseVerified=True,mutationFreezeVerified=True,deployment=False,runtimeStarted=False)
                m.durable(original/'final-migration-state.json',migration);m.durable(original/'final-migration-state.evidence.json',m.encode(evidence))
                manifest=self._derivation_manifest();m.durable(root/'inputs/validators.json',manifest)
                r=self.request('derive-bootstrap',dict(genesisTime='2026-11-13T01:02:03Z',validatorManifestSHA256=m.sha(manifest),migrationEvidenceSHA256=m.sha(m.encode(evidence))))
                r['sourceSHA256']=m.read(bundle/'SOURCE.json')[0]['sha256']
                r['inputs']=[{'path':'inputs/migration.json','bytes':len(migration),'sha256':m.sha(migration)},
                    {'path':'inputs/validators.json',**m.read(root/'inputs/validators.json')[0]}]
                for name in r['transportSources']:
                    m.durable(root/name,b'original');r['transportSources'][name]=m.read(root/name)[0]
                m.durable(root/'request.json',m.encode(r));actual_original=m.original
                def mapped(path):
                    if str(path)==r['runtime']:return bundle
                    if str(path)=='/var/backups/ynx-chain/public-bft-cutover/'+r['transaction']:return OwnedDirectory(original)
                    return actual_original(path)
                stdout=self._derivation_stdout() if mode=='success' else b'original nonzero or malformed DATA\n';commands=[]
                def fake(command,target,input_file=None):
                    commands.append(command);self.assertIsNone(input_file)
                    self.assertEqual(command[6:],['/tool/ynx-consensus-package','-derive-bootstrap','-migration-state','/inputs/migration.json',
                        '-validator-manifest','/inputs/validators.json','-genesis-time',r['arguments']['genesisTime']])
                    self.assertEqual(command[:5],['/usr/bin/timeout','--signal=TERM','--kill-after=5','120','/usr/sbin/chroot'])
                    self.assertEqual((target/'public-root/inputs/migration.json').read_bytes(),migration)
                    self.assertEqual((target/'public-root/inputs/validators.json').read_bytes(),manifest)
                    self.assertFalse((target/'public-root/package').exists())
                    m.durable(target/'stdout',stdout);m.durable(target/'stderr',b'original failure\n' if mode=='nonzero' else b'')
                    return 1 if mode=='nonzero' else 0
                with patch.object(m,'original',mapped),patch.object(m,'original_validator') as admitted,patch.object(m,'bounded_math',fake):
                    if mode=='malformed':
                        with self.assertRaises(ValueError):m.execute(root,r)
                    else:self.assertEqual(m.execute(root,r),1 if mode=='nonzero' else 0)
                admitted.assert_called_once();self.assertEqual(len(commands),1);self.assertEqual((root/'stdout').read_bytes(),stdout)
                self.assertEqual((original/'final-migration-state.json').read_bytes(),migration)
                if mode=='malformed':
                    self.assertFalse((root/'RESULT.json').exists());self.assertFalse((root/'COMPLETE.json').exists());continue
                self.assertTrue((root/'COMPLETE.json').exists())
                receiver=m.fresh(self.root/('receiver-'+mode));m.checked_copy(root/'response.tar',receiver/'response.tar',m.read(root/'response.tar',material=False)[0])
                out,status=m.accept_result(receiver,r);self.assertEqual(status,1 if mode=='nonzero' else 0)
                m.publish_result(receiver,r,out,status);self.assertEqual((out/'stdout').read_bytes(),stdout)
                self.assertTrue((receiver/'PUBLISHED.json').is_file())
                self.assertFalse(any('.partial' in p.name or 'UNKNOWN' in p.name for p in receiver.rglob('*')))
                self.assertEqual({p['path'] for p in m.catalog(out)},{'stdout','stderr'})
                # Reconciled/reused successful output must still validate the
                # DATA, even when its catalog is coherently changed by a peer.
                if mode=='success':
                    (out/'stdout').write_bytes(b'{}\n');result=m.decode((out.parent/'RESULT.json').read_bytes());result['outputs']=m.catalog(out)
                    (out.parent/'RESULT.json').write_bytes(m.encode(result))
                    with self.assertRaisesRegex(ValueError,'closed bootstrap'):m.verified_result(out.parent,r)
                with patch.object(m,'original',mapped),patch.object(m,'original_validator'),patch.object(m,'bounded_math') as math,self.assertRaisesRegex(ValueError,'closed original transport input'):m.execute(root,r)
                math.assert_not_called()

    def test_derive_bootstrap_completed_publication_reuses_exact_data(self):
        from types import SimpleNamespace
        tx,data,migration,validators,args=self._derivation_client();calls=[];stdout=self._derivation_stdout()
        def receive(command,stream,out,err,limit):
            with tarfile.open(fileobj=stream,mode='r:') as archive:
                request=m.decode(archive.extractfile('request.json').read());calls.append(request)
                self.assertNotIn('inputs/migration.json',archive.getnames())
            remote=m.fresh(self.root/'completed-synthetic-response');outputs=m.fresh(remote/'outputs')
            m.durable(outputs/'stdout',stdout);m.durable(outputs/'stderr',b'')
            result=dict(version=m.VERSION,requestSHA256=m.sha(m.encode(request)),role=request['role'],commit=request['commit'],
                sourceSHA256=request['sourceSHA256'],operation=request['operation'],exitCode=0,outputs=m.catalog(outputs),
                sourceGrant=False,deployment=False,runtimeStarted=False,mathStartedUnixNanoseconds='100',mathFinishedUnixNanoseconds='101')
            m.durable(remote/'RESULT.json',m.encode(result));m.pack(remote,m.catalog(remote),out);m.durable(err,b'');return 0
        output=io.BytesIO();errors=io.BytesIO()
        with patch.object(m,'receive_transport',receive),patch.object(m.sys,'stdout',SimpleNamespace(buffer=output)),patch.object(m.sys,'stderr',SimpleNamespace(buffer=errors)):
            self.assertEqual(m.client(args),0)
        self.assertEqual(output.getvalue(),stdout);self.assertEqual(errors.getvalue(),b'');self.assertEqual(len(calls),1)
        local=data/'linux-public-tools'/m.sha(m.encode(calls[0]));before=m.catalog(local)
        self.assertTrue((local/'PUBLISHED.json').exists());self.assertFalse((local/'inputs/migration.json').exists())
        self.assertFalse(any('.partial' in p.name or 'UNKNOWN' in p.name for p in local.rglob('*')))
        output=io.BytesIO()
        with patch.object(m,'receive_transport') as transport,patch.object(m.sys,'stdout',SimpleNamespace(buffer=output)),patch.object(m.sys,'stderr',SimpleNamespace(buffer=errors)):
            self.assertEqual(m.client(args),0)
        transport.assert_not_called();self.assertEqual(output.getvalue(),stdout);self.assertEqual(m.catalog(local),before)
        self.assertFalse(m.decode((local/'PUBLISHED.json').read_bytes())['mathReexecuted'])


def actual_smoke(args):
    """CI only: original built ELF + fresh normal fixture, no rebuild/keygen."""
    import argparse,hashlib,shutil
    p=argparse.ArgumentParser();p.add_argument('--runtime',required=True);p.add_argument('--original-case',required=True)
    p.add_argument('--fixture',required=True);p.add_argument('--output',required=True);p.add_argument('--operator-case',required=True);p.add_argument('--operator-fixture',required=True);p.add_argument('--exporter',required=True);a=p.parse_args(args)
    m.require(sys.platform.startswith('linux') and os.geteuid()==0,'actual bridge smoke requires isolated hosted Linux root for chroot')
    runtime=m.original(m.absolute(a.runtime));fixture_raw=m.read(m.absolute(a.fixture),32<<20)[1];fixture=m.decode(fixture_raw)
    m.require(fixture['syntheticOnly'] is True and fixture['dataAuthorized'] is False and fixture['nativeRootAuthorized'] is False,'PUBLIC-only original fixture')
    source_raw=m.read(runtime/'SOURCE.json',128<<10)[1];source=m.decode(source_raw)
    m.require(source['commit']==os.environ['GITHUB_SHA'],'actual normal current SOURCE required')
    parent=m.fresh(m.absolute(a.output));original_case=m.original(m.absolute(a.original_case))
    # No fake ELF is accepted here. Original parser runs before any copy/math.
    check=subprocess.run(['/bin/bash','-c','source "$1"; validate_runtime_bundle "$2" "$3" "$4"','smoke',str(ROOT/'scripts/deploy/deploy-consensus-candidate.sh'),str(runtime),source['commit'],m.sha(source_raw)],capture_output=True,env=m.CLEAN_ENV,check=False)
    m.require(check.returncode==0 and not check.stderr,'original full eight-ELF validator must succeed')
    intake=m.fresh(Path('/var/tmp')/('ynx-pq-runtime-ci-primary-'+parent.name))
    shutil.copytree(runtime,intake/'verified',copy_function=shutil.copyfile)
    for f in (intake/'verified').rglob('*'):os.chmod(f,0o700 if f.is_dir() else 0o600)
    context_raw=m.read(original_case/'trust-context.json',32<<10)[1];context=m.decode(context_raw)
    paths={name:context[name] for name in m.PROOF_FIELDS}
    trusted=m.decode(m.read(Path(paths['trustedLightBlockFile']),10<<20)[1])
    clock_check={'checkedAtUnixNanoseconds':str(m.time.time_ns()),
        'trustExpiresUnixNanoseconds':str(m.proof_trust_expiry(context,trusted)),
        'fixtureUnchanged':True,'clockInjected':False,'trustPeriodExtended':False}
    m.durable(parent/'PROOF-CLOCK-PREFLIGHT.json',m.encode(clock_check))
    m.require(int(clock_check['checkedAtUnixNanoseconds'])<int(clock_check['trustExpiresUnixNanoseconds']),
        'original proof fixture already expired: keep failure; do not rewrite time or extend its trust period')
    op=m.fresh(parent/'original-public-operation');m.fresh(op/'inputs')
    originals=[('inputs/context.json',original_case/'trust-context.json')]+[('inputs/'+k,Path(v)) for k,v in paths.items() if v]
    for name,path in originals:
        m.checked_copy(path,op/name,m.read(path,material=False)[0])
    # Exact producer request representation used by the existing normal step.
    request=json.dumps(fixture['request'],separators=(',',':')).encode();m.durable(op/'inputs/request.json',request)
    controller=HERE/'public-bft-linux-public-tools.py';validator=ROOT/'scripts/deploy/deploy-consensus-candidate.sh';exporter=HERE/'remote/public-bft-final-snapshot.sh'
    tools={'controller.py':controller,'runtime-validator.sh':validator,'exporter-validator.sh':exporter}
    r=dict(version=m.VERSION,transaction='ci-public-math-'+m.sha(str(parent).encode())[:24],role='primary',runtime=str(intake/'verified'),commit=source['commit'],sourceSHA256=m.sha(source_raw),operation='proof',arguments=dict(contextPath=str(original_case/'trust-context.json'),contextSHA256=m.sha(context_raw),proofPaths=paths),inputs=[{**v,'path':'inputs/'+v['path']} for v in m.catalog(op/'inputs')],phase='verify_pq_continuation',destination='',transportSources={name:m.read(path,1<<20,False)[0] for name,path in tools.items()})
    for name,path in tools.items():m.checked_copy(path,op/name,r['transportSources'][name])
    m.durable(op/'request.json',m.encode(r));status=m.execute(op,r)
    m.require(status==0,'actual original math bridge rejected positive fixture')
    raw=m.read(op/'outputs/stdout',1<<20)[1];m.require(m.decode(raw)==fixture['expectedResponse'],'actual bridged full verifier result differs')
    m.require(m.read(op/'outputs/stderr',1<<20)[1]==b'','actual original math stderr')
    for name,path in originals:m.require(path.read_bytes()==(op/name).read_bytes(),'original public source changed')
    # Same original already-exercised package fixture, no fresh keys/signing.
    opcase=m.original(m.absolute(a.operator_case));opfixture=m.original(m.absolute(a.operator_fixture))
    manifest=m.decode(m.read(opfixture/'manifest.json',1<<20)[1])
    m.require(manifest['syntheticOnly'] is True and manifest['publicOnly'] is True and manifest['authorityGranted'] is False,'original PUBLIC operator fixture')
    layout=next(x for x in manifest['layouts'] if x['stateLayout']=='block-journal')
    for name,expected in manifest['files'].items():m.require(m.read(opfixture/name,16<<20,False)[0]==expected,'original operator material pin')
    operations=[dict(operation='proof',exitCode=status,responseSHA256=m.sha(raw))]
    def math_case(name,operation,arguments,files):
        # Use the real production SHA-addressed operation root. A following
        # verify references this original COMPLETE/result, not a copied package
        # or a test stub pretending to have performed the Go generation.
        pins=[{'path':relative,**m.read(path,material=False)[0]} for relative,path in files]
        pins.sort(key=lambda item:item['path'])
        request={**r,'operation':operation,'arguments':arguments,'inputs':pins}
        m.validate_request(request)
        case=m.fresh(Path('/var/tmp')/('ynx-public-tools-'+request['transaction']+'-'+m.sha(m.encode(request))))
        m.fresh(case/'inputs')
        skipped=[]
        for relative,path in files:
            if ('migrationEvidenceSHA256' in arguments and relative=='inputs/migration.json') or 'producerRequestSHA256' in arguments:
                skipped.append(relative);continue
            target=case/relative;m.ensure_directories(target.parent)
            m.checked_copy(path,target,m.read(path,material=False)[0])
        for tool,path in tools.items():m.checked_copy(path,case/tool,request['transportSources'][tool])
        m.durable(case/'request.json',m.encode(request))
        m.require(all(not (case/relative).exists() for relative in skipped),'referenced public body was uploaded')
        evidence_case=m.fresh(parent/name)
        try:
            status=m.execute(case,request)
        finally:
            for entry in ('request.json','command.json','SPACE.json','RESULT.json','COMPLETE.json','stdout','stderr'):
                if (case/entry).exists():m.checked_copy(case/entry,evidence_case/entry,m.read(case/entry,4<<20,False)[0])
        operations.append(dict(case=name,operation=operation,exitCode=status,
            responseSHA256=m.read(case/'outputs/stdout',1<<20)[0]['sha256'],
            originalRequestSHA256=m.sha(m.encode(request)),omittedTransportMembers=skipped,
            originalResultSHA256=m.read(case/'RESULT.json',4<<20)[0]['sha256']))
        return case,status
    def package_temp_completed(case,name):
        # Success is from the real original Go CLI above, whose full operator
        # verification creates/removes its public template via os.MkdirTemp.
        # This additionally proves its scratch stayed in this private jail.
        temporary=case/'public-root/tmp';m.original(temporary);info=temporary.lstat()
        m.require(temporary.is_dir() and info.st_mode&0o777==0o700 and info.st_uid==os.geteuid()
                  and not list(temporary.iterdir()),'normal Go public temporary directory was not private and cleaned')
        observation=dict(pathInsideJail='/tmp',mode='0700',ownedByExecutor=True,remainingEntries=0,hostMount=False)
        m.durable(parent/name/'TEMPORARY-DIRECTORY.json',m.encode(observation))
        operations[-1]['privateTemporaryDirectory']=observation
    negative=next(c for c in fixture['negativeCases'] if c['name']=='invalid-dual-commit-signatures')
    negative_path=parent/'original-negative-request.json'
    m.durable(negative_path,json.dumps(negative['request'],separators=(',',':')).encode())
    failed,code=math_case('proof-original-bad-signatures','proof',r['arguments'],originals+[('inputs/request.json',negative_path)])
    m.require(code==1 and m.decode(m.read(failed/'outputs/stdout',1<<20)[1])['code']=='PROOF_REJECTED','original invalid signatures were not rejected by bridged verifier')
    exporter_original=m.original(m.absolute(a.exporter))
    exporter_pin=m.read(exporter_original/'SOURCE.json',256<<10)[0]['sha256']
    exporter_intake=m.fresh(Path('/var/tmp')/('ynx-pq-exporter-ci-primary-'+parent.name))
    shutil.copytree(exporter_original,exporter_intake/'verified',copy_function=shutil.copyfile)
    for f in (exporter_intake/'verified').iterdir():os.chmod(f,0o600)
    exported,code=math_case('original-exporter-public-copy','exporter-files',{'bundle':str(exporter_intake/'verified'),'sourceSHA256':exporter_pin},[])
    m.require(code==0 and m.catalog(exporter_original)==[p for p in m.catalog(exported/'outputs') if p['path'] not in ('stdout','stderr')],'original strict exporter SOURCE/tools public copy differs')
    summary,code=math_case('migration-summary','migration-summary',{},[('inputs/migration.json',opfixture/'migration.json')]);m.require(code==0,'original migration math bridge failed')
    value=m.decode(m.read(summary/'outputs/stdout',8192)[1]);m.require(value['sourceSHA256']==manifest['files']['migration.json']['sha256'],'migration summary not bound to original bytes')
    # This is PUBLIC synthetic transport provenance in the isolated CI, not a
    # real node export/approval. Its migration bytes just passed the original
    # Go summary, and the same fixed host-local origin is exercised below.
    snapshot=Path('/var/backups/ynx-chain/public-bft-cutover')/r['transaction']
    m.ensure_directories(snapshot.parent);m.fresh(snapshot)
    migration_pin=m.read(opfixture/'migration.json',material=False)[0]
    m.checked_copy(opfixture/'migration.json',snapshot/'final-migration-state.json',migration_pin)
    evidence=m.encode(dict(transactionId=r['transaction'],exporterCommit=r['commit'],sha256=migration_pin['sha256'],
        validated=True,sourceUnchanged=True,pauseVerified=True,mutationFreezeVerified=True,runtimeStarted=False,deployment=False))
    m.durable(snapshot/'final-migration-state.evidence.json',evidence)
    referenced,code=math_case('same-origin-migration-summary','migration-summary',{'migrationEvidenceSHA256':m.sha(evidence)},[('inputs/migration.json',opfixture/'migration.json')])
    m.require(code==0 and m.read(referenced/'outputs/stdout',8192)[1]==m.read(summary/'outputs/stdout',8192)[1],
              'same original host migration reference changed normal Go result')
    account_summary,code=math_case('same-origin-migration-account-summary','migration-account-summary',{'migrationEvidenceSHA256':m.sha(evidence)},[('inputs/migration.json',opfixture/'migration.json')])
    account_value=m.decode(m.read(account_summary/'outputs/stdout',8192)[1])
    frozen_account=next(account for account in m.decode(m.read(opfixture/'migration.json',1<<30)[1])['accounts'] if account['address']==value['firstCanonicalAccount'])
    m.require(code==0 and account_value==dict(value,version='YNX-MIGRATION-PUBLIC-SUMMARY/v2',
        firstCanonicalBalance=str(frozen_account['balance']),firstCanonicalNonce=str(frozen_account['nonce'])),
        'original Linux account summary does not match the exact frozen account')
    # The release bridge consumes the same host-local M and exact public V.
    # The already built Go command must derive the identical operator Genesis.
    reviewed_manifest=m.read(opfixture/'validator-manifest.json',256<<10)[1]
    validator_pin=m.validator_manifest_pin(reviewed_manifest)
    canonical_raw=m.canonical_validator_manifest(reviewed_manifest)
    m.require(m.sha(canonical_raw)==validator_pin,'canonical validator fixture differs from its approved manifest pin')
    canonical_path=parent/'approved-derive-validators.json';m.durable(canonical_path,canonical_raw)
    derivation,code=math_case('derive-frozen-bootstrap','derive-bootstrap',
        {'genesisTime':manifest['genesisTime'],'validatorManifestSHA256':validator_pin,'migrationEvidenceSHA256':m.sha(evidence)},
        [('inputs/migration.json',opfixture/'migration.json'),('inputs/validators.json',canonical_path)])
    derived=m.decode(m.read(derivation/'outputs/stdout',1<<20)[1]);original_plan=m.decode(m.read(opfixture/layout['operatorPlan'],1<<20)[1])
    m.require(code==0 and derived['consensusGenesis']==original_plan['consensusGenesis']
              and derived['consensusGenesisSHA256']==original_plan['consensusGenesisSHA256']
              and derived['boundMigrationStateHash']==original_plan['migrationStateHash']
              and derived['originalGenesisHash']==original_plan['originalGenesisHash'], 'actual frozen derivation differs from the normal operator plan')
    m.require(operations[-1]['omittedTransportMembers']==['inputs/migration.json']
              and not (derivation/'outputs/package').exists(),'frozen derivation transferred the original migration or created a package')
    generated,code=math_case('generate-package','generate-package',{'genesisTime':manifest['genesisTime'],'planSHA256':layout['operatorPlanHash'],'migrationEvidenceSHA256':m.sha(evidence)},[('inputs/migration.json',opfixture/'migration.json'),('inputs/validators.json',opfixture/'validator-manifest.json'),('inputs/operator-plan.json',opfixture/layout['operatorPlan'])]);m.require(code==0,'normal package generation through bridge failed')
    package_temp_completed(generated,'generate-package')
    expected_package=opcase/'candidate-block-journal';actual_package=generated/'outputs/package'
    m.require(m.catalog(expected_package)==m.catalog(actual_package),'normal local/direct and bridge package bytes differ')
    files=[('inputs/package/'+f['path'],actual_package/f['path']) for f in m.catalog(actual_package)]
    producer_pin=m.read(generated/'request.json',2<<20)[0]['sha256']
    verified,code=math_case('same-origin-verify-package','verify-package',{'planSHA256':layout['operatorPlanHash'],'producerRequestSHA256':producer_pin},files);m.require(code==0,'original operator verification through bridge failed')
    package_temp_completed(verified,'same-origin-verify-package')
    wrong=('a' if layout['operatorPlanHash'][0]!='a' else 'b')+layout['operatorPlanHash'][1:]
    rejected,code=math_case('wrong-plan','verify-package',{'planSHA256':wrong},files);m.require(code!=0 and m.read(rejected/'outputs/stdout',1<<20)[1]==b'','wrong independent plan must be rejected without success output')
    receipt=dict(version='YNX-PUBLIC-LINUX-TOOL-CI-SMOKE/v1',commit=source['commit'],sourceSHA256=m.sha(source_raw),exporterSOURCEPin=exporter_pin,fixtureSHA256=m.sha(fixture_raw),normalVerifierSHA256=source['binaries']['ynx-consensus-proof-verify']['sha256'],actualELF=True,syntheticOnly=True,actualLiveCapture=False,actual683MBMigration=False,syntheticSnapshotTransportRecord=True,proofClockPreflight=clock_check,publicMathOperations=operations,code=m.decode(raw)['code'],responseSHA256=m.sha(raw),sourceGrant=False,deployment=False,runtimeStarted=False)
    m.durable(parent/'SMOKE.json',m.encode(receipt));print(json.dumps(receipt,sort_keys=True));return 0

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--actual-smoke':sys.exit(actual_smoke(sys.argv[2:]))
    unittest.main()
