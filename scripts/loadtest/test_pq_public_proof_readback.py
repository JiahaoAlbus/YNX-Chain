"""Public byte transport/path-map controls. No signing or valid proof fixtures."""
import copy
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('public_proof_transport',Path(__file__).with_name('pq-public-proof-readback.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class PublicProofClosureControls(unittest.TestCase):
    def fixture(self,base):
        public=base/'public';case=public/'load-operations/00000';directory=base/'private-lab/node-0/operation-000001/verifier';case.mkdir(parents=True);directory.mkdir(parents=True)
        for role,name in p.FILES.items():
            path=directory/name if role!='proof' else directory.parent/name;path.write_bytes(('PUBLIC transport control only: '+role).encode())
        light={field:str(directory/p.FILES[role]) for role,field in p.FIELDS.items()};light.update(runtimePlanFile='',runtimePlanHash='',trustedLightBlockSHA256=p.sha((directory/'trusted-light-block.json').read_bytes()),engineHeight='21')
        context=dict(version='YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1',lightTrust=light,expectedTransaction={'PUBLIC_ONLY':'no-valid-proof-or-authority'})
        # Keep deliberately noncanonical spacing to prove original bytes survive.
        (directory/'trust-context.json').write_bytes(json.dumps(context,indent=3).encode())
        refs={role:dict(path=p.FILES[role],sha256=p.sha((directory/p.FILES[role]).read_bytes()),bytes=str((directory/p.FILES[role]).stat().st_size)) for role in ('request','context')}
        export=dict(syntheticOnly=True,authorityGranted=False,**refs);proof=directory.parent/'proof.json';proofref=dict(path=str(proof),sha256=p.sha(proof.read_bytes()),bytes=str(proof.stat().st_size))
        return public,case,directory,export,proofref
    def export(self,f,verifier='f'*64):return p.export_original_public_proof(*f,'7'*40,verifier)
    def completed_fixture(self,base,verifier='f'*64):
        f=self.fixture(base);ref=self.export(f,verifier);public,case,directory,_,_=f
        row=dict(index=0,ownerIndex=11,operationId='PUBLIC-unit-operation',nonce=2)
        (case/'qualified-receipt.json').write_text(json.dumps(dict(operationId=row['operationId'],transaction=dict(ownerIndex=11,firstNonce='2'),meaning='transport unit marker; no verified business claim')))
        for path in (public/'load-00000-normal-verifier.log',case/'four-node-inclusion.json',case/'original-confirm-reply.json',public/'load-00000-live-result.log',case/'original-sign-reply.json'):path.write_bytes(b'PUBLIC original transport unit marker; not proof success')
        portable=p.finalize_portable_catalog(public,case,ref,row)
        return f,ref,portable
    def test_exact_original_bytes_and_existing_normal_closed_catalog(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp).resolve();f,ref,portable=self.completed_fixture(base);original=(f[2]/'trust-context.json').read_bytes();manifest=f[0]/ref['path'];m=p.strict(manifest.read_bytes())
            self.assertEqual(set(m['entries']),set(p.FILES));self.assertFalse(m['authorityGranted'] or m['independentReverification'])
            self.assertEqual((f[0]/m['entries']['context']['publicRelativePath']).read_bytes(),original)
            archive,_,catalog=p.read_portable_archive(f[0]/portable['path'],portable['sha256']);self.assertEqual(len(p.strict(catalog.read_bytes())['files']),14)
            self.assertEqual(archive['actualOwnerIndex'],11);self.assertTrue(archive['legacyOwner4LabelsAreTransportNamesOnly'])
            self.assertEqual((f[2]/'trust-context.json').read_bytes(),original)
            self.assertFalse(any('derived' in x.name for x in base.rglob('*')))
    def test_missing_one_original_result_cannot_be_invented(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp).resolve();f=self.fixture(base);ref=self.export(f)
            with self.assertRaises((RuntimeError,OSError)):p.finalize_portable_catalog(f[0],f[1],ref,dict(index=0,ownerIndex=11,operationId='PUBLIC-unit-operation',nonce=2))
            self.assertFalse((f[1]/'normal-portable-originals.json').exists());self.assertFalse((f[1]/'portable-file-catalog.json').exists())
    def test_scope_arbitrary_context_path_and_symlink_never_export(self):
        for mode in ('authority','privatePath','symlink','hardlink','wrongPin'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as temp:
                base=Path(temp).resolve();f=self.fixture(base);public,case,directory,context,proof=f
                if mode=='authority':context['authorityGranted']=True
                elif mode=='privatePath':
                    value=p.strict((directory/'trust-context.json').read_bytes());value['lightTrust']['migrationFile']=str(base/'custody/key.json');raw=json.dumps(value).encode();(directory/'trust-context.json').write_bytes(raw);context['context'].update(sha256=p.sha(raw),bytes=str(len(raw)))
                elif mode=='wrongPin':proof['sha256']='e'*64
                else:
                    source=directory/'migration.json';source.unlink();key=base/'NEVER_EXPORT_PRIVATE';key.write_bytes(b'PRIVATE-unit-marker')
                    if mode=='symlink':source.symlink_to(key)
                    else:os.link(key,source)
                with self.assertRaises((RuntimeError,ValueError,OSError)):self.export(f)
                self.assertFalse((public/'proof-public-blobs').exists())
    def test_manifest_and_blob_tamper_or_missing_are_never_zero_filled(self):
        for mode in ('manifestPin','blob','missing','pathEscape','duplicate','sourceExtraRole'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as temp:
                base=Path(temp).resolve();f=self.fixture(base);ref=self.export(f);path=f[0]/ref['path'];manifest=p.strict(path.read_bytes());pin=ref['sha256']
                if mode=='manifestPin':pin='d'*64
                elif mode in ('blob','missing'):
                    blob=f[0]/manifest['entries']['request']['publicRelativePath']
                    if mode=='blob':blob.write_bytes(b'changed')
                    else:blob.unlink()
                else:
                    if mode=='pathEscape':manifest['entries']['request']['publicRelativePath']='../../custody/key'
                    elif mode=='sourceExtraRole':manifest['entries']['custody']=copy.deepcopy(manifest['entries']['request'])
                    raw=p.json_bytes(manifest)
                    if mode=='duplicate':raw=raw[:-2]+b',"schema":"duplicate"}\n'
                    path.write_bytes(raw);pin=p.sha(raw)
                with self.assertRaises((RuntimeError,ValueError,OSError)):p.read_original_closure(path,pin)
                self.assertFalse((base/'independent').exists())
    def test_actual_child_import_rejection_never_invokes_verifier_or_becomes_success(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp).resolve();verifier=Path(sys.executable).resolve()
            f,ref,portable=self.completed_fixture(base,p.sha(verifier.read_bytes()))
            report=p.reverify(f[0]/portable['path'],portable['sha256'],verifier,p.sha(verifier.read_bytes()),base/'independent',True)
            self.assertNotEqual(report['normalImport']['returnCode'],0);self.assertNotIn('normalVerifier',report)
            self.assertFalse(report['independentCryptographicReverification'] or report['sourceGrant'] or report['nativeRootAuthorized'] or report['originalAuthorityClaim'])
            command=report['normalImportCommand'];self.assertEqual(command[1],'portable-import');self.assertEqual(set(command[2::2]),{'--trust-context','--trust-context-sha256','--file-catalog','--file-catalog-sha256','--source-dir','--output-dir'})
            self.assertEqual((base/'independent/original-source/context/trust-context.json').read_bytes(),(f[2]/'trust-context.json').read_bytes())
    def test_portable_catalog_tamper_missing_original_or_extra_path_fail_closed(self):
        for mode in ('catalog','missingOriginal','extraPath'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as temp:
                base=Path(temp).resolve();f,ref,portable=self.completed_fixture(base);path=f[0]/portable['path'];m=p.strict(path.read_bytes());pin=portable['sha256']
                if mode=='catalog':(f[1]/'portable-file-catalog.json').write_bytes(b'changed original catalog')
                elif mode=='missingOriginal':(f[0]/m['payload']['original-results/functional-owner-4-original-sign.log']['publicRelativePath']).unlink()
                else:
                    m['payload']['custody/NOT_ALLOWED']=copy.deepcopy(next(iter(m['payload'].values())));raw=p.json_bytes(m);path.write_bytes(raw);pin=p.sha(raw)
                with self.assertRaises((RuntimeError,ValueError,OSError)):p.read_portable_archive(path,pin)
    def test_existing_blob_corruption_refused_and_original_manifest_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp).resolve();f=self.fixture(base);ref=self.export(f);manifest=f[0]/ref['path'];before=manifest.read_bytes();m=p.strict(before);blob=f[0]/m['entries']['migration']['publicRelativePath'];blob.write_bytes(b'corrupt')
            with self.assertRaisesRegex(RuntimeError,'blob differs'):self.export(f)
            self.assertEqual(manifest.read_bytes(),before)

    def test_canceled_migration_export_never_publishes_a_partial_blob(self):
        with tempfile.TemporaryDirectory() as temp:
            public, case, directory, context, proof = self.fixture(Path(temp).resolve())
            stop = threading.Event()

            def interrupt_copy(path, size, *, output, stop):
                output.write(b'partial')
                stop.set()
                return 'a' * 64

            with mock.patch.object(p, 'scan_existing_blob', side_effect=interrupt_copy):
                with self.assertRaisesRegex(RuntimeError, 'export canceled'):
                    p.export_original_public_proof(public, case, directory, context, proof,
                                                  '7' * 40, 'f' * 64, stop=stop)
            self.assertFalse((case / 'original-public-proof-manifest.json').exists())
            self.assertEqual(list((public / 'proof-public-blobs').iterdir()), [])
            self.assertFalse(any(path.name.startswith('tmp') for path in public.parent.iterdir()))

    def test_only_migration_role_uses_its_larger_transport_bound(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(p, 'FILE_LIMIT', 4096):
            f = self.fixture(Path(temp).resolve())
            migration = f[2]/'migration.json'
            original = b'm' * 4097
            migration.write_bytes(original)
            ref = self.export(f)
            _, values, _ = p.read_original_closure(f[0]/ref['path'], ref['sha256'])
            self.assertEqual(values['migration'], original)
            manifest, values, paths = p.read_original_closure(f[0]/ref['path'], ref['sha256'], retain_blobs=False)
            self.assertEqual(values, {})
            self.assertEqual(manifest['entries']['migration']['sha256'], p.sha(original))
            paths['migration'].write_bytes(b'x' + original[1:])
            with self.assertRaisesRegex(RuntimeError, 'blob pin/size differs'):
                p.read_original_closure(f[0]/ref['path'], ref['sha256'], retain_blobs=False)
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(p, 'FILE_LIMIT', 4096):
            f = self.fixture(Path(temp).resolve())
            (f[2]/'genesis.json').write_bytes(b'g' * 4097)
            with self.assertRaisesRegex(RuntimeError, 'bounded regular public input'):
                self.export(f)

if __name__=='__main__':unittest.main()
