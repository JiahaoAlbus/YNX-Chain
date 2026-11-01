"""Public byte transport/path-map controls. No signing or valid proof fixtures."""
import copy
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
import unittest

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
    def test_exact_eight_originals_and_separate_mapping_preserve_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp).resolve();f=self.fixture(base);original=(f[2]/'trust-context.json').read_bytes();ref=self.export(f);manifest=f[0]/ref['path'];m=p.strict(manifest.read_bytes())
            self.assertEqual(set(m['entries']),set(p.FILES));self.assertFalse(m['authorityGranted'] or m['independentReverification'])
            self.assertEqual((f[0]/m['entries']['context']['publicRelativePath']).read_bytes(),original)
            _,derived,pin,request,mapping=p.prepare_reverification(manifest,ref['sha256'],base/'independent')
            new=p.strict(derived.read_bytes());old=p.strict(original)
            for field in p.FIELDS.values():new['lightTrust'][field]=old['lightTrust'][field]
            self.assertEqual(new,old);self.assertEqual((f[2]/'trust-context.json').read_bytes(),original)
            self.assertEqual(request.read_bytes(),(f[2]/'request.json').read_bytes());self.assertFalse(mapping['authorityGranted'] or mapping['derivedContextIsOriginal'])
            self.assertEqual(pin,p.sha(derived.read_bytes()))
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
                with self.assertRaises((RuntimeError,ValueError,OSError)):p.prepare_reverification(path,pin,base/'independent')
                self.assertFalse((base/'independent').exists())
    def test_actual_child_rejection_never_becomes_success(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp).resolve();verifier=Path(sys.executable).resolve()
            # Existing interpreter rejects the normal verifier's flags; no fake
            # successful verifier, valid proof fixture or newly executable file.
            f=self.fixture(base);ref=self.export(f,p.sha(verifier.read_bytes()));report=p.reverify(f[0]/ref['path'],ref['sha256'],verifier,p.sha(verifier.read_bytes()),base/'independent',True)
            self.assertNotEqual(report['returnCode'],0);self.assertIsNone(report['originalVerifierResult']);self.assertFalse(report['independentCryptographicReverification'] or report['authorityGranted'] or report['originalAuthorityClaim']);self.assertTrue((base/'independent/reverification.json').exists())
    def test_existing_blob_corruption_refused_and_original_manifest_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp).resolve();f=self.fixture(base);ref=self.export(f);manifest=f[0]/ref['path'];before=manifest.read_bytes();m=p.strict(before);blob=f[0]/m['entries']['migration']['publicRelativePath'];blob.write_bytes(b'corrupt')
            with self.assertRaisesRegex(RuntimeError,'blob differs'):self.export(f)
            self.assertEqual(manifest.read_bytes(),before)

if __name__=='__main__':unittest.main()
