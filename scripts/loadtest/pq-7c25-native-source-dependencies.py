"""Complete the frozen normal CGO source closure in its private build view.

Original production/optional composer bytes and six-root selection are retained.
Only these original7c supporting source files are added; no authority or build
permission, compiler/security flag, module descriptor, or original checkout changes.
"""
import hashlib,json,os,re,stat,subprocess,time
from pathlib import Path,PurePosixPath
SOURCE='7c25cbcc7d31b10743e26ae1ddca745085ee1b0b'
TREE='8a90d4ceb86a3a9460648e011bfed9f2e3ac1f4a'
HELD_SOURCE='19485259d6f0440c89a3d31e27b97de25a8cd12f'
HELD_TREE='3a6f9a5efe4e0257eab8edc1a62d52631281d5b2'
HELD_CI_SOURCE='a11754cc649121f2cec553d5b2ed5a784a1e3f99'
HELD_CI_TREE='737ac34a1658e23d8ec03c65a099a44f9cbf8eb1'
HELD_GATE_SOURCE='b70d3a25e83ac6bfb064c3f448952fcabaa70ed8'
HELD_GATE_TREE='90a8f8fd3fc043fb336d676e9a43d8f930f0b327'
HELD_PATCHED_SOURCE="2db09bd8e6178221ddd61b4522762947782f1ff5"
HELD_PATCHED_TREE="63b2ec94f847a978fafb7d96a35856653d6e342a"
HELD_GETTER_SOURCE="8e0e6b94254a2ae8c1508e1b55014b4d845b4dc2"
HELD_GETTER_TREE="1db9efadc9c1d12dc21890bd6bf0614cf81e6fd9"
HELD_SOURCE_TREES={HELD_SOURCE:HELD_TREE, HELD_CI_SOURCE:HELD_CI_TREE,
                   HELD_GATE_SOURCE:HELD_GATE_TREE, HELD_PATCHED_SOURCE:HELD_PATCHED_TREE,
                   HELD_GETTER_SOURCE:HELD_GETTER_TREE}
SOURCE_TREES={SOURCE:TREE, **HELD_SOURCE_TREES}
FILES={'packages/wallet-auth/go/sourceparentprofile/canonical.cpp': {'mode': '100644',
                                                               'gitBlob': 'b5bdced61b6754b088980d736bc9ca027592a9b7',
                                                               'bytes': 62,
                                                               'sha256': '6b0ae48f4eb5aa62b9e9845e96df1beaeadec2a66fc0f83736a2c584062ee49c',
                                                               'includes': ['packages/wallet-auth/native/source-parent/MobileCanonicalDATA.cpp']},
 'packages/wallet-auth/go/sourceparentprofile/inventory.cpp': {'mode': '100644',
                                                               'gitBlob': '1d8c740c86fd674b63690c3374a934f9a430a4d4',
                                                               'bytes': 63,
                                                               'sha256': '0d2c369e9e4787adff266eefafec296b80c80fdbf3ac4fcc80ebaa97b86de6f2',
                                                               'includes': ['packages/wallet-auth/native/source-parent/SourceParentProfileC.cpp']},
 'packages/wallet-auth/go/sourceparentprofile/original.cpp': {'mode': '100644',
                                                              'gitBlob': '5a10c546a74e7f12869cc375905696756c838157',
                                                              'bytes': 70,
                                                              'sha256': '423e51d2791e5857c8311c20c8fcee9355526b2c063cbdf146214f9877afb62d',
                                                              'includes': ['packages/wallet-auth/native/source-parent/SourceParentOriginalProfile.cpp']},
 'packages/wallet-auth/go/sourceparentprofile/profile.go': {'mode': '100644',
                                                            'gitBlob': '5902a504122432d458adc4477816f37becd0e95e',
                                                            'bytes': 4298,
                                                            'sha256': '30231b0651967201e21fa55eefe7779661514d8c61d8367e2b90244b62d34788',
                                                            'includes': ['packages/wallet-auth/native/source-parent/SourceParentProfileCPrivate.h']},
 'packages/wallet-auth/native/source-parent/MobileCanonicalDATA.cpp': {'mode': '100644',
                                                                       'gitBlob': '7c1fcd72773e3d4649690d95a03acada474c7048',
                                                                       'bytes': 5243,
                                                                       'sha256': '088924c5a093d3f15ff11de2c3ce00dec5a4ed0d35fb1832508a32f1095fe556',
                                                                       'includes': ['packages/wallet-auth/native/source-parent/MobileCanonicalDATA.hpp']},
 'packages/wallet-auth/native/source-parent/MobileCanonicalDATA.hpp': {'mode': '100644',
                                                                       'gitBlob': 'f5792d496fa797f482be91368dbc8bb14be1c34e',
                                                                       'bytes': 1495,
                                                                       'sha256': '6658eafc777a860d1ce20f8a97617d82e816dab6b88b8b15c043a0f16d8d26a7',
                                                                       'includes': []},
 'packages/wallet-auth/native/source-parent/SourceParentOriginalProfile.cpp': {'mode': '100644',
                                                                               'gitBlob': '11cd50bc5c2ce2c40820688cfa5f3e5b6052dcf7',
                                                                               'bytes': 16452,
                                                                               'sha256': '89d4f217e6deea1944a13e07604d0c56c5923b918369ba40b8c8759a3e5c4e60',
                                                                               'includes': ['packages/wallet-auth/native/source-parent/SourceParentOriginalProfilePrivate.hpp',
                                                                                            'packages/wallet-auth/native/source-parent/SourceParentReviewedProfilePrivate.hpp',
                                                                                            'packages/wallet-auth/native/source-parent/MobileCanonicalDATA.hpp']},
 'packages/wallet-auth/native/source-parent/SourceParentOriginalProfilePrivate.hpp': {'mode': '100644',
                                                                                      'gitBlob': '1677d6979f303dfca384f668136459b44b68ff92',
                                                                                      'bytes': 1711,
                                                                                      'sha256': '390eb2da9217acdedff8200c8b2c477b277e2d9bbee7652d9e8148883179ef9b',
                                                                                      'includes': []},
 'packages/wallet-auth/native/source-parent/SourceParentProfileC.cpp': {'mode': '100644',
                                                                        'gitBlob': '4238c5fc327ea46ae2b2f6891c61127e5a1e460b',
                                                                        'bytes': 3876,
                                                                        'sha256': '44a14f3ef40d2f474d1fc544389cca18688625d4dee5b19f4dc5efd6e073f04a',
                                                                        'includes': ['packages/wallet-auth/native/source-parent/SourceParentProfileCPrivate.h',
                                                                                     'packages/wallet-auth/native/source-parent/SourceParentOriginalProfilePrivate.hpp']},
 'packages/wallet-auth/native/source-parent/SourceParentProfileCPrivate.h': {'mode': '100644',
                                                                             'gitBlob': '3b4e23fa6fc2583e5f38c5f45b7eb7cb0e36f987',
                                                                             'bytes': 1608,
                                                                             'sha256': 'f631d68d5abae5c1814f0a213599c437aa5428354b417c21e969ff7248775c63',
                                                                             'includes': []},
 'packages/wallet-auth/native/source-parent/SourceParentReviewedProfilePrivate.hpp': {'mode': '100644',
                                                                                      'gitBlob': '48593e779ee56e3c8a6f4535f05534e9235aebcf',
                                                                                      'bytes': 773,
                                                                                      'sha256': 'e9ff75c819a1d1b948018d1b3e866ac7f60447e53fdcf5e3c555eef7eda276fe',
                                                                                      'includes': []}}

def require(ok,message):
    if not ok:raise RuntimeError(message)

def git(source,*args):
    return subprocess.check_output(['git','-C',str(source),*args],timeout=15,env=dict(os.environ,GIT_NO_LAZY_FETCH='1'))

def source_identity(source):
    require(source.is_absolute() and source.resolve(strict=True)==source and not source.is_symlink(),
            'canonical original source required')
    commit = git(source,'rev-parse','HEAD').decode().strip()
    tree = git(source,'rev-parse','HEAD^{tree}').decode().strip()
    require(SOURCE_TREES.get(commit) == tree
            and not git(source,'status','--porcelain','--untracked-files=all').strip(),
            'exact clean original7c source required')
    return commit, tree

def original_files(source):
    commit, _ = source_identity(source);result={}
    for name,ref in FILES.items():
        require(PurePosixPath(name).as_posix()==name and '..' not in PurePosixPath(name).parts
                and name.startswith('packages/wallet-auth/'),'closed original dependency path required')
        expected=(ref['mode']+' blob '+ref['gitBlob']+'\t'+name+'\0').encode()
        require(git(source,'ls-tree','-z',commit,'--',name)==expected,'original dependency Git mode/blob differs')
        raw=git(source,'cat-file','blob',ref['gitBlob'])
        require(len(raw)==ref['bytes']<=1<<20 and hashlib.sha256(raw).hexdigest()==ref['sha256'],
                'original dependency bytes differ')
        result[name]=raw
    return result

def write_exclusive(root,name,raw):
    parts=PurePosixPath(name).parts
    require(parts and not PurePosixPath(name).is_absolute() and '..' not in parts,'relative dependency destination required')
    fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            try:os.mkdir(part,0o700,dir_fd=fd)
            except FileExistsError:pass
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child
        output=os.open(parts[-1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
        try:
            require(stat.S_ISREG(os.fstat(output).st_mode) and os.fstat(output).st_nlink==1,
                    'exclusive regular source destination required')
            pending=memoryview(raw)
            while pending:
                count=os.write(output,pending);require(count>0,'short dependency source write');pending=pending[count:]
            os.fchmod(output,0o644);os.fsync(output)
        finally:os.close(output)
    finally:os.close(fd)

def materialize(source,build_source,receipt):
    started=time.monotonic_ns();source=Path(source);build_source=Path(build_source);receipt=Path(receipt)
    require(build_source.is_absolute() and build_source.resolve(strict=True)==build_source and not build_source.is_symlink(),
            'canonical original private build root required')
    require(receipt.is_absolute() and receipt.parent.resolve(strict=True)==build_source.parent
            and receipt.name=='SOURCE-NATIVE-DEPENDENCIES.json','fresh sibling dependency receipt required')
    require(source!=build_source and source not in build_source.parents and build_source not in source.parents,
            'private build must be disjoint from original source')
    commit, tree = source_identity(source)
    blobs=original_files(source)
    before={name:hashlib.sha256((build_source/name).read_bytes()).hexdigest()
            for name in ('go.mod','go.sum','third_party/cometbft/go.mod','third_party/cometbft/go.sum')}
    for name,raw in blobs.items():write_exclusive(build_source,name,raw)
    require(before=={name:hashlib.sha256((build_source/name).read_bytes()).hexdigest() for name in before},
            'original module descriptors changed during supporting source copy')
    require(source_identity(source) == (commit, tree), 'original native dependency source changed')
    value=dict(schema='YNX-PERF-ORIGINAL-CGO-SOURCE-DEPENDENCIES/v1',source=commit,sourceTree=tree,
        buildSource=str(build_source),files=[dict(path=name,**ref) for name,ref in FILES.items()],
        fileCount=len(FILES),sourceBytes=sum(ref['bytes'] for ref in FILES.values()),
        moduleDescriptorSHA256=before,elapsedNs=time.monotonic_ns()-started,
        originalSixRootComposerReused=True,originalSixRootReceiptIncludesTheseFiles=False,
        originalCheckoutWritten=False,sourceBytesChanged=False,compilerOrSecurityFlagsChanged=False,
        cgoDisabled=False,goModReadonlyPreserved=True,binaryBuilt=False,nodeStarted=False,
        sourceOnly=True,authorityGranted=False,pressureAuthorized=False,intervalsOverlap=True)
    raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
    write_exclusive(receipt.parent,receipt.name,raw)
    return dict(receiptPath=str(receipt),receiptBytes=len(raw),receiptSHA256=hashlib.sha256(raw).hexdigest(),
        sourceDependencies=value)
