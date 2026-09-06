import hashlib, importlib.util, json, os, pathlib, signal, subprocess, sys, tempfile, time, types, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('deploy',pathlib.Path(__file__).with_name('deploy-sdk529.py'));deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
class Lifecycle(unittest.TestCase):
 def exercise(self,fail=(),initial='old',action='deploy'):
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td);source='a'*40;env='same private environment';service='ynx-creator-studio-wallet.service'
   dirs={mode:str(root/mode) for mode in ['old','normal','recovery','peer']};own=root/'etc/systemd/system'/f'{service}.d/20260906-zz-sdk529.conf';own.parent.mkdir(parents=True)
   predecessor=own.with_name('old.conf');predecessor.write_bytes(b'old override')
   normal_files={'index.html':{'bytes':6,'sha256':deploy.digest(b'normal')},'wallet-callback.html':{'bytes':8,'sha256':deploy.digest(b'callback')}}
   recovery_files={'index.html':{'bytes':8,'sha256':deploy.digest(b'recovery')}}
   normal={'sourceCommit':source,'files':normal_files};recovery={'sourceCommit':source,'files':recovery_files};raw={dirs['normal']:json.dumps(normal).encode(),dirs['recovery']:json.dumps(recovery).encode(),dirs['old']:b'old',dirs['peer']:b'peer'}
   infos={mode:{'directory':dirs[mode],'manifest':'runtime-manifest.json','manifestSHA256':deploy.digest(raw[dirs[mode]])} for mode in ['normal','recovery']}
   p={'unit':service,'port':6495,'oldDropIns':{str(predecessor):deploy.digest(predecessor.read_bytes())},'oldDirectory':dirs['old'],'oldManifest':'runtime-manifest.json','oldManifestSHA256':deploy.digest(b'old'),**infos}
   e={'sourceCommit':source,'products':{'creator':p,'viewer':{'unit':'ynx-video-viewer.service','port':6494}},'preservedFiles':[],'authDirectory':'auth'};ep=root/'envelope.json';ep.write_text(json.dumps(e))
   state={'mode':initial,'running':True};events=[]
   signal_phase=os.environ.get('YNX_FIXTURE_SIGNAL_PHASE');signalled=False
   if initial!='old':own.write_bytes(deploy.config_bytes(infos[initial]))
   def Path(value):
    v=str(value)
    if v.startswith('/etc/') or v.startswith('/var/lib/'):return root/v[1:]
    return pathlib.Path(value)
   def prop(unit,name):
    if unit=='ynx-wallet-gateway.service' and name=='WorkingDirectory':return 'auth'
    return {'User':'ynx','Environment':env,'EnvironmentFiles':'','MainPID':'33' if state['running'] else '0','WorkingDirectory':dirs[state['mode']], 'DropInPaths':' '.join(sorted([str(predecessor)]+([str(own)] if own.exists() else [])))}[name]
   def identity(unit,port=None):return {'pid':33,'cwd':dirs[state['mode']] if unit==service else dirs['peer']}
   def files(directory,name,source=None):return ({'files':{}},raw[str(directory)])
   def payload(directory,info,source):return recovery if str(directory)==dirs['recovery'] else normal
   def command(*args):
    nonlocal signalled
    events.append(args)
    phase='stop' if args[:2]==('systemctl','stop') else 'dropin' if args[:2]==('systemctl','daemon-reload') else 'start' if args[:2]==('systemctl','start') else None
    if signal_phase==phase and not signalled:
     signalled=True;pathlib.Path(os.environ['YNX_FIXTURE_SIGNAL_MARKER']).write_text(phase)
     while True:time.sleep(.1)
    if args[:2]==('systemctl','stop'):state['running']=False
    if args[:2]==('systemctl','daemon-reload'):
     state['mode']='recovery' if ('WorkingDirectory='+dirs['recovery']).encode() in own.read_bytes() else 'normal'
    if args[:2]==('systemctl','start'):
     if state['mode'] in fail:raise RuntimeError('fixture '+state['mode']+' startup failure')
     state['running']=True
    return ''
   def http(port,path):
    if port==18445:return (200,{},json.dumps({'build':{'sourceCommit':deploy.AUTH}}).encode()) if path=='/version' else (200,{},b'{"ok":true}')
    if port==6493:return 200,{},b'backend'
    if path=='/runtime-manifest.json':return 200,{'Cache-Control':'no-store'},raw[dirs[state['mode']]]
    recovery_mode=state['mode']=='recovery';data=b'recovery' if recovery_mode else b'callback' if path in ['/wallet-callback.html','/wallet-auth/callback'] else b'normal'
    return 503 if recovery_mode else 200,{'Cache-Control':'no-store'},data
   patches={'pathlib':types.SimpleNamespace(Path=Path,PurePosixPath=pathlib.PurePosixPath),'prop':prop,'unit_identity':identity,'validate_files':files,'validate_payload':payload,'materialize':lambda *a:None,'run':command,'http':http}
   with patch.multiple(deploy,**patches),patch.object(deploy.os,'geteuid',return_value=0),patch.object(deploy.sys,'argv',['deploy',str(ep),deploy.digest(ep.read_bytes()),'creator',action]):
    if fail or signal_phase:
     with self.assertRaises((RuntimeError,deploy.ReleaseInterrupted)):deploy.main()
    else:deploy.main()
   self.assertNotIn('old',[a[-1] for a in events if a[:2]==('systemctl','start')]);self.assertTrue(predecessor.exists());self.assertEqual(predecessor.read_bytes(),b'old override')
   self.assertEqual(own.read_bytes(),deploy.config_bytes(infos['recovery' if fail or signal_phase or action=='recover' else 'normal']))
   self.assertEqual(state['mode'],'recovery' if fail or signal_phase or action=='recover' else 'normal')
   self.assertEqual(state['running'],not ('normal' in fail and 'recovery' in fail))
   self.assertTrue(all(a[2]==service for a in events if a[:2] in [('systemctl','start'),('systemctl','stop')]))
 def test_deploy_normal(self):self.exercise()
 def test_normal_failure_recovers_compatible(self):self.exercise(fail=('normal',))
 def test_both_fail_leave_compatible_override_and_stopped_frontend(self):self.exercise(fail=('normal','recovery'))
 def test_explicit_recovery(self):self.exercise(initial='normal',action='recover')
 def test_resume_from_compatible_recovery(self):self.exercise(initial='recovery',action='resume')
 def test_real_process_signals(self):
  if os.environ.get('YNX_FIXTURE_SIGNAL_PHASE'):return
  for phase in ['stop','dropin','start']:
   for sig in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]:
    with self.subTest(phase=phase,signal=sig),tempfile.TemporaryDirectory() as directory:
     marker=pathlib.Path(directory)/'entered';env={**os.environ,'YNX_FIXTURE_SIGNAL_PHASE':phase,'YNX_FIXTURE_SIGNAL_MARKER':str(marker)}
     child=subprocess.Popen([sys.executable,__file__,'Lifecycle.test_deploy_normal'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
     try:
      deadline=time.monotonic()+5
      while not marker.exists() and child.poll() is None and time.monotonic()<deadline:time.sleep(.02)
      self.assertTrue(marker.exists(),'Child did not reach '+phase)
      child.send_signal(sig);out,err=child.communicate(timeout=8)
      self.assertEqual(child.returncode,0,out+err)
      self.assertIn('compatibleRecoveryRunning',out)
      print('Actual subprocess signal recovery PASS',phase,sig)
     finally:
      if child.poll() is None:child.kill();child.wait()
if __name__=='__main__':unittest.main()
