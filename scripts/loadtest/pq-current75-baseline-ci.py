#!/usr/bin/env python3
"""One normal four-node online finite live-wire/TCP baseline; no pressure window."""
import argparse,hashlib,json,os,re,shutil,signal,stat,subprocess,sys,types
from pathlib import Path
PROFILE = 'normal-live-d903-finite'
REF = 'refs/heads/codex/ynx-pq-current75-baseline-20261101'
WORKFLOW = '.github/workflows/pq-normal-process.yml'
GO_SOURCE = 'd9038b9292f9c28d38decb9717282e50febffdb1'
GO_TREE = '66d6f8f2ddce1a08202d5b32e0e216debfabbdeb'
FORK_TREE = '54e88e6aba735eaceeb2d00bb40731248c673bd7'
TOOLS = '542ff46f54dd68ab702d48326ad91cc30eb6ead5'
TOOLS_TREE = '467d04b3b5197b325c8c4dddf302b7733a57c34a'
CAPS = {'totalSeconds': 900, 'cleanupSeconds': 15, 'rssBytes': 4294967296, 'newBytes': 8589934592, 'initialMemoryBytes': 6442450944, 'initialDiskBytes': 17179869184, 'logBytes': 4194304, 'cpus': 2}
SOURCE_PINS = {'go.mod': '2892248959ac73f0aaf16197ba18c78594ad956a2e9b9617404c2ebb50818858', 'go.sum': 'cfa98a228afc945aa54730a821b80cfc31cb1b8c0aa57aa0bd1e7cf3827d23ad', 'scripts/verify/wire-live-matching-source-ci.py': 'f9c83d7a7d7dc1c2ccbbd15795ba22b1d54e28a81d9084a813a8fb71c4b55839', 'scripts/loadtest/pq-source-artifact-intake.py': 'ab75f9748a05523f5719ee42a8a99b576d3444a30481b0e07253956e3e5943ef'}
TOOL_PINS = {'pq-normal-process-lab.py': 'bf73e8f35768353c23369ff565bf48ef3a31dbb244f921f2bb739ffcec1eb7ac', 'pq-normal-live-reader.py': 'ab351ffece0ad8583b291cb80a4cf21236f8ed0419ad2db715b2a74fb61d73fc', 'pq-network-window.py': '6132d2adf72e01959f9d9e71ec4da22961b7f5335cb77331dc2769c66af4cdc8', 'owned-tcp-accounting.py': '612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440', 'network-layer-accounting.py': '1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635', 'pq-hop-byte-accounting.py': '663c072e11f777d5119f87fa9e200548c117f937427c46295277e722c7d3744b', 'consensus-linux-cohort.py': 'ffc7e02e1d37adc28f4d94c262d30a45e91eb594307931b482dcdd39ccc82591', 'pq-paired-linux-window.py': 'b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2', 'test_pq_normal_live_reader.py': 'b8ab2724db4a2c7c26675f662e3c8581b5a6ff86ec69b43526701a6f7c604ac2', 'test_pq_normal_network_baseline.py': 'd408a22ef0d592d6dd2b0e4391fb65b12a59c2ec95e62d4f013b0dd05aa992c9', 'test_pq_normal_live_build_source.py': 'aa35b1a041ba3da4e3dee1d6d432d6b37d1b66c81f1cb9f1d74f1bb7684d26db', 'pq-normal-live-source-data.py': '082e1e84e0d7960eeff12f1c5c85f2c843b968017fc71f85f3a24fd113b07d99', 'fixtures/d903-normal-live-source-original.zip': 'e0a2d27680b55968675d735b5fb1a02ca3b3bc6bd1e2d8c711e897ebcc52ddef', 'test_pq_normal_live_source_data.py': 'e103aab804a055ce82691eab397287ffd0f534e38f8639bb9ec9d479d47f5696'}

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
    return argparse.Namespace(source=str(source),commit=GO_SOURCE,mode='online',wire_observation=True,live_network_baseline=True,execute=True)

def prepared_data():
    return dict(profile=PROFILE,controllerRef=REF,goSource=GO_SOURCE,goTree=GO_TREE,tools=TOOLS,toolsTree=TOOLS_TREE,
        originalOwnerCount=8,functionalOwners=4,batchSize=1,perOwnerCapacity=32,measurementScope='hot-original-functional-plus-drain-live-wire-and-endpoint-TCP',
        caps=CAPS,executed=False,businessPressureAuthorized=False,pressureAuthorized=False,nodeStartAuthorized=False,sourceGrant=False,
        sameHost=True,physicalFaultDomains=1,physicalBytesMeasured=False,coldLegacyFailureMeasured=False,sourceQualification=dict(run=41317363794,job=124880188598,artifact=13088047288,scope='SOURCE_ONLY_FINITE_BASELINE',pressureAuthorized=False))

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
    require(len(calls)==1 and result.get('cleanupComplete') is True and result.get('phaseComplete') is True and result.get('functionalPhaseComplete') is True and result.get('qualifiedFinalCount')==4 and result.get('networkBaseline',{}).get('status')=='OBSERVED','explicit normal live baseline incomplete; never infer from functional proof alone')
    return result

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
