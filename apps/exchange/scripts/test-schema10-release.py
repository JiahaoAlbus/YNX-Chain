import importlib.util,unittest,tempfile,os,json
from pathlib import Path

spec=importlib.util.spec_from_file_location('release',Path(__file__).with_name('release-schema10-d736a878.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ReleaseBoundaries(unittest.TestCase):
 def test_frozen_real_archive_inventory(self):
  archive=Path('/tmp/ynx-exchange-schema10-runtime-20260912.S33fLQ/ynx-exchange-schema10-d736a87831fe-linux-amd64.tar.gz').resolve()
  data,manifest=module.archive_files(archive)
  self.assertEqual(manifest['stateSchema'],10);self.assertEqual(len(data),7)
  self.assertEqual(module.sha(data['ynx-exchanged']),'01b9398202aec44dc1f9872378728720a6158216f264a07e738f17a8781f3918')
  self.assertIn(b'Native Wallet action signing',data['apps/exchange/web/wallet-auth.js'])
 def test_file_identity_hash_symlink_hardlink_and_substitution_fences(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp).resolve();p=root/'control';p.write_bytes(b'original');r=module.regular(p)
   with self.assertRaises(AssertionError):module.regular(p,'0'*64)
   q=root/'symlink';q.symlink_to(p)
   with self.assertRaises(AssertionError):module.regular(q)
   q.unlink();os.link(p,q)
   with self.assertRaises(AssertionError):module.regular(p)
   q.unlink();p.rename(root/'original');p.write_bytes(b'foreign')
   with self.assertRaises(AssertionError):module.remove_exact(p,r)
   self.assertEqual(p.read_bytes(),b'foreign');self.assertEqual((root/'original').read_bytes(),b'original')
   new=module.regular(p);module.remove_exact(p,new);module.absent(p)
 def test_deploy_rolls_back_dropin_and_never_restores_state(self):
  # Exercise the actual deploy control flow with local boundary operations,
  # not a second implementation of its success/failure transitions.
  original={name:getattr(module,name) for name in ['RELEASE','DROPIN','STATE','verify_baseline','directory','regular','receipt','absent','save','service','ctl','ready','http','remove_exact','HASHES','original_links','process_executable']}
  original_run=module.subprocess.run
  try:
   for failed in [False,True]:
    with tempfile.TemporaryDirectory() as temp:
     root=Path(temp).resolve();release=root/'release';release.mkdir();control=root/'controls';control.mkdir();state=root/'live-state';state.write_bytes(b'latest-state')
     for name in ['public.conf','quant-product-session.conf']:(control/name).write_bytes(name.encode())
     manifest={'entries':[]};(release/'BUNDLE_MANIFEST.json').write_text(json.dumps(manifest));(release/'preflight-receipt.json').write_text(json.dumps({'status':'ISOLATED_LINUX_SCHEMA10_PREFLIGHT_PASS','source':module.SOURCE,'files':[]}))
     actions=[];stage={'started':False,'failed':False};before={'state':{'sha256':'original'},'service':{'MainPID':'877065'},'quant':{'MainPID':'2275763'}}
     module.RELEASE=release;module.DROPIN=control/'own.conf';module.STATE=state;module.HASHES={};module.verify_baseline=lambda:before;module.directory=lambda p:{};module.receipt=lambda p:{}
     module.regular=lambda p,d=None: before['state'] if p==state else {'path':str(p)};module.absent=lambda p:self.assertFalse(os.path.lexists(p))
     def save(p,raw,*args):
      self.assertFalse(os.path.lexists(p));p.write_bytes(raw);return {'path':str(p)}
     module.save=save
     def ctl(action):actions.append(action);stage['started']=action=='start'
     module.ctl=ctl
     module.service=lambda name='ynx-exchange.service': before['quant'] if name!='ynx-exchange.service' else {'MainPID':'0'} if not stage['started'] else {'MainPID':'123456','ActiveState':'active','SubState':'running','NRestarts':'0','WorkingDirectory':str(release)}
     module.ready=lambda *a:None
     def http(url,source=None,**kw):
      if failed and source==module.SOURCE and not stage['failed']:stage['failed']=True;raise AssertionError('candidate public mismatch')
      return {}
     module.http=http;module.original_links=lambda:None;module.process_executable=lambda pid:str(release/'ynx-exchanged')
     module.remove_exact=lambda p,r:p.unlink()
     module.subprocess.run=lambda *a,**k:None
     if failed:
      with self.assertRaises(SystemExit):module.deploy()
      self.assertEqual(actions,['stop','start','stop','start']);self.assertFalse(module.DROPIN.exists());self.assertEqual(set(p.name for p in control.iterdir()),{'public.conf','quant-product-session.conf'})
     else:
      module.deploy();self.assertEqual(actions,['stop','start']);self.assertTrue(module.DROPIN.exists());self.assertEqual(json.loads((release/'deployment-receipt.json').read_bytes())['automaticRollbackCount'],0)
     self.assertEqual(state.read_bytes(),b'latest-state')
  finally:
   for name,value in original.items():setattr(module,name,value)
   module.subprocess.run=original_run

if __name__=='__main__':unittest.main()
