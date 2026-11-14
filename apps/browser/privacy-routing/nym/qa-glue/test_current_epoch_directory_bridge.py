"""New dual-executor/once/budget DATA controls. No vendor or network process."""
import json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
import current_epoch_directory_bridge as bridge

class Failed(Exception):pass
class R2:
    Failed=Failed
    @staticmethod
    def write_new(path,value):path.write_text(json.dumps(value))
    @staticmethod
    def redact(value):return value
class Base:
    def check(self):pass
    def https(self,label):self.rfc.append(label)
    def event(self,label,value):self.events.append((label,value))
    def run(self,label,command,seconds):
        self.calls.append(command)
        (self.out/'ddg-public.body').write_bytes(b'public CAPTCHA anomaly-modal')
        return json.dumps(dict(response_code=202,ssl_verify_result=0,proxy_used=1,remote_ip='127.0.0.1',time_total=.1))

class Controls(unittest.TestCase):
    def obj(self,scope=100,route=100):
        C=bridge.install(Base,R2,Path('/does-not-execute'))
        value=C();value.end=time.monotonic()+scope;value.runtime_expiry=time.time()+route
        value.port=63781;value.calls=[];value.events=[];value.rfc=[];value.children=[]
        value.out=Path(tempfile.mkdtemp(prefix='epoch-bridge-data-control-',dir=bridge.glue.PR/'nym-epoch-diagnostic-20261108'))
        return value
    def test_both_immutable_real_artifact_pins_without_start(self):
        directory,runtime=bridge.pinned_binaries()
        self.assertEqual(bridge.glue.sha(directory),bridge.DIRECTORY_SHA)
        self.assertEqual(bridge.glue.sha(runtime),bridge.glue.RUNTIME_SHA)
        self.assertNotEqual(directory,runtime)
    def test_second_directory_rejected_before_factory_or_child(self):
        value=self.obj();value.directory_count=1
        with patch.object(bridge,'pinned_binaries',side_effect=AssertionError('must-not-be-called')):
            with self.assertRaisesRegex(Failed,'only-one-fresh-directory'):value.directory('directory-second')
        self.assertEqual(value.calls,[])
    def test_scope_budget_omits_search_without_request(self):
        value=self.obj(scope=69);value.https('rfc-1')
        self.assertEqual(value.rfc,['rfc-first']);self.assertEqual(value.calls,[])
        self.assertEqual(value.events[0][0],'DDG-NOT_RUN')
    def test_route_budget_omits_search_without_request(self):
        value=self.obj(route=69);value.https('rfc-1')
        self.assertEqual(value.calls,[]);self.assertEqual(value.events[0][0],'DDG-NOT_RUN')
    def test_one_fixed_search_captcha_is_site_data_not_route_permission(self):
        value=self.obj();value.https('rfc-1');self.assertEqual(len(value.calls),1)
        command=value.calls[0];self.assertEqual(command[-1],'https://duckduckgo.com/?q=YNX%20browser%20privacy')
        self.assertNotIn('-k',command);self.assertEqual(command[command.index('--retry')+1],'0')
        self.assertEqual(command[command.index('--max-redirs')+1],'0')
        result=json.loads((value.out/'ddg-public-result.json').read_text())
        self.assertEqual(result['siteStatus'],'CAPTCHA');self.assertTrue(result['siteResultDoesNotGrantOrRevokeRouteSafety'])
    def test_optional_epoch_log_list_missing_fields_or_wrong_types_never_raise(self):
        for raw in [b'[]',b'{"schema":"YNX_NYM_QA_EPOCH_DIAGNOSTIC_V1"}',b'{"reason":[]}',b'null',b'{',b'['*1100+b'0'+b']'*1100]:
            self.assertIsNone(bridge.public_epoch_summary(raw))
        fixture=bridge.glue.PR/'nym-epoch-diagnostic-20261108/metadata-20261108T023808Z-87966b/public-epoch-diagnostic.json'
        value=json.loads(fixture.read_text());value['runID']='not-a-permit'
        self.assertEqual(bridge.public_epoch_summary(json.dumps(value).encode())['basicAbsoluteEpochID'],34881)
        value['basicAbsoluteEpochID']=True
        self.assertIsNone(bridge.public_epoch_summary(json.dumps(value).encode()))

if __name__=='__main__':unittest.main()
