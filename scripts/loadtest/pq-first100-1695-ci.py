#!/usr/bin/env python3
"""Separate fixed1695 first100 profile; source evidence never grants a window."""
import argparse,hashlib,json,os,re,shutil,signal,stat,subprocess,sys,types
from pathlib import Path
import urllib.request

PROFILES = {'first100-1695-bounded-cold': 'bounded-cold', 'first100-1695-public-owner': 'public-owner'}
PROFILE = os.environ.get('PQ_BASELINE_PROFILE','first100-1695-public-owner')
REF = 'refs/heads/codex/ynx-pq-current75-baseline-20261101'
WORKFLOW = '.github/workflows/pq-normal-process.yml'
GO_SOURCE = '1695aafd351b3cac7860d3452c555a02498e8350'
GO_TREE = '9a172a0a4b07aecc6365bbd05b58726f1214806c'
FORK_TREE = '5a128880d14bfc73de4334cba23218859ad3473c'
TOOLS = '8b2a6db0e2b1e8ea25e73486acfa4eae9ba736cc'
TOOLS_TREE = '90760b360421b688c05ebc0778bb3157c1575713'
CAPS = {'totalSeconds': 900, 'cleanupSeconds': 15, 'rssBytes': 4294967296, 'newBytes': 8589934592, 'initialMemoryBytes': 6442450944, 'initialDiskBytes': 17179869184, 'logBytes': 4194304, 'cpus': 2}
SOURCE_PINS = {'.github/workflows/resource-market-ci.yml': '35dbca1c7bdf0d9f0432be7ea2cd74226b701deab38cdc5c081389013f90aea2', 'cmd/ynx-consensus-pq-lab/checkpoint_loader.go': '5c98b2bae998fbb5c43ee5d8bcfcd0552d539eb1d90c627dfbcd1a3f0e8ea3ee', 'cmd/ynx-consensus-pq-lab/workload.go': '2f818bf32871a72ed4be732b43f23cd13e58d593e0290d034bb01024ef1b8063', 'go.mod': '07b303f8099eebb861f8ce1671089939e45069efbb1f71884b892548af47f803', 'go.sum': '87d7280001b2b5e12b687d45e921d5e3500d53b79d3885acf7ab2b9a17cc575c', 'internal/consensus/pq_lab_live_materials.go': 'ee5c36c43a4bcf4a8d2472dd38f6839a5d6da93b1e34fb5e4bdbdc68bb453502', 'internal/consensus/pq_lab_live_materials_anchor.go': '64e2812147b444c5b186127dca3c745d012ce707a97ce19b19dee915950df1d0', 'internal/consensus/pq_lab_live_materials_control.go': 'a510d3ba225d5ce321d9eb6608d757033676d255444e5923b687f50a0af6043f', 'internal/consensus/pq_lab_network.go': 'b3dd4fed0f2c5fd1bca21599da3ce8ac0a331319f83597d233ab55cfae4accb7', 'internal/consensus/pq_lab_static_cache.go': '89f4123fc10423e13fa228c754ec3fe3f08577f6ba31254739f4b088d363f6bd', 'scripts/loadtest/pq-source-artifact-intake.py': 'ab75f9748a05523f5719ee42a8a99b576d3444a30481b0e07253956e3e5943ef', 'scripts/ops/validate-pq-remote-normal-ci.py': '6d617c4ba97f82d59db512962873df1202fabfc6f5422c1b56452f020fbb8475'}
TOOL_PINS = {'consensus-linux-cohort.py': 'e6d8f6e841d63cf501148cbfea3eaf065f709a15e6455e5d4b2c49560fe051d2', 'fixtures/1695-source/HANDOFF.json': '43e407cef326575939b39109b4b0deeb48f3d8ce89e07163bef1ab6b5f2c4659', 'fixtures/1695-source/SEMANTIC-READBACK.json': '1c1b52cef5ae2ea7a7b71b0670d35c5bdae7cc0a909ee2ab14028511f1aeffb3', 'fixtures/1695-source/chain-jobs-030.json': 'cbbe866e48196569f34b9643184f150ef0fb7eb640284cee0ed70a900174e693', 'fixtures/1695-source/collector-0.stdout': '471d5797459a701cc07f5f4db3c8a0ba1dc5a92df1774314adf841cb8d89c340', 'fixtures/1695-source/collector-1.stdout': 'd15adec70f1bad2f33eed3c38ad957728e35f7d89fa71b3d98709b19732c15a9', 'fixtures/1695-source/collector-2.stdout': '3c1ef53b4c34fa0059b08c1e724d4f0dbfff12ec8feeb88299adb38fd3ac4555', 'fixtures/1695-source/collector-3.stdout': 'b2d1d1a493565f76e0c40b243890e1090c6d2576d50cb4850241a42de0ff0732', 'fixtures/1695-source/collector-4.stdout': '3dc5628c9c99beea92493f7d28cdc5c70e4bb0dd312aa955a90b32ff562eac17', 'fixtures/1695-source/collector-5.stdout': 'a80108f48feba445cb421daa47c6820192ba8126000a19c2eec7caa537778941', 'fixtures/1695-source/original-public-streams.zip': 'c6db205db0509fbdc89fb92e1311a9416fca0d19205e082a402478b5c9542d92', 'fixtures/1695-source/resource-jobs-030.json': '368a3d1269c021b554e28a919286824f609fbe1dae345cd2e30f4bd517c939df', 'fixtures/1a-lossless-source-job.json': '97e733ec1a9bd5e7bd16dbe23996850193a2e647985483e3223d7d50351c8aa1', 'fixtures/1a-lossless-source-original.zip': '4139c50b32dc9929522da0ba61b18df271e9cee2a7d7ef7760f5860832ea7e81', 'fixtures/1b-source/13563183469.zip': '347a0d9ce401a3463f54ad6dfa8162ee88a70c655bd4acf9de6054f53016b60c', 'fixtures/1b-source/13563318084.zip': '7161456f8e54d29574c998bf782788804c84c09b0c9211453ab6dc64a0a6bcea', 'fixtures/1b-source/13563592493.zip': 'faca376d34f3208f5ec383018312d1fb254a80c13f62b1ad16afb368c92cde8b', 'fixtures/1b-source/13564005459.zip': 'b08d6dfd81ef4a387cf409198ad9c683ca569cd7a0cb6de91aac121a14107883', 'fixtures/1b-source/42345664402-FINAL-STATUS.json': 'b739ec7494768ee13361f93cc758d3b0389456720042ca7353f1bcda1f990f58', 'fixtures/1b-source/42345664409-FINAL-STATUS.json': '9a8ed811350b75dfe2a0480a27fce1fca0c3e693c82e53283b83411ed49ef1f4', 'fixtures/1b-source/CLIENT-ORIGINAL.log': '14303b5d8fdd4ea00e38841bafcd29194654af930b4efd50baa11709a748004f', 'fixtures/1b-source/H.json': '610c4c4a85be1755f488aaa31c6e3b630af0f36230e0c206786fd168c236e147', 'fixtures/1b-source/STARTUP-COLLECTOR-RECEIPTS-FINAL.json': '831a7247e8a152731c5539a01e7d2caa6ba7cb35680e1593bc971d613f8246b2', 'fixtures/6cc-component-source-H.json': '8ca54724aabb5f69928748baf72f49090a9f089b8dfce842995570952a30bdf2', 'fixtures/6cc-component-source-jobs.json': 'abcef528a4e4c4c4b99706366a66adcce6451cfb3e884833f4655203a001053e', 'fixtures/6cc-lossless-source-original.zip': '6f1ad2c3ec3de639d7ef78f04e182a7804703ff6c5011dc1fdd8f418420eaedf', 'fixtures/6cc-trace-source-original.zip': '3145708e392121ac43bad0c287079598e7930b01750eb8be6f4a6de8ee677475', 'fixtures/896-live-functional-original.json': '4ff5e4d1a301e4b8c636baadcfde1459f35107f2e2b5dedc456a3817f3e7deae', 'fixtures/9081-live-functional-original.json': '9744b10e2d40d4674ffc3dfaa2273349e9d7a8b13e22aa268724ce69c9386a22', 'fixtures/9081-normal-live-source-original.zip': '5c3db014446402ced74177c7965ec1554fa6aa609b2cca0000fe2667bc2fef08', 'fixtures/c06-functional-readback.json': '23c0639ababad3e041810ba9d21e96e754c618da7a14ee546aa9bf2ddabd7146', 'fixtures/c06-named-cases-original.zip': '65df3771ab668be1b6a8c044dbcc3cc0a024bea416b08547ba0d8eb9cb51d1fe', 'fixtures/c4b-source-functional-original.json': '2daaf7e71840e15dc27dba9ff8883e285c5f3bacd88b7df655c6330a025e3664', 'fixtures/commit-observation-public-schema.json': '9dc8dbf4820d04068b2272e4dd16f202d6fb106b82cecf8aef6d544517680c06', 'fixtures/d24-source/13568519289.zip': 'a2835443d37f4e009e54fd1c94f436827e83b011b34a7ae9094fffc7b040a743', 'fixtures/d24-source/13568784007.zip': '6fcabdf62ef3c31c538ca73c79227dbd142d2d1d308d8b23d688060484b256de', 'fixtures/d24-source/13568854112.zip': '8f100165f144b4cc6ed69693c75bd7c9659f72b937237baceaff16bb0e6662d5', 'fixtures/d24-source/13569173444.zip': '28baad460ea06a5f159de4fee3487e2a85e281eb335aba0726341a93d67a777e', 'fixtures/d24-source/13569501647.zip': '4a6294d636f5f7da20da79c5777a147feff998e8d26fdd686679a4392c8c349e', 'fixtures/d24-source/CHAIN-JOBS.json': '26b2d233e8c1b083dcc813f500599d692150c982f40a65fa08b2db78adee48ec', 'fixtures/d24-source/CHAIN-RUN.json': 'c50660ec4c056f66c914547c613bf74d62549e7283fe0310eae941fc2747d758', 'fixtures/d24-source/CLIENT128365907200.log': '44b12ca914f9d8c493e2053e17dddfacf981038853cb4cc2d75c9daa68b3650c', 'fixtures/d24-source/RESOURCE-JOBS.json': 'aa1196b8196abef04af08f646b8479a80723eadf50ea56bb4e1a40bf0bc75438', 'fixtures/d24-source/RESOURCE-RUN.json': '73662a0685662c54af155e4fc9744b1be67b93813803d704dc6aaa0e81d694e1', 'fixtures/init500-live-setup0-original-failure.txt': 'a81288b98a781b952f46d699850168248bddee30690248d490efcfabf1ae9cbd', 'network-layer-accounting.py': '1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635', 'owned-tcp-accounting.py': '612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440', 'pq-1695-source-qualification.py': 'b553028656b038b18b698db094ec3561ec06a299f2be7bfd9e50e44b54d19fa1', 'pq-bounded-sender-backend.py': 'add2f9a3b9e3458b660aac27ab2b2556425b4b283d11322284100df74f8c65da', 'pq-c06-source-qualification.py': '385b34200486ede3045bea1e37d2cc0ea057481c0294257da4e825126975d37c', 'pq-commit-observation.py': '4033dea236ee7536e2bc4fab74655e0ec9317564ec10516e47d599ccafa64cc0', 'pq-d24-semantic-readback.py': 'aead5f59c1d72eb32f0a46816d530e263645dfbdae3ae1fc1eeb21a53d5ba098', 'pq-d24-source-readback.py': 'd20e90967a871161d02a3dbee1632480adfb0d7ddd28f47ac7dbc2f1d18351c3', 'pq-finalize-trace-readback.py': '6b88b499745d2a3fe7cdcc1e690ca116a4986fc81fe40876a55491886569d524', 'pq-first-trial-source.py': '495a0614dc989db5c5eee157a3e5519459a90750821896a194073993c76dad7d', 'pq-height-vectors.py': '2928be0afa76eb7d968533d6a71c4cc06298edef89bfa5cfece46211e281a2c3', 'pq-hop-byte-accounting.py': '663c072e11f777d5119f87fa9e200548c117f937427c46295277e722c7d3744b', 'pq-independent-load.py': '574bf3beaed7d6696f2601945dfd90e68018f4dc41630cda41e6eda4693a058e', 'pq-independent-scheduler.py': '460718524ddbde9243f77588bc9a826bb4b25d4b84e7cf7f58a7953c0b29b8f8', 'pq-initialization-measurements.py': 'a5dd93bc0be164f1d3b38b1962037e5ccb7f9a68bd9051b651fba2ff2ba8e917', 'pq-initialization-readback.py': '50b56368aa5a25fbd2c17c16a2f6bde2a119be675a5f49a32e10f89aa72b8530', 'pq-live-source-qualification.py': '159cbe9e96d8cde3956141fea5880f1b8bc16bf7db9f85aeddccf6c1c87d23a7', 'pq-lossless-source-data.py': '43cd58a84b361162f637586f391782ea65ffa6fcb5152e6bc515fd2cd3ba075c', 'pq-network-window.py': '6132d2adf72e01959f9d9e71ec4da22961b7f5335cb77331dc2769c66af4cdc8', 'pq-node-startup-measurements.py': '3b6e5a3b27ec0d1bc18f9469c961b23c9dedaf960928b0f9dbfd77de78115045', 'pq-normal-leg-trace.py': '43d2a2059df8933e57e5f6709376bef274f4bc480e08c81300a8c26da6c69121', 'pq-normal-live-reader.py': 'a81ae944a691fae89b57b8e833015b19367dadc8c67e2c6f7f7c0a5b210dce06', 'pq-normal-live-source-data.py': '969610212a6fbed759d5a516a0c294bc4f796046e4755119780668b2cd837f6b', 'pq-normal-paired-runtime.py': 'e0257f223d0a2f7732bf9cac58e170365249137b86200a286aa3de6f15c1716a', 'pq-normal-process-lab.py': '67b9c025cdfbcd0554a1701a5119fa496fead5ff91fa688845d81ee18ee125a5', 'pq-owned-header-capture.py': 'f5a03c7fbe7c1048d045986fbdd00f6e306d2025b53b41adeaf6fd8e06301bcd', 'pq-owned-storage-window.py': '67e96cda53201b32b0ab1ca10707abb5e885645b51cbceaf2f3c8c77ac81f7c3', 'pq-paired-linux-window.py': 'b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2', 'pq-preload-initialization.py': 'f6fbc37c6b97ca6831c81c39a08d8213e00c1093e24b980ee3653edfb67d3f7d', 'pq-public-owner-backend.py': 'e8996837859f8f99baf1468a7ff781327199bfafd4680a0424b3417db92b6785', 'pq-public-owner-readback.py': '8c3b4080615854a908862ad7aedbd236e76facb7cf46a0856f3fcc417bb9f8fb', 'pq-public-owner-transport.py': '2df45d6e5157ea54f80b7ba31985fc075757e3d3152dd6d5ec7e1327f754fbc8', 'pq-public-proof-readback.py': '50ad1dbb6eadb494cfac180f84fd9deb13051abae58f3acfb055d32541decc53', 'pq-rpc-measurements.py': '610e634faf55f3d5fced1a1037139600019bc61175f9e79cc3d7209127f73ed3', 'pq-staged-harness-controls.py': '182a3e966f0f35ab3911e7aede43b0f42686ca358937c307e664d5516d98df99', 'pq-staged-independent-scheduler.py': '1e46d1665bf37869f15eaaa555a97a6939ff3fd45e6a9aadc87436271681cf77', 'test_consensus_linux_cohort.py': 'bcb9b6450374f0d734887b7c7f4e9c83314e71f913948098da0927406b4e233b', 'test_linux_owned_rss.py': '6a9a92a7f910af83ffc227ef1fde1ff535658112fb1728308c5ed43b8620b5af', 'test_linux_thread_group_exit.py': '3b22ec42f247d76b0b12dc48fcdf28819efd799074d2931bee9d8ca235e84706', 'test_pq_1695_source_qualification.py': '2e499f3d011332dbc2fdca3116a3b7b8781efad5a6cf344b3fa2962d6ba3bfdc', 'test_pq_bounded_sender_backend.py': '49285087d885e51b0087e697e6073416ac95344fab81ad73e745d12b8e7331ca', 'test_pq_c06_source_qualification.py': 'f112c861af7ffeaa966c24fd516ed84be308e6af64c9ce913a963eb7c3a582a3', 'test_pq_cold_readiness.py': 'd0f734a0393f1a0d3c6fb4d314190b6cb4228426a72d2e41953996e5cecd8fb9', 'test_pq_commit_observation.py': '08f978edb78f153f7ab01a64e07ba6e7f35fa410c984103dc5c15372f76931cb', 'test_pq_completion_diagnostics.py': 'af1193758a8b17b70dfa78790060a51787b9b4dfff598246843efec35a4c61b8', 'test_pq_d24_semantic_readback.py': 'a593a54252805ffcd22c4c5100aabe868196d2cc27086b5046d63145530a29fe', 'test_pq_d24_source_readback.py': '335f2dac1537e8c0548b9c107070bf387ce1a160b29e6800d2a04bc20175cdf9', 'test_pq_finalize_trace_readback.py': '4a1ac12d8f7c62ba6301a7b6371a89a8658ce99773edb8945ae8bd3fae4954b8', 'test_pq_first_trial_source.py': 'd7e67253675ec0e323b90e96c5fd43e39a82efa5dc4edf829750a4fea5059aaa', 'test_pq_height_vectors.py': '7a75324faff6c3141a13217b664abf19637ffc4e22217a1e8e886490a0e589d1', 'test_pq_helper_lifecycle.py': '00774fc00404074d59f7eb09839b1bf25830ab60771ed2fac83884da37a37629', 'test_pq_hop_byte_accounting.py': '2116cdb12f52f2e8f6500d5e54e3d20248b0d29eef88081962b3ce6ff1984e67', 'test_pq_independent_load.py': '78756c2e271ffe5999a73a2586cb83ff400728b87f29ddb4e0a686dcb814aaae', 'test_pq_initialization_measurements.py': 'a7c0ba801d5d83642e88778778d1cac03087fa72f161d01ddb63970c91fbd521', 'test_pq_initialization_readback.py': '601db3cff42985cbfeb46a54097ebee73e233fa2a1fa47be79ce2998d2c7bf8c', 'test_pq_live_source_qualification.py': '5998b6652afa345f5a0c2c66b79918fc3bf7984afd623ef84f8a8072781cbe01', 'test_pq_load_escalation_conditions.py': '5307203ba58fc2656b6ce79eec4d9e1a175ffeaeef05a98d432d5b3764d6fb9d', 'test_pq_lossless_source_data.py': '2530f2dfda2e4940d9af6ed50d70eafed2f1b22418d4e573ead60792ee0d8ed1', 'test_pq_node_startup_measurements.py': '81896422ac5e8f4e03d3cd7b5278a9854e9fb088db7dae30d58e96007330d3b7', 'test_pq_normal_callgraph.py': '507854aab80fd522ba93c6699e6c38f18eed30159bc6506aee175c3b0dc63bef', 'test_pq_normal_clean_exit.py': '991f167b37bbbfac9c090f4e6ddb5ee8d47300038807f6d9fe4066c5f7fedce6', 'test_pq_normal_leg_trace.py': 'a6ad35270139dfda7ba89702da17c72a5430c377db32ffd3e51a9e7835f1f234', 'test_pq_normal_live_build_source.py': 'aa35b1a041ba3da4e3dee1d6d432d6b37d1b66c81f1cb9f1d74f1bb7684d26db', 'test_pq_normal_live_reader.py': 'b8ab2724db4a2c7c26675f662e3c8581b5a6ff86ec69b43526701a6f7c604ac2', 'test_pq_normal_live_source_data.py': '89a9e8ff671f4007bfb42cc6da88001563223d35ec30b9255be987a4be8a797d', 'test_pq_normal_network_baseline.py': 'd408a22ef0d592d6dd2b0e4391fb65b12a59c2ec95e62d4f013b0dd05aa992c9', 'test_pq_normal_pair_gates.py': '20d8b43f711d7d60c4cb7331f824ec53734b9b8137d760e34ede7afedced78d0', 'test_pq_normal_paired_runtime.py': 'edab54868e48aa9aafda0e4f608020ee43b766715ef9ca3aea148c2a8dcedd89', 'test_pq_normal_parent_measurements.py': '40acc291ef78d1772b9bac7f398c16952edb5aa05f880bf124052393d553c818', 'test_pq_observed_throughput.py': 'df8c26a18a35214acef9a6a4f158f3bb8c3759c2107d94214aecc92da6ced6ad', 'test_pq_owned_header_capture.py': 'e30105c2282790215ae01c56e162402b71d49d23dd0d04b511fe92166d2f11f7', 'test_pq_owned_storage_window.py': '1dc1419b69361cbd604aef8c9b055b42b96567d181c3315ed1ce56395865cf33', 'test_pq_preload_initialization.py': 'bb6ecb84e3c22fe98e354ebe1f26e4d7690029f70924ab84769dc704033a61e7', 'test_pq_preparation_startup_timings.py': '21af9c61f18f53d2e2812e3e5ef6619e7e2d33313fe2122b68150107a9f9a9fb', 'test_pq_public_owner_readback.py': '88d326b1a7c2fdbf4b51b9ebd9aab8dba348a70059062fd1fd84c2e9a7c28bbe', 'test_pq_public_owner_transport.py': '7fb14f2822268de82b85c96c42686dc1bb0729733e85e628e64731e0cb785104', 'test_pq_public_proof_readback.py': '4b412446c26186ce925a2cfc5896901a58df64067c15e36e9b3d07a3b33ad019', 'test_pq_ready_metrics.py': 'f76a971436898261ed0ade64b451996363e01c6b3f684e434c2fd7862a2449be', 'test_pq_rpc_measurements.py': '5a36392c9162075468d729b3ea18fbcde59a834c9c41ccd9286c82ea466b83bb', 'test_pq_sender_backend_selection.py': 'f0abb6c4218a106fc617d5e030a79ab41474d6ebe6c412d0a64f8e6f8f3feecd', 'test_pq_staged_independent_scheduler.py': 'e9ba5de9b5c72d3fd1f0b6bba54847c6054382d8630b5b8f9f8f54110e8422bb', 'test_resource_guard_sampling.py': 'e394f527f07f9b2228f0168ab11d95f3021669c12aa7d5e8ec4d5734ef33d082', 'test_window_failure_cleanup.py': 'b29af491d4dd36d8f2756ba71d9bd949cf4aea9d95abea9e492346086b72bbd7'}

TOOLS_CI_RUN = 42388018370
TOOLS_CI_JOB = 128449445231
TOOLS_CI_WORKFLOW = 322083952
SEMANTIC_READBACK_BYTES = b'{\n  "afterCommit": "1695aafd351b3cac7860d3452c555a02498e8350",\n  "afterForkTree": "5a128880d14bfc73de4334cba23218859ad3473c",\n  "artifactID": 13579202583,\n  "artifactSHA256": "b1ad0707350769fbbc598ac39a62b3f1893d0f2f21772f3ed10ad9f4568839e8",\n  "beforeForkTree": "54e88e6aba735eaceeb2d00bb40731248c673bd7",\n  "binaryBytesIndependentlyRehashed": false,\n  "binaryHashesProducerReported": {\n    "after": {\n      "bytes": 40551149,\n      "sha256": "4af6e1fa5ee734905a8e3e902021d7e89057d31ee4dd31eea818966cf4302933"\n    },\n    "before": {\n      "bytes": 40235021,\n      "sha256": "961a2263a6f6848c3b204a9b17ed98612a7b549e1d86031449a9ff73b22b1147"\n    }\n  },\n  "cleanupComplete": true,\n  "controllerCommit": "50dc582be22986adf6935401599e0934d9e329a3",\n  "effectiveBusinessTPS": null,\n  "finalConfirmationLatency": null,\n  "heights": 9,\n  "inclusionLatency": null,\n  "intermediateFullStateBytesIndependentlyReconstructed": false,\n  "jobID": 128441900709,\n  "limitedOriginalTrajectoryQualified": true,\n  "liveNetworkPairQualified": false,\n  "originalElapsedSeconds": 98.345031536,\n  "peakNewBytes": 1973968896,\n  "peakRSSBytes": 635179008,\n  "runID": 42385500887,\n  "runtimePressureAuthorized": false,\n  "schema": "YNX-PERF-1695-LINUX-SEMANTIC-ORIGINAL-READBACK/v1",\n  "sourceInventoryFiles": {\n    "after": 3245,\n    "before": 3077\n  },\n  "stageParentWallSeconds": {\n    "after-build": 12.0669592,\n    "after-buildinfo": 0.214430024,\n    "after-replay": 0.428824945,\n    "before-build": 71.392251446,\n    "before-buildinfo": 0.214134823,\n    "before-replay": 0.650139407,\n    "fetch-original-source-objects": 0.42370561,\n    "go-version": 0.215934304,\n    "prepare-fixed-two-source-trees": 8.995039693\n  },\n  "timingMeaning": "Parent observed launch-to-exit wall time; sequential builds share cache. Not paired performance improvement or business latency.",\n  "toolsCommit": "d0e0889afb7f171ce568c07ea0d6a7e9206083f2",\n  "toolsTree": "64bee8a254880c700d23a1b1158367053d61fa4a"\n}\n'

def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def strict_json(raw):
    require(isinstance(raw, bytes) and 0 < len(raw) <= 1 << 20, 'bounded original JSON required')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate original JSON field')
            result[key] = value
        return result
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                      parse_constant=lambda _: require(False, 'nonfinite original JSON'))


def source_prerequisites():
    require(hashlib.sha256(SEMANTIC_READBACK_BYTES).hexdigest() == '1c1b52cef5ae2ea7a7b71b0670d35c5bdae7cc0a909ee2ab14028511f1aeffb3','actual1695 original semantic readback changed')
    semantic=strict_json(SEMANTIC_READBACK_BYTES)
    require(semantic['afterCommit']==GO_SOURCE and semantic['afterForkTree']==FORK_TREE and semantic['limitedOriginalTrajectoryQualified'] is True and semantic['heights']==9 and semantic['cleanupComplete'] is True and semantic['runtimePressureAuthorized'] is False and semantic['liveNetworkPairQualified'] is False,'limited original semantic scope differs')
    return dict(semanticReadbackSHA256=hashlib.sha256(SEMANTIC_READBACK_BYTES).hexdigest(),semanticArtifactID=13579202583,retainedHeights=9,semanticReplayReexecuted=False,actual500InitializationQualified=False,runtimePermissionGranted=False,pressureAuthorized=False)


def validate_tools_ci(run, job):
    require(type(run) is dict and type(job) is dict, 'actual tools CI objects required')
    require(run.get('id') == TOOLS_CI_RUN and run.get('run_attempt') == 1 and
            run.get('head_sha') == TOOLS and run.get('head_branch') == 'codex/chain-batch-v01-performance' and
            run.get('event') == 'push' and run.get('workflow_id') == TOOLS_CI_WORKFLOW and
            run.get('path') == '.github/workflows/chain-core.yml' and
            run.get('repository',{}).get('full_name') == 'JiahaoAlbus/YNX-Chain' and
            run.get('status') == 'completed' and run.get('conclusion') == 'success',
            'own fixed tools CI is not completed successfully; no runtime permission')
    require(job.get('id') == TOOLS_CI_JOB and job.get('run_id') == TOOLS_CI_RUN and
            job.get('head_sha') == TOOLS and job.get('head_branch') == run['head_branch'] and
            job.get('name') == 'Chain Core source and release gate' and
            job.get('status') == 'completed' and job.get('conclusion') == 'success',
            'own fixed tools job not successfully completed')
    for name in ('Execute original Linux worker affinity limits stdin and cleanup case',
                 'Verify fixed1695 semantic original transport and process controls',
                 'Verify fixed1695 own source originals with explicit opt-in skips',
                 'Verify normal public owner stream isolation and lost acknowledgements',
                 'Verify full first100 cohort counts and censored latency readback',
                 'Verify original bounded sender and post-ready checkpoint ordering'):
        found = [step for step in job.get('steps',[]) if step.get('name') == name]
        require(len(found) == 1 and found[0].get('status') == 'completed' and
                found[0].get('conclusion') == 'success', 'original tools step incomplete: '+name)
    return dict(runID=TOOLS_CI_RUN,jobID=TOOLS_CI_JOB,attempt=1,head=TOOLS,
                workflowID=TOOLS_CI_WORKFLOW,conclusion='success',runtimePermissionGranted=False)


def read_tools_ci():
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise RuntimeError('tools CI metadata redirect refused')
    opener = urllib.request.build_opener(NoRedirect)
    headers = {'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
               'User-Agent':'ynx-fixed1695-ci'}
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer '+token
    raw = []
    for suffix in ('runs/'+str(TOOLS_CI_RUN), 'jobs/'+str(TOOLS_CI_JOB)):
        url = 'https://api.github.com/repos/JiahaoAlbus/YNX-Chain/actions/'+suffix
        with opener.open(urllib.request.Request(url,headers=headers),timeout=15) as response:
            require(response.status == 200 and response.url == url, 'exact original CI metadata response required')
            raw.append(response.read((1 << 20)+1))
    value = validate_tools_ci(*(strict_json(body) for body in raw))
    return dict(value, metadata=[dict(bytes=len(body),sha256=hashlib.sha256(body).hexdigest(),
                                    original=strict_json(body)) for body in raw])

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
    require(PROFILE in PROFILES and sys.platform == "linux" and environment.get("GITHUB_ACTIONS") == "true" and
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
        driver.lab.write_new(work / "public/FIRST100-1695-CI.json", record)
        calls.append(window)
        return window

    driver.lab.Window = counted_window
    return original, calls

def fixed_options(source):
    return argparse.Namespace(first_trial_profile='1695',sender_backend=PROFILES[PROFILE],source=str(source),commit=GO_SOURCE,mode='online',rate=100,seconds=5,accounts=500,per_account=1,tail_seconds=30,proof_timeout=30,wire_observation=True,network_accounting=True,header_hop_capture=False,owned_storage_accounting=True,commit_observation=True,prior_result=None,prior_result_sha256=None,execute=True,staged_publication=True,initialization_only=False,initialize_before_load=True,startup_timings=True)


def prepared_data():
    return dict(profile=PROFILE,controllerRef=REF,goSource=GO_SOURCE,goTree=GO_TREE,tools=TOOLS,toolsTree=TOOLS_TREE,configuredBusinessDemand=500,preparationAccounts=4,senderBackend=PROFILES.get(PROFILE),backendComparison='whole-backend-not-cache-single-factor',measurementScope='same-window-normal504-initialization-then-first100x5',caps=CAPS,executed=False,businessLoadAuthorized=False,pressureAuthorized=False,nodeStartAuthorized=False,sourceGrant=False,sameHost=True,physicalFaultDomains=1,actual500InitializationQualified=False,resourceGuardComponentTimers=True,commitEncodingPersistenceObserver=True,allEightNodeExitZeroRequired=True,coldReadinessPhaseMaxSeconds=180,globalActiveLimitSeconds=885,ordinaryReadinessDefaultSeconds=60,steadyStateSLOChanged=False,requiredRemainingActiveSeconds=35,initializationBeforeLoad=True,startupTimings=True,higher500Or1000Permission=False)


def verify_tools(tools):
    checked_source(tools,TOOLS,TOOLS_TREE)
    for path,pin in TOOL_PINS.items():pinned_bytes(tools/'scripts/loadtest'/path,pin)
    require(not any((tools/'scripts/loadtest').rglob('*.pyc')),'no ignored bytecode substitutes allowed')


def validate_driver(driver):
    # The old source/initialization/escalation gates remain untouched in tools.
    require(driver.STAGED_CALLEE_SOURCE=='9081f14654a48f4fe14e57696ec33527869da353' and driver.STAGED_SOURCE_QUALIFICATION is None,'legacy staged qualification gate changed')
    require(driver.first_trial_1695_source.SOURCE==GO_SOURCE and driver.first_trial_1695_source.TREE==GO_TREE and driver.first_trial_1695_source.FORK==FORK_TREE,'exact1695 own-source qualification binding required')
    require(driver.lab.CAPS==CAPS and driver.lab.RSS_OBSERVER_VERSION=='same-process-rss-v4-pidfd-any-state' and driver.lab.guard.CAPS['ownedProcesses']==16,'original runtime guard/caps differ')
    data=driver.first_trial_1695_source.trial_qualification()
    require(len(data['flows'])==4 and data['requiredNamedCases']==130 and data['semanticPairConsumed'] is True and data['source']==GO_SOURCE and data['sourceTree']==GO_TREE and data['sourceOnlyQualified'] is True and data['runtimePermissionGranted'] is False and data['pressureAuthorized'] is False and data['actual500InitializedOwnersQualified'] is False,'own source-only DATA cannot grant runtime or prior500 qualification')
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
    tools_ci=read_tools_ci()
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
    adapter=dict(prepared_data(),toolsCI=tools_ci,sourceAndSemanticHandoff=source_prerequisites(),controllerCommit=os.environ['GITHUB_SHA'],controllerSourceSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),sourceFunctionalPrerequisite=data)
    original,calls=install_counted_window(driver,intake,(workspace,parent,go_root),adapter)
    try:
        options=fixed_options(source);require(driver.validate_options(options)==500,'full500 original business cohort required')
        result=driver.run(options)
    finally:driver.lab.Window=original
    require(len(calls)==1,'exactly one original initialization Window required')
    return validate_result(driver,result,data)



def main(argv=None):
    values = sys.argv[1:] if argv is None else argv
    for flag in ("--source", "--tools", "--execute", "--check-tools-ci"):
        require(values.count(flag) <= 1, "duplicate fixed-profile argument")
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--source"); parser.add_argument("--tools")
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument("--execute", action="store_true"); mode.add_argument("--check-tools-ci", action="store_true")
    args = parser.parse_args(values)
    if args.check_tools_ci:
        require(not args.source and not args.tools, "qualification-only has no workload inputs")
        validate_host(os.environ)
        print(json.dumps(dict(toolsCI=read_tools_ci(),sourceAndSemanticHandoff=source_prerequisites()), sort_keys=True))
        return 0
    if not args.execute:
        require(not args.source and not args.tools, "inert preparation accepts no workload inputs")
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
