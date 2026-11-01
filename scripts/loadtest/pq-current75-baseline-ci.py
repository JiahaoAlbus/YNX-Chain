#!/usr/bin/env python3
"""One normal four-node online finite live-wire/TCP baseline; no pressure window."""
import argparse,hashlib,json,os,re,shutil,signal,stat,subprocess,sys,types
from pathlib import Path
PROFILE = 'normal-live-9081-finite'
REF = 'refs/heads/codex/ynx-pq-current75-baseline-20261101'
WORKFLOW = '.github/workflows/pq-normal-process.yml'
GO_SOURCE = '9081f14654a48f4fe14e57696ec33527869da353'
GO_TREE = '8c12ec07479bf6664cf279adb6395c704ead33e1'
FORK_TREE = '54e88e6aba735eaceeb2d00bb40731248c673bd7'
TOOLS = 'f5941aadde4f09d938a2146c54abad8c79a29301'
TOOLS_TREE = 'a35afc60ee24f3f590a694453ca2db446cccbd44'
CAPS = {'totalSeconds': 900, 'cleanupSeconds': 15, 'rssBytes': 4294967296, 'newBytes': 8589934592, 'initialMemoryBytes': 6442450944, 'initialDiskBytes': 17179869184, 'logBytes': 4194304, 'cpus': 2}
SOURCE_PINS = {'go.mod': '2892248959ac73f0aaf16197ba18c78594ad956a2e9b9617404c2ebb50818858', 'go.sum': 'cfa98a228afc945aa54730a821b80cfc31cb1b8c0aa57aa0bd1e7cf3827d23ad', 'scripts/verify/wire-live-matching-source-ci.py': 'f9c83d7a7d7dc1c2ccbbd15795ba22b1d54e28a81d9084a813a8fb71c4b55839', 'scripts/loadtest/pq-source-artifact-intake.py': 'ab75f9748a05523f5719ee42a8a99b576d3444a30481b0e07253956e3e5943ef'}
TOOL_PINS = {'pq-normal-process-lab.py': '63139cc769a982cc7a3cd78eab4515165c49539a629ccd804e1c567bf8d59ee3', 'pq-normal-live-reader.py': 'ba373604329c873c7c22230c5836a28b030f5f217ed6773805e9355b1d7b1149', 'pq-network-window.py': '6132d2adf72e01959f9d9e71ec4da22961b7f5335cb77331dc2769c66af4cdc8', 'owned-tcp-accounting.py': '612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440', 'network-layer-accounting.py': '1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635', 'pq-hop-byte-accounting.py': '663c072e11f777d5119f87fa9e200548c117f937427c46295277e722c7d3744b', 'consensus-linux-cohort.py': 'ffc7e02e1d37adc28f4d94c262d30a45e91eb594307931b482dcdd39ccc82591', 'pq-paired-linux-window.py': 'b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2', 'test_pq_normal_live_reader.py': 'b8ab2724db4a2c7c26675f662e3c8581b5a6ff86ec69b43526701a6f7c604ac2', 'test_pq_normal_network_baseline.py': 'd408a22ef0d592d6dd2b0e4391fb65b12a59c2ec95e62d4f013b0dd05aa992c9', 'test_pq_normal_live_build_source.py': 'aa35b1a041ba3da4e3dee1d6d432d6b37d1b66c81f1cb9f1d74f1bb7684d26db', 'pq-normal-live-source-data.py': '969610212a6fbed759d5a516a0c294bc4f796046e4755119780668b2cd837f6b', 'test_pq_normal_live_source_data.py': '89a9e8ff671f4007bfb42cc6da88001563223d35ec30b9255be987a4be8a797d', 'fixtures/9081-normal-live-source-original.zip': '5c3db014446402ced74177c7965ec1554fa6aa609b2cca0000fe2667bc2fef08', 'fixtures/d903-normal-live-source-original.zip': 'e0a2d27680b55968675d735b5fb1a02ca3b3bc6bd1e2d8c711e897ebcc52ddef', 'test_pq_normal_parent_measurements.py': '40acc291ef78d1772b9bac7f398c16952edb5aa05f880bf124052393d553c818', 'test_pq_normal_clean_exit.py': '991f167b37bbbfac9c090f4e6ddb5ee8d47300038807f6d9fe4066c5f7fedce6', 'test_pq_normal_process_lab.py': '5e748519abcc1ee863c49fe543c5282ef92936e98d77f1176a5dd1c522193420'}

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], timeout=10).decode().strip()

def checked_source(root, commit, tree):
    require(root.is_absolute() and root.resolve(strict=True) == root and not root.is_symlink(),
            "canonical exact checkout required")
    require(git(root, "rev-parse", "HEAD") == commit and
            git(root, "rev-parse", "HEAD^{tree}") == tree and
            git(root, "status", "--porcelain", "--untracked-files=all") == "",
            "exact clean original checkout required")

def pinned_bytes(path, expected):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 < info.st_size <= 1 << 20,
            "bounded regular original source required")
    raw = path.read_bytes()
    require(len(raw) == info.st_size and hashlib.sha256(raw).hexdigest() == expected,
            "fixed original source bytes changed")
    return raw

def pinned_module(name, path, pin):
    raw = pinned_bytes(path, pin)
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module

def validate_host(environment):
    require(sys.platform == "linux" and environment.get("GITHUB_ACTIONS") == "true" and
            environment.get("RUNNER_ENVIRONMENT") == "github-hosted" and
            environment.get("GITHUB_REPOSITORY") == "JiahaoAlbus/YNX-Chain" and
            environment.get("GITHUB_EVENT_NAME") in ("push", "workflow_dispatch") and
            environment.get("GITHUB_REF") == REF and environment.get("GITHUB_RUN_ATTEMPT") == "1" and
            environment.get("PQ_BASELINE_PROFILE") == PROFILE and
            environment.get("GITHUB_WORKFLOW_REF") == "JiahaoAlbus/YNX-Chain/" + WORKFLOW + "@" + REF,
            "only the fixed first-attempt hosted synthetic profile may execute")
    require(re.fullmatch("[0-9a-f]{40}", environment.get("GITHUB_SHA", "")) is not None and
            environment["GITHUB_SHA"] != "0" * 40 and
            re.fullmatch("[1-9][0-9]*", environment.get("GITHUB_RUN_ID", "")) is not None,
            "actual current controller and run identity required")

def install_counted_window(driver, intake, additional_roots, adapter):
    original = driver.lab.Window
    calls = []

    def counted_window(source, work, additional_storage=()):
        require(not calls, "the fixed profile may create only one original Window")
        roots = intake.nonoverlapping_roots([*additional_storage, *additional_roots])
        window = original(source, work, additional_storage=tuple(roots))
        # The original helper resolves strictly and removes only real overlap.
        # Its failures propagate; no root or capacity error is suppressed.
        window.storage_roots = intake.nonoverlapping_roots(window.storage_roots)
        record = dict(adapter, additionalRoots=[str(p) for p in additional_roots],
                      actualStorageRoots=[str(p) for p in window.storage_roots],
                      originalWindowImplementationUnchanged=True, onlyStorageRootAdapter=True)
        driver.lab.write_new(work / "public/NORMAL-LIVE-BASELINE-CI.json", record)
        calls.append(window)
        return window

    driver.lab.Window = counted_window
    return original, calls

def fixed_options(source):
    return argparse.Namespace(source=str(source),commit=GO_SOURCE,mode='online',wire_observation=True,live_network_baseline=True,callee_timings=True,execute=True)

def prepared_data():
    return dict(profile=PROFILE,controllerRef=REF,goSource=GO_SOURCE,goTree=GO_TREE,tools=TOOLS,toolsTree=TOOLS_TREE,
        originalOwnerCount=8,functionalOwners=4,batchSize=1,perOwnerCapacity=32,measurementScope='hot-original-functional-plus-drain-live-wire-and-endpoint-TCP',
        caps=CAPS,executed=False,businessPressureAuthorized=False,pressureAuthorized=False,nodeStartAuthorized=False,sourceGrant=False,
        sameHost=True,physicalFaultDomains=1,physicalBytesMeasured=False,coldLegacyFailureMeasured=False,originalSenderTimingsRequested=True,requiredNormalZeroExits=8,sourceQualification=dict(run=41323073659,job=124897263752,artifact=13089839088,scope='SOURCE_ONLY_FINITE_BASELINE',pressureAuthorized=False))

def execute(source,tools):
    validate_host(os.environ)
    workspace=Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True);parent=Path(os.environ['RUNNER_TEMP']).resolve(strict=True);controller=Path(__file__).resolve().parents[2]
    require(controller==workspace/'controller' and source==workspace/'source' and tools==workspace/'tools','only exact three owned checkout locations allowed')
    require(git(controller,'rev-parse','HEAD')==os.environ['GITHUB_SHA'] and git(controller,'status','--porcelain','--untracked-files=all')=='','exact clean original controller required')
    checked_source(source,GO_SOURCE,GO_TREE);checked_source(tools,TOOLS,TOOLS_TREE)
    require(git(source,'rev-parse','--is-shallow-repository')=='false','complete original source history required; shallow checkout cannot qualify normal ancestry')
    for ancestor in ('a78803d31632a461df7f012e2c13e46f17c48e6d','e3a7319267b4c48d3f9164d702a38a3c3ac51713'):
        git(source,'merge-base','--is-ancestor',ancestor,GO_SOURCE)

    require(git(source,'rev-parse','HEAD:third_party/cometbft')==FORK_TREE,'original production fork graph differs')
    require(git(source,'rev-parse','54b104fb1cdf3d7d2e89e3bc40eafc6d61f8f076:third_party/cometbft')=='b1e9a83ab11ed141fda90bc47521faa412176caa','exact selected supplier object not received')
    for path,pin in SOURCE_PINS.items():pinned_bytes(source/path,pin)
    for path,pin in TOOL_PINS.items():pinned_bytes(tools/'scripts/loadtest'/path,pin)
    require(not any((tools/'scripts/loadtest').rglob('*.pyc')),'ignored bytecode substitute refused')
    os.environ.pop('GH_TOKEN',None);os.environ.pop('GITHUB_TOKEN',None)
    driver=pinned_module('normal_live_baseline_driver',tools/'scripts/loadtest/pq-normal-process-lab.py',TOOL_PINS['pq-normal-process-lab.py'])
    reader=pinned_module('normal_live_baseline_qualification',tools/'scripts/loadtest/pq-normal-live-reader.py',TOOL_PINS['pq-normal-live-reader.py'])
    qualification=reader.qualify(dict(commit=GO_SOURCE,tree=GO_TREE,forkTree=FORK_TREE))
    require(qualification['optionalForkCommit']=='54b104fb1cdf3d7d2e89e3bc40eafc6d61f8f076' and qualification['optionalForkTree']=='b1e9a83ab11ed141fda90bc47521faa412176caa','exact optional module qualification required')
    intake=pinned_module('normal_live_counted_storage',source/'scripts/loadtest/pq-source-artifact-intake.py',SOURCE_PINS['scripts/loadtest/pq-source-artifact-intake.py'])
    require(driver.lab.CAPS==CAPS and driver.lab.guard.CAPS['ownedProcesses']==16,'original finite runtime caps differ')
    go=shutil.which('go');require(go is not None,'pinned original Go toolchain required');go_root=Path(go).resolve(strict=True).parent.parent
    adapter=dict(prepared_data(),controllerCommit=os.environ['GITHUB_SHA'],controllerSourceSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),originalSourceQualification=qualification)
    original,calls=install_counted_window(driver,intake,(workspace,parent,go_root),adapter)
    try:result=driver.run(fixed_options(source))
    finally:driver.lab.Window=original
    validate_runtime_result(result,len(calls))
    return result

def validate_runtime_result(result,window_count):
    require(window_count==1 and result.get('firstCause') is None and result.get('cleanupComplete') is True and result.get('phaseComplete') is True and result.get('functionalPhaseComplete') is True and result.get('qualifiedFinalCount')==4 and result.get('networkBaseline',{}).get('status')=='OBSERVED' and result.get('normalNodeCleanExit',{}).get('allEightExitZero') is True and result['normalNodeCleanExit'].get('operationalCleanExit') is True,'explicit normal live baseline or eight normal exit0 incomplete; preserve first cause, raw logs, network and cleanup separately')

def main(argv=None):
    values = sys.argv[1:] if argv is None else argv
    for flag in ("--source", "--tools", "--execute"):
        require(values.count(flag) <= 1, "duplicate fixed-profile argument")
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--source"); parser.add_argument("--tools"); parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(values)
    if not args.execute:
        print(json.dumps(prepared_data(), sort_keys=True))
        return 0
    require(args.source and args.tools, "explicit exact source and tools checkouts required")
    # Preserve the original entry's signal -> exception -> original run/finally
    # cleanup path when invoking its function rather than its __main__ parser.
    def interrupted(signum, frame):
        raise RuntimeError("normal live baseline received signal " + str(signum))
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    print(json.dumps(execute(Path(args.source), Path(args.tools)), sort_keys=True))
    return 0

if __name__=='__main__':raise SystemExit(main())
