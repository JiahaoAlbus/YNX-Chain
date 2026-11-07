#!/usr/bin/env python3
"""Fixed own1b initialization then first100 load; explicit hosted dispatch only."""
import argparse,hashlib,json,os,re,shutil,signal,stat,subprocess,sys,types
from pathlib import Path
PROFILE = 'first100-own1b-initialize-before-load'
REF = 'refs/heads/codex/ynx-pq-current75-baseline-20261101'
WORKFLOW = '.github/workflows/pq-normal-process.yml'
GO_SOURCE = '1b0ea548aca6b5260a9824d0edd3012d52e53521'
GO_TREE = '7c8f6cd8af01b366ea31ffc9f58659e6ca0099e6'
FORK_TREE = '54e88e6aba735eaceeb2d00bb40731248c673bd7'
TOOLS = '67870e2be35295fb903e4d6f1723092e2facef7f'
TOOLS_TREE = '7a002853e0351d9c0a125b558fa9fbfffde47211'
CAPS = {'totalSeconds': 900, 'cleanupSeconds': 15, 'rssBytes': 4294967296, 'newBytes': 8589934592, 'initialMemoryBytes': 6442450944, 'initialDiskBytes': 17179869184, 'logBytes': 4194304, 'cpus': 2}
SOURCE_PINS = {'.github/workflows/resource-market-ci.yml': 'dde5299df99ea0ce626b3eb32464dda406e2c779f36d30c2456f068dcae74f0b', 'go.mod': '07b303f8099eebb861f8ce1671089939e45069efbb1f71884b892548af47f803', 'go.sum': '87d7280001b2b5e12b687d45e921d5e3500d53b79d3885acf7ab2b9a17cc575c', 'scripts/ops/validate-pq-remote-normal-ci.py': '6d617c4ba97f82d59db512962873df1202fabfc6f5422c1b56452f020fbb8475', 'scripts/loadtest/pq-source-artifact-intake.py': 'ab75f9748a05523f5719ee42a8a99b576d3444a30481b0e07253956e3e5943ef', 'cmd/ynx-consensus-pq-lab/checkpoint_loader.go': '20d60d66b1030fe2a3f47cec7c5e3822af6b13664ea25fe7aec45b9582ee66cd', 'cmd/ynx-consensus-pq-lab/workload.go': '1d4fceff16593d9e65b6031a6b34209d2944d4b5120b79ece710ac7a6d8aa366', 'internal/consensus/pq_lab_static_cache.go': 'af00934476f553ba22a898c55a70eaffe3b897d7ee314536893c02f9551bb8a0', 'internal/consensus/pq_lab_live_materials.go': '1c8eb7e42812d5240bae880b0c94c8e8016d9c09bca4ffbfc37945f1dd5efb47', 'internal/consensus/pq_lab_live_materials_anchor.go': '64e2812147b444c5b186127dca3c745d012ce707a97ce19b19dee915950df1d0', 'internal/consensus/pq_lab_live_materials_control.go': '67ca8c5d2326c36da3b8b7725db34e8b1589c98c063b56197af71cf37b76a044', 'internal/consensus/pq_lab_network.go': 'a73d87452608eb13429b8a1acc02755120bd7500698a9c10e561f9be434e46ad'}
TOOL_PINS = {'pq-network-window.py': '6132d2adf72e01959f9d9e71ec4da22961b7f5335cb77331dc2769c66af4cdc8', 'owned-tcp-accounting.py': '612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440', 'network-layer-accounting.py': '1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635', 'pq-hop-byte-accounting.py': '663c072e11f777d5119f87fa9e200548c117f937427c46295277e722c7d3744b', 'test_pq_hop_byte_accounting.py': '2116cdb12f52f2e8f6500d5e54e3d20248b0d29eef88081962b3ce6ff1984e67', 'pq-owned-header-capture.py': 'f5a03c7fbe7c1048d045986fbdd00f6e306d2025b53b41adeaf6fd8e06301bcd', 'test_pq_owned_header_capture.py': 'e30105c2282790215ae01c56e162402b71d49d23dd0d04b511fe92166d2f11f7', 'fixtures/commit-observation-public-schema.json': '9dc8dbf4820d04068b2272e4dd16f202d6fb106b82cecf8aef6d544517680c06', 'test_pq_commit_observation.py': '08f978edb78f153f7ab01a64e07ba6e7f35fa410c984103dc5c15372f76931cb', 'pq-commit-observation.py': '4033dea236ee7536e2bc4fab74655e0ec9317564ec10516e47d599ccafa64cc0', 'test_pq_independent_load.py': '78756c2e271ffe5999a73a2586cb83ff400728b87f29ddb4e0a686dcb814aaae', 'test_pq_public_proof_readback.py': '4b412446c26186ce925a2cfc5896901a58df64067c15e36e9b3d07a3b33ad019', 'pq-public-proof-readback.py': '50ad1dbb6eadb494cfac180f84fd9deb13051abae58f3acfb055d32541decc53', 'test_pq_helper_lifecycle.py': '00774fc00404074d59f7eb09839b1bf25830ab60771ed2fac83884da37a37629', 'test_pq_ready_metrics.py': 'c963092242dc7a63fb50e973949e18f35fb362be9dc78c37ca51fd0b9c155e1e', 'pq-independent-load.py': '6fabf803367b42e9980de1c52350801100735bf5be02364dbc209d5473db7cc8', 'pq-independent-scheduler.py': 'ce8f3384191283980d967a0166a53ed52f77b1e7add7008df7c446d35a6e8bfa', 'pq-normal-process-lab.py': '67b9c025cdfbcd0554a1701a5119fa496fead5ff91fa688845d81ee18ee125a5', 'consensus-linux-cohort.py': 'e6d8f6e841d63cf501148cbfea3eaf065f709a15e6455e5d4b2c49560fe051d2', 'pq-paired-linux-window.py': 'b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2', 'pq-c06-source-qualification.py': '385b34200486ede3045bea1e37d2cc0ea057481c0294257da4e825126975d37c', 'test_pq_c06_source_qualification.py': 'f112c861af7ffeaa966c24fd516ed84be308e6af64c9ce913a963eb7c3a582a3', 'fixtures/c06-functional-readback.json': '23c0639ababad3e041810ba9d21e96e754c618da7a14ee546aa9bf2ddabd7146', 'fixtures/c06-named-cases-original.zip': '65df3771ab668be1b6a8c044dbcc3cc0a024bea416b08547ba0d8eb9cb51d1fe', 'pq-owned-storage-window.py': '67e96cda53201b32b0ab1ca10707abb5e885645b51cbceaf2f3c8c77ac81f7c3', 'test_pq_owned_storage_window.py': '1dc1419b69361cbd604aef8c9b055b42b96567d181c3315ed1ce56395865cf33', 'pq-bounded-sender-backend.py': '44c56d132965653af0321144dda5b80dc3838c4bd8e97126f0d7185858f8dd12', 'pq-staged-independent-scheduler.py': '1e46d1665bf37869f15eaaa555a97a6939ff3fd45e6a9aadc87436271681cf77', 'pq-staged-harness-controls.py': 'a3795ff29d801bd5db90dd728ca3118f17e8403273637bcbfa0a4f238829f99b', 'test_pq_bounded_sender_backend.py': '747f871cec3079f1af090623a7ae6b6ea7db36e0f434b615b4d7d123c058ec6e', 'test_pq_completion_diagnostics.py': 'af1193758a8b17b70dfa78790060a51787b9b4dfff598246843efec35a4c61b8', 'test_pq_staged_independent_scheduler.py': 'e9ba5de9b5c72d3fd1f0b6bba54847c6054382d8630b5b8f9f8f54110e8422bb', 'pq-initialization-measurements.py': 'a5dd93bc0be164f1d3b38b1962037e5ccb7f9a68bd9051b651fba2ff2ba8e917', 'test_pq_initialization_measurements.py': 'a7c0ba801d5d83642e88778778d1cac03087fa72f161d01ddb63970c91fbd521', 'fixtures/c4b-source-functional-original.json': '2daaf7e71840e15dc27dba9ff8883e285c5f3bacd88b7df655c6330a025e3664', 'pq-live-source-qualification.py': '159cbe9e96d8cde3956141fea5880f1b8bc16bf7db9f85aeddccf6c1c87d23a7', 'test_pq_live_source_qualification.py': '5998b6652afa345f5a0c2c66b79918fc3bf7984afd623ef84f8a8072781cbe01', 'fixtures/896-live-functional-original.json': '4ff5e4d1a301e4b8c636baadcfde1459f35107f2e2b5dedc456a3817f3e7deae', 'fixtures/init500-live-setup0-original-failure.txt': 'a81288b98a781b952f46d699850168248bddee30690248d490efcfabf1ae9cbd', 'pq-initialization-readback.py': 'da7957678bd0e56f3711431bdb7094bb2d381dc3ebfae14bd78cf56d9e51204b', 'test_pq_initialization_readback.py': '601db3cff42985cbfeb46a54097ebee73e233fa2a1fa47be79ce2998d2c7bf8c', 'test_pq_cold_readiness.py': 'd0f734a0393f1a0d3c6fb4d314190b6cb4228426a72d2e41953996e5cecd8fb9', 'fixtures/9081-live-functional-original.json': '9744b10e2d40d4674ffc3dfaa2273349e9d7a8b13e22aa268724ce69c9386a22', 'test_resource_guard_sampling.py': 'e394f527f07f9b2228f0168ab11d95f3021669c12aa7d5e8ec4d5734ef33d082', 'test_pq_normal_clean_exit.py': '991f167b37bbbfac9c090f4e6ddb5ee8d47300038807f6d9fe4066c5f7fedce6', 'test_pq_normal_parent_measurements.py': '40acc291ef78d1772b9bac7f398c16952edb5aa05f880bf124052393d553c818', 'test_pq_load_escalation_conditions.py': '5307203ba58fc2656b6ce79eec4d9e1a175ffeaeef05a98d432d5b3764d6fb9d', 'test_linux_owned_rss.py': '6a9a92a7f910af83ffc227ef1fde1ff535658112fb1728308c5ed43b8620b5af', 'test_linux_thread_group_exit.py': '3b22ec42f247d76b0b12dc48fcdf28819efd799074d2931bee9d8ca235e84706', 'test_window_failure_cleanup.py': 'b29af491d4dd36d8f2756ba71d9bd949cf4aea9d95abea9e492346086b72bbd7', 'test_consensus_linux_cohort.py': 'bcb9b6450374f0d734887b7c7f4e9c83314e71f913948098da0927406b4e233b', 'pq-normal-live-reader.py': 'a81ae944a691fae89b57b8e833015b19367dadc8c67e2c6f7f7c0a5b210dce06', 'pq-normal-live-source-data.py': '969610212a6fbed759d5a516a0c294bc4f796046e4755119780668b2cd837f6b', 'fixtures/9081-normal-live-source-original.zip': '5c3db014446402ced74177c7965ec1554fa6aa609b2cca0000fe2667bc2fef08', 'test_pq_normal_pair_gates.py': '20d8b43f711d7d60c4cb7331f824ec53734b9b8137d760e34ede7afedced78d0', 'pq-height-vectors.py': '2928be0afa76eb7d968533d6a71c4cc06298edef89bfa5cfece46211e281a2c3', 'test_pq_height_vectors.py': '7a75324faff6c3141a13217b664abf19637ffc4e22217a1e8e886490a0e589d1', 'test_pq_normal_live_source_data.py': '89a9e8ff671f4007bfb42cc6da88001563223d35ec30b9255be987a4be8a797d', 'test_pq_normal_live_build_source.py': 'aa35b1a041ba3da4e3dee1d6d432d6b37d1b66c81f1cb9f1d74f1bb7684d26db', 'test_pq_normal_network_baseline.py': 'd408a22ef0d592d6dd2b0e4391fb65b12a59c2ec95e62d4f013b0dd05aa992c9', 'test_pq_normal_live_reader.py': 'b8ab2724db4a2c7c26675f662e3c8581b5a6ff86ec69b43526701a6f7c604ac2', 'pq-lossless-source-data.py': '43cd58a84b361162f637586f391782ea65ffa6fcb5152e6bc515fd2cd3ba075c', 'test_pq_lossless_source_data.py': '2530f2dfda2e4940d9af6ed50d70eafed2f1b22418d4e573ead60792ee0d8ed1', 'fixtures/1a-lossless-source-original.zip': '4139c50b32dc9929522da0ba61b18df271e9cee2a7d7ef7760f5860832ea7e81', 'fixtures/1a-lossless-source-job.json': '97e733ec1a9bd5e7bd16dbe23996850193a2e647985483e3223d7d50351c8aa1', 'pq-finalize-trace-readback.py': '6b88b499745d2a3fe7cdcc1e690ca116a4986fc81fe40876a55491886569d524', 'test_pq_finalize_trace_readback.py': '4a1ac12d8f7c62ba6301a7b6371a89a8658ce99773edb8945ae8bd3fae4954b8', 'fixtures/6cc-component-source-H.json': '8ca54724aabb5f69928748baf72f49090a9f089b8dfce842995570952a30bdf2', 'fixtures/6cc-component-source-jobs.json': 'abcef528a4e4c4c4b99706366a66adcce6451cfb3e884833f4655203a001053e', 'fixtures/6cc-lossless-source-original.zip': '6f1ad2c3ec3de639d7ef78f04e182a7804703ff6c5011dc1fdd8f418420eaedf', 'fixtures/6cc-trace-source-original.zip': '3145708e392121ac43bad0c287079598e7930b01750eb8be6f4a6de8ee677475', 'pq-normal-paired-runtime.py': 'e0257f223d0a2f7732bf9cac58e170365249137b86200a286aa3de6f15c1716a', 'test_pq_normal_paired_runtime.py': 'edab54868e48aa9aafda0e4f608020ee43b766715ef9ca3aea148c2a8dcedd89', 'pq-normal-leg-trace.py': '43d2a2059df8933e57e5f6709376bef274f4bc480e08c81300a8c26da6c69121', 'test_pq_normal_leg_trace.py': 'a6ad35270139dfda7ba89702da17c72a5430c377db32ffd3e51a9e7835f1f234', 'pq-node-startup-measurements.py': '3b6e5a3b27ec0d1bc18f9469c961b23c9dedaf960928b0f9dbfd77de78115045', 'test_pq_node_startup_measurements.py': '81896422ac5e8f4e03d3cd7b5278a9854e9fb088db7dae30d58e96007330d3b7', 'test_pq_preparation_startup_timings.py': '21af9c61f18f53d2e2812e3e5ef6619e7e2d33313fe2122b68150107a9f9a9fb', 'pq-rpc-measurements.py': '610e634faf55f3d5fced1a1037139600019bc61175f9e79cc3d7209127f73ed3', 'test_pq_rpc_measurements.py': '5a36392c9162075468d729b3ea18fbcde59a834c9c41ccd9286c82ea466b83bb', 'test_pq_normal_callgraph.py': '507854aab80fd522ba93c6699e6c38f18eed30159bc6506aee175c3b0dc63bef', 'test_pq_observed_throughput.py': 'df8c26a18a35214acef9a6a4f158f3bb8c3759c2107d94214aecc92da6ced6ad', 'pq-preload-initialization.py': 'f6fbc37c6b97ca6831c81c39a08d8213e00c1093e24b980ee3653edfb67d3f7d', 'test_pq_preload_initialization.py': 'bb6ecb84e3c22fe98e354ebe1f26e4d7690029f70924ab84769dc704033a61e7', 'pq-first-trial-source.py': '495a0614dc989db5c5eee157a3e5519459a90750821896a194073993c76dad7d', 'test_pq_first_trial_source.py': 'd7e67253675ec0e323b90e96c5fd43e39a82efa5dc4edf829750a4fea5059aaa', 'fixtures/1b-source/13563183469.zip': '347a0d9ce401a3463f54ad6dfa8162ee88a70c655bd4acf9de6054f53016b60c', 'fixtures/1b-source/42345664409-FINAL-STATUS.json': '9a8ed811350b75dfe2a0480a27fce1fca0c3e693c82e53283b83411ed49ef1f4', 'fixtures/1b-source/STARTUP-COLLECTOR-RECEIPTS-FINAL.json': '831a7247e8a152731c5539a01e7d2caa6ba7cb35680e1593bc971d613f8246b2', 'fixtures/1b-source/13563318084.zip': '7161456f8e54d29574c998bf782788804c84c09b0c9211453ab6dc64a0a6bcea', 'fixtures/1b-source/13563592493.zip': 'faca376d34f3208f5ec383018312d1fb254a80c13f62b1ad16afb368c92cde8b', 'fixtures/1b-source/H.json': '610c4c4a85be1755f488aaa31c6e3b630af0f36230e0c206786fd168c236e147', 'fixtures/1b-source/13564005459.zip': 'b08d6dfd81ef4a387cf409198ad9c683ca569cd7a0cb6de91aac121a14107883', 'fixtures/1b-source/CLIENT-ORIGINAL.log': '14303b5d8fdd4ea00e38841bafcd29194654af930b4efd50baa11709a748004f', 'fixtures/1b-source/42345664402-FINAL-STATUS.json': 'b739ec7494768ee13361f93cc758d3b0389456720042ca7353f1bcda1f990f58'}

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
            environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and
            environment.get("GITHUB_JOB") == PROFILE and
            environment.get("GITHUB_REF") == REF and environment.get("GITHUB_RUN_ATTEMPT") == "1" and
            environment.get("PQ_BASELINE_PROFILE") == PROFILE and
            environment.get("GITHUB_WORKFLOW_REF") == "JiahaoAlbus/YNX-Chain/" + WORKFLOW + "@" + REF,
            "only the fixed first-attempt hosted synthetic profile may execute")
    require(re.fullmatch("[0-9a-f]{40}", environment.get("GITHUB_SHA", "")) is not None and
            environment["GITHUB_SHA"] != "0" * 40 and
            environment.get("GITHUB_WORKFLOW_SHA") == environment["GITHUB_SHA"] and
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
        driver.lab.write_new(work / "public/FIRST100-OWN1B-CI.json", record)
        calls.append(window)
        return window

    driver.lab.Window = counted_window
    return original, calls

def fixed_options(source):
    return argparse.Namespace(source=str(source),commit=GO_SOURCE,mode='online',rate=100,seconds=5,accounts=500,per_account=1,tail_seconds=30,proof_timeout=30,wire_observation=True,network_accounting=True,header_hop_capture=False,owned_storage_accounting=True,commit_observation=True,prior_result=None,prior_result_sha256=None,execute=True,staged_publication=True,initialization_only=False,initialize_before_load=True,startup_timings=True)


def prepared_data():
    return dict(profile=PROFILE,controllerRef=REF,goSource=GO_SOURCE,goTree=GO_TREE,tools=TOOLS,toolsTree=TOOLS_TREE,configuredBusinessDemand=500,preparationAccounts=4,measurementScope='same-window-normal504-initialization-then-first100x5',caps=CAPS,executed=False,businessLoadAuthorized=False,pressureAuthorized=False,nodeStartAuthorized=False,sourceGrant=False,sameHost=True,physicalFaultDomains=1,actual500InitializationQualified=False,resourceGuardComponentTimers=True,commitEncodingPersistenceObserver=True,allEightNodeExitZeroRequired=True,coldReadinessPhaseMaxSeconds=180,globalActiveLimitSeconds=885,ordinaryReadinessDefaultSeconds=60,steadyStateSLOChanged=False,requiredRemainingActiveSeconds=35,initializationBeforeLoad=True,startupTimings=True,higher500Or1000Permission=False)


def verify_tools(tools):
    checked_source(tools,TOOLS,TOOLS_TREE)
    for path,pin in TOOL_PINS.items():pinned_bytes(tools/'scripts/loadtest'/path,pin)
    require(not any((tools/'scripts/loadtest').rglob('*.pyc')),'no ignored bytecode substitutes allowed')


def validate_driver(driver):
    # The old source/initialization/escalation gates remain untouched in tools.
    require(driver.STAGED_CALLEE_SOURCE=='9081f14654a48f4fe14e57696ec33527869da353' and driver.STAGED_SOURCE_QUALIFICATION is None,'legacy staged qualification gate changed')
    require(driver.first_trial_source.SOURCE==GO_SOURCE and driver.first_trial_source.TREE==GO_TREE and driver.first_trial_source.H_SHA=='610c4c4a85be1755f488aaa31c6e3b630af0f36230e0c206786fd168c236e147','exact own-source qualification binding required')
    require(driver.lab.CAPS==CAPS and driver.lab.RSS_OBSERVER_VERSION=='same-process-rss-v4-pidfd-any-state' and driver.lab.guard.CAPS['ownedProcesses']==16,'original runtime guard/caps differ')
    data=driver.first_trial_source.qualification()
    require(data['source']==GO_SOURCE and data['sourceTree']==GO_TREE and data['sourceOnlyQualified'] is True and data['runtimePermissionGranted'] is False and data['pressureAuthorized'] is False and data['actual500InitializedOwnersQualified'] is False,'own source-only DATA cannot grant runtime or prior500 qualification')
    return data


def validate_result(driver,result,source_data):
    require(result.get('source',{}).get('commit')==GO_SOURCE and result['source'].get('tree')==GO_TREE and result.get('toolIdentity',{}).get('commit')==TOOLS and result['toolIdentity'].get('tree')==TOOLS_TREE and result.get('caps')==CAPS,'actual original result source/tools/caps differ')
    require(result.get('sameWindowInitializationSourceFunctionalData')==source_data and result.get('loadConditions')==driver.load_conditions(fixed_options(Path('/source'))),'result cannot inherit another source or load profile')
    require(result.get('firstCause') is None and result.get('cleanupComplete') is True and result.get('loadExecuted') is True and result.get('normalLiveCalleeUsed') is True and result.get('initializationOnlyRequested') is False,'original same-window preparation/load/cleanup incomplete; preserve first cause')
    preload=result.get('preloadInitialization');require(type(preload) is dict,'original pre-release boundary missing')
    checked=driver.preload_initialization.validate(result.get('initializedAccountReadback'),preload.get('originalProcesses'),result.get('preparationUnconfirmedOwners'),preload.get('remainingOriginalActiveSeconds'),5,30)
    require(checked==preload,'original pre-release census/process/budget receipt differs')
    final=driver.normal.normal_node_clean_exit(result.get('processes',[]))
    require(final['allEightExitZero'] is True and result.get('normalNodeCleanExit')==final,'eight natural exit0 observations required independently of cleanup/proof')
    before={row['name']:(row['pid'],str(row['startTicks'])) for row in preload['originalProcesses']}
    require(before=={row['name']:(row['pid'],str(row['startTicks'])) for row in final['records']},'pre-release and final original node identities differ')
    load=result.get('loadResult',{})
    require(load.get('firstCause') is None and load.get('windowCompleted') is True and load.get('configuredDemand')==500 and load.get('requestedOfferedTPS')==100 and load.get('releasedWithinWindow')==500 and load.get('qualified')==500 and all(load.get(key)==0 for key in ('notReleased','notSubmitted','lateSubmitted','notQualified')),'complete original500 demand/proof/confirm readback required; no escalation')
    return result


def execute(source,tools):
    validate_host(os.environ)
    workspace=Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True);parent=Path(os.environ['RUNNER_TEMP']).resolve(strict=True);controller=Path(__file__).resolve().parents[2]
    require(controller==workspace/'controller' and source==workspace/'source' and tools==workspace/'tools','only the exact three owned checkout locations allowed')
    require(git(controller,'rev-parse','HEAD')==os.environ['GITHUB_SHA'] and git(controller,'status','--porcelain','--untracked-files=all')=='','exact clean original controller required')
    checked_source(source,GO_SOURCE,GO_TREE);verify_tools(tools)
    require(git(source,'rev-parse','HEAD:third_party/cometbft')==FORK_TREE,'original Comet graph differs')
    for path,pin in SOURCE_PINS.items():pinned_bytes(source/path,pin)
    os.environ.pop('GH_TOKEN',None);os.environ.pop('GITHUB_TOKEN',None)
    driver=pinned_module('normal_initialization_driver',tools/'scripts/loadtest/pq-independent-load.py',TOOL_PINS['pq-independent-load.py'])
    intake=pinned_module('normal_initialization_store',source/'scripts/loadtest/pq-source-artifact-intake.py',SOURCE_PINS['scripts/loadtest/pq-source-artifact-intake.py'])
    data=validate_driver(driver)
    go=shutil.which('go');require(go is not None,'original pinned Go toolchain required');go_root=Path(go).resolve(strict=True).parent.parent
    adapter=dict(prepared_data(),controllerCommit=os.environ['GITHUB_SHA'],controllerSourceSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),sourceFunctionalPrerequisite=data)
    original,calls=install_counted_window(driver,intake,(workspace,parent,go_root),adapter)
    try:
        options=fixed_options(source);require(driver.validate_options(options)==500,'full500 original business cohort required')
        result=driver.run(options)
    finally:driver.lab.Window=original
    require(len(calls)==1,'exactly one original initialization Window required')
    return validate_result(driver,result,data)



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
