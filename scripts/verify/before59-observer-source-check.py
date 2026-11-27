#!/usr/bin/env python3
"""Require exact 59f source plus reviewed opt-in observer/stream leaves."""
import subprocess
BASE='59f7885d11bd3eeb5d27dce7232779aae480a806'
OBSERVER_BLOBS={'cmd/ynx-comet/commit_monotonic.go': 'a053fa915c3dfba703dfc48049f8f35cfa3d934b', 'cmd/ynx-comet/commit_monotonic_linux.go': '38281a17381032a1b2a3b2b7d6cd7a76176d9d6f', 'cmd/ynx-comet/commit_monotonic_other.go': '2275a18dc0452cb72fcaabe6ca1887d61cc07624', 'cmd/ynx-comet/commit_monotonic_test.go': '2359d54628848e8da8e4ee4e076818d54097ddb3', 'cmd/ynx-comet/commit_monotonic_linux_test.go': 'd81c57794f34ba10a2e294a845c9d4f5297bb395', 'cmd/ynx-comet/commit_monotonic_other_test.go': '9bd4a990651f5fe0790b9b7831ca77fa5c0d9d90', 'cmd/ynx-comet/commit_clock_cost_linux_test.go': '0680c5274d1d13d7b26f425f27a77eb458afd477', 'cmd/ynx-comet/commit_observation.go': '958c1665eae0d2fe6bef376f7ffb4721e75d3746', 'cmd/ynx-comet/commit_observation_io.go': '552051880d0111202a18fdf157f70224863e1258', 'cmd/ynx-comet/commit_observation_validation.go': '73a1e89b25119bd429b0c7494191e7c354162df2', 'cmd/ynx-comet/commit_observation_validation_test.go': '565d1cfb4bf492770bb4110da9c3412f6bffd9c3', 'cmd/ynx-comet/commit_validation_observation_test.go': '5651d1c056d5a83b14008b0dd3be3407a59ceb6f', 'cmd/ynx-comet/finalize_observation.go': 'dc8c9e2799026084e91001c4997efcbcb0da76ab', 'cmd/ynx-comet/main.go': 'fa7d10baf102c228505d894343a9f0bf3cd73520'}
# The stream/header delta is bound to reviewed 9318 leaves; application.go
# retains the original 59f business body plus the reviewed opt-in hooks.
OBSERVER_BLOBS.update({'.github/workflows/pq-synthetic-header-controls.yml': 'c4b1fe4ed80c4b31d536272721fecd9487bdece5', 'cmd/ynx-comet/commit_header_callback_test.go': 'b3291e8aaea904dbc9983ad71c4f26cc1da9e05d', 'cmd/ynx-comet/commit_header_observation.go': '36862c0818d9eba6b097cfe0242fcc773cd02ff5', 'cmd/ynx-comet/commit_header_observation_test.go': '089e9b6c65f1c4dcb4d960cfd4c1300f902469f7', 'cmd/ynx-comet/commit_header_probe_test.go': 'd6141be7745a918fd2379d80b4b62d03c0f8ed94', 'cmd/ynx-comet/commit_monotonic.go': '02e4ffe9bafb1cd04df68bc7c16f183198675c97', 'cmd/ynx-comet/commit_observation.go': 'e7e12a1a4dddc507417b274af8e0556cca9bd4c6', 'cmd/ynx-comet/commit_observation_io.go': '8d4e3fc54e7a0c5acc1dec0575d25c7614c4ad38', 'cmd/ynx-comet/finalize_observation.go': '8f1db58f904f8da6d67b9457767a8135d3cab864', 'cmd/ynx-comet/main.go': '04880c91740f22cb6a54940cf351e049674055fd', 'cmd/ynx-comet/synthetic_header_only_test.go': '641a7a0f83dbb1ba480631c7291b506b107f777b', 'cmd/ynx-comet/synthetic_header_stream.go': '43020a6b9e376f477336dc6bcb56b57c0f1f1c82', 'cmd/ynx-comet/synthetic_header_stream_test.go': '74db626b7e4d896ec632cab8a2f663f7b2ecac21', 'internal/consensus/application.go': 'e4f74005797c17dd675479a2469b6b8d46686a65', 'internal/consensus/snapshot.go': '022b84dd308a7ac16fd3cc63ddff4636aab6afcc', 'internal/consensus/synthetic_commit_header.go': '3cdd56236041417c5e69ec7b1f73c19b14303333', 'internal/consensus/synthetic_commit_header_identity_test.go': 'bbbf44a8deef95775e8c8d322f1fe0db1ad58267'})
# Pin the pre-existing source/CI and before-business equivalence controls too.
OBSERVER_BLOBS.update({'cmd/ynx-comet/before59_observer_equivalence_test.go': '52323ec55e8a8478758666d5cc2234522967d3b0', '.github/workflows/resource-market-ci.yml': '65fd78ac7d575506956f7eb8ba012eb00fbeeb30', 'scripts/verify/pq-remote-window-entry-check.sh': 'f2f7576fb62aad17604d5eb34045f55bbbcfd6f2', 'scripts/ops/test_validate_pq_remote_normal_ci.py': 'bdf036d340c14fb009d9f578826cdb7a3641d64d'})
OBSERVER_BLOBS['internal/consensus/abci_public_trace_equivalence_test.go']='9245c9c3b26c236bdfc9b95abeb515a95bd6345e'
OBSERVER_BLOBS['scripts/verify/pq-clock-ab-ci.sh']='604904f5ce3ff223112e82e443d6d58269517cec'
ALLOWED=set(OBSERVER_BLOBS)|{'cmd/ynx-comet/before59_observer_equivalence_test.go',
    '.github/workflows/resource-market-ci.yml','scripts/verify/pq-clock-ab-ci.sh',
    'scripts/verify/pq-remote-window-entry-check.sh','scripts/verify/before59-observer-source-check.py',
    'scripts/ops/test_validate_pq_remote_normal_ci.py'}
def git(*args):return subprocess.check_output(['git',*args],text=True).strip()
subprocess.run(['git','merge-base','--is-ancestor',BASE,'HEAD'],check=True)
if git('status','--porcelain','--untracked-files=normal'):raise RuntimeError('original exact candidate checkout is not clean')
changed=set(git('diff','--name-only',BASE,'HEAD').splitlines())
if changed!=ALLOWED:raise RuntimeError('before59 observer changed unexpected or missing source files')
for path,blob in OBSERVER_BLOBS.items():
    if git('rev-parse','HEAD:'+path)!=blob:raise RuntimeError('original reviewed observer/stream blob differs: '+path)
# The original normal-CI control must explicitly account for this exact
# source-only ref. Pin the reviewed control so the extra leaf cannot hide an
# unrelated change to the original test or its negative admission cases.
if git('rev-parse','HEAD:scripts/ops/test_validate_pq_remote_normal_ci.py')!='bdf036d340c14fb009d9f578826cdb7a3641d64d':
    raise RuntimeError('before59 exact normal-CI control differs')
for path in ('internal/consensus/commit_timing.go','internal/consensus/finalize_timing.go'):
    if git('rev-parse','HEAD:'+path)!=git('rev-parse',BASE+':'+path):raise RuntimeError('original 59f timing implementation differs')
print('YNX_BEFORE59_OBSERVER_SOURCE_DATA_ONLY base='+BASE+' observerBlobCount='+str(len(OBSERVER_BLOBS))+' applicationBodyPinned=true equivalenceTestsRequired=true runtimeAuthorized=false')
