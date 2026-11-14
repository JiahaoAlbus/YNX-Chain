"""Pure DATA codec controls only. No fake child, Root, init, process or network."""
import copy,hashlib,json,unittest
from qa_directory_capture import PREFIX,CaptureError,parse_directory_output,require_terminal_capture

RUN='qa-dir-'+'1'*32
def sample():
    def basic(i,role,flag,key):return {'node_id':i,'role':role,'supported_roles':{flag:True},'ed25519_identity_pubkey':key,'ip_addresses':['1.1.1.'+str(i)],'entry':{'hostname':'gateway.fixture.invalid','ws_port':9000,'wss_port':9001} if i==1 else None}
    def desc(i,key):return {'node_id':i,'description':{'host_information':{'keys':{'ed25519':key},'ip_address':['1.1.1.'+str(i)],'hostname':'gateway.fixture.invalid' if i==1 else None},'mixnet_websockets':{'ws_port':9000,'wss_port':9001 if i==1 else None},'network_requester':{'address':'synthetic-public-recipient@'+key,'uses_exit_policy':True} if i==2 else None}}
    nodes=[basic(1,'EntryGateway','entry','entry-public'),basic(2,'ExitGateway','exit_nr','exit-public')]
    descriptions=[desc(1,'entry-public'),desc(2,'exit-public')]
    body={'schema':'YNX_NYM_DIRECTORY_V1','basic':{'nodes':{'pagination':{'page':0,'size':2,'total':2},'data':nodes}},'described':{'pagination':{'page':0,'size':2,'total':2},'data':descriptions},'epoch':{}}
    return body
def encoded(body=None):
    body=sample() if body is None else body;raw=json.dumps(body,separators=(',',':')).encode()
    frame={'schema':'YNX_NYM_QA_DIRECTORY_CANDIDATES_V1','runID':RUN,'payloadSHA256':hashlib.sha256(raw).hexdigest(),'entryNodeIDs':[1],'exitNodeIDs':[2]}
    return raw+b'\n',frame
def stderr(frame):return PREFIX+json.dumps(frame,separators=(',',':')).encode()+b'\n'

class CodecControls(unittest.TestCase):
    def test_data_roundtrip_is_not_a_typed_crypto_or_authority_fixture(self):
        raw,frame=encoded();value=parse_directory_output(raw,stderr(frame),RUN)
        self.assertEqual(value.entry_node_ids,(1,));self.assertEqual(value.exit_node_ids,(2,))
        self.assertEqual(value.value,sample())
    def test_nonce_and_hash(self):
        raw,frame=encoded()
        with self.assertRaises(CaptureError):parse_directory_output(raw,stderr(frame),'qa-dir-'+'2'*32)
        frame['payloadSHA256']='0'*64
        with self.assertRaises(CaptureError):parse_directory_output(raw,stderr(frame),RUN)
    def test_exact_raw_bytes_not_json_normalization(self):
        raw,frame=encoded();alternate=json.dumps(sample(),indent=2).encode()+b'\n'
        with self.assertRaises(CaptureError):parse_directory_output(alternate,stderr(frame),RUN)
        with self.assertRaises(CaptureError):parse_directory_output(raw[:-1],stderr(frame),RUN)
    def test_duplicate_or_unterminated_marker(self):
        raw,frame=encoded()
        with self.assertRaises(CaptureError):parse_directory_output(raw,stderr(frame)*2,RUN)
        with self.assertRaises(CaptureError):parse_directory_output(raw,stderr(frame)[:-1],RUN)
        duplicate=stderr(frame).replace(b'"runID":',b'"runID":"ignored","runID":')
        with self.assertRaises(CaptureError):parse_directory_output(raw,duplicate,RUN)
    def test_id_type_role_and_overlap(self):
        raw,original=encoded()
        for changes in [{'entryNodeIDs':[True]},{'entryNodeIDs':[1,1]},{'entryNodeIDs':[2]},{'exitNodeIDs':[1]},{'entryNodeIDs':[999]}]:
            frame=copy.deepcopy(original);frame.update(changes)
            with self.assertRaises(CaptureError):parse_directory_output(raw,stderr(frame),RUN)
    def test_missing_join_and_non_tls_or_non_policy_cannot_be_promoted(self):
        for kind in ['missing-desc','non-tls','policy-false']:
            body=sample()
            if kind=='missing-desc':body['described']['data'].pop();body['described']['pagination']={'total':1,'size':1,'page':0}
            elif kind=='non-tls':body['described']['data'][0]['description']['mixnet_websockets']['wss_port']=None
            else:body['described']['data'][1]['description']['network_requester']['uses_exit_policy']=False
            raw,frame=encoded(body)
            with self.assertRaises(CaptureError):parse_directory_output(raw,stderr(frame),RUN)
    def test_partial_or_unreaped_capture_and_late_are_reject_only(self):
        good=[0,True,True,False,False,100,1000,99,999]
        for slot,value in [(0,None),(0,1),(1,False),(2,False),(3,True),(4,True),(7,100),(8,1000)]:
            fields=good.copy();fields[slot]=value
            with self.assertRaises(CaptureError):require_terminal_capture(*fields)

if __name__=='__main__':unittest.main()
