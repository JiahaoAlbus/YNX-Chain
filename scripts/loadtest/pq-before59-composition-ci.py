"""Reproduce only the fixed before59 source composition, never a node/window."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time

SOURCE='de54c52b669ad56ebc702a484e2eaca51d0efc2e'
TREE='d22b51801073930a4715dcea20b0320259d27fb4'
FORK='5a128880d14bfc73de4334cba23218859ad3473c'
SUPPLIER='5a49f5c91452604dffb910df736702b3b9df2562'
SUPPLIER_TREE='08747364c24c065bf2b13527c210625d7ec95fba'
COMPOSER_SHA256='e35ff39c10090e9200bdabf7b265c1fd211fd2ae4d227ffaae52054c6dbc2fac'

def require(ok,message):
    if not ok:raise RuntimeError(message)

def git(root,*args):
    return subprocess.check_output(['git','-C',str(root),*args],text=True,timeout=20,
        env=dict(os.environ,GIT_NO_LAZY_FETCH='1',GIT_OPTIONAL_LOCKS='0')).strip()

def digest_regular(path):
    fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
    try:
        initial=os.fstat(fd)
        require(stat.S_ISREG(initial.st_mode) and initial.st_nlink==1 and initial.st_size>0,
                'original built binary must be a nonempty single-link regular file')
        h=hashlib.sha256()
        while True:
            part=os.read(fd,1<<20)
            if not part:break
            h.update(part)
        final=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        fields=lambda value:(value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns,value.st_nlink)
        require(fields(initial)==fields(final)==fields(named),'original built binary changed during readback')
        return dict(bytes=initial.st_size,sha256=h.hexdigest())
    finally:os.close(fd)

def run(repository,temp_root,*,require_linux=True,evidence_dir=None,ci_identity=None):
    require(not require_linux or sys.platform=='linux','actual Linux original composition required')
    repository=Path(repository);temp_root=Path(temp_root)
    require(repository.is_absolute() and repository.resolve(strict=True)==repository
        and temp_root.is_absolute() and temp_root.resolve(strict=True)==temp_root
        and not repository.is_symlink() and not temp_root.is_symlink(),
        'canonical original repository and private temporary root required')
    if ci_identity is not None:
        require(type(ci_identity) is dict and set(ci_identity)=={'toolSource','run','attempt','job'}
            and type(ci_identity['toolSource']) is str and re.fullmatch('[0-9a-f]{40}',ci_identity['toolSource'])
            and type(ci_identity['run']) is int and ci_identity['run']>0 and type(ci_identity['attempt']) is int
            and ci_identity['attempt']==1 and ci_identity['job']=='before59-original-composition'
            and git(repository,'rev-parse','HEAD')==ci_identity['toolSource'],
            'exact original source-only Tools run identity required')
    require(git(repository,'rev-parse',SOURCE+'^{commit}')==SOURCE
        and git(repository,'rev-parse',SOURCE+'^{tree}')==TREE
        and git(repository,'rev-parse',SOURCE+':third_party/cometbft')==FORK
        and git(repository,'rev-parse',SUPPLIER+':third_party/cometbft')==SUPPLIER_TREE,
        'exact already-present before59/supplier Git objects required')
    started=time.monotonic_ns()
    private=Path(tempfile.mkdtemp(prefix='before59-source-only-',dir=temp_root)).resolve(strict=True)
    source=private/'original';output=private/'composed'
    # Only the exact immutable Git object is used; never fetch or infer an
    # alternative source and never run the resulting program.
    subprocess.run(['git','-C',str(repository),'worktree','add','--detach',str(source),SOURCE],
        check=True,timeout=120,env=dict(os.environ,GIT_NO_LAZY_FETCH='1'))
    spec=importlib.util.spec_from_file_location('before59_original_normal_reader',
        Path(__file__).with_name('pq-normal-live-reader.py'))
    reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
    result=reader.prepare_matching_source(source,output,held_source_only=True)
    require(result['source']==dict(commit=SOURCE,tree=TREE,forkTree=FORK)
        and result['optionalForkCommit']==SUPPLIER and result['optionalForkTree']==SUPPLIER_TREE
        and result['compositionScriptSHA256']==COMPOSER_SHA256 and result['sourceCompositionOnly'] is True
        and result['sourceCIQualified'] is False and result['runtimeAuthorized'] is False
        and result['pressureAuthorized'] is False and result['actualNetworkWindow'] is False,
        'original source-only composition scope differs')
    selection=output/'SOURCE-SELECTION.json';dependencies=output/'SOURCE-NATIVE-DEPENDENCIES.json'
    native=json.loads(dependencies.read_bytes())
    selection_pin=hashlib.sha256(selection.read_bytes()).hexdigest()
    dependencies_pin=hashlib.sha256(dependencies.read_bytes()).hexdigest()
    require(native['source']==SOURCE and native['sourceTree']==TREE and native['fileCount']==11
        and native['sourceOnly'] is True and native['sourceBytesChanged'] is False
        and native['nodeStarted'] is False and native['pressureAuthorized'] is False,
        'original eleven source dependency closure differs')
    require(not git(source,'status','--porcelain','--untracked-files=all')
        and git(source,'rev-parse','HEAD')==SOURCE,'original before59 source changed')
    go=shutil.which('go');require(go is not None,'original pinned Go toolchain missing')
    env=dict(os.environ,GOTOOLCHAIN='local',GOMAXPROCS='1',GOMEMLIMIT='1536MiB')
    go_env=json.loads(subprocess.check_output([go,'env','-json','GOVERSION','GOOS','GOARCH','CGO_ENABLED'],
        cwd=output/'source',env=env,text=True,timeout=20))
    require(type(go_env) is dict and set(go_env)=={'GOVERSION','GOOS','GOARCH','CGO_ENABLED'}
        and go_env['GOVERSION']=='go1.26.11' and go_env['CGO_ENABLED']=='1'
        and (not require_linux or (go_env['GOOS'],go_env['GOARCH'])==('linux','amd64')),
        'exact original Go toolchain, platform and CGO required')
    binary=private/'ynx-comet'
    argv=[go,'build','-mod=readonly','-p','1','-trimpath','-buildvcs=false','-ldflags',
          '-X main.operatorCommitBuildSource='+SOURCE,'-tags','ynx_live_wire_observation','-o',str(binary),'./cmd/ynx-comet']
    subprocess.run(argv,cwd=output/'source',env=env,timeout=600,check=True)
    binary_pin=digest_regular(binary)
    info=subprocess.check_output([go,'version','-m',str(binary)],env=env,text=True,timeout=20)
    spec=importlib.util.spec_from_file_location('before59_original_build_info',Path(__file__).with_name('pq-before59-composition-readback.py'))
    readback=importlib.util.module_from_spec(spec);spec.loader.exec_module(readback)
    readback.validate_build_info(info.encode(),str(binary),go_env)
    declaration_raw=subprocess.check_output([str(binary),'synthetic-commit-clock-build-identity','--synthetic'],
        env=env,timeout=20)
    declaration=json.loads(declaration_raw)
    require(declaration.get('version')=='YNX-COMET-COMMIT-CLOCK-BUILD/v1'
        and declaration.get('sourceBinding')=='linker-declared-requires-original-manifest-build-binary-and-process-proof'
        and declaration.get('sourceRevision')==SOURCE and declaration.get('status')=='DECLARED'
        and declaration.get('syntheticOnly') is True and declaration.get('nodeStarted') is False
        and declaration.get('runtimeAuthorized') is False and digest_regular(binary)==binary_pin,
        'original synthetic binary declaration or stable binary differs')
    require(hashlib.sha256(selection.read_bytes()).hexdigest()==selection_pin
        and hashlib.sha256(dependencies.read_bytes()).hexdigest()==dependencies_pin
        and not git(source,'status','--porcelain','--untracked-files=all')
        and git(source,'rev-parse','HEAD')==SOURCE,'original source or manifests changed during build')
    for name in ('go.mod','go.sum','third_party/cometbft/go.mod','third_party/cometbft/go.sum'):
        require((source/name).read_bytes()==(output/'source'/name).read_bytes(),
                'original module descriptor changed during build')
    result=dict(schema='YNX-BEFORE59-ORIGINAL-COMPOSITION-CI/v1',source=SOURCE,tree=TREE,fork=FORK,
        supplier=SUPPLIER,supplierTree=SUPPLIER_TREE,composerSHA256=COMPOSER_SHA256,
        sourceSelectionSHA256=selection_pin,nativeDependenciesSHA256=dependencies_pin,
        nativeDependencyFiles=native['fileCount'],goVersion='go1.26.11',goEnv=go_env,platform=sys.platform,
        binary=binary_pin,buildArgv=argv,buildCwd=str(output/'source'),
        buildFlags=['-mod=readonly','-p=1','-trimpath','-buildvcs=false','-tags=ynx_live_wire_observation'],
        buildInfoSHA256=hashlib.sha256(info.encode()).hexdigest(),binaryDeclaration=declaration,
        sourceOnly=True,sourceCIQualified=False,
        runtimeAuthorized=False,pressureAuthorized=False,nodeStarted=False,
        elapsedNs=time.monotonic_ns()-started)
    if ci_identity is not None:
        require(git(repository,'rev-parse','HEAD')==ci_identity['toolSource'],
                'original Tools source changed during composition')
        result['originalToolsRun']=ci_identity
    if evidence_dir is not None:
        evidence_dir=Path(evidence_dir)
        require(evidence_dir.is_absolute() and evidence_dir.parent==temp_root and not evidence_dir.exists(),
                'new original source evidence directory required')
        evidence_dir.mkdir(mode=0o700)
        items={'SOURCE-SELECTION.json':selection.read_bytes(),'SOURCE-NATIVE-DEPENDENCIES.json':dependencies.read_bytes(),
               'GO-BUILD-INFO.txt':info.encode(),'SYNTHETIC-BUILD-IDENTITY.json':declaration_raw,
               'COMPOSITION-RECEIPT.json':(json.dumps(result,sort_keys=True)+'\n').encode()}
        for name,raw in items.items():
            fd=os.open(evidence_dir/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
            try:
                data=memoryview(raw)
                while data:
                    written=os.write(fd,data);require(written>0,'original source evidence write failed');data=data[written:]
                os.fsync(fd)
            finally:os.close(fd)
        folder=os.open(evidence_dir,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(folder)
        finally:os.close(folder)
    return result

def main():
    parser=argparse.ArgumentParser(allow_abbrev=False);parser.add_argument('--run',action='store_true');args=parser.parse_args()
    require(args.run,'explicit original source-only composition required')
    temp=os.environ.get('RUNNER_TEMP');require(type(temp) is str and temp,'original private runner temp required')
    root=Path(temp).resolve(strict=True)
    run_id=os.environ.get('GITHUB_RUN_ID','');attempt=os.environ.get('GITHUB_RUN_ATTEMPT','')
    require(re.fullmatch('[1-9][0-9]*',run_id) is not None and attempt=='1',
            'exact first-attempt source-only workflow identity required')
    identity=dict(toolSource=os.environ.get('GITHUB_SHA'),run=int(run_id),attempt=1,job=os.environ.get('GITHUB_JOB'))
    result=run(Path.cwd().resolve(),root,evidence_dir=root/'before59-composition-original',ci_identity=identity)
    print(json.dumps(result,sort_keys=True))

if __name__=='__main__':main()
