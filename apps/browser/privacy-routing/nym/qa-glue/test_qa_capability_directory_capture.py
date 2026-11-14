"""V2 capability DATA boundaries, not a Recipient-codec or live-child fixture."""
import hashlib,json,unittest
from qa_capability_directory_capture import PREFIX,CaptureError,parse_directory_output
from test_qa_directory_capture import RUN,sample

def encode(body,entries=(1,),exits=(2,)):
    raw=json.dumps(body,separators=(',',':')).encode()
    frame={'schema':'YNX_NYM_QA_CAPABILITY_CANDIDATES_V2','runID':RUN,
           'payloadSHA256':hashlib.sha256(raw).hexdigest(),'entryNodeIDs':list(entries),'exitNodeIDs':list(exits)}
    return raw+b'\n',frame

def stderr(frame):return PREFIX+json.dumps(frame,separators=(',',':')).encode()+b'\n'

class CapabilityCodecControls(unittest.TestCase):
    def test_rewarded_roles_do_not_replace_capability_or_exact_frame_membership(self):
        body=sample();body['basic']['nodes']['data'][0]['role']='Inactive';body['basic']['nodes']['data'][1]['role']='EntryGateway'
        raw,frame=encode(body);parsed=parse_directory_output(raw,stderr(frame),RUN)
        self.assertEqual(parsed.entry_node_ids,(1,));self.assertEqual(parsed.exit_node_ids,(2,))
        body['basic']['nodes']['data'][0]['supported_roles']['entry']=False
        raw,frame=encode(body)
        with self.assertRaises(CaptureError):parse_directory_output(raw,stderr(frame),RUN)

    def test_official_dual_service_pool_overlap_is_data_not_ambiguous_identity(self):
        body=sample();node=body['basic']['nodes']['data'][0];node['supported_roles']['exit_nr']=True
        body['described']['data'][0]['description']['network_requester']={'address':'synthetic-public-recipient@entry-public','uses_exit_policy':True}
        raw,frame=encode(body,exits=(1,2));parsed=parse_directory_output(raw,stderr(frame),RUN)
        self.assertIn(1,parsed.entry_node_ids);self.assertIn(1,parsed.exit_node_ids)

    def test_v1_or_extra_scope_fields_cannot_be_mistaken_for_v2_cohort(self):
        raw,frame=encode(sample());old=dict(frame,schema='YNX_NYM_QA_DIRECTORY_CANDIDATES_V1')
        with self.assertRaises(CaptureError):parse_directory_output(raw,stderr(old),RUN)
        with self.assertRaises(CaptureError):parse_directory_output(raw,stderr(dict(frame,ready=True)),RUN)
        with self.assertRaises(CaptureError):parse_directory_output(raw,stderr(frame).replace(PREFIX,b'YNX_NYM_QA_DIRECTORY_CANDIDATES_V1 '),RUN)

if __name__=='__main__':unittest.main()
