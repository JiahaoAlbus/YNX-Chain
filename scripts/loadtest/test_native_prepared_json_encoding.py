"""Private snapshot encoder pair: actual signed Go streams, never network TPS."""
import copy,importlib.util,json,os,subprocess,types,unittest
from pathlib import Path

HERE=Path(__file__).parent

def load(name):
    p=HERE/(name+'.py');spec=importlib.util.spec_from_file_location(name,p)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

e=load('native-stream-evidence');controller=load('supply-linux-window')

class PreparedJSONEncodingTests(unittest.TestCase):
    def test_original_eleven_pair_recipes_remain_exact(self):
        # Frozen accepted source, compared as code only; no old run data.
        old=types.ModuleType('old_controller');old.__file__=str(HERE/'supply-linux-window.py')
        raw=subprocess.check_output(['git','show','eda90aba3727268a602001c63b1679f0db133f34:scripts/loadtest/supply-linux-window.py'])
        exec(compile(raw,old.__file__,'exec'),old.__dict__)
        self.assertEqual(len(old.STREAM_PAIRS),11)
        for kind in old.STREAM_PAIRS:
            with self.subTest(kind=kind):self.assertEqual(old.pair_recipe(kind),controller.pair_recipe(kind))

    def test_actual_both_signed_streams_and_private_encoder_binding(self):
        value=os.environ.get('YNX_NATIVE_PREPARED_JSON_PUBLIC_FIXTURE_DIR')
        self.assertTrue(value,'both actual Go public fixtures are mandatory')
        for mode in controller.PREPARED_JSON_ENCODINGS:
            root=Path(value)/mode
            scope=json.loads((root/'PUBLIC_FIXTURE_SCOPE.json').read_bytes())
            plan=json.loads((root/'transactions-result.json.streaming-plan.json').read_bytes())
            with self.subTest(mode=mode):
                self.assertFalse(scope['independentBFTProof']);self.assertEqual(scope['preparedJSONEncoding'],mode)
                self.assertEqual(plan['nativePrefix']['preparedJSONEncoding'],mode)
                self.assertTrue(plan['nativePrefix']['replayTiming']);self.assertNotIn('clientProcs2',plan['nativePrefix'])
                self.assertEqual(plan['profile'],'scoped_native_prefix_stream8_prepared_grouped_snapshot_'+('original_json' if mode=='original-json' else 'fee_json')+'_v1')
                got=e.prepared_json_encoding_measurements(scope,mode)
                self.assertGreater(got['actualPreparedEncodes'],0);self.assertFalse(got['stateHashBackendChanged'])
                phases=scope['durableReadback']['prefixReplay']['workPhases']
                e.certificate_publish_measurements(phases,32<<20,required=True,native_clone=True,prepared_native=True)
                self.assertTrue(e.suffix_replay_measurements(phases,True)['localReplayOnly'])
                manifest=(root/'network-manifest.json').read_bytes()
                initial=json.loads((root/'transactions.json').read_bytes())['transactions']
                proof=e.verify_streams(root,scope['runtimeNetworkRoot'],scope['runtimeOutput'],manifest,initial,scope['intents'],scope['terminalStream'],scope['latest'],scope['rounds'],64<<20)
                self.assertEqual(proof['validatedRecords'],102)
                for fault in ('top','constructor','absent','zero','bool','errors','duration','coverage','runtime','scheduler','hash','unselected'):
                    bad=copy.deepcopy(scope);prefix=bad['durableReadback']['prefixReplay'];encode=prefix['workPhases']['preparedEncodeDetails']
                    if fault=='top':bad['nativePreparedJSONEncoding']='unknown'
                    if fault=='constructor':prefix['preparedJSONEncoding']='unknown'
                    if fault=='absent':encode.pop('jsonEncode')
                    if fault=='zero':encode['jsonEncode']['calls']=0
                    if fault=='bool':encode['jsonEncode']['calls']=True
                    if fault=='errors':encode['jsonEncode']['errors']=1
                    if fault=='duration':encode['jsonEncode']['durationNs']=0
                    if fault=='coverage':prefix['workPhases']['certificatePublishDetails']['preparedNativeAccepted']=True
                    if fault=='runtime':bad['gomaxprocs']=2
                    if fault=='scheduler':bad['clientProcs2']=True
                    if fault=='hash':bad['nativeCachedFeeJSON']=True
                    with self.subTest(mode=mode,fault=fault),self.assertRaises(RuntimeError):e.prepared_json_encoding_measurements(bad,'' if fault=='unselected' else mode)

if __name__=='__main__':unittest.main()
