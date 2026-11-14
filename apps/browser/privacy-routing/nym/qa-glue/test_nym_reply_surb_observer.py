import hashlib
import json
import unittest
from nym_reply_surb_observer import ReplySurbObserver, RUST_LOG

class ReplySurbControls(unittest.TestCase):
    address = 'A'*32 + '.' + 'B'*32 + '@' + 'C'*32
    prefix = '2026-11-08T00:00:00Z '
    sender = 'common/client-core/src/client/replies/reply_controller/sender_controller.rs:80: '
    def make(self):
        observer = ReplySurbObserver('f'*32)
        observer.provider_sha256 = hashlib.sha256(self.address.encode()).hexdigest()
        return observer
    def test_exact_reconstructed_request_and_local_enqueue_are_not_delivery_or_stream_proof(self):
        o = self.make()
        request = o.feed(self.prefix+'DEBUG common/client-core/src/client/received_buffer.rs:320: received request for 50 additional reply SURBs from '+self.address)
        sent = o.feed(self.prefix+'TRACE '+self.sender+'sent 50 reply SURBs to '+self.address)
        self.assertEqual(request['requestedCount'], 50); self.assertTrue(request['selectedProvider'])
        self.assertEqual(sent['count'], 50); self.assertFalse(sent['remoteDeliveryProven'])
        self.assertEqual(sent['connectionAssociation'], 'NOT_PROVEN')
        self.assertNotIn(self.address, json.dumps([request,sent]))
        self.assertNotIn(o.provider_sha256, json.dumps([request,sent]))
    def test_wrong_peer_or_malformed_payload_cannot_be_selected(self):
        o = self.make()
        other = self.address.replace('C', 'D')
        event = o.feed(self.prefix+'DEBUG common/client-core/src/client/received_buffer.rs:320: received request for 3 additional reply SURBs from '+other)
        self.assertFalse(event['selectedProvider'])
        for message in ['sent 101 reply SURBs to '+self.address, 'sent 3 reply SURBs to '+self.address+' PRIVATE KEY', 'sent 3 reply SURBs to '+self.address+'\nsecret']:
            self.assertIsNone(o.feed(self.prefix+'TRACE '+self.sender+message))
        self.assertIsNone(o.feed(self.prefix+'DEBUG common/client-core/src/client/received_buffer.rs:320: received request for 4294967296 additional reply SURBs from '+self.address))
    def test_cap_stops_coverage_without_storing_raw_failure_or_inventing_nr_error(self):
        o = self.make(); o.events = 256
        line = self.prefix+'WARN '+self.sender+'failed to send additional surbs to '+self.address+' - payload-secret'
        self.assertIsNone(o.feed(line))
        self.assertEqual(o.first_failure['classification'], 'coverage_incomplete')
        self.assertNotIn('secret', json.dumps(o.first_failure)); self.assertEqual(o.events,256)
    def test_generation_has_no_provider_attribution_and_logging_change_is_only_scoped(self):
        o = self.make()
        event = o.feed(self.prefix+'DEBUG common/client-core/src/client/real_messages_control/message_handler.rs:545: Sending additional reply SURBs with packet type Mix')
        self.assertEqual(event['providerAssociation'],'NOT_OBSERVABLE')
        self.assertIn('sender_controller=trace',RUST_LOG)
        self.assertNotIn('received_buffer=trace',RUST_LOG)

if __name__ == '__main__': unittest.main()
