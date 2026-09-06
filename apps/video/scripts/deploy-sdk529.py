#!/usr/bin/env python3
"""Coordinator-only frontend switch. Never restores an incompatible predecessor."""
import argparse, hashlib, json, os, pathlib, re, signal, subprocess, sys, tarfile, time, urllib.request, urllib.error, tempfile
class ReleaseInterrupted(BaseException): pass
SDK='529471f3822d2bac43ea47a1ab8004fa2ae79885'
AUTH='8dad0bab8f6f711e6ca6037201eec5725f9a6a02'
def digest(data): return hashlib.sha256(data).hexdigest()
def require(condition,message):
    if not condition: raise RuntimeError(message)
def run(*args): return subprocess.check_output(args,text=True).strip()
def prop(unit,name): return run('systemctl','show',unit,'-p',name,'--value')
def http(port,path):
    request=urllib.request.Request('http://127.0.0.1:'+str(port)+path,headers={'x-request-id':'req_sdk529_preflight'})
    try:
        with urllib.request.urlopen(request,timeout=8) as response: return response.status,dict(response.headers),response.read()
    except urllib.error.HTTPError as error: return error.code,dict(error.headers),error.read()
def unit_identity(unit,port=None):
    pid=int(prop(unit,'MainPID'));require(pid>1 and prop(unit,'ActiveState')=='active','Service is not active: '+unit)
    cwd=os.path.realpath('/proc/'+str(pid)+'/cwd')
    require(cwd==os.path.realpath(prop(unit,'WorkingDirectory') or '/'),'Process cwd differs from declared directory')
    argv=pathlib.Path('/proc/'+str(pid)+'/cmdline').read_bytes().split(b'\0')
    if port:
        require(('pid='+str(pid)+',') in run('ss','-ltnp','sport = :'+str(port)), 'Socket owner mismatch: '+unit)
        require(any(value.decode(errors='strict')==cwd+'/server.mjs' for value in argv),'Unexpected frontend argv')
    return {'unit':unit,'pid':pid,'cwd':cwd,'execSHA256':digest(pathlib.Path('/proc/'+str(pid)+'/exe').read_bytes()),'argvSHA256':digest(b'\0'.join(argv)),'started':prop(unit,'ExecMainStartTimestampMonotonic')}
def file_entries(manifest):
    return {item['path']:{'sha256':item['sha256'],'bytes':item['bytes']} for item in manifest['files']} if isinstance(manifest['files'],list) else manifest['files']
def validate_files(directory,name,source=None):
    directory=pathlib.Path(directory);raw=(directory/name).read_bytes();manifest=json.loads(raw)
    if source: require(manifest['sourceCommit']==source,'Runtime source mismatch')
    entries=file_entries(manifest)
    for name,item in entries.items():
        path=pathlib.PurePosixPath(name)
        require(not path.is_absolute() and '..' not in path.parts,'Invalid manifest path')
        target=directory/name;require(target.is_file() and not target.is_symlink(),'Nonregular runtime file')
        data=target.read_bytes();require(len(data)==item['bytes'] and digest(data)==item['sha256'],'Runtime bytes differ: '+name)
    return manifest,raw

def materialize(info,source,archive_root):
    archive=pathlib.Path(archive_root)/info['archive'];data=archive.read_bytes()
    require(len(data)==info['bytes'] and digest(data)==info['sha256'],'Archive identity mismatch')
    directory=pathlib.Path(info['directory'])
    if not directory.exists():
        directory.parent.mkdir(parents=True,exist_ok=True)
        stage=pathlib.Path(tempfile.mkdtemp(prefix='.sdk529-stage-',dir=directory.parent))
        try:
            with tarfile.open(archive,'r:gz') as tar:
                members=tar.getmembers()
                for member in members:
                    path=pathlib.PurePosixPath(member.name)
                    require(not path.is_absolute() and '..' not in path.parts and (member.isdir() or member.isfile()),'Unsafe archive member')
                    parts=list(path.parts)
                    if info['stripRuntime']:
                        require(parts and parts.pop(0)=='runtime','Archive prefix mismatch')
                    if not parts: continue
                    target=stage.joinpath(*parts)
                    if member.isdir(): target.mkdir(parents=True,exist_ok=True);target.chmod(0o755)
                    else:
                        target.parent.mkdir(parents=True,exist_ok=True)
                        require(not target.exists(),'Duplicate archive member')
                        with tar.extractfile(member) as stream: target.write_bytes(stream.read())
                        target.chmod(0o644)
            validate_payload(stage,info,source)
            stage.chmod(0o755);stage.rename(directory)
        except BaseException:
            # Failed staging is retained for review, not substituted for a release.
            raise
    validate_payload(directory,info,source)

def validate_payload(directory,info,source):
    manifest,raw=validate_files(directory,info['manifest'],source)
    require(digest(raw)==info['manifestSHA256'],'Manifest digest mismatch')
    expected=set(file_entries(manifest))|{info['manifest']}
    actual={str(path.relative_to(directory)) for path in pathlib.Path(directory).rglob('*') if path.is_file()}
    require(expected==actual,'Unexpected or absent runtime files')
    sdk=json.loads((pathlib.Path(directory)/'product-session-sdk-source.json').read_text())
    require(sdk['sdkSourceCommit']==SDK and sdk['sourceArchive']['sha256']=='68a4d192c2a7d82d1ea3f69fe6fe6e7d9c670ce7e4ca29b06fea0341ca4e0e18','Incompatible recovery SDK')
    for item in sdk['files']:
        require(digest((pathlib.Path(directory)/item['path']).read_bytes())==item['sha256'],'SDK file mismatch')
    run('/usr/bin/node','--check',str(pathlib.Path(directory)/'server.mjs'))
    return manifest

def config_bytes(info):
    directory=info['directory'];return ('[Service]\nWorkingDirectory='+directory+'\nExecStart=\nExecStart=/usr/bin/node '+directory+'/server.mjs\n').encode()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('envelope');parser.add_argument('envelope_sha256');parser.add_argument('product',choices=['creator','viewer']);parser.add_argument('action',choices=['preflight','deploy','recover','resume']);parser.add_argument('--archive-root',default='/var/tmp')
    args=parser.parse_args();require(os.geteuid()==0,'Run via sudo')
    raw=pathlib.Path(args.envelope).read_bytes();require(digest(raw)==args.envelope_sha256,'Unreviewed envelope bytes');envelope=json.loads(raw)
    source=envelope['sourceCommit'];require(re.fullmatch('[0-9a-f]{40}',source),'Invalid source')
    p=envelope['products'][args.product];unit=p['unit'];dropin=pathlib.Path('/etc/systemd/system/'+unit+'.d/20260906-zz-sdk529.conf')
    require(prop(unit,'User')=='ynx','Unexpected service user')
    original_env=digest((prop(unit,'Environment')+'\n'+prop(unit,'EnvironmentFiles')).encode())
    def preserved():
        peers=[]
        for mode,peer in envelope['products'].items():
            if mode!=args.product:
                identity=unit_identity(peer['unit'],peer['port']);cwd=pathlib.Path(identity['cwd'])
                name='creator-studio.manifest.json' if (cwd/'creator-studio.manifest.json').exists() else 'runtime-manifest.json'
                _,data=validate_files(cwd,name);identity['manifestSHA256']=digest(data);peers.append(identity)
        for name in ['ynx-videod.service','ynx-wallet-gateway.service']:peers.append(unit_identity(name))
        config={path:digest(pathlib.Path(path).read_bytes()) for path in envelope['preservedFiles']}
        return {'peers':peers,'config':config,'videoCurrent':os.path.realpath('/opt/ynx-video/current'),'videoVersion':digest(http(6493,'/version')[2])}
    before=preserved()
    for path,sha in p['oldDropIns'].items():require(digest(pathlib.Path(path).read_bytes())==sha,'Predecessor drop-in changed')
    expected_dropins=list(p['oldDropIns'])
    live=unit_identity(unit,p['port'])
    if dropin.exists():
        require(dropin.read_bytes() in [config_bytes(p['normal']),config_bytes(p['recovery'])],'Unowned deployment drop-in')
        require(live['cwd'] in [p['normal']['directory'],p['recovery']['directory']],'Unexpected active candidate')
        require(dropin.read_bytes()==config_bytes(p['normal'] if live['cwd']==p['normal']['directory'] else p['recovery']),'Declared/runtime identity diverged')
        expected_dropins.append(str(dropin))
        require(args.action!='deploy','Already switched; use recover or resume')
    else:
        require(args.action in ['preflight','deploy'],'No compatible deployment to recover or resume')
        require(live['cwd']==p['oldDirectory'],'Public predecessor changed')
        _,old=validate_files(live['cwd'],p['oldManifest']);require(digest(old)==p['oldManifestSHA256'],'Predecessor manifest changed')
    require(prop(unit,'DropInPaths').split()==sorted(expected_dropins),'Unexpected drop-in set/order')
    for mode in ['recovery','normal']:materialize(p[mode],source,args.archive_root)
    # Authority may not be weakened to an earlier implementation.
    require(prop('ynx-wallet-gateway.service','WorkingDirectory')==envelope['authDirectory'],'Auth compatible baseline changed')
    code,_,version=http(18445,'/version');require(code==200 and json.loads(version).get('build',{}).get('sourceCommit')==AUTH,'Auth live source does not match compatible baseline')
    code,_,body=http(18445,'/v2/product-sessions/time');require(code==200 and json.loads(body).get('ok') is True,'Authority time unavailable')
    require(preserved()==before,'Neighbor/config changed during preparation')
    require(unit_identity(unit,p['port'])==live,'Selected frontend changed during preparation')
    if args.action=='preflight':print(json.dumps({'stagedAndVerified':True,'sourceCommit':source,'product':args.product,'selected':live,'installedWalletApprovalVerified':False}));return
    receipt_dir=pathlib.Path('/var/lib/ynx-product-frontend-releases')/(source+'-'+args.product);receipt_dir.mkdir(parents=True,exist_ok=True);receipt_dir.chmod(0o700)
    stamp=str(time.time_ns());(receipt_dir/(stamp+'-before.json')).write_text(json.dumps({'source':source,'product':args.product,'action':args.action,'selected':live,'preserved':before,'environmentSHA256':original_env},indent=2));os.chmod(receipt_dir/(stamp+'-before.json'),0o600)
    mutation_attempted=False
    def switch(mode):
        nonlocal mutation_attempted
        info=p[mode];validate_payload(info['directory'],info,source)
        require(preserved()==before,'Neighbor/config drift: refusing switch')
        require(digest((prop(unit,'Environment')+'\n'+prop(unit,'EnvironmentFiles')).encode())==original_env,'Environment changed')
        mutation_attempted=True
        run('systemctl','stop',unit)
        require(prop(unit,'MainPID')=='0','Selected frontend did not stop')
        tmp=dropin.with_suffix('.tmp');tmp.write_bytes(config_bytes(info));tmp.chmod(0o644);tmp.replace(dropin)
        run('systemctl','daemon-reload')
        require(prop(unit,'WorkingDirectory')==info['directory'],'Wrong merged working directory')
        require(digest((prop(unit,'Environment')+'\n'+prop(unit,'EnvironmentFiles')).encode())==original_env,'Environment changed after merge')
        run('systemctl','start',unit)
        for attempt in range(40):
            try:
                identity=unit_identity(unit,p['port']);require(identity['cwd']==info['directory'],'Wrong selected runtime')
                status,headers,body=http(p['port'],'/'+info['manifest']);require(status==200 and digest(body)==info['manifestSHA256'],'Served manifest mismatch')
                require(headers.get('Cache-Control')=='no-store','Manifest cache policy mismatch');break
            except Exception:
                if attempt==39:raise
                time.sleep(.25)
        manifest=validate_payload(info['directory'],info,source)
        for name,item in file_entries(manifest).items():
            if name in ['server.mjs','package.json'] or name.startswith('runtime/'):continue
            status,headers,body=http(p['port'],'/'+name)
            require(status==(503 if mode=='recovery' and name=='index.html' else 200) and digest(body)==item['sha256'],'Public file mismatch: '+name)
            require(headers.get('Cache-Control')=='no-store','Public cache policy mismatch')
        status,headers,body=http(p['port'],'/wallet-auth/callback')
        require(status==(503 if mode=='recovery' else 200),'Callback mode mismatch')
        expected='index.html' if mode=='recovery' else 'wallet-callback.html';require(digest(body)==file_entries(manifest)[expected]['sha256'],'Callback bytes mismatch')
        require(preserved()==before,'Neighbor/config drift after switch')
        require(prop(unit,'DropInPaths').split()==sorted(list(p['oldDropIns'])+[str(dropin)]),'Unexpected merged drop-ins')
        return identity
    target='recovery' if args.action=='recover' else 'normal'
    watched=(signal.SIGTERM,signal.SIGHUP,signal.SIGINT)
    previous_handlers={sig:signal.getsignal(sig) for sig in watched}
    def interrupted(sig,frame):raise ReleaseInterrupted('Release interrupted by signal '+str(sig))
    for sig in watched:signal.signal(sig,interrupted)
    try:
        result=switch(target)
    except BaseException as error:
        if not mutation_attempted:raise
        for sig in watched:signal.signal(sig,signal.SIG_IGN)
        print(json.dumps({'deploymentFailed':str(error),'compatibleRecoveryAttempted':True}),flush=True)
        try:
            recovery=switch('recovery');print(json.dumps({'compatibleRecoveryRunning':recovery,'sourceCommit':source}),flush=True)
        except BaseException as recovery_error:
            # Never remove this guard or start the ff68 predecessor. Keep the
            # compatible recovery override even if normal/recovery startup fails.
            run('systemctl','stop',unit)
            dropin.write_bytes(config_bytes(p['recovery']));dropin.chmod(0o644);run('systemctl','daemon-reload')
            print(json.dumps({'selectedFrontendStopped':True,'reason':str(recovery_error),'dataPreserved':True}),flush=True)
        raise
    finally:
        for sig,handler in previous_handlers.items():signal.signal(sig,handler)
    receipt={'sourceCommit':source,'product':args.product,'mode':target,'selected':result,'preserved':preserved(),'environmentSHA256':original_env,'installedWalletApprovalVerified':False,'completedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    path=receipt_dir/(stamp+'-after.json');path.write_text(json.dumps(receipt,indent=2));path.chmod(0o600);print(json.dumps(receipt,indent=2))
if __name__=='__main__':main()
