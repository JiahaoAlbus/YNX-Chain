"""Local real-filesystem fixture of the exact remote executor (no SSH).

systemd/HTTP/user identity/Linux start are explicit test boundaries, never public
runtime evidence. Archive validation and drop-in success/rollback execute real
executor functions against the exact frozen candidate bytes.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[1]/'scripts/deploy-quant-owned-runtime.py'
ARCHIVE=Path('/tmp/ynx-quant-lab-e022589fbd11-linux-amd64.tar.gz')

def load():
 spec=importlib.util.spec_from_file_location('quant_deploy_fixture',SCRIPT)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module

class QuantDeploymentTest(unittest.TestCase):
 def test_exact_archive_and_bad_member_boundaries(self):
  m=load();raw=ARCHIVE.read_bytes();entries,manifest=m.validate_archive(raw)
  self.assertEqual(len(entries),14)
  self.assertEqual(manifest['dependencyProvenance']['privateWallet']['source'],'a7dad7ec1bc7c06577978bdd5fea8dc9c7a248a9')
  for attack in ('traversal','symlink','duplicate','content','extra'):
   with self.subTest(attack=attack):
    output=io.BytesIO()
    with tarfile.open(fileobj=output,mode='w:gz') as result:
     for index,(name,(data,mode)) in enumerate(entries.items()):
      member=tarfile.TarInfo(name);member.mode=mode
      if index==0 and attack=='traversal':member.name=m.RELEASE_NAME+'/../outside'
      if index==0 and attack=='symlink':member.type=tarfile.SYMTYPE;member.linkname='/etc/passwd'
      if index==0 and attack=='content':data=b'tampered'
      member.size=len(data);result.addfile(member,io.BytesIO(data))
      if index==0 and attack=='duplicate':result.addfile(member,io.BytesIO(data))
     if attack=='extra':
      member=tarfile.TarInfo(m.RELEASE_NAME+'/foreign');member.mode=0o644;member.size=1;result.addfile(member,io.BytesIO(b'x'))
    with self.assertRaises(RuntimeError):m.validate_archive(output.getvalue())

 def flow(self,failure=None):
  m=load();raw=ARCHIVE.read_bytes()
  with tempfile.TemporaryDirectory(prefix='quant-owner-executor-') as directory:
   root=Path(directory);releases=root/'releases';releases.mkdir()
   old=root/'old';old.mkdir();old_binary=old/'ynx-quant';old_binary.write_bytes(b'old executable')
   current=root/'current';current.symlink_to(old)
   state=root/'state.json';state.write_bytes(b'{"user":"fixture-only","preserve":true}')
   unit=root/'ynx-quant.service';unit.write_bytes(b'original service')
   env=root/'env';env.write_bytes(b'PRIVATE_VALUE=not-printed')
   drop_dir=root/'ynx-quant.service.d'
   original={'MainPID':'877070','NRestarts':'0','ActiveState':'active','SubState':'running'}
   running=dict(original);sibling={'MainPID':'2275763','NRestarts':'0','ActiveState':'active','SubState':'running'}
   calls=[];checks=[]
   m.RELEASE=releases/m.RELEASE_NAME;m.RELEASE_PARENT_ID=m.identity(releases)
   m.CURRENT=current;m.OLD_CURRENT=str(old);m.STATE=state;m.EXPECTED_STATE_SHA=m.digest(state.read_bytes())
   m.FIXED_FILES={str(p):m.digest(p.read_bytes()) for p in [old_binary,unit,env]}
   m.DROP_DIR=drop_dir;m.DROP_FILE=drop_dir/'90-fixture.conf';m.VALIDATION=root/'validation'
   if failure=='existing-child':drop_dir.mkdir();m.DROP_FILE.write_bytes(b'foreign')
   def fake_run(argv):
    calls.append(argv)
    if argv==['/usr/bin/systemctl','restart','ynx-quant.service']:
     running['MainPID']='900001' if m.DROP_FILE.exists() else '900002'
    elif argv!=['/usr/bin/systemctl','daemon-reload']:raise AssertionError(argv)
    return ''
   def old_http():checks.append('old');return []
   def candidate_http(base,manifest):
    checks.append('candidate')
    if failure=='public-mismatch':raise RuntimeError('CANDIDATE_ASSET')
    return [{'url':base,'fixture':True}]
   def isolated(manifest,uid,gid):
    self.assertTrue((m.RELEASE/'ynx-quantd').is_file())
    self.assertEqual(state.read_bytes(),b'{"user":"fixture-only","preserve":true}')
    return [{'isolatedStart':'mock boundary, not Linux evidence'}]
   out=io.StringIO()
   with patch.object(m.os,'geteuid',return_value=0),patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=995,pw_gid=986)),patch.object(m,'service',side_effect=lambda name='ynx-quant.service':dict(sibling if name!='ynx-quant.service' else running)),patch.object(m,'run',side_effect=fake_run),patch.object(m,'old_http',side_effect=old_http),patch.object(m,'candidate_http',side_effect=candidate_http),patch.object(m,'isolated_start',side_effect=isolated),patch.object(m.sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(raw))),patch.object(m.sys,'argv',['executor','--deploy-owned-quant-e022589fbd11']),contextlib.redirect_stdout(out):
    if failure=='existing-child':
     with self.assertRaisesRegex(RuntimeError,'NEW_PATH_ALREADY_EXISTS'):m.main()
    elif failure:
     with self.assertRaises(SystemExit):m.main()
    else:m.main()
   self.assertEqual(current.resolve(),old.resolve())
   self.assertEqual(state.read_bytes(),b'{"user":"fixture-only","preserve":true}')
   self.assertEqual(env.read_bytes(),b'PRIVATE_VALUE=not-printed')
   self.assertEqual(unit.read_bytes(),b'original service')
   self.assertNotIn('PRIVATE_VALUE',out.getvalue())
   self.assertTrue(all('ynx-quant-exchange.service' not in argv for argv in calls))
   if failure=='existing-child':
    self.assertEqual(calls,[]);self.assertEqual(m.DROP_FILE.read_bytes(),b'foreign');self.assertFalse(m.RELEASE.exists())
   elif failure:
    self.assertFalse(drop_dir.exists());self.assertEqual(running['MainPID'],'900002')
    self.assertEqual(checks,['old','candidate','old'])
    self.assertTrue(json.loads(out.getvalue())['automaticRollbackVerified'])
   else:
    self.assertTrue(m.RELEASE.is_dir());self.assertTrue(m.DROP_FILE.is_file())
    self.assertEqual(running['MainPID'],'900001')
    self.assertEqual(json.loads(out.getvalue())['result'],'QUANT_OWNED_RUNTIME_DEPLOYED')

 def test_success_keeps_candidate_and_rollback_pointer(self):self.flow()
 def test_asset_failure_restores_only_own_unit_not_old_state(self):self.flow('public-mismatch')
 def test_existing_control_refused_before_writes(self):self.flow('existing-child')

if __name__=='__main__':unittest.main()
