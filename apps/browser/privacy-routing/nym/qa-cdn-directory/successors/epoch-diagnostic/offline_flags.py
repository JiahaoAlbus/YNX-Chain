"""Only two new real CLI rejection cases; no sockets, profiles or normal authority."""
import argparse, hashlib, json, os, selectors, subprocess, time
from pathlib import Path

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main():
    p=argparse.ArgumentParser();p.add_argument('--feature-on',type=Path,required=True);p.add_argument('--feature-on-sha256',required=True)
    p.add_argument('--default-off',type=Path,required=True);p.add_argument('--default-off-sha256',required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();os.umask(0o077)
    if sha(a.feature_on)!=a.feature_on_sha256 or sha(a.default_off)!=a.default_off_sha256:raise ValueError('binary-pin')
    a.output.mkdir(mode=0o700,exist_ok=False);children=[];records=[];failure=None
    def run(label,command,required):
        home=a.output/(label+'-nym-home');home.mkdir(mode=0o700)
        env={k:os.environ[k] for k in ['HOME','USER','LOGNAME','LANG'] if k in os.environ}
        env.update(PATH='/usr/bin:/bin',NYM_HOME_DIR=str(home),NO_COLOR='1',RUST_LOG='error')
        child=subprocess.Popen(command,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        children.append(child)  # Immediate retained original handle, same owned probe group.
        begun=time.monotonic();data=[bytearray(),bytearray()];eof=[False,False];selector=selectors.DefaultSelector()
        try:
            for index,pipe in enumerate((child.stdout,child.stderr)):
                os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,index)
            while child.poll() is None or selector.get_map():
                if time.monotonic()-begun>=3:raise ValueError('new-flag-case-deadline')
                for key,_ in selector.select(.05):
                    block=os.read(key.fileobj.fileno(),1024);index=key.data
                    if not block:selector.unregister(key.fileobj);key.fileobj.close();eof[index]=True;continue
                    if len(data[index])+len(block)>8192:raise ValueError('new-flag-output-bound')
                    data[index].extend(block)
            code=child.wait()
            if code==0 or required not in bytes(data[0]+data[1]) or not all(eof) or any(home.rglob('*')):
                raise ValueError('expected-new-flag-refusal-not-proven')
            records.append(dict(label=label,pid=child.pid,exit=code,reaped=True,bothEOF=eof,
                                NYMHomeFileCount=0,elapsedSeconds=time.monotonic()-begun,
                                stdoutBytes=len(data[0]),stderrBytes=len(data[1]),requiredFixedError=required.decode('ascii')))
        finally:
            selector.close()
            if child.poll() is None:
                child.kill();child.wait(timeout=2)
            for pipe in (child.stdout,child.stderr):
                if not pipe.closed:pipe.close()
    try:
        run('default-off-refuses-epoch-command',[str(a.default_off),'--no-banner','ynx-qa-cdn-directory','--epoch-metadata-only'],b'unrecognized subcommand')
        run_id='qa-dir-'+'1'*32
        plan={'schema':'YNX_NYM_QA_CDN_DIRECTORY_V1','purpose':'fresh-complete-directory-only','runID':run_id,'issuedAt':1,'expiresAt':2,
              'networkDefaultsSHA256':'596d541b58fdfe26082f858437165969a3933316482c279efbd21f5494b55a7b','origin':'https://cdn1.media-platform.net','addresses':['172.104.178.252']}
        path=a.output/'expired-plan.json';path.write_text(json.dumps(plan)+'\n');path.chmod(0o600)
        run('expired-plan-with-epoch-flag',[str(a.feature_on),'--no-banner','ynx-qa-cdn-directory','--plan',str(path),'--plan-sha256',sha(path),'--run-id',run_id,'--epoch-metadata-only'],b'qa-directory-plan-binding')
    except BaseException as error:failure={'type':type(error).__name__,'message':str(error)}
    finally:
        for child in children:
            if child.poll() is None:child.kill()
            child.wait(timeout=2)
        receipt=dict(schema='P05_NYM_TWO_NEW_EPOCH_FLAG_REJECTIONS_V1',firstFailure=failure,records=records,
                     remainingOwned=[c.pid for c in children if c.poll() is None],old11Rerun=False,normalAuthority=False)
        (a.output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    if failure or len(records)!=2:raise SystemExit(1)

if __name__=='__main__':main()
