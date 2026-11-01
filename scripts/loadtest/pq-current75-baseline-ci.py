#!/usr/bin/env python3
"""One normal full500 account initialization only; no business pressure window."""
import argparse,hashlib,json,os,re,shutil,signal,stat,subprocess,sys,types
from pathlib import Path
PROFILE = 'currentc4b-initialize500-only'
REF = 'refs/heads/codex/ynx-pq-current75-baseline-20261101'
WORKFLOW = '.github/workflows/pq-normal-process.yml'
GO_SOURCE = 'c4b39c73ec3a43c2ba32f7071bb735b0c0447f5e'
GO_TREE = '2fd621242e73e1cb4901413c03f7d48336801d11'
FORK_TREE = '54e88e6aba735eaceeb2d00bb40731248c673bd7'
TOOLS = '1f4996d507df8c1b4d079ffe9922f5801099ea34'
TOOLS_TREE = 'efc22834b0ab0a8a17695b592ffd9861aa4e0ebe'
CAPS = {'totalSeconds': 900, 'cleanupSeconds': 15, 'rssBytes': 4294967296, 'newBytes': 8589934592, 'initialMemoryBytes': 6442450944, 'initialDiskBytes': 17179869184, 'logBytes': 4194304, 'cpus': 2}
SOURCE_PINS = {'.github/workflows/resource-market-ci.yml': 'a0ae81fd4ec76fa14006e1eed606e5be8001c39eab24ec21977702282b11ffb6', 'go.mod': '2892248959ac73f0aaf16197ba18c78594ad956a2e9b9617404c2ebb50818858', 'go.sum': 'cfa98a228afc945aa54730a821b80cfc31cb1b8c0aa57aa0bd1e7cf3827d23ad', 'scripts/ops/validate-pq-remote-normal-ci.py': '6d617c4ba97f82d59db512962873df1202fabfc6f5422c1b56452f020fbb8475', 'scripts/loadtest/pq-source-artifact-intake.py': 'ab75f9748a05523f5719ee42a8a99b576d3444a30481b0e07253956e3e5943ef', 'cmd/ynx-consensus-pq-lab/checkpoint_loader.go': '20d60d66b1030fe2a3f47cec7c5e3822af6b13664ea25fe7aec45b9582ee66cd', 'cmd/ynx-consensus-pq-lab/workload.go': '1d4fceff16593d9e65b6031a6b34209d2944d4b5120b79ece710ac7a6d8aa366', 'internal/consensus/pq_lab_static_cache.go': 'af00934476f553ba22a898c55a70eaffe3b897d7ee314536893c02f9551bb8a0'}
TOOL_PINS = {'pq-network-window.py': '6132d2adf72e01959f9d9e71ec4da22961b7f5335cb77331dc2769c66af4cdc8', 'owned-tcp-accounting.py': '612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440', 'network-layer-accounting.py': '1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635', 'pq-hop-byte-accounting.py': '663c072e11f777d5119f87fa9e200548c117f937427c46295277e722c7d3744b', 'test_pq_hop_byte_accounting.py': '2116cdb12f52f2e8f6500d5e54e3d20248b0d29eef88081962b3ce6ff1984e67', 'pq-owned-header-capture.py': 'f5a03c7fbe7c1048d045986fbdd00f6e306d2025b53b41adeaf6fd8e06301bcd', 'test_pq_owned_header_capture.py': 'e30105c2282790215ae01c56e162402b71d49d23dd0d04b511fe92166d2f11f7', 'fixtures/commit-observation-public-schema.json': '9dc8dbf4820d04068b2272e4dd16f202d6fb106b82cecf8aef6d544517680c06', 'test_pq_commit_observation.py': 'f959a619f163b8af46081aa9c8629da4db4930e356a8bec3b722de7266bca1e8', 'pq-commit-observation.py': 'dc0c830f8e8281a15de2c5c77a278e68419909843af90fde93230e919c9e2ff0', 'test_pq_independent_load.py': '78756c2e271ffe5999a73a2586cb83ff400728b87f29ddb4e0a686dcb814aaae', 'test_pq_public_proof_readback.py': '4b412446c26186ce925a2cfc5896901a58df64067c15e36e9b3d07a3b33ad019', 'pq-public-proof-readback.py': '50ad1dbb6eadb494cfac180f84fd9deb13051abae58f3acfb055d32541decc53', 'test_pq_helper_lifecycle.py': '00774fc00404074d59f7eb09839b1bf25830ab60771ed2fac83884da37a37629', 'test_pq_ready_metrics.py': 'c963092242dc7a63fb50e973949e18f35fb362be9dc78c37ca51fd0b9c155e1e', 'pq-independent-load.py': '779e59cb37bde4966af09e92fbc9bad57a509db1bbecbbda0782284a5f223466', 'pq-independent-scheduler.py': '98ff9d3c0c90fe7c46850b9014d757425d1c24eb9bcff1c3759df44082a0c9ee', 'pq-normal-process-lab.py': '6810b02608e54fe0dfde05555073c8f01463ac182f4dea76a9dfb6a2af4e1195', 'consensus-linux-cohort.py': 'ffc7e02e1d37adc28f4d94c262d30a45e91eb594307931b482dcdd39ccc82591', 'pq-paired-linux-window.py': 'b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2', 'pq-c06-source-qualification.py': '385b34200486ede3045bea1e37d2cc0ea057481c0294257da4e825126975d37c', 'test_pq_c06_source_qualification.py': 'f112c861af7ffeaa966c24fd516ed84be308e6af64c9ce913a963eb7c3a582a3', 'fixtures/c06-functional-readback.json': '23c0639ababad3e041810ba9d21e96e754c618da7a14ee546aa9bf2ddabd7146', 'fixtures/c06-named-cases-original.zip': '65df3771ab668be1b6a8c044dbcc3cc0a024bea416b08547ba0d8eb9cb51d1fe', 'pq-owned-storage-window.py': '67e96cda53201b32b0ab1ca10707abb5e885645b51cbceaf2f3c8c77ac81f7c3', 'test_pq_owned_storage_window.py': '1dc1419b69361cbd604aef8c9b055b42b96567d181c3315ed1ce56395865cf33', 'pq-bounded-sender-backend.py': '44c56d132965653af0321144dda5b80dc3838c4bd8e97126f0d7185858f8dd12', 'pq-staged-independent-scheduler.py': '1e46d1665bf37869f15eaaa555a97a6939ff3fd45e6a9aadc87436271681cf77', 'pq-staged-harness-controls.py': '0914b1eb59c3b23ba039e63ef608aaa1463a1722b2ef6ecc6825b62a45fa170d', 'test_pq_bounded_sender_backend.py': 'ee891ffbc6275fec3209fe564db1af768e91c881fcb76671f008b36545767b79', 'test_pq_completion_diagnostics.py': 'af1193758a8b17b70dfa78790060a51787b9b4dfff598246843efec35a4c61b8', 'test_pq_staged_independent_scheduler.py': 'e9ba5de9b5c72d3fd1f0b6bba54847c6054382d8630b5b8f9f8f54110e8422bb', 'pq-initialization-measurements.py': '373f3e18ec7cda4f9781ee2dad87105a22793635275ab56b5e7c435fc5c6c63d', 'test_pq_initialization_measurements.py': '64ed087b9727d52861a03a8cb0d4874b38a7367caa892248a5c3057aa5b22230', 'fixtures/c4b-source-functional-original.json': '2daaf7e71840e15dc27dba9ff8883e285c5f3bacd88b7df655c6330a025e3664'}

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
        driver.lab.write_new(work / "public/CURRENT703-BASELINE-CI.json", record)
        calls.append(window)
        return window

    driver.lab.Window = counted_window
    return original, calls

def fixed_options(source):
    return argparse.Namespace(source=str(source),commit=GO_SOURCE,mode='online',rate=100,seconds=5,accounts=500,per_account=1,tail_seconds=30,proof_timeout=30,wire_observation=False,network_accounting=False,header_hop_capture=False,owned_storage_accounting=True,commit_observation=True,prior_result=None,prior_result_sha256=None,execute=True,staged_publication=True,initialization_only=True)


def prepared_data():
    return dict(profile=PROFILE,controllerRef=REF,goSource=GO_SOURCE,goTree=GO_TREE,tools=TOOLS,toolsTree=TOOLS_TREE,configuredBusinessDemand=500,preparationAccounts=4,measurementScope='normal-initialization-only',caps=CAPS,executed=False,businessLoadAuthorized=False,pressureAuthorized=False,nodeStartAuthorized=False,sourceGrant=False,sameHost=True,physicalFaultDomains=1,actual500InitializationQualified=False)


def execute(source,tools):
    validate_host(os.environ)
    workspace=Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True);parent=Path(os.environ['RUNNER_TEMP']).resolve(strict=True);controller=Path(__file__).resolve().parents[2]
    require(controller==workspace/'controller' and source==workspace/'source' and tools==workspace/'tools','only the exact three owned checkout locations allowed')
    require(git(controller,'rev-parse','HEAD')==os.environ['GITHUB_SHA'] and git(controller,'status','--porcelain','--untracked-files=all')=='','exact clean original controller required')
    checked_source(source,GO_SOURCE,GO_TREE);checked_source(tools,TOOLS,TOOLS_TREE)
    require(git(source,'rev-parse','HEAD:third_party/cometbft')==FORK_TREE,'original Comet graph differs')
    for path,pin in SOURCE_PINS.items():pinned_bytes(source/path,pin)
    for path,pin in TOOL_PINS.items():pinned_bytes(tools/'scripts/loadtest'/path,pin)
    require(not any((tools/'scripts/loadtest').rglob('*.pyc')),'no ignored bytecode substitutes allowed')
    os.environ.pop('GH_TOKEN',None);os.environ.pop('GITHUB_TOKEN',None)
    driver=pinned_module('normal_initialization_driver',tools/'scripts/loadtest/pq-independent-load.py',TOOL_PINS['pq-independent-load.py'])
    intake=pinned_module('normal_initialization_store',source/'scripts/loadtest/pq-source-artifact-intake.py',SOURCE_PINS['scripts/loadtest/pq-source-artifact-intake.py'])
    require(driver.STAGED_CALLEE_SOURCE==GO_SOURCE and driver.STAGED_CALLEE_TREE==GO_TREE and driver.STAGED_SOURCE_QUALIFICATION is None,'exact staged source and absent business-pressure qualification required')
    require(driver.lab.CAPS==CAPS and driver.lab.RSS_OBSERVER_VERSION=='same-process-rss-v4-pidfd-any-state' and driver.lab.guard.CAPS['ownedProcesses']==16,'original runtime guard/caps differ')
    data=driver.initialization.source_functional_data()
    require(data['source']==GO_SOURCE and data['pressureAuthorized'] is False and data['actual500OwnerInputPreviouslyQualified'] is False,'source-functional receipt cannot grant full500 or pressure')
    go=shutil.which('go');require(go is not None,'original pinned Go toolchain required');go_root=Path(go).resolve(strict=True).parent.parent
    adapter=dict(prepared_data(),controllerCommit=os.environ['GITHUB_SHA'],controllerSourceSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),sourceFunctionalPrerequisite=data)
    original,calls=install_counted_window(driver,intake,(workspace,parent,go_root),adapter)
    try:
        options=fixed_options(source);require(driver.validate_options(options)==500,'full500 original business cohort required')
        result=driver.run(options)
    finally:driver.lab.Window=original
    require(len(calls)==1,'exactly one original initialization Window required')
    validation=driver.initialization.require_complete_initialization(result)
    require(validation['pressureAuthorized'] is False and result.get('loadExecuted') is False,'no business load authorization or execution from initialization')
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
        raise RuntimeError("normal independent load received signal " + str(signum))
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    print(json.dumps(execute(Path(args.source), Path(args.tools)), sort_keys=True))
    return 0

if __name__=='__main__':raise SystemExit(main())
