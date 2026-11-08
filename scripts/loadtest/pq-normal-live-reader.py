"""Consume Core's original private two-slot live CLI; never a publisher.

Source qualification pins the original matching normal source/module/tagged CI.
It permits only the selected finite baseline; source tests are not live data.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

_native_spec=importlib.util.spec_from_file_location('original_current7c_native_source',Path(__file__).with_name('pq-7c25-native-source-dependencies.py'))
native_source_dependencies=importlib.util.module_from_spec(_native_spec)
_native_spec.loader.exec_module(native_source_dependencies)

VERSION = 'YNX-OPERATOR-LIVE-WIRE/v1'
BUILD_TAG = 'ynx_live_wire_observation'
NORMAL_LIVE_SOURCE_QUALIFICATION = {'commit': '9081f14654a48f4fe14e57696ec33527869da353', 'tree': '8c12ec07479bf6664cf279adb6395c704ead33e1', 'forkTree': '54e88e6aba735eaceeb2d00bb40731248c673bd7', 'optionalForkCommit': '54b104fb1cdf3d7d2e89e3bc40eafc6d61f8f076', 'optionalForkTree': 'b1e9a83ab11ed141fda90bc47521faa412176caa', 'buildTag': 'ynx_live_wire_observation', 'compositionScriptSHA256': 'f9c83d7a7d7dc1c2ccbbd15795ba22b1d54e28a81d9084a813a8fb71c4b55839', 'ciEvidenceSHA256': '86e7ad98116af984eeb145c3bcf7b48d7a96da8ad897b3603cdd984527bf7f17', 'sourceCI': {'run': 41323073659, 'job': 124897263752, 'artifact': 13089839088}, 'scope': 'original normal online finite wire/TCP baseline only', 'pressureAuthorized': False}
LIMIT = 128 << 10


def require(value, message):
    if not value:
        raise RuntimeError(message)


def qualify(identity):
    # No caller override, ancestor inference or migration of the 896 init grant.
    if identity.get('commit') == '7c25cbcc7d31b10743e26ae1ddca745085ee1b0b':
        spec=importlib.util.spec_from_file_location('current7c_normal_live_source_data',Path(__file__).with_name('pq-7c25-live-source-data.py'))
        current=importlib.util.module_from_spec(spec);spec.loader.exec_module(current)
        q=current.qualification()
        require(all(identity[k]==q[k] for k in ('commit','tree','forkTree')) and q['buildTag']==BUILD_TAG,
                'exact current normal live source/module profile required')
        return dict(q)
    q = NORMAL_LIVE_SOURCE_QUALIFICATION
    require(q is not None, 'normal live source/module/tagged CI qualification not supplied')
    require(all(identity[k] == q[k] for k in ('commit', 'tree', 'forkTree')) and
            q['buildTag'] == BUILD_TAG and q['ciEvidenceSHA256'],
            'exact normal live source profile required')
    verify_qualification_evidence(q)
    return dict(q)


def verify_qualification_evidence(q):
    spec=importlib.util.spec_from_file_location('original_normal_live_source_data',Path(__file__).with_name('pq-normal-live-source-data.py'))
    original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
    require(original.qualification()==q,'original source-CI qualification differs')


def prepare_matching_source(source, destination):
    """Reuse Core's exact source composer in a supervised private helper."""
    def git(*args):
        return subprocess.check_output(['git','-C',str(source),*args],timeout=5).decode().strip()
    require(source.resolve(strict=True)==source and not git('status','--porcelain','--untracked-files=normal'),
            'original source must remain clean and canonical')
    identity=dict(commit=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}'),
                  forkTree=git('rev-parse','HEAD:third_party/cometbft'))
    q=qualify(identity)
    path=source/'scripts/verify/wire-live-matching-source-ci.py'
    require(not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest()==q['compositionScriptSHA256'],
            'exact original Core composition callee required')
    spec=importlib.util.spec_from_file_location('original_core_live_composer',path)
    core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
    require(git('rev-parse',q['optionalForkCommit']+':third_party/cometbft')==q['optionalForkTree'],
            'actual selected matching module object differs')
    if identity['commit'] != '7c25cbcc7d31b10743e26ae1ddca745085ee1b0b':
        require(core.PRODUCTION_TREE==identity['forkTree'] and core.FORK_COMMIT==q['optionalForkCommit'] and
                core.FORK_TREE==q['optionalForkTree'], 'original legacy source/module identities differ')
    prepared=core.prepare_wire_live_source(source,destination,identity['commit'],identity['tree'])
    build_source=destination/'source'
    receipt_path=destination/'SOURCE-SELECTION.json'
    require(prepared['sourceDirectory']==str(build_source) and prepared['receiptPath']==str(receipt_path),
            'original Core prepared source path differs')
    raw=receipt_path.read_bytes()
    selection=json.loads(raw)
    require(len(raw)<=64<<10 and len(raw)==prepared['receiptBytes'] and
            hashlib.sha256(raw).hexdigest()==prepared['receiptSHA256'] and selection==prepared['sourceSelection'],
            'original Core source-selection receipt changed')
    require(selection['originalSourceCommit']==identity['commit'] and selection['originalSourceTree']==identity['tree'] and
            selection['originalProductionForkTree']==identity['forkTree'] and
            selection['selectedOptionalForkCommit']==q['optionalForkCommit'] and selection['selectedOptionalForkTree']==q['optionalForkTree'] and
            selection['buildTags']==[BUILD_TAG] and all(selection[k] is False for k in
                ('fakeVCSIdentity','originalCheckoutWritten','originalModuleDescriptorsChanged','nodeStarted','carrierEnabled','publicActivation')),
            'original Core source-selection identity or scope differs')
    for name in ('go.mod','go.sum'):
        require((build_source/name).read_bytes()==(source/name).read_bytes(),'original module descriptor changed')
    require(not git('status','--porcelain','--untracked-files=normal') and git('rev-parse','HEAD')==identity['commit'],
            'original source changed during composition')
    result=dict(schema='YNX-PERF-NORMAL-LIVE-BUILD-SOURCE/v1',source=identity,
                optionalForkCommit=selection['selectedOptionalForkCommit'],optionalForkTree=selection['selectedOptionalForkTree'],
                compositionScriptSHA256=q['compositionScriptSHA256'],ciEvidenceSHA256=q['ciEvidenceSHA256'],
                buildTag=BUILD_TAG,buildSource=str(build_source),originalSourceUnchanged=True,
                originalCoreSelection=prepared,carrierEnabled=False,actualNetworkWindow=False)
    if identity['commit']==native_source_dependencies.SOURCE:
        result['originalNativeSourceDependencies']=native_source_dependencies.materialize(source,build_source,destination/'SOURCE-NATIVE-DEPENDENCIES.json')
    return result


def prepare_lossless_matching_source(source,destination):
    """Call the actual qualified Core composer, no build/node/carrier enable."""
    source,destination=Path(source),Path(destination)
    spec=importlib.util.spec_from_file_location('paired_original_component_source',Path(__file__).with_name('pq-lossless-source-data.py'))
    evidence=importlib.util.module_from_spec(spec);spec.loader.exec_module(evidence);q=evidence.component_qualification()
    def git(*args):return subprocess.check_output(['git','-C',str(source),*args],timeout=5).decode().strip()
    require(source.resolve(strict=True)==source and not git('status','--porcelain','--untracked-files=normal'),'original new paired source must stay canonical and clean')
    identity=dict(commit=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}'),forkTree=git('rev-parse','HEAD:third_party/cometbft'))
    require(identity==dict(commit=q['source'],tree=q['sourceTree'],forkTree='54e88e6aba735eaceeb2d00bb40731248c673bd7'),'exact independently qualified new paired source required; no old grant migration')
    path=source/'scripts/verify/wire-live-matching-source-ci.py'
    require(not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest()=='3ce49141da75daeb996611f5ea7697445f73eb3ca02e1e8d78e75a5287a0a972','exact new Core lossless composer required')
    spec=importlib.util.spec_from_file_location('paired_original_core_source_composer',path);core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
    require(core.PRODUCTION_TREE==identity['forkTree'] and git('rev-parse',q['supplierCommit']+':third_party/cometbft')==q['supplierTree'],'actual selected supplier object differs')
    prepared=core.prepare_wire_lossless_source(source,destination,identity['commit'],identity['tree'],supplier_commit=q['supplierCommit'],supplier_tree=q['supplierTree'])
    receipt=destination/'SOURCE-SELECTION.json';raw=receipt.read_bytes();selection=json.loads(raw);build_source=destination/'source'
    require(prepared['receiptPath']==str(receipt) and prepared['sourceDirectory']==str(build_source) and prepared['receiptBytes']==len(raw) and prepared['receiptSHA256']==hashlib.sha256(raw).hexdigest() and prepared['sourceSelection']==selection,'original paired source-selection bytes differ')
    require(selection['originalSourceCommit']==identity['commit'] and selection['originalSourceTree']==identity['tree'] and selection['originalProductionForkTree']==identity['forkTree'] and selection['selectedOptionalForkCommit']==q['supplierCommit'] and selection['selectedOptionalForkTree']==q['supplierTree'] and selection['buildTags']==[BUILD_TAG,'ynx_lossless_hex'] and selection['losslessOptInSupported'] is True and selection['sourceOnly'] is True and all(selection[k] is False for k in ('fakeVCSIdentity','originalCheckoutWritten','originalModuleDescriptorsChanged','nodeStarted','carrierEnabled','publicActivation','actualOnExecution')),'actual paired source composition scope/identity differs')
    for name in ('go.mod','go.sum'):require((build_source/name).read_bytes()==(source/name).read_bytes(),'original paired module descriptors changed')
    require(not (build_source/'.git').exists() and not git('status','--porcelain','--untracked-files=normal') and git('rev-parse','HEAD')==identity['commit'],'original paired source changed or fake VCS created')
    return dict(schema='YNX-PERF-PAIRED-MATCHING-BUILD-SOURCE/v1',source=identity,originalSourceOnlyCI=q,originalCoreSelection=prepared,buildSource=str(build_source),optionalForkCommit=q['supplierCommit'],optionalForkTree=q['supplierTree'],originalSourceUnchanged=True,binaryBuilt=False,nodeStarted=False,carrierEnabled=False,runtimeAuthorized=False,pressureAuthorized=False)

def fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def private_read(directory, name, limit, expected_directory=None):
    require('/' not in name and name not in ('.', '..'), 'exact private slot name required')
    parent = os.open(directory, os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY)
    fd = None
    try:
        original = os.fstat(parent)
        require(stat.S_IMODE(original.st_mode) == 0o700 and original.st_uid == os.getuid() and
                (expected_directory is None or (original.st_dev, original.st_ino) == expected_directory),
                'original private control directory required')
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode) == 0o600 and
                before.st_uid == os.getuid() and before.st_nlink == 1 and before.st_size <= limit,
                'original single-link private file required')
        raw = bytearray()
        while len(raw) <= limit:
            part = os.read(fd, min(65536, limit + 1 - len(raw)))
            if not part:
                break
            raw.extend(part)
        require(len(raw) <= limit and len(raw) == before.st_size and
                fingerprint(before) == fingerprint(os.fstat(fd)) == fingerprint(os.stat(name, dir_fd=parent, follow_symlinks=False)),
                'original private slot changed during read')
        current = directory.lstat()
        require(directory.resolve() == directory and
                (current.st_dev, current.st_ino, current.st_mode, current.st_uid) ==
                (original.st_dev, original.st_ino, original.st_mode, original.st_uid),
                'original control directory changed during read')
        return bytes(raw)
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent)


class NormalLiveReader:
    def __init__(self, ceremony, lab):
        self.c, self.w, self.lab = ceremony, ceremony.w, lab
        self.slots = {}
        self.evidence = []
        spec = importlib.util.spec_from_file_location('normal_live_frozen_hook', Path(__file__).with_name('pq-network-window.py'))
        hook = importlib.util.module_from_spec(spec); spec.loader.exec_module(hook)
        self.layers = hook.frozen_module('network-layer-accounting.py')

    def startup_arguments(self, phase, index):
        if phase != 'pq':
            return []
        name = 'pq-node-%d' % index
        require(type(index) is int and 0 <= index < 4 and name not in self.slots,
                'one fresh original PQ control per node')
        directory = self.w.work / '.private' / ('network-live-' + name)
        directory.mkdir(mode=0o700)
        info = directory.lstat()
        require(directory.resolve() == directory and stat.S_IMODE(info.st_mode) == 0o700 and
                info.st_uid == os.getuid(), 'original private control directory required')
        self.slots[name] = dict(directory=directory, identity=(info.st_dev, info.st_ino),
                                next=0, retired=False, observed=False)
        return ['--wire-observation-live-control', str(directory)]

    def owned(self, node, slot):
        matches = [c for c in self.w.children if c['name'] == node['name']]
        require(len(matches) == 1, 'one original registered node required')
        child = matches[0]
        require(child['persistent'] and child['process'].pid == node['pid'] and
                str(child['startTicks']) == node['startTicks'] and child['process'].poll() is None,
                'original live Popen identity differs')
        current = self.lab.guard.parse_stat(self.lab.guard.bounded(
            Path('/proc') / str(node['pid']) / 'stat'), node['pid'])
        require(str(current['startTicks']) == node['startTicks'] and current['state'] != 'Z',
                'original kernel process identity differs')
        directory = slot['directory']
        info = directory.lstat()
        require(directory.resolve() == directory and stat.S_ISDIR(info.st_mode) and
                stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.getuid() and
                (info.st_dev, info.st_ino) == slot['identity'], 'original control directory changed')

    def retain(self, slot, phase, event):
        # Copy only this non-secret observation contract, never custody files.
        directory = self.w.work / 'public' / 'network-live-originals'
        directory.mkdir(mode=0o700, exist_ok=True)
        files = []
        self.evidence.append(event)
        for name, limit in [('producer.json', 4096), (phase + '.request', 128),
                            (phase + '.raw.json', LIMIT), (phase + '.result.json', 4096)]:
            try:
                info = slot['directory'].lstat()
                require(slot['directory'].resolve() == slot['directory'] and
                        (info.st_dev, info.st_ino) == slot['identity'] and
                        stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.getuid(),
                        'original control directory changed before retention')
                raw = private_read(slot['directory'], name, limit, slot['identity'])
                target = directory / (event['node'] + '-' + phase + '-' + name)
                with target.open('xb') as out:
                    os.chmod(target, 0o600)
                    out.write(raw)
                files.append(dict(path=str(target.relative_to(self.w.work / 'public')),
                                  bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest()))
            except FileNotFoundError:
                continue
            except Exception as error:
                files.append(dict(slot=name, retentionErrorType=type(error).__name__))
        event['originalFiles'] = files
        if event['status'] == 'OBSERVED':
            require(len(files) == 4 and all('sha256' in row for row in files),
                    'observed read original-file retention incomplete')
        self.lab.write_new(self.w.work / 'public' / (event['node'] + '-live-' + phase + '-read.json'), event)

    def __call__(self, node):
        require(node['name'] in self.slots, 'original startup control missing')
        slot = self.slots[node['name']]
        require(not slot['retired'] and slot['next'] < 2, 'live read retired; UNKNOWN is never retried')
        phase = ('before', 'after')[slot['next']]
        require(phase == 'before' or slot['observed'], 'after requires original observed before')
        slot['next'] += 1  # Consume before any I/O or launch, including failure.
        event = dict(node=node['name'], pid=node['pid'], startTicks=node['startTicks'], phase=phase,
                     status='UNKNOWN', noRetry=True, readStartMonotonicNs=str(time.clock_gettime_ns(time.CLOCK_MONOTONIC)))
        proc = None
        try:
            self.owned(node, slot)
            producer = private_read(slot['directory'], 'producer.json', 4096, slot['identity'])
            expected = dict(pid=str(node['pid']), startTicks=node['startTicks'])
            require(json.loads(producer) == dict(version=VERSION, identity=expected),
                    'producer does not match independently owned Popen')
            name = node['name'] + '-live-' + phase
            proc = self.w.launch(name, [str(self.c.bins / 'ynx-comet'), 'request-wire-observation',
                                      '--control', str(slot['directory']), '--phase', phase], thread_safe=True)
            until = min(self.w.started + self.lab.CAPS['totalSeconds'] - self.lab.CAPS['cleanupSeconds'],
                        time.monotonic() + 4)
            while proc.poll() is None:
                self.w.sample()
                require(time.monotonic() < until, 'bounded original live reader deadline; UNKNOWN retained')
                time.sleep(.01)
            self.w.wait(proc)
            self.owned(node, slot)
            raw = private_read(slot['directory'], phase + '.raw.json', LIMIT, slot['identity'])
            receipt = json.loads(private_read(slot['directory'], phase + '.result.json', 4096, slot['identity']))
            require(receipt.get('version') == VERSION and receipt.get('phase') == phase and
                    receipt.get('status') == 'OBSERVED' and receipt.get('reason') == '' and
                    receipt.get('identity') == expected and receipt.get('syntheticOnly') is True and
                    receipt.get('authorityGranted') is False and
                    receipt.get('rawSHA256') == hashlib.sha256(raw).hexdigest(),
                    'original observed receipt/raw binding differs')
            require(private_read(slot['directory'], 'producer.json', 4096, slot['identity']) == producer,
                    'original producer changed during read')
            require(self.lab.guard.bounded(self.w.work / 'public' / (name + '.log'), LIMIT) == raw,
                    'normal CLI output differs from original raw bytes')
            parent_end = time.clock_gettime_ns(time.CLOCK_MONOTONIC)
            checked = self.layers.original_live_node_capture(node=node, raw=raw.decode('utf-8'),
                sha256=hashlib.sha256(raw).hexdigest(), start_monotonic_ns=int(event['readStartMonotonicNs']),
                end_monotonic_ns=parent_end)
            require(checked['liveStatus'] == 'OBSERVED', 'original live raw validation failed: ' + str(checked['liveReason']))
            value = json.loads(raw)
            def decimal_ns(v):
                require(type(v) is str and v.isascii() and v.isdecimal() and
                        str(int(v)) == v and 0 < int(v) < 1 << 64,
                        'original receipt clock must be canonical uint64 decimal string')
                return int(v)
            receipt_start = decimal_ns(receipt.get('startMonotonicNs'))
            receipt_end = decimal_ns(receipt.get('endMonotonicNs'))
            # Core records the getter's OUTER call bracket; raw contains its
            # INNER sample. Preserve both original clocks without equating them.
            require(int(event['readStartMonotonicNs']) <= receipt_start <= int(value['startMonotonicNs']) <=
                    int(value['endMonotonicNs']) <= receipt_end <= parent_end and
                    receipt_end - receipt_start <= 2_000_000_000,
                    'original receipt clock does not contain raw inside parent bounded read')
            slot['observed'] = True
            event.update(status='OBSERVED', rawSHA256=hashlib.sha256(raw).hexdigest())
            return raw
        except BaseException as error:
            slot['retired'] = True
            event['errorType'] = type(error).__name__
            event['errorReason'] = str(error)[:512]
            raise
        finally:
            active_error = sys.exc_info()[0]
            if proc is not None and proc.poll() is None:
                # Only our registered requester; original node and slots remain.
                try:
                    proc.send_signal(signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    proc.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    event['requesterCleanupComplete'] = False
                else:
                    event['requesterCleanupComplete'] = True
            event['readEndMonotonicNs'] = str(time.clock_gettime_ns(time.CLOCK_MONOTONIC))
            try:
                self.retain(slot, phase, event)
            except BaseException as error:
                slot['retired'] = True
                event.update(status='UNKNOWN', retentionErrorType=type(error).__name__)
                if active_error is None:
                    raise


PAIR_SUPPLIER = dict(commit='ed628e5cdd00c4496de5b2587bf2e9585aaf3d2d',
    tree='f1a8837079178469bc57ede955c55973f8b7d8ba',tag=BUILD_TAG,
    mandatoryNewCases=['TestLosslessHexBudgetInitialPeerReadinessDeadline','TestLosslessHexBudgetReadyTransitionKeepsSelectedCarrier'])
# Only populated after the actual new normal ON/source CI is consumed by the
# original qualification parser. The completed9081 OFF grant stays separate.
PAIR_SOURCE_QUALIFICATION = None


def read_normal_business_leg(public, receipt_sha256, tools_commit, check=None):
    """Consume existing PUBLIC originals only. No process/getter/collector call."""
    public=Path(public)
    require(public.is_absolute() and public.resolve(strict=True)==public,'canonical original public directory required')
    spec=importlib.util.spec_from_file_location('pair_original_public_io',Path(__file__).with_name('pq-public-proof-readback.py'))
    io=importlib.util.module_from_spec(spec);spec.loader.exec_module(io)
    pins=[]
    def original(name,limit=64<<20):
        path=Path(name);require(not path.is_absolute() and '..' not in path.parts,'original public path escaped')
        if check is not None:check()
        raw=io.read_original(public/path,limit)
        pins.append(dict(path=str(path),bytes=len(raw),sha256=io.sha(raw)))
        return raw
    def data(name,limit=64<<20):return io.strict(original(name,limit))
    receipt=data('receipt.json');require(pins[-1]['sha256']==receipt_sha256,'externally pinned original receipt differs')
    ci=data('NORMAL-LIVE-BASELINE-CI.json',256<<10)
    require(ci['tools']==tools_commit and ci['goSource']==receipt['source']['commit'] and ci['goTree']==receipt['source']['tree'] and ci['caps']==receipt['caps'],'original controller/source/tool/caps binding differs')
    bundle=dict(receipt=receipt,toolsCommit=tools_commit,canonicalTransactions=[],originalVerifiers=[],originalConfirms=[],originalExports=[])
    import base64
    for row in receipt['functionalCohort']:
        name='functional-owner-'+str(row['owner'])
        intent=data(name+'-intent.json');bundle['canonicalTransactions'].append(base64.b64decode(intent['transaction'],validate=True))
        bundle['originalVerifiers'].append(data(name+'-normal-verifier.log'))
        bundle['originalConfirms'].append(data(name+'-original-confirm.log'))
        exported=data(name+'-original-export.log');bundle['originalExports'].append(exported)
        state=original(name+'-public-proof/export/committed-state.json')
        require(io.sha(state)==receipt['allFourStoppedStateSHA256'] and io.sha(state)==exported['checkpoint']['sha256'],'original complete independent stopped state differs')
        if 'stoppedStateBytes' in bundle:require(bundle['stoppedStateBytes']==state,'original four proof exports use different final states')
        else:bundle['stoppedStateBytes']=state
    network=data('network-accounting.json');binding=data('network-binding.json');start=data('network-start.json');end=data('network-end.json');hop=data('network-hop-accounting.json')
    require(binding==network['binding'] and binding['tools']==tools_commit and binding['source']==receipt['source']['commit'],'original network binding differs')
    modules={}
    for key,file in [('layers','network-layer-accounting.py'),('hops','pq-hop-byte-accounting.py')]:
        spec=importlib.util.spec_from_file_location('pair_original_'+key,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);modules[key]=m
    for key,value in modules['layers'].account_layers(binding=binding,start=start,end=end).items():require(network[key]==value,'original frozen network accounting differs: '+key)
    for key,value in modules['hops'].directional_hops(binding,start,end).items():require(hop[key]==value,'original directional endpoint accounting differs: '+key)
    reads=receipt['liveNetworkReads'];require(len(reads)==8,'all8 original live reads required')
    slots=set()
    for entry in reads:
        require(entry['status']=='OBSERVED' and entry['noRetry'] is True and len(entry['originalFiles'])==4,'original live read missing/unknown')
        key=(entry['node'],entry['phase']);require(key not in slots,'duplicate original read slot');slots.add(key)
        contents={}
        for ref in entry['originalFiles']:
            require(ref['path'].startswith('network-live-originals/'),'original live read path outside closed subtree')
            raw=original(ref['path'],128<<10);require(len(raw)==ref['bytes'] and io.sha(raw)==ref['sha256'],'original live slot SHA/size differs')
            contents[ref['path']]=raw
        raw=next(v for k,v in contents.items() if k.endswith('.raw.json'));ret=io.strict(next(v for k,v in contents.items() if k.endswith('.result.json')));sample=io.strict(raw)
        require(io.sha(raw)==entry['rawSHA256']==ret['rawSHA256'] and ret['status']==sample['status']=='OBSERVED' and ret['identity']==dict(pid=str(entry['pid']),startTicks=entry['startTicks']),'original raw producer/result identity differs')
        checkpoint=start if entry['phase']=='before' else end
        captured=next(n['live'] for n in checkpoint['nodes'] if n['name']==entry['node'])
        require(captured['raw'].encode()==raw,'original live raw and checkpoint bytes differ')
        require(data(entry['node']+'-live-'+entry['phase']+'-read.json',128<<10)==entry,'original live event and receipt differ')
        proc=next(p for p in receipt['processes'] if p['name']==entry['node'])
        require(proc['pid']==entry['pid'] and str(proc['startTicks'])==entry['startTicks'] and sample['producerPID']==str(entry['pid']),'original registered node identity differs')
        require(int(entry['readStartMonotonicNs'])<=int(ret['startMonotonicNs'])<=int(sample['startMonotonicNs'])<=int(sample['endMonotonicNs'])<=int(ret['endMonotonicNs'])<=int(entry['readEndMonotonicNs']),'original same-kernel clock enclosure differs')
    require(slots=={('pq-node-'+str(i),phase) for i in range(4) for phase in ('before','after')},'exact original4node x2slots required')
    build=receipt['normalLiveBuildSource']
    bundle['provenance']=dict(public=str(public),receiptSHA256=receipt_sha256,controller=ci['controllerCommit'],runID=binding['runID'],
        selectedSupplierCommit=build['optionalForkCommit'],selectedSupplierTree=build['optionalForkTree'],binaryHashesOriginalRuntimeReportedOnly=True,
        allOriginal8RawSlotsAndFrozenAccountingRead=True,files=pins)
    bundle['networkData']=dict(losslessStatuses=[row['liveWindow']['losslessStatus'] for row in network['nodes']],
        senderEndpointBytes=hop['sourceSocketEndpointBytesSentSum'],retransmittedEndpointBytesSeparate=hop['sourceSocketEndpointRetransmittedBytesSum'],
        directedHops=len(hop['directedHops']),physicalBytesMeasured=False,perTxPhysicalBytes=None,receiverBytesNotAdded=True)
    own=compare_normal_business_data(bundle,bundle)
    require(own['status']=='MATCHED_BUSINESS_DATA_ONLY','original independent leg verifier/Confirm/ledger DATA failed: '+str(own.get('firstCause')))
    bundle['provenance'].update(originalVerifierAndConfirm4DataMatched=True,ownLedgerFullStatePinned=True,independentCryptoReverified=False,selfCheckDoesNotRepresentTwoRuns=True)
    spec=importlib.util.spec_from_file_location('pair_original_leg_trace',Path(__file__).with_name('pq-normal-leg-trace.py'))
    trace_reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(trace_reader)
    bundle['completeTraceData']=trace_reader.read(public,receipt,bundle['stoppedStateBytes'],original)
    requested=any(arg=='--startup-timings' or arg.startswith('--startup-timings=') for row in receipt['processes'] if '-node-' in row['name'] for arg in row.get('command',[]))
    if requested:
        spec=importlib.util.spec_from_file_location('pair_original_node_startup',Path(__file__).with_name('pq-node-startup-measurements.py'))
        startup=importlib.util.module_from_spec(spec);spec.loader.exec_module(startup)
        node_logs={phase+'-node-'+str(i)+'.log':original(phase+'-node-'+str(i)+'.log',startup.MAX_LOG_BYTES) for phase in ('bootstrap','pq') for i in range(4)}
        bundle['nodeStartupData']=startup.original_nodes(node_logs,'',receipt['processes'])
    else:bundle['nodeStartupData']=dict(status='NOT_REQUESTED',sourceQualified=False,readinessOrFinalityInferred=False)
    return bundle


def prepare_paired_candidate(off=None,on=None,replay_data=None,source_only_ci=False,complete_trace_data=None):
    """Inert paired candidate DATA. No ON/trace qualification is guessed."""
    result=dict(schema='YNX-PERF-NORMAL-PAIRED-CANDIDATE/v1',status='NOT_READY',ready=False,
        requiredSupplier=dict(PAIR_SUPPLIER),runtimeAuthorized=False,pressureAuthorized=False,
        normalWirePairQualified=False,normalONSourceQualified=False,physicalBytesMeasured=False,perTxPhysicalBytes=None,
        replayGate=dict(status='NOT_SUPPLIED',qualified=False),normalBusinessGate=dict(status='NOT_SUPPLIED'),missing=[])
    if source_only_ci:
        spec=importlib.util.spec_from_file_location('pair_original_lossless_source_data',Path(__file__).with_name('pq-lossless-source-data.py'))
        source_data=importlib.util.module_from_spec(spec);spec.loader.exec_module(source_data)
        result['originalSourceOnlyCI']=source_data.component_qualification()
        require(result['originalSourceOnlyCI']['supplierCommit']==PAIR_SUPPLIER['commit'] and result['originalSourceOnlyCI']['supplierTree']==PAIR_SUPPLIER['tree'],'original paired supplier source DATA differs')
        result['missing'].append('actual normal ON running window and kernel/private-control evidence remain required; original source-only constructor/budget/trace tests start no nodes')
    if complete_trace_data is not None:
        require(complete_trace_data.get('schema')=='YNX-PERF-COMPLETE-FINALIZE-TRACE-READBACK/v1' and type(complete_trace_data.get('qualified')) is bool,'original complete trace readback DATA scope required')
        result['replayGate']=complete_trace_data
        result['missing'].extend(complete_trace_data['missing'])
    if replay_data is not None:
        # Legacy height-derived source fixtures cannot satisfy the actual
        # complete original Finalize request gate, even if every state matches.
        result['replayGate']=dict(status='ORIGINAL_COMPLETE_TRACE_READER_NOT_SUPPLIED',qualified=False,
            suppliedData=replay_data,legacySourceFixture=replay_data.get('commonOriginalFinalizeTrajectoryQualified') is not True)
    if source_only_ci:
        pass # Exact original source-only DATA above is never a runtime grant.
    elif PAIR_SOURCE_QUALIFICATION is None:
        result['missing'].append('Core exact new normal guarded ON source CI qualification for ed628/f1a; old9081/b1e OFF qualification is not transferable')
    else:
        result['missing'].append('new ON qualification parser must consume actual matching CI originals before this report can qualify any source')
    if complete_trace_data is None:result['missing'].append('Original complete immutable Finalize trajectory and deterministic before/after normal replay DATA not supplied; Core stopped-store ABI now has a dedicated original reader')
    trace_status={label:(bundle or {}).get('completeTraceData',{}).get('status','NOT_SUPPLIED') for label,bundle in [('OFF',off),('ON',on)]}
    result['normalLegTraceDataGate']=dict(statuses=trace_status,dataComplete=all((bundle or {}).get('completeTraceData',{}).get('completePerLegTraceDataVerified') is True for bundle in (off,on)),normalLiveChainCoverageQualified=False)
    result['missing'].append('Independently qualified each-leg full AppHash/normal-source coverage is still required; stopped trace DATA and the last successor marker remain explicit')
    for label,bundle in [('OFF',off),('ON',on)]:
        if bundle is None:
            result['missing'].append(label+' original normal PUBLIC leg with exact receipt/tool pins and common canonical signed user fixture not supplied')
            continue
        evidence=bundle.get('provenance',{});result[label]=dict(originals=evidence,network=bundle.get('networkData'),completeTraceData=bundle.get('completeTraceData'),nodeStartupData=bundle.get('nodeStartupData'))
        if (evidence.get('selectedSupplierCommit'),evidence.get('selectedSupplierTree'))!=(PAIR_SUPPLIER['commit'],PAIR_SUPPLIER['tree']):result['missing'].append(label+' actual selected supplier differs from ed628/f1a')
        statuses=[phase['status'] for row in bundle.get('networkData',{}).get('losslessStatuses',[]) for phase in row.values()]
        expected='DISABLED' if label=='OFF' else 'OBSERVED'
        if len(statuses)!=8 or any(value!=expected for value in statuses):result['missing'].append(label+' original lossless counters do not establish '+expected+' at all8 endpoints')
    if off is None or on is None:return result
    result['normalBusinessGate']=compare_normal_business_data(off,on)
    if off.get('provenance',{}).get('runID')==on.get('provenance',{}).get('runID'):result['missing'].append('same original run cannot be two independent normal legs')
    if result['normalBusinessGate']['status']!='MATCHED_BUSINESS_DATA_ONLY':result['missing'].append('normal business/canonical/ledger data not comparable; original first cause retained')
    return result


def compare_normal_business_data(off, on):
    """Readback DATA only: independent real clocks need no cross-leg AppHash equality.

    Bundles contain original receipt/state/envelope/Verifier/Confirm bytes or
    objects, retained by the original reader. This helper starts no node and
    does not qualify ON, a complete normal per-height trace or crypto itself.
    The owning source CI, common fixture and full trace contracts remain gates.
    """
    result=dict(schema='YNX-PERF-INDEPENDENT-NORMAL-LEG-BUSINESS-COMPARISON/v1',
        comparisonGate='independent-normal-business-data',status='NOT_COMPARABLE',firstCause=None,
        deterministicReplayRequiredSeparately=True,normalWirePairQualified=False,
        normalPerHeightTraceQualification='NOT_ASSESSED; original Core trace required',
        onSourceCIQualification='NOT_ASSESSED; separate owning original ON qualification required',
        independentCryptographicReverification=False,physicalBytesMeasured=False,perTxPhysicalBytes=None,
        crossLegAppHashEqualityRequired=False,fullStateFieldsRemoved=False,heightsRemapped=False,
        meaning='Normal legs retain their independent full state and real clock inputs. Match canonical signed user bytes and business ledger/results. This DATA comparison never substitutes for deterministic replay, full per-leg chain trace or original ON/network qualification.')
    spec=importlib.util.spec_from_file_location('normal_pair_original_checks',Path(__file__).with_name('pq-normal-process-lab.py'))
    normal=importlib.util.module_from_spec(spec);spec.loader.exec_module(normal)
    def leg(bundle):
        receipt=bundle['receipt'];cohort=receipt['functionalCohort']
        require(receipt.get('firstCause') is None and receipt.get('phaseComplete') is True and receipt.get('functionalPhaseComplete') is True and receipt.get('cleanupComplete') is True and receipt.get('qualifiedFinalCount')==4 and receipt.get('configuredFunctionalDenominator')==4 and len(cohort)==4,'complete original finite4 leg required')
        require([row['owner'] for row in cohort]==list(range(4,8)) and len({row['transactionHash'] for row in cohort})==4 and all(row.get('qualifiedFinal') is True for row in cohort),'original4 distinct functional business requests required')
        require(normal.normal_node_clean_exit(receipt['processes'])['allEightExitZero'],'all original eight normal exit0 required')
        require(receipt.get('networkBaseline',{}).get('status')=='OBSERVED','original normal network evidence missing')
        raw=bundle['stoppedStateBytes'];require(type(raw) is bytes and 0<len(raw)<=64<<20,'bounded original complete state bytes required')
        state_pin=hashlib.sha256(raw).hexdigest();require(state_pin==receipt['allFourStoppedStateSHA256'],'original full stopped state SHA differs')
        def pairs(items):
            obj={}
            for key,value in items:
                require(key not in obj,'duplicate original full state field');obj[key]=value
            return obj
        state=json.loads(raw,object_pairs_hook=pairs)
        require(type(state['height']) is int and state['height']>0 and type(state['appHash']) is str and len(state['appHash'])==64 and all(c in '0123456789abcdef' for c in state['appHash']),'original independent full AppHash/height invalid')
        accounts={}
        for account in state['accounts']:
            address=account['address'];require(type(address) is str and address and address not in accounts,'duplicate/missing original ledger account')
            require(type(account['balance']) is int and account['balance']>=0 and type(account['nonce']) is int and account['nonce']>=0,'complete original balance/nonce required')
            accounts[address]=(account['balance'],account['nonce'])
        envelopes=bundle['canonicalTransactions'];verifiers=bundle['originalVerifiers'];confirms=bundle['originalConfirms'];exports=bundle['originalExports']
        require(len(envelopes)==len(verifiers)==len(confirms)==len(exports)==4,'all original canonical requests and fullproof4 required')
        requests=[];business=[]
        for row,envelope,verified,confirmed,exported in zip(cohort,envelopes,verifiers,confirms,exports):
            require(type(envelope) is bytes and hashlib.sha256(envelope).hexdigest()==normal.comet_hash(row['transactionHash']),'original canonical transaction bytes differ')
            normal.require_verified(verified,dict(abciHash=row['transactionHash'],nativeHash=row['nativeHash']))
            require(confirmed.get('code')=='PROOF_CONFIRMED_DATA' and confirmed['result']['result']==verified['result'],'original Confirm/full verifier result differs')
            require(exported.get('sourceReadOnly') is True and exported.get('stoppedNodes')==4 and str(exported['engineHeight'])==str(state['height']) and exported['engineAppHash']==state['appHash'],'original independent final ledger/engine binding differs')
            require(normal.comet_hash(exported['transactionHash'])==normal.comet_hash(row['transactionHash']) and normal.comet_hash(exported['nativeWireHash'])==normal.comet_hash(row['nativeHash']),'original independent export transaction binding differs')
            for key in ('block','successor'):
                proof=verified['result'][key]
                require(proof.get('commitVerified') is True and proof.get('lightTransitionVerified') is True,'original per-leg H/H+1 verification missing')
            requests.append(envelope)
            # Block/header/history/time/AppHash stay in the original artifacts.
            # Compare business outputs, not timestamps from independent clocks.
            business.append({key:verified['result'].get(key) for key in ('transactionType','transactionHash','nativeWireHash','executionCode','gasWanted','gasUsed','executionData','included','finalized','executionSuccessful','outcome','nativeGrant')})
        return dict(receipt=receipt,requests=requests,accounts=accounts,business=business,
            stateSHA256=state_pin,finalHeight=state['height'],finalAppHash=state['appHash'],tools=bundle['toolsCommit'])
    try:
        result['originalFirstCauses']={label:bundle.get('receipt',{}).get('firstCause') for label,bundle in [('OFF',off),('ON',on)]}
        a,b=leg(off),leg(on)
        for key in ('source','caps','binaries','signingMode','configuredFunctionalDenominator','sameHost','physicalFaultDomains'):
            require(a['receipt'][key]==b['receipt'][key],'normal leg same source/binary/caps/conditions differ: '+key)
        require(type(a['tools']) is str and len(a['tools'])==40 and a['tools']==b['tools'],'normal leg tool commit differs')
        require(set(a['receipt']['binaries'])=={'ynx-comet','ynx-consensus-pq-lab','ynx-consensus-proof-verify'},'all original normal binary identities required')
        require(a['requests']==b['requests'],'normal legs do not share exact canonical signed user fixture')
        require(a['accounts']==b['accounts'],'normal final complete balances/nonces differ')
        require(a['business']==b['business'],'normal original business execution results differ')
        result.update(status='MATCHED_BUSINESS_DATA_ONLY',canonicalSignedUserBytesEqual=True,
            allBusinessResultsAndBalancesAndNoncesEqual=True,
            originalLegStates=dict(OFF=dict(sha256=a['stateSHA256'],height=a['finalHeight'],appHash=a['finalAppHash']),ON=dict(sha256=b['stateSHA256'],height=b['finalHeight'],appHash=b['finalAppHash'])),
            independentAppHashesDiffer=a['finalAppHash']!=b['finalAppHash'],
            originalInclusionPositions={label:[dict(height=row['height'],index=proof['result'].get('index')) for row,proof in zip(bundle['receipt']['functionalCohort'],bundle['originalVerifiers'])] for label,bundle in [('OFF',off),('ON',on)]})
    except (RuntimeError,KeyError,ValueError,TypeError) as error:
        result['firstCause']=str(error);result['errorType']=type(error).__name__
    return result


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--prepare-source',required=True)
    parser.add_argument('--destination',required=True)
    args=parser.parse_args()
    print(json.dumps(prepare_matching_source(Path(args.prepare_source),Path(args.destination)),sort_keys=True))
