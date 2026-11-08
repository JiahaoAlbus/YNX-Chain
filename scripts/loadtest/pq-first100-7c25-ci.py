#!/usr/bin/env python3
"""Fixed7c25 first100 public-owner successor; source data never grants a window."""
import argparse,hashlib,json,os,re,shutil,signal,stat,subprocess,sys,types
from pathlib import Path
import urllib.request

PROFILES = {'first100-7c25-public-owner': 'public-owner'}
PROFILE = os.environ.get('PQ_BASELINE_PROFILE','first100-7c25-public-owner')
REF = 'refs/heads/codex/ynx-pq-current75-baseline-20261101'
WORKFLOW = '.github/workflows/pq-normal-process.yml'
GO_SOURCE = '7c25cbcc7d31b10743e26ae1ddca745085ee1b0b'
GO_TREE = '8a90d4ceb86a3a9460648e011bfed9f2e3ac1f4a'
FORK_TREE = '5a128880d14bfc73de4334cba23218859ad3473c'
TOOLS = '91caff35a141889a4a8de6b2f4ba533c69b64550'
TOOLS_TREE = '4bece71b095b6983e0f22ec63537ef4a7bf6c47b'
CAPS = {'totalSeconds': 900, 'cleanupSeconds': 15, 'rssBytes': 4294967296, 'newBytes': 8589934592, 'initialMemoryBytes': 6442450944, 'initialDiskBytes': 17179869184, 'logBytes': 4194304, 'cpus': 2}
SOURCE_PINS = {'.github/workflows/resource-market-ci.yml': '34859948746bb252d9864f3ff891638d8dc32c61c63e01231f0269455fe97be2', 'cmd/ynx-consensus-pq-lab/checkpoint_loader.go': '5c98b2bae998fbb5c43ee5d8bcfcd0552d539eb1d90c627dfbcd1a3f0e8ea3ee', 'cmd/ynx-consensus-pq-lab/workload.go': '2f818bf32871a72ed4be732b43f23cd13e58d593e0290d034bb01024ef1b8063', 'go.mod': '07b303f8099eebb861f8ce1671089939e45069efbb1f71884b892548af47f803', 'go.sum': '87d7280001b2b5e12b687d45e921d5e3500d53b79d3885acf7ab2b9a17cc575c', 'internal/consensus/pq_lab_live_materials.go': 'ab243a107ebb885b3cc8c5e6379ff6fbff473f7ebcd2d5971c866534ca2ae66e', 'internal/consensus/pq_lab_live_materials_anchor.go': '64e2812147b444c5b186127dca3c745d012ce707a97ce19b19dee915950df1d0', 'internal/consensus/pq_lab_live_materials_control.go': 'a510d3ba225d5ce321d9eb6608d757033676d255444e5923b687f50a0af6043f', 'internal/consensus/pq_lab_network.go': 'b3dd4fed0f2c5fd1bca21599da3ce8ac0a331319f83597d233ab55cfae4accb7', 'internal/consensus/pq_lab_static_cache.go': '89f4123fc10423e13fa228c754ec3fe3f08577f6ba31254739f4b088d363f6bd', 'packages/wallet-auth/go/sourceparentprofile/canonical.cpp': '6b0ae48f4eb5aa62b9e9845e96df1beaeadec2a66fc0f83736a2c584062ee49c', 'packages/wallet-auth/go/sourceparentprofile/inventory.cpp': '0d2c369e9e4787adff266eefafec296b80c80fdbf3ac4fcc80ebaa97b86de6f2', 'packages/wallet-auth/go/sourceparentprofile/original.cpp': '423e51d2791e5857c8311c20c8fcee9355526b2c063cbdf146214f9877afb62d', 'packages/wallet-auth/go/sourceparentprofile/profile.go': '30231b0651967201e21fa55eefe7779661514d8c61d8367e2b90244b62d34788', 'packages/wallet-auth/native/source-parent/MobileCanonicalDATA.cpp': '088924c5a093d3f15ff11de2c3ce00dec5a4ed0d35fb1832508a32f1095fe556', 'packages/wallet-auth/native/source-parent/MobileCanonicalDATA.hpp': '6658eafc777a860d1ce20f8a97617d82e816dab6b88b8b15c043a0f16d8d26a7', 'packages/wallet-auth/native/source-parent/SourceParentOriginalProfile.cpp': '89d4f217e6deea1944a13e07604d0c56c5923b918369ba40b8c8759a3e5c4e60', 'packages/wallet-auth/native/source-parent/SourceParentOriginalProfilePrivate.hpp': '390eb2da9217acdedff8200c8b2c477b277e2d9bbee7652d9e8148883179ef9b', 'packages/wallet-auth/native/source-parent/SourceParentProfileC.cpp': '44a14f3ef40d2f474d1fc544389cca18688625d4dee5b19f4dc5efd6e073f04a', 'packages/wallet-auth/native/source-parent/SourceParentProfileCPrivate.h': 'f631d68d5abae5c1814f0a213599c437aa5428354b417c21e969ff7248775c63', 'packages/wallet-auth/native/source-parent/SourceParentReviewedProfilePrivate.hpp': 'e9ff75c819a1d1b948018d1b3e866ac7f60447e53fdcf5e3c555eef7eda276fe', 'scripts/loadtest/pq-source-artifact-intake.py': 'ab75f9748a05523f5719ee42a8a99b576d3444a30481b0e07253956e3e5943ef', 'scripts/ops/validate-pq-remote-normal-ci.py': '6d617c4ba97f82d59db512962873df1202fabfc6f5422c1b56452f020fbb8475', 'scripts/verify/wire-live-matching-source-ci.py': 'e35ff39c10090e9200bdabf7b265c1fd211fd2ae4d227ffaae52054c6dbc2fac'}
TOOL_PINS = {'consensus-linux-cohort.py': 'e6d8f6e841d63cf501148cbfea3eaf065f709a15e6455e5d4b2c49560fe051d2', 'fixtures/1695-source/HANDOFF.json': '43e407cef326575939b39109b4b0deeb48f3d8ce89e07163bef1ab6b5f2c4659', 'fixtures/1695-source/SEMANTIC-READBACK.json': '1c1b52cef5ae2ea7a7b71b0670d35c5bdae7cc0a909ee2ab14028511f1aeffb3', 'fixtures/1695-source/chain-jobs-030.json': 'cbbe866e48196569f34b9643184f150ef0fb7eb640284cee0ed70a900174e693', 'fixtures/1695-source/collector-0.stdout': '471d5797459a701cc07f5f4db3c8a0ba1dc5a92df1774314adf841cb8d89c340', 'fixtures/1695-source/collector-1.stdout': 'd15adec70f1bad2f33eed3c38ad957728e35f7d89fa71b3d98709b19732c15a9', 'fixtures/1695-source/collector-2.stdout': '3c1ef53b4c34fa0059b08c1e724d4f0dbfff12ec8feeb88299adb38fd3ac4555', 'fixtures/1695-source/collector-3.stdout': 'b2d1d1a493565f76e0c40b243890e1090c6d2576d50cb4850241a42de0ff0732', 'fixtures/1695-source/collector-4.stdout': '3dc5628c9c99beea92493f7d28cdc5c70e4bb0dd312aa955a90b32ff562eac17', 'fixtures/1695-source/collector-5.stdout': 'a80108f48feba445cb421daa47c6820192ba8126000a19c2eec7caa537778941', 'fixtures/1695-source/original-public-streams.zip': 'c6db205db0509fbdc89fb92e1311a9416fca0d19205e082a402478b5c9542d92', 'fixtures/1695-source/resource-jobs-030.json': '368a3d1269c021b554e28a919286824f609fbe1dae345cd2e30f4bd517c939df', 'fixtures/1a-lossless-source-job.json': '97e733ec1a9bd5e7bd16dbe23996850193a2e647985483e3223d7d50351c8aa1', 'fixtures/1a-lossless-source-original.zip': '4139c50b32dc9929522da0ba61b18df271e9cee2a7d7ef7760f5860832ea7e81', 'fixtures/1b-source/13563183469.zip': '347a0d9ce401a3463f54ad6dfa8162ee88a70c655bd4acf9de6054f53016b60c', 'fixtures/1b-source/13563318084.zip': '7161456f8e54d29574c998bf782788804c84c09b0c9211453ab6dc64a0a6bcea', 'fixtures/1b-source/13563592493.zip': 'faca376d34f3208f5ec383018312d1fb254a80c13f62b1ad16afb368c92cde8b', 'fixtures/1b-source/13564005459.zip': 'b08d6dfd81ef4a387cf409198ad9c683ca569cd7a0cb6de91aac121a14107883', 'fixtures/1b-source/42345664402-FINAL-STATUS.json': 'b739ec7494768ee13361f93cc758d3b0389456720042ca7353f1bcda1f990f58', 'fixtures/1b-source/42345664409-FINAL-STATUS.json': '9a8ed811350b75dfe2a0480a27fce1fca0c3e693c82e53283b83411ed49ef1f4', 'fixtures/1b-source/CLIENT-ORIGINAL.log': '14303b5d8fdd4ea00e38841bafcd29194654af930b4efd50baa11709a748004f', 'fixtures/1b-source/H.json': '610c4c4a85be1755f488aaa31c6e3b630af0f36230e0c206786fd168c236e147', 'fixtures/1b-source/STARTUP-COLLECTOR-RECEIPTS-FINAL.json': '831a7247e8a152731c5539a01e7d2caa6ba7cb35680e1593bc971d613f8246b2', 'fixtures/6cc-component-source-H.json': '8ca54724aabb5f69928748baf72f49090a9f089b8dfce842995570952a30bdf2', 'fixtures/6cc-component-source-jobs.json': 'abcef528a4e4c4c4b99706366a66adcce6451cfb3e884833f4655203a001053e', 'fixtures/6cc-lossless-source-original.zip': '6f1ad2c3ec3de639d7ef78f04e182a7804703ff6c5011dc1fdd8f418420eaedf', 'fixtures/6cc-trace-source-original.zip': '3145708e392121ac43bad0c287079598e7930b01750eb8be6f4a6de8ee677475', 'fixtures/7c25-cancelled-live-source/ANNOTATIONS.json': '33b2301f9f3fffdac7498b4adf87fa741542590f98af4551336e5cd2f0e67b93', 'fixtures/7c25-cancelled-live-source/JOB.json': 'd0bf12c898f90e5d13884747b2944ca8e55eef6afaa1d7fa836b17e20c45af88', 'fixtures/7c25-cancelled-live-source/ORIGINAL.zip': '84d68c8cfa4817fd5673696431217e15553e771c7c961e35e41879cb24287ad2', 'fixtures/7c25-cancelled-live-source/RUN.json': 'fdd20eb544a14b8075f47d81ce7bccd82a8a0a2ee0dcbdaa01775e6731dd769d', 'fixtures/7c25-first100-once01/ORIGINAL.zip': 'cbee78ef929a46cbf674ebf0b38b0e2c37511de0c0a44b2522c277d9739515cf', 'fixtures/7c25-live-source-job-original.json': 'b7b88d805bb1193bef0624321759da87173acf3678f223689716025a99fec7a4', 'fixtures/7c25-live-source-original.zip': 'b6ea06afbbaa1df4ec58cfeb0c56e351425d7727fd88820046db9c29c2c088d8', 'fixtures/7c25-live-source-run-original.json': '0326fd0c23112e25a5ce89794a2c5c43827ef7bcac60da5205596309e96dcf3b', 'fixtures/7c25-source/NORMAL-READBACK.json': 'c4cb8cfcf87b6ff4f6de2f91af656f93cd7c663487c02e733e7448554a45fab9', 'fixtures/7c25-source/SEMANTIC-READBACK.json': 'e290fc26545fc2d87cea2b7ed51c0a4935d5a8c291cf7a4152e8a30514164e44', 'fixtures/7c25-source/provenance.json': 'dd42402cc5888dcc9fffcbbfb5360bd36fdc49458e60a80452bcd5068719fb2b', 'fixtures/896-live-functional-original.json': '4ff5e4d1a301e4b8c636baadcfde1459f35107f2e2b5dedc456a3817f3e7deae', 'fixtures/9081-live-functional-original.json': '9744b10e2d40d4674ffc3dfaa2273349e9d7a8b13e22aa268724ce69c9386a22', 'fixtures/9081-normal-live-source-original.zip': '5c3db014446402ced74177c7965ec1554fa6aa609b2cca0000fe2667bc2fef08', 'fixtures/c06-functional-readback.json': '23c0639ababad3e041810ba9d21e96e754c618da7a14ee546aa9bf2ddabd7146', 'fixtures/c06-named-cases-original.zip': '65df3771ab668be1b6a8c044dbcc3cc0a024bea416b08547ba0d8eb9cb51d1fe', 'fixtures/c4b-source-functional-original.json': '2daaf7e71840e15dc27dba9ff8883e285c5f3bacd88b7df655c6330a025e3664', 'fixtures/commit-observation-public-schema.json': '9dc8dbf4820d04068b2272e4dd16f202d6fb106b82cecf8aef6d544517680c06', 'fixtures/d24-source/13568519289.zip': 'a2835443d37f4e009e54fd1c94f436827e83b011b34a7ae9094fffc7b040a743', 'fixtures/d24-source/13568784007.zip': '6fcabdf62ef3c31c538ca73c79227dbd142d2d1d308d8b23d688060484b256de', 'fixtures/d24-source/13568854112.zip': '8f100165f144b4cc6ed69693c75bd7c9659f72b937237baceaff16bb0e6662d5', 'fixtures/d24-source/13569173444.zip': '28baad460ea06a5f159de4fee3487e2a85e281eb335aba0726341a93d67a777e', 'fixtures/d24-source/13569501647.zip': '4a6294d636f5f7da20da79c5777a147feff998e8d26fdd686679a4392c8c349e', 'fixtures/d24-source/CHAIN-JOBS.json': '26b2d233e8c1b083dcc813f500599d692150c982f40a65fa08b2db78adee48ec', 'fixtures/d24-source/CHAIN-RUN.json': 'c50660ec4c056f66c914547c613bf74d62549e7283fe0310eae941fc2747d758', 'fixtures/d24-source/CLIENT128365907200.log': '44b12ca914f9d8c493e2053e17dddfacf981038853cb4cc2d75c9daa68b3650c', 'fixtures/d24-source/RESOURCE-JOBS.json': 'aa1196b8196abef04af08f646b8479a80723eadf50ea56bb4e1a40bf0bc75438', 'fixtures/d24-source/RESOURCE-RUN.json': '73662a0685662c54af155e4fc9744b1be67b93813803d704dc6aaa0e81d694e1', 'fixtures/init500-live-setup0-original-failure.txt': 'a81288b98a781b952f46d699850168248bddee30690248d490efcfabf1ae9cbd', 'fixtures/live-request-observation-f76/CHILD-RECEIPTS.json': 'fe1ea69ecf432caeea58e855ef307efaebe999d655c9e0c73fe71d096d654a43', 'fixtures/live-request-observation-f76/SIGINT.combined.log': '950d700b05a18e8d0f27873f8085996461e97cb6db420045ef4259bc477e268f', 'fixtures/live-request-observation-f76/SIGTERM.combined.log': '46fa181d708bf582665f361b0111439ccbf3006793b4b9dfd4e01e575a77090f', 'fixtures/live-request-observation-f76/component.combined.log': '0dce8a9de58df90fed7b63446b8b2582fca637ad6bdad21862ac32a838817c87', 'fixtures/live-request-observation-f76/provenance.json': '971273cb16e02331311c4786f49d4069851adf193a3b5c64fefa1a2c27a64151', 'network-layer-accounting.py': '1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635', 'owned-tcp-accounting.py': '612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440', 'pq-1695-source-qualification.py': 'b553028656b038b18b698db094ec3561ec06a299f2be7bfd9e50e44b54d19fa1', 'pq-7c25-live-source-data.py': 'e7861fe94308c276c02d2dd74ad2e3d99c50ab5d31beea2574658784283fdccb', 'pq-7c25-native-source-dependencies.py': '5b7b8a5df0a3a37d2eac311f92e645a07da3b9d26f6c14abb0027a7a6e8bdfe5', 'pq-7c25-semantic-readback.py': 'da6461e36953d67de5fedd2b7161af24f253376c7a59f160663159221eb9a73f', 'pq-7c25-source-qualification.py': 'b28e9238e8ee88104e8cf8796a9e277cb8d6824a4e6d1b86b4d7aff65aec1e39', 'pq-bounded-sender-backend.py': 'add2f9a3b9e3458b660aac27ab2b2556425b4b283d11322284100df74f8c65da', 'pq-c06-source-qualification.py': '385b34200486ede3045bea1e37d2cc0ea057481c0294257da4e825126975d37c', 'pq-commit-observation.py': '4033dea236ee7536e2bc4fab74655e0ec9317564ec10516e47d599ccafa64cc0', 'pq-d24-semantic-readback.py': 'aead5f59c1d72eb32f0a46816d530e263645dfbdae3ae1fc1eeb21a53d5ba098', 'pq-d24-source-readback.py': 'd20e90967a871161d02a3dbee1632480adfb0d7ddd28f47ac7dbc2f1d18351c3', 'pq-finalize-trace-readback.py': '6b88b499745d2a3fe7cdcc1e690ca116a4986fc81fe40876a55491886569d524', 'pq-first-trial-source.py': '495a0614dc989db5c5eee157a3e5519459a90750821896a194073993c76dad7d', 'pq-height-vectors.py': '2928be0afa76eb7d968533d6a71c4cc06298edef89bfa5cfece46211e281a2c3', 'pq-hop-byte-accounting.py': '663c072e11f777d5119f87fa9e200548c117f937427c46295277e722c7d3744b', 'pq-independent-load.py': 'c3e03fa60dd6329f1df9f2157cb254e155bea7f8f4f64e7b3e454767052b3916', 'pq-independent-scheduler.py': '460718524ddbde9243f77588bc9a826bb4b25d4b84e7cf7f58a7953c0b29b8f8', 'pq-initialization-measurements.py': 'a5dd93bc0be164f1d3b38b1962037e5ccb7f9a68bd9051b651fba2ff2ba8e917', 'pq-initialization-readback.py': '50b56368aa5a25fbd2c17c16a2f6bde2a119be675a5f49a32e10f89aa72b8530', 'pq-live-request-observation-readback.py': '3ff841f013cd0956253d415da79485265a52b63d2a5419d16d8cede6a74a0b01', 'pq-live-source-qualification.py': '159cbe9e96d8cde3956141fea5880f1b8bc16bf7db9f85aeddccf6c1c87d23a7', 'pq-lossless-source-data.py': '43cd58a84b361162f637586f391782ea65ffa6fcb5152e6bc515fd2cd3ba075c', 'pq-network-window.py': '6132d2adf72e01959f9d9e71ec4da22961b7f5335cb77331dc2769c66af4cdc8', 'pq-node-startup-measurements.py': '3b6e5a3b27ec0d1bc18f9469c961b23c9dedaf960928b0f9dbfd77de78115045', 'pq-normal-leg-trace.py': '43d2a2059df8933e57e5f6709376bef274f4bc480e08c81300a8c26da6c69121', 'pq-normal-live-reader.py': '871c2236d2c208fe99177a74f929e1b5e91f86ff61d3a482a593e1aaaa4dec24', 'pq-normal-live-source-data.py': '969610212a6fbed759d5a516a0c294bc4f796046e4755119780668b2cd837f6b', 'pq-normal-paired-runtime.py': 'e0257f223d0a2f7732bf9cac58e170365249137b86200a286aa3de6f15c1716a', 'pq-normal-process-lab.py': '67b9c025cdfbcd0554a1701a5119fa496fead5ff91fa688845d81ee18ee125a5', 'pq-owned-header-capture.py': 'f5a03c7fbe7c1048d045986fbdd00f6e306d2025b53b41adeaf6fd8e06301bcd', 'pq-owned-storage-window.py': '67e96cda53201b32b0ab1ca10707abb5e885645b51cbceaf2f3c8c77ac81f7c3', 'pq-paired-linux-window.py': 'b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2', 'pq-preload-initialization.py': 'f6fbc37c6b97ca6831c81c39a08d8213e00c1093e24b980ee3653edfb67d3f7d', 'pq-public-owner-backend.py': 'e8996837859f8f99baf1468a7ff781327199bfafd4680a0424b3417db92b6785', 'pq-public-owner-readback.py': '8c3b4080615854a908862ad7aedbd236e76facb7cf46a0856f3fcc417bb9f8fb', 'pq-public-owner-transport.py': '2df45d6e5157ea54f80b7ba31985fc075757e3d3152dd6d5ec7e1327f754fbc8', 'pq-public-proof-readback.py': '50ad1dbb6eadb494cfac180f84fd9deb13051abae58f3acfb055d32541decc53', 'pq-rpc-measurements.py': '610e634faf55f3d5fced1a1037139600019bc61175f9e79cc3d7209127f73ed3', 'pq-runtime-hardware.py': '8eada64f9eb260a950e194d05ba48402a0febf7bd5584f924167d7ba263209e9', 'pq-semantic-height-state.py': 'ba995e8c1096dc64d871d5131603a2def98f19e69694abdbdbc480648183dfa1', 'pq-staged-harness-controls.py': '182a3e966f0f35ab3911e7aede43b0f42686ca358937c307e664d5516d98df99', 'pq-staged-independent-scheduler.py': '1e46d1665bf37869f15eaaa555a97a6939ff3fd45e6a9aadc87436271681cf77', 'test_consensus_linux_cohort.py': 'bcb9b6450374f0d734887b7c7f4e9c83314e71f913948098da0927406b4e233b', 'test_linux_owned_rss.py': '6a9a92a7f910af83ffc227ef1fde1ff535658112fb1728308c5ed43b8620b5af', 'test_linux_thread_group_exit.py': '3b22ec42f247d76b0b12dc48fcdf28819efd799074d2931bee9d8ca235e84706', 'test_pq_1695_source_qualification.py': '2e499f3d011332dbc2fdca3116a3b7b8781efad5a6cf344b3fa2962d6ba3bfdc', 'test_pq_7c25_native_source_dependencies.py': 'c2da9ad5f241c2b0ebd1b7bbd2862b1f784a2a20569f04c126f290c66d05a824', 'test_pq_7c25_semantic_readback.py': 'c443d3ce8ec61e73a5f890107e680b653168df433a789f6b14017c8224705fa2', 'test_pq_7c25_source_qualification.py': '17ec4789b8ea3fd6c7b796b04c15c350b16b20497a3ad3e54ee736e091977cd7', 'test_pq_bounded_sender_backend.py': '49285087d885e51b0087e697e6073416ac95344fab81ad73e745d12b8e7331ca', 'test_pq_c06_source_qualification.py': 'f112c861af7ffeaa966c24fd516ed84be308e6af64c9ce913a963eb7c3a582a3', 'test_pq_cold_readiness.py': 'd0f734a0393f1a0d3c6fb4d314190b6cb4228426a72d2e41953996e5cecd8fb9', 'test_pq_commit_observation.py': '08f978edb78f153f7ab01a64e07ba6e7f35fa410c984103dc5c15372f76931cb', 'test_pq_completion_diagnostics.py': 'af1193758a8b17b70dfa78790060a51787b9b4dfff598246843efec35a4c61b8', 'test_pq_current_live_reader_wiring.py': '2313178495acf811f7bf7ae462251b259cf996ae989691cc791baa9ea670ead1', 'test_pq_d24_semantic_readback.py': 'a593a54252805ffcd22c4c5100aabe868196d2cc27086b5046d63145530a29fe', 'test_pq_d24_source_readback.py': '335f2dac1537e8c0548b9c107070bf387ce1a160b29e6800d2a04bc20175cdf9', 'test_pq_finalize_7c25_semantic_ci.py': '0ca77639287cad76788d90f0985190e1f04eb0ef2d1d6df54d482e0b1a07377c', 'test_pq_finalize_trace_readback.py': '4a1ac12d8f7c62ba6301a7b6371a89a8658ce99773edb8945ae8bd3fae4954b8', 'test_pq_first_trial_source.py': 'd7e67253675ec0e323b90e96c5fd43e39a82efa5dc4edf829750a4fea5059aaa', 'test_pq_height_vectors.py': '7a75324faff6c3141a13217b664abf19637ffc4e22217a1e8e886490a0e589d1', 'test_pq_helper_lifecycle.py': '210288fe3b4215775489d2481936563da3bfbd0880b76ca21249b414be75e952', 'test_pq_hop_byte_accounting.py': '2116cdb12f52f2e8f6500d5e54e3d20248b0d29eef88081962b3ce6ff1984e67', 'test_pq_independent_load.py': '78756c2e271ffe5999a73a2586cb83ff400728b87f29ddb4e0a686dcb814aaae', 'test_pq_initialization_measurements.py': 'a7c0ba801d5d83642e88778778d1cac03087fa72f161d01ddb63970c91fbd521', 'test_pq_initialization_readback.py': '601db3cff42985cbfeb46a54097ebee73e233fa2a1fa47be79ce2998d2c7bf8c', 'test_pq_live_source_qualification.py': '5998b6652afa345f5a0c2c66b79918fc3bf7984afd623ef84f8a8072781cbe01', 'test_pq_load_escalation_conditions.py': '5307203ba58fc2656b6ce79eec4d9e1a175ffeaeef05a98d432d5b3764d6fb9d', 'test_pq_lossless_source_data.py': '2530f2dfda2e4940d9af6ed50d70eafed2f1b22418d4e573ead60792ee0d8ed1', 'test_pq_node_startup_measurements.py': '81896422ac5e8f4e03d3cd7b5278a9854e9fb088db7dae30d58e96007330d3b7', 'test_pq_normal_callgraph.py': '507854aab80fd522ba93c6699e6c38f18eed30159bc6506aee175c3b0dc63bef', 'test_pq_normal_clean_exit.py': '991f167b37bbbfac9c090f4e6ddb5ee8d47300038807f6d9fe4066c5f7fedce6', 'test_pq_normal_leg_trace.py': 'a6ad35270139dfda7ba89702da17c72a5430c377db32ffd3e51a9e7835f1f234', 'test_pq_normal_live_build_source.py': 'aa35b1a041ba3da4e3dee1d6d432d6b37d1b66c81f1cb9f1d74f1bb7684d26db', 'test_pq_normal_live_reader.py': 'b8ab2724db4a2c7c26675f662e3c8581b5a6ff86ec69b43526701a6f7c604ac2', 'test_pq_normal_live_source_data.py': '89a9e8ff671f4007bfb42cc6da88001563223d35ec30b9255be987a4be8a797d', 'test_pq_normal_network_baseline.py': 'd408a22ef0d592d6dd2b0e4391fb65b12a59c2ec95e62d4f013b0dd05aa992c9', 'test_pq_normal_pair_gates.py': '20d8b43f711d7d60c4cb7331f824ec53734b9b8137d760e34ede7afedced78d0', 'test_pq_normal_paired_runtime.py': 'edab54868e48aa9aafda0e4f608020ee43b766715ef9ca3aea148c2a8dcedd89', 'test_pq_normal_parent_measurements.py': '40acc291ef78d1772b9bac7f398c16952edb5aa05f880bf124052393d553c818', 'test_pq_observed_throughput.py': 'df8c26a18a35214acef9a6a4f158f3bb8c3759c2107d94214aecc92da6ced6ad', 'test_pq_owned_header_capture.py': 'e30105c2282790215ae01c56e162402b71d49d23dd0d04b511fe92166d2f11f7', 'test_pq_owned_storage_window.py': '1dc1419b69361cbd604aef8c9b055b42b96567d181c3315ed1ce56395865cf33', 'test_pq_preload_initialization.py': 'bb6ecb84e3c22fe98e354ebe1f26e4d7690029f70924ab84769dc704033a61e7', 'test_pq_preparation_startup_timings.py': '21af9c61f18f53d2e2812e3e5ef6619e7e2d33313fe2122b68150107a9f9a9fb', 'test_pq_public_owner_readback.py': '88d326b1a7c2fdbf4b51b9ebd9aab8dba348a70059062fd1fd84c2e9a7c28bbe', 'test_pq_public_owner_transport.py': '7fb14f2822268de82b85c96c42686dc1bb0729733e85e628e64731e0cb785104', 'test_pq_public_proof_readback.py': '4b412446c26186ce925a2cfc5896901a58df64067c15e36e9b3d07a3b33ad019', 'test_pq_ready_metrics.py': 'f76a971436898261ed0ade64b451996363e01c6b3f684e434c2fd7862a2449be', 'test_pq_rpc_measurements.py': '5a36392c9162075468d729b3ea18fbcde59a834c9c41ccd9286c82ea466b83bb', 'test_pq_sender_backend_selection.py': 'f0abb6c4218a106fc617d5e030a79ab41474d6ebe6c412d0a64f8e6f8f3feecd', 'test_pq_staged_independent_scheduler.py': 'e9ba5de9b5c72d3fd1f0b6bba54847c6054382d8630b5b8f9f8f54110e8422bb', 'test_resource_guard_sampling.py': 'e394f527f07f9b2228f0168ab11d95f3021669c12aa7d5e8ec4d5734ef33d082', 'test_window_failure_cleanup.py': 'b29af491d4dd36d8f2756ba71d9bd949cf4aea9d95abea9e492346086b72bbd7', 'testdata/native-source-dependencies/packages/wallet-auth/go/sourceparentprofile/canonical.cpp': '6b0ae48f4eb5aa62b9e9845e96df1beaeadec2a66fc0f83736a2c584062ee49c', 'testdata/native-source-dependencies/packages/wallet-auth/go/sourceparentprofile/inventory.cpp': '0d2c369e9e4787adff266eefafec296b80c80fdbf3ac4fcc80ebaa97b86de6f2', 'testdata/native-source-dependencies/packages/wallet-auth/go/sourceparentprofile/original.cpp': '423e51d2791e5857c8311c20c8fcee9355526b2c063cbdf146214f9877afb62d', 'testdata/native-source-dependencies/packages/wallet-auth/go/sourceparentprofile/profile.go': '30231b0651967201e21fa55eefe7779661514d8c61d8367e2b90244b62d34788', 'testdata/native-source-dependencies/packages/wallet-auth/native/source-parent/MobileCanonicalDATA.cpp': '088924c5a093d3f15ff11de2c3ce00dec5a4ed0d35fb1832508a32f1095fe556', 'testdata/native-source-dependencies/packages/wallet-auth/native/source-parent/MobileCanonicalDATA.hpp': '6658eafc777a860d1ce20f8a97617d82e816dab6b88b8b15c043a0f16d8d26a7', 'testdata/native-source-dependencies/packages/wallet-auth/native/source-parent/SourceParentOriginalProfile.cpp': '89d4f217e6deea1944a13e07604d0c56c5923b918369ba40b8c8759a3e5c4e60', 'testdata/native-source-dependencies/packages/wallet-auth/native/source-parent/SourceParentOriginalProfilePrivate.hpp': '390eb2da9217acdedff8200c8b2c477b277e2d9bbee7652d9e8148883179ef9b', 'testdata/native-source-dependencies/packages/wallet-auth/native/source-parent/SourceParentProfileC.cpp': '44a14f3ef40d2f474d1fc544389cca18688625d4dee5b19f4dc5efd6e073f04a', 'testdata/native-source-dependencies/packages/wallet-auth/native/source-parent/SourceParentProfileCPrivate.h': 'f631d68d5abae5c1814f0a213599c437aa5428354b417c21e969ff7248775c63', 'testdata/native-source-dependencies/packages/wallet-auth/native/source-parent/SourceParentReviewedProfilePrivate.hpp': 'e9ff75c819a1d1b948018d1b3e866ac7f60447e53fdcf5e3c555eef7eda276fe'}

TOOLS_CI_RUN = 42456208220
TOOLS_CI_JOB = 128655657101
TOOLS_CI_WORKFLOW = 322083952
SEMANTIC_READBACK_BYTES = b'{\n  "afterCommit": "7c25cbcc7d31b10743e26ae1ddca745085ee1b0b",\n  "afterExecutionTree": "96d91aed6a015f7243bb18b5d7a375bddf51483a",\n  "afterForkTree": "5a128880d14bfc73de4334cba23218859ad3473c",\n  "afterSourceGoHeightTests": {\n    "childCases": 15,\n    "failed": 0,\n    "nodeStarted": false,\n    "originalStreamBytes": 17253,\n    "originalStreamSHA256": "1d032f624df967f42455c19f99963cbdbc42c02bace300de905623abd8491956",\n    "package": "github.com/JiahaoAlbus/YNX-Chain/internal/consensus",\n    "packagePassed": true,\n    "passed": [\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICColdRefusals",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICColdRefusals/invalid-normal-state",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICColdRefusals/live-hash",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICColdRefusals/no-overwrite",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICColdRefusals/output-failure",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICColdRefusals/wrong-apphash",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICColdRefusals/wrong-height",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold/10",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold/11",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold/12",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold/4",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold/5",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold/6",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold/7",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold/8",\n      "TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold/9"\n    ],\n    "semanticPairQualified": false,\n    "skipped": 0,\n    "topCases": 2\n  },\n  "afterTree": "8a90d4ceb86a3a9460648e011bfed9f2e3ac1f4a",\n  "artifactSHA256": "6c20cb8df95cc835d144744b259a9e9be9bd4a03fce64edc6d107489ca4693b8",\n  "beforeExecutionTree": "0397f75ec55db6a89b46e2e6d051ce960c36827d",\n  "beforeForkTree": "54e88e6aba735eaceeb2d00bb40731248c673bd7",\n  "beforeOriginalCallerTree": "d6ff40c8e2603d2ef4086fcca6bafc276fd710b1",\n  "beforeProductionBase": "f27e07df6dd96114135aceace20a9413bba94649",\n  "binaryBytesIndependentlyRehashed": false,\n  "binaryHashesProducerReported": {\n    "after": {\n      "bytes": 40612160,\n      "sha256": "ef9c4415f9509fd19258a448239c388d90445a4707c940a051a1735799f20f6a"\n    },\n    "before": {\n      "bytes": 40249346,\n      "sha256": "4c398fb275c3a3eee71f9db3a2248f564efd2407082f0ec03421f44b734e1f7b"\n    }\n  },\n  "cleanupComplete": true,\n  "coldReconstructionProducerRecordsVerified": true,\n  "commonEvidenceOverlay": [\n    {\n      "bytes": 39737,\n      "gitBlob": "72e4d368a9fc225a621e24f65ab9a281d9282645",\n      "mode": "100644",\n      "path": "internal/consensus/pq_lab_finalize_trace.go",\n      "sha256": "0aa9b4e00a6c9f249ddc57063a3e9e37b4325f41a6014f0da3e571efb2eed61e"\n    },\n    {\n      "bytes": 23962,\n      "gitBlob": "a71ec1d82e1bb9bda22544dad4fa247b62ae80b3",\n      "mode": "100644",\n      "path": "internal/consensus/pq_lab_finalize_trace_test.go",\n      "sha256": "ff8908b58ee3a77900429bd3ca5d417564e3bbfcd87f969c8bcddf5f1f0923b5"\n    }\n  ],\n  "completePerHeightAppHashEqual": true,\n  "completePerHeightBalanceNonceStateEqual": true,\n  "completePerHeightRawStateBytesEqual": true,\n  "completePerHeightTxResultsEqual": true,\n  "controllerCommit": "87e4983dd668050a185bcd90e93fe377e549be26",\n  "effectiveBusinessTPS": null,\n  "equalityMeaning": "Full responses and all per-height raw canonical state bytes compared against fixed original length/SHA/AppHash and between arms; Go executes cold reconstruction, reader does not execute loader.",\n  "finalConfirmationLatency": null,\n  "heights": 9,\n  "inclusionLatency": null,\n  "intermediateFullStateBytesIndependentlyReconstructed": false,\n  "jobID": 128624390998,\n  "limitedOriginalTrajectoryQualified": true,\n  "liveNetworkPairQualified": false,\n  "originalElapsedSeconds": 168.111605901,\n  "peakNewBytes": 2673549312,\n  "peakRSSBytes": 1146929152,\n  "perHeightEvidence": {\n    "coldReconstructionIndependentlyExecutedByReader": false,\n    "coldReconstructionProducerRecordsVerified": true,\n    "coldStageObservedNanoseconds": {\n      "after": [\n        {\n          "coldCompareNs": "390",\n          "coldEncodeNs": "28993",\n          "coldLoadNs": "3539035",\n          "height": "4"\n        },\n        {\n          "coldCompareNs": "9824",\n          "coldEncodeNs": "1933945",\n          "coldLoadNs": "10051115",\n          "height": "5"\n        },\n        {\n          "coldCompareNs": "9614",\n          "coldEncodeNs": "977408",\n          "coldLoadNs": "10801952",\n          "height": "6"\n        },\n        {\n          "coldCompareNs": "10205",\n          "coldEncodeNs": "925770",\n          "coldLoadNs": "11240572",\n          "height": "7"\n        },\n        {\n          "coldCompareNs": "19269",\n          "coldEncodeNs": "1143798",\n          "coldLoadNs": "10813459",\n          "height": "8"\n        },\n        {\n          "coldCompareNs": "10145",\n          "coldEncodeNs": "1159481",\n          "coldLoadNs": "12844770",\n          "height": "9"\n        },\n        {\n          "coldCompareNs": "14512",\n          "coldEncodeNs": "1175486",\n          "coldLoadNs": "14818214",\n          "height": "10"\n        },\n        {\n          "coldCompareNs": "15484",\n          "coldEncodeNs": "1516878",\n          "coldLoadNs": "15752487",\n          "height": "11"\n        },\n        {\n          "coldCompareNs": "17056",\n          "coldEncodeNs": "1841916",\n          "coldLoadNs": "15655381",\n          "height": "12"\n        }\n      ],\n      "before": [\n        {\n          "coldCompareNs": "411",\n          "coldEncodeNs": "29594",\n          "coldLoadNs": "3710141",\n          "height": "4"\n        },\n        {\n          "coldCompareNs": "10906",\n          "coldEncodeNs": "1521444",\n          "coldLoadNs": "10516753",\n          "height": "5"\n        },\n        {\n          "coldCompareNs": "9364",\n          "coldEncodeNs": "984829",\n          "coldLoadNs": "11177094",\n          "height": "6"\n        },\n        {\n          "coldCompareNs": "10365",\n          "coldEncodeNs": "943597",\n          "coldLoadNs": "11546438",\n          "height": "7"\n        },\n        {\n          "coldCompareNs": "14883",\n          "coldEncodeNs": "2040454",\n          "coldLoadNs": "12698389",\n          "height": "8"\n        },\n        {\n          "coldCompareNs": "11087",\n          "coldEncodeNs": "1125891",\n          "coldLoadNs": "11881753",\n          "height": "9"\n        },\n        {\n          "coldCompareNs": "14422",\n          "coldEncodeNs": "1419813",\n          "coldLoadNs": "14966635",\n          "height": "10"\n        },\n        {\n          "coldCompareNs": "16084",\n          "coldEncodeNs": "1520483",\n          "coldLoadNs": "15652074",\n          "height": "11"\n        },\n        {\n          "coldCompareNs": "23676",\n          "coldEncodeNs": "1845511",\n          "coldLoadNs": "15895711",\n          "height": "12"\n        }\n      ]\n    },\n    "completePerHeightAppHashEqual": true,\n    "completePerHeightBalanceNonceStateEqual": true,\n    "completePerHeightRawStateBytesEqual": true,\n    "heights": [\n      "4",\n      "5",\n      "6",\n      "7",\n      "8",\n      "9",\n      "10",\n      "11",\n      "12"\n    ],\n    "statePins": {\n      "after/10": {\n        "bytes": 400648,\n        "sha256": "0241060baabdc5804f01052e9a5f5182623400d68c1fb44dcf0d33c221356bf9"\n      },\n      "after/11": {\n        "bytes": 517890,\n        "sha256": "e7533cd1ee522e2409d41cc066bfcb1d9fbb4aedca20575f8cd7532b7cc6210f"\n      },\n      "after/12": {\n        "bytes": 517890,\n        "sha256": "38d32aa3bddfc5e7c21b4343095283eb3c3e1b8da514c9b267fd222aca0ba2fa"\n      },\n      "after/4": {\n        "bytes": 8138,\n        "sha256": "2c8f8e27c45b86818a6f418c10f594df068e51e87cfaddf4ef6a261499377577"\n      },\n      "after/5": {\n        "bytes": 318267,\n        "sha256": "5d3a0738d600e668177c9db112f7ac97c023291ed38bccf3ad186d09131cf277"\n      },\n      "after/6": {\n        "bytes": 318864,\n        "sha256": "413961baa39ac1f6af2be350ec4e75ebf6402057e0f539a012b2d978c5d67906"\n      },\n      "after/7": {\n        "bytes": 318864,\n        "sha256": "7a76cfb874621cf5e57aa67a28385de8edf22ac4f6dd10982f9e99d3cfa15317"\n      },\n      "after/8": {\n        "bytes": 318864,\n        "sha256": "8d173ed887276fc7125d7f6958a871a997317ce8fd1fd2a820e6a3085ef2fe2e"\n      },\n      "after/9": {\n        "bytes": 318864,\n        "sha256": "fbec1e2fe14b879b819101c40252dfd1edc289a05f5159cee3c1037f1c2db46c"\n      },\n      "before/10": {\n        "bytes": 400648,\n        "sha256": "0241060baabdc5804f01052e9a5f5182623400d68c1fb44dcf0d33c221356bf9"\n      },\n      "before/11": {\n        "bytes": 517890,\n        "sha256": "e7533cd1ee522e2409d41cc066bfcb1d9fbb4aedca20575f8cd7532b7cc6210f"\n      },\n      "before/12": {\n        "bytes": 517890,\n        "sha256": "38d32aa3bddfc5e7c21b4343095283eb3c3e1b8da514c9b267fd222aca0ba2fa"\n      },\n      "before/4": {\n        "bytes": 8138,\n        "sha256": "2c8f8e27c45b86818a6f418c10f594df068e51e87cfaddf4ef6a261499377577"\n      },\n      "before/5": {\n        "bytes": 318267,\n        "sha256": "5d3a0738d600e668177c9db112f7ac97c023291ed38bccf3ad186d09131cf277"\n      },\n      "before/6": {\n        "bytes": 318864,\n        "sha256": "413961baa39ac1f6af2be350ec4e75ebf6402057e0f539a012b2d978c5d67906"\n      },\n      "before/7": {\n        "bytes": 318864,\n        "sha256": "7a76cfb874621cf5e57aa67a28385de8edf22ac4f6dd10982f9e99d3cfa15317"\n      },\n      "before/8": {\n        "bytes": 318864,\n        "sha256": "8d173ed887276fc7125d7f6958a871a997317ce8fd1fd2a820e6a3085ef2fe2e"\n      },\n      "before/9": {\n        "bytes": 318864,\n        "sha256": "fbec1e2fe14b879b819101c40252dfd1edc289a05f5159cee3c1037f1c2db46c"\n      }\n    },\n    "timingMeaning": "Original Go monotonic load/encode/compare observations; no missing interval filled; not business latency or source performance improvement."\n  },\n  "runID": 42445815447,\n  "runtimePressureAuthorized": false,\n  "schema": "YNX-PERF-7C25-LINUX-SEMANTIC-ORIGINAL-READBACK/v1",\n  "sourceInventoryFiles": {\n    "after": 3265,\n    "before": 3077\n  },\n  "stageParentWallSeconds": {\n    "after-build": 11.005214652,\n    "after-buildinfo": 0.213480326,\n    "after-height-evidence-tests": 81.861421653,\n    "after-replay": 0.637111258,\n    "before-build": 62.20892026,\n    "before-buildinfo": 0.213603723,\n    "before-replay": 0.804414304,\n    "fetch-original-source-objects": 0.422417476,\n    "go-version": 0.214951665,\n    "prepare-fixed-two-source-trees": 9.065259374\n  },\n  "timingMeaning": "Parent observed launch-to-exit wall time; sequential builds share cache. Not paired performance improvement or business latency.",\n  "toolsCommit": "478bf2ee60c19dcbdb67872184f9e1f500511746",\n  "toolsTree": "3f6457276cdea84467917e763e6e3fb8b42701db",\n  "traceSHA256": "11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6"\n}\n'

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
    require(hashlib.sha256(SEMANTIC_READBACK_BYTES).hexdigest() == 'e290fc26545fc2d87cea2b7ed51c0a4935d5a8c291cf7a4152e8a30514164e44', 'actual semantic readback bytes differ')
    value = strict_json(SEMANTIC_READBACK_BYTES)
    require(value['controllerCommit'] == '87e4983dd668050a185bcd90e93fe377e549be26'
            and value['runID'] == 42445815447 and value['jobID'] == 128624390998
            and value['afterCommit'] == GO_SOURCE and value['afterTree'] == GO_TREE
            and value['beforeExecutionTree'] == '0397f75ec55db6a89b46e2e6d051ce960c36827d'
            and value['afterExecutionTree'] == '96d91aed6a015f7243bb18b5d7a375bddf51483a'
            and value['heights'] == 9 and value['limitedOriginalTrajectoryQualified'] is True
            and value['completePerHeightRawStateBytesEqual'] is True
            and value['coldReconstructionProducerRecordsVerified'] is True
            and value['afterSourceGoHeightTests']['topCases'] == 2
            and value['afterSourceGoHeightTests']['childCases'] == 15
            and value['afterSourceGoHeightTests']['packagePassed'] is True
            and value['binaryBytesIndependentlyRehashed'] is False
            and value['runtimePressureAuthorized'] is False, 'limited actual same-tuple semantic scope differs')
    return dict(semanticReadbackSHA256=hashlib.sha256(SEMANTIC_READBACK_BYTES).hexdigest(),
                semanticArtifactID=13604015145,semanticRun=42445815447,retainedHeights=9,
                semanticReplayReexecuted=False,actual500InitializationQualified=False,
                runtimePermissionGranted=False,pressureAuthorized=False)


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
                 'Verify original d24 cohort and separate stage denominators',
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
               'User-Agent':'ynx-fixed7c25-ci'}
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
        driver.lab.write_new(work / "public/FIRST100-7C25-CI.json", record)
        calls.append(window)
        return window

    driver.lab.Window = counted_window
    return original, calls

def fixed_options(source):
    return argparse.Namespace(first_trial_profile='7c25',sender_backend=PROFILES[PROFILE],source=str(source),commit=GO_SOURCE,mode='online',rate=100,seconds=5,accounts=500,per_account=1,tail_seconds=30,proof_timeout=30,wire_observation=True,network_accounting=True,header_hop_capture=False,owned_storage_accounting=True,commit_observation=True,prior_result=None,prior_result_sha256=None,execute=True,staged_publication=True,initialization_only=False,initialize_before_load=True,startup_timings=True)


def prepared_data():
    return dict(profile=PROFILE,controllerRef=REF,goSource=GO_SOURCE,goTree=GO_TREE,tools=TOOLS,toolsTree=TOOLS_TREE,configuredBusinessDemand=500,preparationAccounts=4,senderBackend=PROFILES.get(PROFILE),backendComparison='source-successor-not-yet-matched-paired-performance',matchedBeforeAfterComparisonExecuted=False,requestStageObservation=True,sameInstanceNormalLiveReaderRequired=True,requiredCurrentGetterCI=42452563828,measurementScope='same-window-normal504-initialization-then-first100x5',caps=CAPS,executed=False,businessLoadAuthorized=False,pressureAuthorized=False,nodeStartAuthorized=False,sourceGrant=False,sameHost=True,physicalFaultDomains=1,actual500InitializationQualified=False,resourceGuardComponentTimers=True,commitEncodingPersistenceObserver=True,allEightNodeExitZeroRequired=True,coldReadinessPhaseMaxSeconds=180,globalActiveLimitSeconds=885,ordinaryReadinessDefaultSeconds=60,steadyStateSLOChanged=False,requiredRemainingActiveSeconds=35,initializationBeforeLoad=True,startupTimings=True,higher500Or1000Permission=False)


def verify_tools(tools):
    checked_source(tools,TOOLS,TOOLS_TREE)
    for path,pin in TOOL_PINS.items():pinned_bytes(tools/'scripts/loadtest'/path,pin)
    require(not any((tools/'scripts/loadtest').rglob('*.pyc')),'no ignored bytecode substitutes allowed')


def validate_driver(driver):
    require(driver.STAGED_CALLEE_SOURCE=='9081f14654a48f4fe14e57696ec33527869da353' and driver.STAGED_SOURCE_QUALIFICATION is None,'legacy staged qualification gate changed')
    require(driver.first_trial_7c25_source.SOURCE==GO_SOURCE and driver.first_trial_7c25_source.TREE==GO_TREE and driver.first_trial_7c25_source.FORK==FORK_TREE,'exact7c25 own-source qualification binding required')
    require(driver.lab.CAPS==CAPS and driver.lab.RSS_OBSERVER_VERSION=='same-process-rss-v4-pidfd-any-state' and driver.lab.guard.CAPS['ownedProcesses']==16,'original runtime guard/caps differ')
    data=driver.first_trial_7c25_source.qualification()
    require(data['semanticPairConsumed'] is True and data['heights']==9 and data['source']==GO_SOURCE
            and data['sourceTree']==GO_TREE and data['sourceOnlyQualified'] is True
            and data['semanticReadbackSHA256']=='e290fc26545fc2d87cea2b7ed51c0a4935d5a8c291cf7a4152e8a30514164e44'
            and data['runtimePermissionGranted'] is False and data['pressureAuthorized'] is False
            and data['actual500InitializedOwnersQualified'] is False,'own source-only DATA cannot grant runtime or prior500 qualification')
    live=driver.module('fixed_current7c_normal_live_reader','pq-normal-live-reader.py')
    getter=live.qualify(dict(commit=GO_SOURCE,tree=GO_TREE,forkTree=FORK_TREE))
    require(getter['sourceCI']==dict(run=42452563828,job=128644748345,artifact=13606770461)
            and getter['ciHead']=='4931e0c0c6765e1655fcffb4763a8d952d8d828f'
            and getter['optionalForkCommit']=='5a49f5c91452604dffb910df736702b3b9df2562'
            and getter['optionalForkTree']=='08747364c24c065bf2b13527c210625d7ec95fba'
            and getter['buildTag']=='ynx_live_wire_observation'
            and getter['actualFrozenProductionCommitRun'] is False and getter['pressureAuthorized'] is False,
            'actual current getter source CI must qualify before the original Window')
    require(callable(driver.attach_live_reader) and callable(driver.create_network_window),
            'same-instance normal live reader caller missing')
    native=driver.module('fixed_current7c_native_sources','pq-7c25-native-source-dependencies.py')
    require(native.SOURCE==GO_SOURCE and native.TREE==GO_TREE and len(native.FILES)==11
            and sum(ref['bytes'] for ref in native.FILES.values())==35651
            and all(SOURCE_PINS.get(name)==ref['sha256'] for name,ref in native.FILES.items()),
            'closed original native supporting source pins differ')
    return data


def validate_result(driver,result,source_data):
    require(result.get('source',{}).get('commit')==GO_SOURCE and result['source'].get('tree')==GO_TREE and result.get('toolIdentity',{}).get('commit')==TOOLS and result['toolIdentity'].get('tree')==TOOLS_TREE and result.get('caps')==CAPS,'actual original result source/tools/caps differ')
    require(result.get('sameWindowInitializationSourceFunctionalData')==source_data and result.get('loadConditions')==driver.load_conditions(fixed_options(Path('/source'))),'result cannot inherit another source or load profile')
    require(result.get('firstCause') is None and result.get('cleanupComplete') is True and result.get('loadExecuted') is True and result.get('normalLiveCalleeUsed') is True and result.get('initializationOnlyRequested') is False,'original same-window preparation/load/cleanup incomplete; preserve first cause')
    require(result.get('networkBaseline',{}).get('status')=='OBSERVED','actual four-node original wire/TCP reads incomplete; retain UNKNOWN')
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
