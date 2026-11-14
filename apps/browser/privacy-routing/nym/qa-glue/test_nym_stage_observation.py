"""New socketpair/fragmented-EOF controls, not a real proxy/NR/TLS-success proof."""
import http.client,io,json,socket,threading,time,types,unittest
from nym_https_stage_probe import HeaderReader,PhaseFailure,RFC_BYTES,SocketDeadlines,over_connected_proxy,read_rfc_body,verified_context
from nym_runtime_stage_observer import RuntimeStageObserver,install_observed_child

class StageControls(unittest.TestCase):
    def test_actual_completed_result_profile_field_is_bound_to_original_intent(self):
        from diagnose_existing_request_once import reconciled_profile_id
        profile='ynx-route-bundled-12345678-1234-1234-1234-123456789abc'
        result={'newProfileID':profile};intent={'profileID':profile,'state':'UNKNOWN'}
        self.assertEqual(reconciled_profile_id(result,intent),profile)
        with self.assertRaisesRegex(RuntimeError,'completed-profile-intent-binding'):
            reconciled_profile_id(result,dict(intent,profileID=profile[:-1]+'d'))
        with self.assertRaises((KeyError,RuntimeError)):
            reconciled_profile_id({'profileID':profile},intent)
    def test_truncated_length_with_both_markers_is_not_verified(self):
        class Wire:
            def makefile(self,*args,**kwargs):
                return io.BytesIO(b'HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\nRFC 1928 SOCKS')
        response=http.client.HTTPResponse(Wire());response.begin()
        with self.assertRaisesRegex(PhaseFailure,'HTTP_BODY_TRUNCATED'):
            read_rfc_body(response,lambda:None)
        self.assertGreater(response.length,0)
        response.close()
        class WrongDocument:
            def makefile(self,*args,**kwargs):
                data=b'RFC 1928 SOCKS'+b'x'*(RFC_BYTES-len(b'RFC 1928 SOCKS'))
                return io.BytesIO(b'HTTP/1.1 200 OK\r\nContent-Length: '+str(len(data)).encode()+b'\r\n\r\n'+data)
        response=http.client.HTTPResponse(WrongDocument());response.begin()
        with self.assertRaisesRegex(PhaseFailure,'HTTP_BODY_DOCUMENT_PIN_MISMATCH'):
            read_rfc_body(response,lambda:None)
        self.assertEqual(response.length,0);response.close()
    def test_expired_guard_adopts_actual_detached_ssl_socket_and_closes_it(self):
        left,right=socket.socketpair();guard=SocketDeadlines(left,time.monotonic()+.03)
        tls=verified_context().wrap_socket(left,server_hostname='www.rfc-editor.org',do_handshake_on_connect=False)
        self.assertEqual(left.fileno(),-1);self.assertGreaterEqual(tls.fileno(),0)
        try:
            guard.thread.join(timeout=.3);self.assertFalse(guard.thread.is_alive())
            with self.assertRaisesRegex(PhaseFailure,'ABSOLUTE_REQUEST_DEADLINE'):guard.set_socket(tls)
            right.settimeout(.2);self.assertEqual(right.recv(1),b'')
        finally:guard.finish();tls.close();left.close();right.close()
    def test_current_error_after_event_cap_still_fails_owned_controller(self):
        o=RuntimeStageObserver('c'*32);o.current_id=123;o.events=256
        class Original:
            def __init__(self):self.runtime=True;self.owner=types.SimpleNamespace();self.lock=threading.Lock()
            def line(self,text):raise AssertionError('unapproved raw error reached lifecycle logger')
        r2=types.SimpleNamespace(Child=Original,stamp=lambda:{'monotonic':1})
        install_observed_child(r2,o);child=r2.Child()
        child.line('2026-11-08T00:00:00Z ERROR common/socks5-client-core/src/socks/mixnet_responses.rs:82: Network requester failed on connection id 123 with error: Domain private.invalid failed filter check')
        self.assertEqual(child.owner.requester_failure['fixedReason'],'NR_CURRENT_CONNECTION_ERROR')
        self.assertEqual(child.owner.requester_failure['classification'],'filter_or_dns_rejected')
        self.assertNotIn('private',json.dumps(child.owner.requester_failure));self.assertEqual(o.events,256)
        self.assertEqual(getattr(child,'stage_events',[]),[])
    def probe_peer(self,stall=False):
        left,right=socket.socketpair();events=[];hello_counts=[];peer_errors=[]
        def exact(n):
            data=b''
            while len(data)<n:
                chunk=right.recv(n-len(data))
                if not chunk:return data
                data+=chunk
            return data
        def peer():
            try:
                self.assertEqual(exact(3),b'\x05\x01\x00')
                right.sendall(b'\x05');right.sendall(b'\x00')
                head=exact(5);self.assertEqual(head[:4],b'\x05\x01\x00\x03')
                self.assertEqual(exact(head[4]),b'www.rfc-editor.org');self.assertEqual(exact(2),b'\x01\xbb')
                for part in [b'\x05',b'\x00\x00',b'\x01\x00',b'\x00\x00\x00\x00\x00']:right.sendall(part)
                # Count/drop TLS records, never store/hash any record bytes.
                hello_counts.append(len(right.recv(4096)))
                if stall:time.sleep(.5)
            except BaseException as error:peer_errors.append(type(error).__name__)
            finally:right.close()
        thread=threading.Thread(target=peer);thread.start();began=time.monotonic()
        try:
            with self.assertRaises(PhaseFailure):over_connected_proxy(left,lambda event,**fields:events.append(dict(event=event,**fields)),began+(.2 if stall else 3))
        finally:left.close();thread.join(timeout=1)
        self.assertFalse(thread.is_alive());self.assertEqual(peer_errors,[]);self.assertGreater(hello_counts[0],0)
        self.assertIn('socks_local_ack',[x['event'] for x in events]);self.assertNotIn('tls_verified',[x['event'] for x in events])
        self.assertNotIn('http_headers',[x['event'] for x in events]);self.assertEqual(events[-1]['tlsSuccessProof'],'NO_TLS_SUCCESS_PROOF')
        return events,time.monotonic()-began
    def test_fragmented_ack_then_tls_eof_is_not_tls_or_http_success(self):
        events,_=self.probe_peer();self.assertEqual(events[-1]['phase'],'tls_handshake')
        self.assertIn(events[-1]['code'],['TLS_NEGOTIATION_FAILED','SOCKET_IO_FAILED'])
    def test_absolute_deadline_ends_stalled_tls_not_extended_by_local_ack(self):
        events,elapsed=self.probe_peer(stall=True);self.assertLess(elapsed,1)
        self.assertEqual(events[-1]['code'],'ABSOLUTE_REQUEST_DEADLINE')
    def test_default_ca_hostname_and_cumulative_header_cap_are_required(self):
        context=verified_context();self.assertTrue(context.check_hostname)
        reader=HeaderReader(io.BytesIO(b'X: '+b'a'*16384+b'\r\n'))
        with self.assertRaisesRegex(PhaseFailure,'HTTP_HEADERS_LIMIT'):reader.readline(65536)
    def test_strict_debug_filter_counts_only_and_never_exports_identifiers_or_payload(self):
        o=RuntimeStageObserver('a'*32);prefix='2026-11-08T00:00:00Z '
        first=o.feed(prefix+'INFO common/socks5-client-core/src/socks/client.rs:499: Starting proxy for www.rfc-editor.org:443 (id: 123456789)')
        self.assertIn('connectionTagSHA256',first);self.assertNotIn('123456789',json.dumps(first))
        sent=o.feed(prefix+'DEBUG common/socks5/proxy-helpers/src/ordered_sender.rs:99: [349 bytes]\t127.0.0.1:63801 → local → mixnet → remote → www.rfc-editor.org:443. Local closed: false')
        self.assertEqual(sent['bytes'],349)
        reply=o.feed(prefix+'DEBUG common/client-core/src/client/received_buffer.rs:142: YNX_REPLY_DECRYPTED encrypted_bytes=1024')
        self.assertEqual(reply['connectionAssociation'],'not_proven')
        self.assertIsNone(o.feed(prefix+'DEBUG common/client-core/src/client/received_buffer.rs:425: received PRIVATE KEY payload-secret'))
        self.assertIsNone(o.feed(prefix+'ERROR other/source.rs:10: Cookie: session-secret'))
        response=o.feed(prefix+'ERROR common/socks5-client-core/src/socks/mixnet_responses.rs:82: Network requester failed on connection id 123456789 with error: Domain secret.invalid failed filter check')
        self.assertTrue(response['currentConnection']);self.assertEqual(response['reason'],'filter_or_dns_rejected')
        self.assertNotIn('secret',json.dumps(response))
    def test_actual_protocol_and_provider_events_are_data_not_remote_success(self):
        o=RuntimeStageObserver('b'*32);prefix='2026-11-08T00:00:00Z INFO '
        event=o.feed(prefix+'common/socks5-client-core/src/lib.rs:130: YNX_LISTENER_CONFIG anon=true bind=127.0.0.1:63781 connection_start_surbs=20 per_request_surbs=3 packet=Mix provider_interface={"type":"Versioned","version":3} socks_protocol={"type":"Versioned","version":3}')
        self.assertEqual(event['providerInterface'],{'type':'Versioned','version':3})
        address='1'*32+'.'+'2'*32+'@'+'3'*32
        provider=o.feed(prefix+'clients/socks5/src/commands/run.rs:112: YNX runtime contract ynx-mixnet-v1 applied; provider='+address)
        self.assertFalse(provider['remoteConnectionProven']);self.assertNotIn(address,json.dumps(provider))
        self.assertEqual(provider['providerSHA256'],o.provider_sha256)

if __name__=='__main__':unittest.main()
