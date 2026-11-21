"""Candidate bridge to the unchanged original driver/Window, not a source grant.

The owning controller must freeze BOTH source/Tools/CI bindings before enabling
configured_adapters. No current or historical source inherits qualification here.
There is no execution CLI. The legacy single-arm controller is not called twice
and its one-Window gate is not patched. Instead the pair controller supplies two
independently verified driver modules and their original options/CI records.

OriginalDriverAdapter is the reviewable integration seam: verify_qualification
must perform the original checkout/tree, supplier, Go, hosted job and CI checks;
admit must enforce original resource floors/caps over ALL supplied storage roots.
Neither callback may turn a refusal into a return value. The original driver.run
still performs its own source, semantic, resource and hosted checks unchanged.

Registration is synchronous, BEFORE original Window.__init__, outside the
original driver's business exception handler. An exception is re-raised unchanged
and no original constructor, cache/key creation or child launch follows it.
Retirement checks the original on-disk receipt AND original Popen objects, worker
and observer evidence. It never repairs a failed receipt or resumes an UNKNOWN.
The Window lease spans execute AND retirement. Missing receipts or unresolved
cleanup keep that coordinator fenced; returning from driver.run is insufficient.
The tests use explicit low-cost lifecycle/source controls, not chain evidence.
"""
import copy
import importlib.util
import os
from pathlib import Path
import threading


spec = importlib.util.spec_from_file_location('pair_adapter_producer', Path(__file__).with_name('pq-same-runner-pair-producer.py'))
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)
require = producer.require

# Must be populated by the original controller owner in a reviewed frozen
# integration, together with original CI/dispatch wiring; NOT a runtime flag.
QUALIFIED_PAIR_BINDING = {'arms': {'after': {'go': 'go1.26.11',
                    'source': 'c697abae262c3be7859f235f45e9e8447bbccf63',
                    'sourceQualification': {'delivery': {'independentFinality': False,
                                                         'job': 136778017832,
                                                         'requiredSteps': ['Verify initial registration and '
                                                                           'funded transfer through the '
                                                                           'original proof CLI',
                                                                           'Verify exact transaction Host '
                                                                           'selection and original '
                                                                           'acquire-current',
                                                                           'Verify normal Host source '
                                                                           'producer with original signed '
                                                                           'transaction fixture'],
                                                         'run': 44880037485,
                                                         'runtimePermissionGranted': False,
                                                         'source': 'c697abae262c3be7859f235f45e9e8447bbccf63'},
                                            'job': 136773095628,
                                            'requiredSteps': ['Check reachable vulnerabilities in the eight '
                                                              'production runtime commands',
                                                              'Verify Linux window controls without starting '
                                                              'a node',
                                                              'Verify complete state bridge and sponsor '
                                                              'continuity',
                                                              'Qualify original Finalize phase observation '
                                                              'tests',
                                                              'Verify prepared signing and held proof '
                                                              'sessions on original inputs',
                                                              'Retain original held session public test '
                                                              'evidence',
                                                              'Verify exact optional live getter composition '
                                                              'without enabling a carrier',
                                                              'Preserve only public optional live source '
                                                              'evidence'],
                                            'run': 44880037485,
                                            'runtimePermissionGranted': False,
                                            'source': 'c697abae262c3be7859f235f45e9e8447bbccf63',
                                            'sourceOnlyQualified': True,
                                            'sourceTree': 'da151a9140c50e93379abaa3894b254ea44e4547'},
                    'sourceTree': 'da151a9140c50e93379abaa3894b254ea44e4547',
                    'supplier': '5a49f5c91452604dffb910df736702b3b9df2562',
                    'supplierTree': '08747364c24c065bf2b13527c210625d7ec95fba',
                    'toolPins': {'consensus-linux-cohort.py': 'ff30eee6a3d9990d31b30096191fb0637e5304b5d84d0390c144a0091a586d8d',
                                 'network-layer-accounting.py': '1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635',
                                 'owned-tcp-accounting.py': '612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440',
                                 'pq-1695-source-qualification.py': 'b553028656b038b18b698db094ec3561ec06a299f2be7bfd9e50e44b54d19fa1',
                                 'pq-7c25-live-source-data.py': 'e7861fe94308c276c02d2dd74ad2e3d99c50ab5d31beea2574658784283fdccb',
                                 'pq-7c25-native-source-dependencies.py': 'ab348dc0f8995ed756c8e66fb197a07c95e2833e55f9e44536a2e13af81dbe60',
                                 'pq-7c25-source-qualification.py': 'b28e9238e8ee88104e8cf8796a9e277cb8d6824a4e6d1b86b4d7aff65aec1e39',
                                 'pq-bounded-sender-backend.py': 'add2f9a3b9e3458b660aac27ab2b2556425b4b283d11322284100df74f8c65da',
                                 'pq-commit-observation.py': '4033dea236ee7536e2bc4fab74655e0ec9317564ec10516e47d599ccafa64cc0',
                                 'pq-d24-source-readback.py': 'd20e90967a871161d02a3dbee1632480adfb0d7ddd28f47ac7dbc2f1d18351c3',
                                 'pq-finalize-observation.py': 'fa0b57a5a773a602a77ade256e5186ec81ee55e52645ab919f581b16c4ed2e4b',
                                 'pq-finalize-trace-readback.py': '6b88b499745d2a3fe7cdcc1e690ca116a4986fc81fe40876a55491886569d524',
                                 'pq-first-trial-source.py': '495a0614dc989db5c5eee157a3e5519459a90750821896a194073993c76dad7d',
                                 'pq-held-first100-source.py': 'b998101611780b28775f68b1d42c68b9ed7bfde3a0f7d4ea1b201e9c4876577a',
                                 'pq-held-input-footprint.py': '6c366519faf418570f456b44c5590a332fa1e085050e231bc19e4f77dcdd44ff',
                                 'pq-hop-byte-accounting.py': '175a33b2ad39dd60afe50bb72b00df0699ed2f81de4d026e5d11240be1646aff',
                                 'pq-independent-load.py': '03076b8d956d19d2a31a459f6011cc281d7db2d8a9e4b510dc692fa3db863da1',
                                 'pq-independent-scheduler.py': '9ec73d1e63b2b50470d8d6bebeceedf5caf6b66a5df265766993de60a3c8a928',
                                 'pq-initialization-measurements.py': 'a5dd93bc0be164f1d3b38b1962037e5ccb7f9a68bd9051b651fba2ff2ba8e917',
                                 'pq-initialization-readback.py': 'dc09c24664e5acc3779943d3893b56ba2c64e2766670f0d6eb2b9f6cc5d71c14',
                                 'pq-live-materials-transport.py': '62f711b382b569ed04f2646a123617a29574a01f3b9679dbe8380cb510721d37',
                                 'pq-live-request-observation-readback.py': '3ff841f013cd0956253d415da79485265a52b63d2a5419d16d8cede6a74a0b01',
                                 'pq-lossless-source-data.py': '43cd58a84b361162f637586f391782ea65ffa6fcb5152e6bc515fd2cd3ba075c',
                                 'pq-network-window.py': '83fe26e6f53d4b8ae7d5f18a3b9f7aff2b44dc3117642155bab8d264632e7d28',
                                 'pq-node-startup-measurements.py': '3b6e5a3b27ec0d1bc18f9469c961b23c9dedaf960928b0f9dbfd77de78115045',
                                 'pq-normal-leg-stages.py': '5b9d1bcd6ba619bde7824bad72e6064632a429c1dba5264e6a4730ce7c40f031',
                                 'pq-normal-leg-trace.py': '43d2a2059df8933e57e5f6709376bef274f4bc480e08c81300a8c26da6c69121',
                                 'pq-normal-live-reader.py': '2b7a9d175eb2bffcf44194c505a847e58f3fed4d07c4e6d3497462fa3d940aa4',
                                 'pq-normal-live-source-data.py': '969610212a6fbed759d5a516a0c294bc4f796046e4755119780668b2cd837f6b',
                                 'pq-normal-paired-runtime.py': 'e0257f223d0a2f7732bf9cac58e170365249137b86200a286aa3de6f15c1716a',
                                 'pq-normal-process-lab.py': 'eb2a3aadcf179fc3e6745a0a87cea5364873e3a1db36b05eeafca75f6e20f33c',
                                 'pq-owned-header-capture.py': 'f5a03c7fbe7c1048d045986fbdd00f6e306d2025b53b41adeaf6fd8e06301bcd',
                                 'pq-owned-storage-window.py': '67e96cda53201b32b0ab1ca10707abb5e885645b51cbceaf2f3c8c77ac81f7c3',
                                 'pq-paired-linux-window.py': 'b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2',
                                 'pq-preload-initialization.py': 'f6fbc37c6b97ca6831c81c39a08d8213e00c1093e24b980ee3653edfb67d3f7d',
                                 'pq-public-owner-backend.py': '4200c349e57ebd960ff0049e699fbef3310703fdd39f0fe10d0c5fbbf2494787',
                                 'pq-public-owner-failure-readback.py': '69f83924ea16a8a55f082882f0b192b619adf8296bc7fb9db747728060270792',
                                 'pq-public-owner-parent-readback.py': 'e042344d5e5d017f5f5e5ab68c098f2d8f36c1c4bfb0729f346f9e7e7b2c9376',
                                 'pq-public-owner-transport.py': '84912d2b4049304e7f16f3d390162b1dc0fe02bdb2d862ff0b8ed76f93128437',
                                 'pq-public-proof-readback.py': 'a7382d98e2bbad6b8034850a54960319af7ff44dd26839419332f2414edf7552',
                                 'pq-rpc-measurements.py': '610e634faf55f3d5fced1a1037139600019bc61175f9e79cc3d7209127f73ed3',
                                 'pq-runtime-hardware.py': '8eada64f9eb260a950e194d05ba48402a0febf7bd5584f924167d7ba263209e9',
                                 'pq-same-runner-controller.py': '5dce480341899ffe89ed2f3cbdf45fb84cf12b88d3f8a29849d63dcea93b19a4',
                                 'pq-same-runner-original-adapter.py': 'b8c9734410e198a36192be30dfcb60b327891fcfd4537501bd26bbd572330e31',
                                 'pq-same-runner-pair-producer.py': '0287dad69b1ae9b4a3d1202e12b51aa487bfd98ae1535a6709659b59b0d545fc',
                                 'pq-same-runner-pair-readback.py': '5a0e4f492f91cf094448355d2d9952d5e189d072e703907d365c9cfcaef9eaba',
                                 'pq-same-runner-workflow.py': '32320c0c547bce4150f49d431d98a3ef3a18f07916fee362a5cffcb1490cb497',
                                 'pq-staged-harness-controls.py': '57f572371bb14aa655aa91ef7ca4232fe521c9cb43a10068af112d821ef0356d',
                                 'pq-staged-independent-scheduler.py': '81a201d479005456757e040fcb162e14c79cbe6c8000955694aebb66f34520f3'},
                    'tools': '4c181c5814697c5eec0217f56d6688da73e36435',
                    'toolsCI': {'branch': 'codex/perf-pair-tools-afterc697-guard-ci-20261121',
                                'event': 'workflow_dispatch',
                                'job': 136799550879,
                                'run': 44888699186,
                                'source': '4c181c5814697c5eec0217f56d6688da73e36435'},
                    'toolsTree': 'e80870407939a9a1eb3259681346b9c6de1d0217'},
          'before': {'go': 'go1.26.11',
                     'source': '59f7885d11bd3eeb5d27dce7232779aae480a806',
                     'sourceQualification': {'job': 132418666724,
                                             'requiredSteps': ['Check reachable vulnerabilities in the eight '
                                                               'production runtime commands',
                                                               'Verify Linux window controls without '
                                                               'starting a node',
                                                               'Verify complete state bridge and sponsor '
                                                               'continuity',
                                                               'Qualify original Finalize phase observation '
                                                               'tests',
                                                               'Verify prepared signing and held proof '
                                                               'sessions on original inputs',
                                                               'Retain original held session public test '
                                                               'evidence',
                                                               'Verify exact optional live getter '
                                                               'composition without enabling a carrier',
                                                               'Preserve only public optional live source '
                                                               'evidence'],
                                             'run': 43585389405,
                                             'runtimePermissionGranted': False,
                                             'source': '59f7885d11bd3eeb5d27dce7232779aae480a806',
                                             'sourceOnlyQualified': True,
                                             'sourceTree': 'f7d7cf8f6df57d931b2f15bb622405764de27d6b'},
                     'sourceTree': 'f7d7cf8f6df57d931b2f15bb622405764de27d6b',
                     'supplier': '5a49f5c91452604dffb910df736702b3b9df2562',
                     'supplierTree': '08747364c24c065bf2b13527c210625d7ec95fba',
                     'toolPins': {'consensus-linux-cohort.py': 'ff30eee6a3d9990d31b30096191fb0637e5304b5d84d0390c144a0091a586d8d',
                                  'network-layer-accounting.py': '1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635',
                                  'owned-tcp-accounting.py': '612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440',
                                  'pq-1695-source-qualification.py': 'b553028656b038b18b698db094ec3561ec06a299f2be7bfd9e50e44b54d19fa1',
                                  'pq-7c25-live-source-data.py': 'e7861fe94308c276c02d2dd74ad2e3d99c50ab5d31beea2574658784283fdccb',
                                  'pq-7c25-native-source-dependencies.py': 'ab348dc0f8995ed756c8e66fb197a07c95e2833e55f9e44536a2e13af81dbe60',
                                  'pq-7c25-source-qualification.py': 'b28e9238e8ee88104e8cf8796a9e277cb8d6824a4e6d1b86b4d7aff65aec1e39',
                                  'pq-bounded-sender-backend.py': 'add2f9a3b9e3458b660aac27ab2b2556425b4b283d11322284100df74f8c65da',
                                  'pq-commit-observation.py': '4033dea236ee7536e2bc4fab74655e0ec9317564ec10516e47d599ccafa64cc0',
                                  'pq-d24-source-readback.py': 'd20e90967a871161d02a3dbee1632480adfb0d7ddd28f47ac7dbc2f1d18351c3',
                                  'pq-finalize-observation.py': 'fa0b57a5a773a602a77ade256e5186ec81ee55e52645ab919f581b16c4ed2e4b',
                                  'pq-finalize-trace-readback.py': '6b88b499745d2a3fe7cdcc1e690ca116a4986fc81fe40876a55491886569d524',
                                  'pq-first-trial-source.py': '495a0614dc989db5c5eee157a3e5519459a90750821896a194073993c76dad7d',
                                  'pq-held-first100-source.py': '12859c8b965a42a73c125f257ac945e87a81c9ed8c90f0bc82728bdd79e37c24',
                                  'pq-held-input-footprint.py': '6c366519faf418570f456b44c5590a332fa1e085050e231bc19e4f77dcdd44ff',
                                  'pq-hop-byte-accounting.py': '175a33b2ad39dd60afe50bb72b00df0699ed2f81de4d026e5d11240be1646aff',
                                  'pq-independent-load.py': '03076b8d956d19d2a31a459f6011cc281d7db2d8a9e4b510dc692fa3db863da1',
                                  'pq-independent-scheduler.py': '9ec73d1e63b2b50470d8d6bebeceedf5caf6b66a5df265766993de60a3c8a928',
                                  'pq-initialization-measurements.py': 'a5dd93bc0be164f1d3b38b1962037e5ccb7f9a68bd9051b651fba2ff2ba8e917',
                                  'pq-initialization-readback.py': 'dc09c24664e5acc3779943d3893b56ba2c64e2766670f0d6eb2b9f6cc5d71c14',
                                  'pq-live-materials-transport.py': '62f711b382b569ed04f2646a123617a29574a01f3b9679dbe8380cb510721d37',
                                  'pq-live-request-observation-readback.py': '3ff841f013cd0956253d415da79485265a52b63d2a5419d16d8cede6a74a0b01',
                                  'pq-lossless-source-data.py': '43cd58a84b361162f637586f391782ea65ffa6fcb5152e6bc515fd2cd3ba075c',
                                  'pq-network-window.py': '83fe26e6f53d4b8ae7d5f18a3b9f7aff2b44dc3117642155bab8d264632e7d28',
                                  'pq-node-startup-measurements.py': '3b6e5a3b27ec0d1bc18f9469c961b23c9dedaf960928b0f9dbfd77de78115045',
                                  'pq-normal-leg-stages.py': '5b9d1bcd6ba619bde7824bad72e6064632a429c1dba5264e6a4730ce7c40f031',
                                  'pq-normal-leg-trace.py': '43d2a2059df8933e57e5f6709376bef274f4bc480e08c81300a8c26da6c69121',
                                  'pq-normal-live-reader.py': '2b7a9d175eb2bffcf44194c505a847e58f3fed4d07c4e6d3497462fa3d940aa4',
                                  'pq-normal-live-source-data.py': '969610212a6fbed759d5a516a0c294bc4f796046e4755119780668b2cd837f6b',
                                  'pq-normal-paired-runtime.py': 'e0257f223d0a2f7732bf9cac58e170365249137b86200a286aa3de6f15c1716a',
                                  'pq-normal-process-lab.py': 'eb2a3aadcf179fc3e6745a0a87cea5364873e3a1db36b05eeafca75f6e20f33c',
                                  'pq-owned-header-capture.py': 'f5a03c7fbe7c1048d045986fbdd00f6e306d2025b53b41adeaf6fd8e06301bcd',
                                  'pq-owned-storage-window.py': '67e96cda53201b32b0ab1ca10707abb5e885645b51cbceaf2f3c8c77ac81f7c3',
                                  'pq-paired-linux-window.py': 'b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2',
                                  'pq-preload-initialization.py': 'f6fbc37c6b97ca6831c81c39a08d8213e00c1093e24b980ee3653edfb67d3f7d',
                                  'pq-public-owner-backend.py': '4200c349e57ebd960ff0049e699fbef3310703fdd39f0fe10d0c5fbbf2494787',
                                  'pq-public-owner-failure-readback.py': '69f83924ea16a8a55f082882f0b192b619adf8296bc7fb9db747728060270792',
                                  'pq-public-owner-parent-readback.py': 'e042344d5e5d017f5f5e5ab68c098f2d8f36c1c4bfb0729f346f9e7e7b2c9376',
                                  'pq-public-owner-transport.py': '84912d2b4049304e7f16f3d390162b1dc0fe02bdb2d862ff0b8ed76f93128437',
                                  'pq-public-proof-readback.py': 'a7382d98e2bbad6b8034850a54960319af7ff44dd26839419332f2414edf7552',
                                  'pq-rpc-measurements.py': '610e634faf55f3d5fced1a1037139600019bc61175f9e79cc3d7209127f73ed3',
                                  'pq-runtime-hardware.py': '8eada64f9eb260a950e194d05ba48402a0febf7bd5584f924167d7ba263209e9',
                                  'pq-same-runner-controller.py': '5dce480341899ffe89ed2f3cbdf45fb84cf12b88d3f8a29849d63dcea93b19a4',
                                  'pq-same-runner-original-adapter.py': 'b8c9734410e198a36192be30dfcb60b327891fcfd4537501bd26bbd572330e31',
                                  'pq-same-runner-pair-producer.py': '0287dad69b1ae9b4a3d1202e12b51aa487bfd98ae1535a6709659b59b0d545fc',
                                  'pq-same-runner-pair-readback.py': '5a0e4f492f91cf094448355d2d9952d5e189d072e703907d365c9cfcaef9eaba',
                                  'pq-same-runner-workflow.py': '32320c0c547bce4150f49d431d98a3ef3a18f07916fee362a5cffcb1490cb497',
                                  'pq-staged-harness-controls.py': '57f572371bb14aa655aa91ef7ca4232fe521c9cb43a10068af112d821ef0356d',
                                  'pq-staged-independent-scheduler.py': '81a201d479005456757e040fcb162e14c79cbe6c8000955694aebb66f34520f3'},
                     'tools': '7630e166bf02b73646553a15df5dc371a0be75d8',
                     'toolsCI': {'branch': 'codex/perf-pair-tools-before59f-guard-ci-20261121',
                                 'event': 'workflow_dispatch',
                                 'job': 136799547290,
                                 'run': 44888696640,
                                 'source': '7630e166bf02b73646553a15df5dc371a0be75d8'},
                     'toolsTree': '82367af09565ad1e7211e55707a59c5194311674'}},
 'schema': 'YNX-PERF-ORIGINAL-PAIR-BINDING/v1'}
_WINDOW_LEASE = threading.Lock()


def configured_adapters(factory):
    """Refuse before loading a driver, reading keys or creating any Window."""
    require(QUALIFIED_PAIR_BINDING is not None,
            'same-runner original source/Tools/CI pair binding NOT_SUPPLIED')
    adapters = factory(copy.deepcopy(QUALIFIED_PAIR_BINDING))
    require(set(adapters) == set(producer.reader.ARMS), 'both original arm adapters required')
    return adapters


def roots(paths):
    result = []
    for value in paths:
        path = Path(value)
        require(path.is_absolute() and path.resolve(strict=True) == path,
                'canonical existing original storage root required')
        if any(root == path or root in path.parents for root in result):
            continue
        result = [root for root in result if path not in root.parents]
        result.append(path)
    return tuple(result)


class OriginalDriverAdapter:
    """One-shot bridge; controller-owned qualification is deliberately explicit."""
    def __init__(self, driver, options, qualification_record, *, verify_qualification,
                 admit, storage_roots, source_metadata_reader=None):
        self.driver, self._run, self._window = driver, driver.run, driver.lab.Window
        require(isinstance(self._window, type) and self._window.__new__ is object.__new__,
                'unwrapped original Window class required; do not bypass another controller')
        self.options = copy.deepcopy(options)
        self._record = copy.deepcopy(qualification_record)
        self._verify, self._admission = verify_qualification, admit
        require(source_metadata_reader is None or callable(source_metadata_reader),
                'original source metadata transport must be callable')
        self._source_metadata_reader = source_metadata_reader
        self.storage_roots = roots(storage_roots)
        self.retained_roots = ()
        self.qualified = self.admitted = self.used = self.retired = False
        self.window = self.work = self.result = self.execution_error = None
        self.registration_error = None
        self.stop_results, self.stop_errors = [], []
        self.threads_before = set()
        self._lease = None
        self._validate_options()

    def _validate_options(self):
        expected = copy.deepcopy(self._record['configuration']['options'])
        require(expected['source'] == 'source' and expected['execute'] is False,
                'original non-executing controller plan required')
        expected.update(source=self.options.source, execute=True)
        require(vars(self.options) == expected
                and all(type(vars(self.options)[key]) is type(value) for key, value in expected.items())
                and self.options.commit == self._record['configuration']['source'],
                'original driver options differ from frozen arm configuration')
        roots((self.options.source,))

    def qualification_record(self):
        return copy.deepcopy(self._record)

    def qualify(self):
        self.qualified = self.admitted = False
        require(not self.used, 'original adapter already used; never retry UNKNOWN')
        self._validate_options()
        require(self._verify() == self._record, 'original source/Tools/CI qualification differs')
        self.qualified = True
        return self.qualification_record()

    def admit(self, retained_roots):
        self.admitted = False
        require(self.qualified and (not self.used or self.retired and self.execution_error is None),
                'original arm not qualified or not fully retired')
        self.retained_roots = roots((*self.storage_roots, *retained_roots))
        require(self._admission(self.retained_roots) is None,
                'original admission must raise on refusal')
        self.admitted = True

    def execute(self, register_work):
        require(self.qualified and self.admitted and not self.used and self.retained_roots,
                'one qualified, admitted original execution required')
        self._validate_options()
        require(_WINDOW_LEASE.acquire(blocking=False), 'another original Window bridge is active')
        self._lease = _WINDOW_LEASE
        self.used = True  # A failed registration/constructor is never retried.
        self.threads_before = set(threading.enumerate())
        original, owner = self._window, self
        execution_thread = threading.get_ident()
        calls = []

        class RegisteredWindow(original):
            def __init__(window, source, work, additional_storage=()):
                require(threading.get_ident() == execution_thread and not calls,
                        'one original Window on its owning execution thread required')
                calls.append(work)
                require(Path(source) == Path(owner.options.source), 'original Window source differs')
                owner.work = Path(work)
                try:
                    register_work(owner.work)
                except BaseException as error:
                    owner.registration_error = error
                    raise
                # No constructor/cache directory or child environment before
                # the durable fence returns successfully. Keep partial objects
                # too, so constructor failure cannot hide owned cleanup debt.
                owner.window = window
                storage = roots((*additional_storage, *owner.retained_roots))
                os.environ.pop('GH_TOKEN', None)
                os.environ.pop('GITHUB_TOKEN', None)
                original.__init__(window, source, work, additional_storage=storage)
                window.storage_roots = list(roots(window.storage_roots))
                owner.driver.lab.write_new(work/'public/FIRST100-HELD-CI.json', owner._record)

            def stop(window):
                try:
                    result = original.stop(window)
                except BaseException as error:
                    owner.stop_errors.append(error)
                    raise
                owner.stop_results.append(result)
                return result

        try:
            require(self.driver.run is self._run and self.driver.lab.Window is original,
                    'original driver/Window changed after adapter binding')
            self.driver.lab.Window = RegisteredWindow
            try:
                kwargs = {} if self._source_metadata_reader is None else dict(source_metadata_reader=self._source_metadata_reader)
                self.result = self._run(copy.deepcopy(self.options), **kwargs)
                require(len(calls) == 1 and self.registration_error is None,
                        'original driver did not propagate Window registration failure')
                return self.result
            finally:
                self.driver.lab.Window = original
        except BaseException as error:
            self.execution_error = error
            raise
        # Release only in retire(), after original cleanup evidence is checked.
        # Even a successful driver return may have an alive worker or observer.

    def _release_lease(self):
        if self._lease is not None:
            self._lease.release()
            self._lease = None

    def retire(self):
        require(self.used, 'original execution never entered')
        require(not self.retired, 'original retirement already consumed')
        if self.window is None:
            require(self.execution_error is not None, 'original Window missing without failure')
            # Registration failed before construction: no owned work to stop.
            # Never mark this arm retired/qualified for subsequent admission.
            self._release_lease()
            return []
        window = self.window
        if not self.stop_results or self.stop_results[-1] is not True:
            window.stop()  # Original owned cleanup only; no foreign PID scan here.
        require(not self.stop_errors and self.stop_results
                and all(value is True for value in self.stop_results),
                'original cleanup failed; preserve first cause and cleanup debt')
        children = [dict(pid=row['process'].pid, startTicks=row.get('startTicks'), process=row['process'])
                    for row in window.children]
        # The driver may raise after writing its receipt. Trust those original
        # bytes, never its mutable return dict or an invented cleanup success.
        try:
            receipt = producer.strict(producer.public_bytes(self.work/'public/receipt.json'))
        except FileNotFoundError as error:
            raise RuntimeError('original arm receipt missing; cleanup alone is not completion') from error
        producer.retired(receipt, children, self.threads_before)
        require(self.registration_error is None, 'original registration failure blocks successor')
        self.retired = True
        self._release_lease()
        return children
