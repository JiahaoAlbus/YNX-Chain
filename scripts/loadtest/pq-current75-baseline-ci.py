#!/usr/bin/env python3
"""One normal full500 account initialization only; no business pressure window."""
import argparse,hashlib,json,os,re,shutil,signal,stat,subprocess,sys,types
from pathlib import Path
PROFILE = 'current9081-measured-initialize500-only'
REF = 'refs/heads/codex/ynx-pq-current75-baseline-20261101'
WORKFLOW = '.github/workflows/pq-normal-process.yml'
GO_SOURCE = '9081f14654a48f4fe14e57696ec33527869da353'
GO_TREE = '8c12ec07479bf6664cf279adb6395c704ead33e1'
FORK_TREE = '54e88e6aba735eaceeb2d00bb40731248c673bd7'
TOOLS = '33c72cce282fd159320c6955fe6eb54984cea316'
TOOLS_TREE = '319b9d4dc4bf30e604f15a0e7d3dc2096195ae43'
CAPS = {'totalSeconds': 900, 'cleanupSeconds': 15, 'rssBytes': 4294967296, 'newBytes': 8589934592, 'initialMemoryBytes': 6442450944, 'initialDiskBytes': 17179869184, 'logBytes': 4194304, 'cpus': 2}
SOURCE_PINS = {'.github/workflows/resource-market-ci.yml': '76cb248db157fd1746c7f9e4a1d2fb91a7ef332ea49cc1ad4082237114c3c7d5', 'go.mod': '2892248959ac73f0aaf16197ba18c78594ad956a2e9b9617404c2ebb50818858', 'go.sum': 'cfa98a228afc945aa54730a821b80cfc31cb1b8c0aa57aa0bd1e7cf3827d23ad', 'scripts/ops/validate-pq-remote-normal-ci.py': '6d617c4ba97f82d59db512962873df1202fabfc6f5422c1b56452f020fbb8475', 'scripts/loadtest/pq-source-artifact-intake.py': 'ab75f9748a05523f5719ee42a8a99b576d3444a30481b0e07253956e3e5943ef', 'cmd/ynx-consensus-pq-lab/checkpoint_loader.go': '20d60d66b1030fe2a3f47cec7c5e3822af6b13664ea25fe7aec45b9582ee66cd', 'cmd/ynx-consensus-pq-lab/workload.go': '1d4fceff16593d9e65b6031a6b34209d2944d4b5120b79ece710ac7a6d8aa366', 'internal/consensus/pq_lab_static_cache.go': 'af00934476f553ba22a898c55a70eaffe3b897d7ee314536893c02f9551bb8a0', 'internal/consensus/pq_lab_live_materials.go': '54de6d5af7a0e8bd529443c495fd0626b223713895c81364a64a31f819930e11', 'internal/consensus/pq_lab_live_materials_anchor.go': '64e2812147b444c5b186127dca3c745d012ce707a97ce19b19dee915950df1d0', 'internal/consensus/pq_lab_live_materials_control.go': '67ca8c5d2326c36da3b8b7725db34e8b1589c98c063b56197af71cf37b76a044', 'internal/consensus/pq_lab_network.go': '6e9ef5fee570d891bcf822f9ea827c5391a4852e30a14212a56337284914e9d2'}
TOOL_PINS = {'pq-network-window.py': '6132d2adf72e01959f9d9e71ec4da22961b7f5335cb77331dc2769c66af4cdc8', 'owned-tcp-accounting.py': '612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440', 'network-layer-accounting.py': '1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635', 'pq-hop-byte-accounting.py': '663c072e11f777d5119f87fa9e200548c117f937427c46295277e722c7d3744b', 'test_pq_hop_byte_accounting.py': '2116cdb12f52f2e8f6500d5e54e3d20248b0d29eef88081962b3ce6ff1984e67', 'pq-owned-header-capture.py': 'f5a03c7fbe7c1048d045986fbdd00f6e306d2025b53b41adeaf6fd8e06301bcd', 'test_pq_owned_header_capture.py': 'e30105c2282790215ae01c56e162402b71d49d23dd0d04b511fe92166d2f11f7', 'fixtures/commit-observation-public-schema.json': '9dc8dbf4820d04068b2272e4dd16f202d6fb106b82cecf8aef6d544517680c06', 'test_pq_commit_observation.py': '08f978edb78f153f7ab01a64e07ba6e7f35fa410c984103dc5c15372f76931cb', 'pq-commit-observation.py': '4033dea236ee7536e2bc4fab74655e0ec9317564ec10516e47d599ccafa64cc0', 'test_pq_independent_load.py': '78756c2e271ffe5999a73a2586cb83ff400728b87f29ddb4e0a686dcb814aaae', 'test_pq_public_proof_readback.py': '4b412446c26186ce925a2cfc5896901a58df64067c15e36e9b3d07a3b33ad019', 'pq-public-proof-readback.py': '50ad1dbb6eadb494cfac180f84fd9deb13051abae58f3acfb055d32541decc53', 'test_pq_helper_lifecycle.py': '00774fc00404074d59f7eb09839b1bf25830ab60771ed2fac83884da37a37629', 'test_pq_ready_metrics.py': 'c963092242dc7a63fb50e973949e18f35fb362be9dc78c37ca51fd0b9c155e1e', 'pq-independent-load.py': 'd1725b8f0a776385a46602c896ed07421059cd3db147729b56d4005ad0336092', 'pq-independent-scheduler.py': '98ff9d3c0c90fe7c46850b9014d757425d1c24eb9bcff1c3759df44082a0c9ee', 'pq-normal-process-lab.py': 'e40120a85ce5f45ab26cda26e7b0151e46ec820ea84846dddd19528b8551c587', 'consensus-linux-cohort.py': 'e6d8f6e841d63cf501148cbfea3eaf065f709a15e6455e5d4b2c49560fe051d2', 'pq-paired-linux-window.py': 'b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2', 'pq-c06-source-qualification.py': '385b34200486ede3045bea1e37d2cc0ea057481c0294257da4e825126975d37c', 'test_pq_c06_source_qualification.py': 'f112c861af7ffeaa966c24fd516ed84be308e6af64c9ce913a963eb7c3a582a3', 'fixtures/c06-functional-readback.json': '23c0639ababad3e041810ba9d21e96e754c618da7a14ee546aa9bf2ddabd7146', 'fixtures/c06-named-cases-original.zip': '65df3771ab668be1b6a8c044dbcc3cc0a024bea416b08547ba0d8eb9cb51d1fe', 'pq-owned-storage-window.py': '67e96cda53201b32b0ab1ca10707abb5e885645b51cbceaf2f3c8c77ac81f7c3', 'test_pq_owned_storage_window.py': '1dc1419b69361cbd604aef8c9b055b42b96567d181c3315ed1ce56395865cf33', 'pq-bounded-sender-backend.py': '44c56d132965653af0321144dda5b80dc3838c4bd8e97126f0d7185858f8dd12', 'pq-staged-independent-scheduler.py': '1e46d1665bf37869f15eaaa555a97a6939ff3fd45e6a9aadc87436271681cf77', 'pq-staged-harness-controls.py': '54c5e892a7a0848b56fb5d5f696563b172efa212f9cb4fa1cde4db3b36d5fba3', 'test_pq_bounded_sender_backend.py': '747f871cec3079f1af090623a7ae6b6ea7db36e0f434b615b4d7d123c058ec6e', 'test_pq_completion_diagnostics.py': 'af1193758a8b17b70dfa78790060a51787b9b4dfff598246843efec35a4c61b8', 'test_pq_staged_independent_scheduler.py': 'e9ba5de9b5c72d3fd1f0b6bba54847c6054382d8630b5b8f9f8f54110e8422bb', 'pq-initialization-measurements.py': 'a5dd93bc0be164f1d3b38b1962037e5ccb7f9a68bd9051b651fba2ff2ba8e917', 'test_pq_initialization_measurements.py': 'a7c0ba801d5d83642e88778778d1cac03087fa72f161d01ddb63970c91fbd521', 'fixtures/c4b-source-functional-original.json': '2daaf7e71840e15dc27dba9ff8883e285c5f3bacd88b7df655c6330a025e3664', 'pq-live-source-qualification.py': '159cbe9e96d8cde3956141fea5880f1b8bc16bf7db9f85aeddccf6c1c87d23a7', 'test_pq_live_source_qualification.py': '5998b6652afa345f5a0c2c66b79918fc3bf7984afd623ef84f8a8072781cbe01', 'fixtures/896-live-functional-original.json': '4ff5e4d1a301e4b8c636baadcfde1459f35107f2e2b5dedc456a3817f3e7deae', 'fixtures/init500-live-setup0-original-failure.txt': 'a81288b98a781b952f46d699850168248bddee30690248d490efcfabf1ae9cbd', 'pq-initialization-readback.py': '12263dae01251eb27f8e4b256573d56040761ed7da1620ac57b9105bf26a3d1b', 'test_pq_initialization_readback.py': '235542e500568073ab19eda48ab636c3818561c1026bf924ba2905f6c1ef96ff', 'test_pq_cold_readiness.py': '8ab8b791e30fa5279456a15b208cc88762ad74d28a9aa400cc998a10a0b96627', 'fixtures/9081-live-functional-original.json': '9744b10e2d40d4674ffc3dfaa2273349e9d7a8b13e22aa268724ce69c9386a22', 'test_resource_guard_sampling.py': 'e394f527f07f9b2228f0168ab11d95f3021669c12aa7d5e8ec4d5734ef33d082', 'test_pq_normal_clean_exit.py': '991f167b37bbbfac9c090f4e6ddb5ee8d47300038807f6d9fe4066c5f7fedce6', 'test_pq_normal_parent_measurements.py': '40acc291ef78d1772b9bac7f398c16952edb5aa05f880bf124052393d553c818', 'test_pq_load_escalation_conditions.py': 'd2afe2c375eac34ac90ea7db64b09d1860653f6678c37b48bbed27888763befb', 'test_linux_owned_rss.py': '6a9a92a7f910af83ffc227ef1fde1ff535658112fb1728308c5ed43b8620b5af', 'test_linux_thread_group_exit.py': '3b22ec42f247d76b0b12dc48fcdf28819efd799074d2931bee9d8ca235e84706', 'test_window_failure_cleanup.py': 'b29af491d4dd36d8f2756ba71d9bd949cf4aea9d95abea9e492346086b72bbd7', 'test_consensus_linux_cohort.py': 'bcb9b6450374f0d734887b7c7f4e9c83314e71f913948098da0927406b4e233b', 'pq-normal-live-reader.py': 'bcd4d6954ad1d894bc404e4760d87fe56d2354c45c1281c4a90964a71a76bfc2', 'pq-normal-live-source-data.py': '969610212a6fbed759d5a516a0c294bc4f796046e4755119780668b2cd837f6b', 'fixtures/9081-normal-live-source-original.zip': '5c3db014446402ced74177c7965ec1554fa6aa609b2cca0000fe2667bc2fef08', 'test_pq_normal_pair_gates.py': '20d8b43f711d7d60c4cb7331f824ec53734b9b8137d760e34ede7afedced78d0', 'pq-height-vectors.py': '2928be0afa76eb7d968533d6a71c4cc06298edef89bfa5cfece46211e281a2c3', 'test_pq_height_vectors.py': '7a75324faff6c3141a13217b664abf19637ffc4e22217a1e8e886490a0e589d1', 'test_pq_normal_live_source_data.py': '89a9e8ff671f4007bfb42cc6da88001563223d35ec30b9255be987a4be8a797d', 'test_pq_normal_live_build_source.py': 'aa35b1a041ba3da4e3dee1d6d432d6b37d1b66c81f1cb9f1d74f1bb7684d26db', 'test_pq_normal_network_baseline.py': 'd408a22ef0d592d6dd2b0e4391fb65b12a59c2ec95e62d4f013b0dd05aa992c9', 'test_pq_normal_live_reader.py': 'b8ab2724db4a2c7c26675f662e3c8581b5a6ff86ec69b43526701a6f7c604ac2'}

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
    return dict(profile=PROFILE,controllerRef=REF,goSource=GO_SOURCE,goTree=GO_TREE,tools=TOOLS,toolsTree=TOOLS_TREE,configuredBusinessDemand=500,preparationAccounts=4,measurementScope='normal-initialization-only',caps=CAPS,executed=False,businessLoadAuthorized=False,pressureAuthorized=False,nodeStartAuthorized=False,sourceGrant=False,sameHost=True,physicalFaultDomains=1,actual500InitializationQualified=False,resourceGuardComponentTimers=True,commitEncodingPersistenceObserver=True,allEightNodeExitZeroRequired=True,coldReadinessPhaseMaxSeconds=180,globalActiveLimitSeconds=885,ordinaryReadinessDefaultSeconds=60,steadyStateSLOChanged=False)


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
