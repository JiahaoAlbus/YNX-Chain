"""Reject-by-default runtime log DATA filter. No raw payload/key/address export."""
import hashlib,json,re

# Default DEBUG is needed for upstream's dynamic '(id) socks5 inbound/outbound'
# targets; noisy core/gateway/TLS/HTTP modules are narrowed explicitly. Existing
# raw output/memory limits must remain in force and abort if reached.
RUST_LOG=('debug,nym_client_core=info,nym_client_core::client::received_buffer=debug,'
          'nym_socks5_client_core=info,nym_socks5_client_core::socks::client=debug,'
          'nym_socks5_client_core::socks::mixnet_responses=debug,nym_gateway_client=info,'
          'nym_task=info,nym_http_api_client=warn,nym_bandwidth_controller=warn,'
          'hyper=warn,h2=warn,rustls=warn,tungstenite=warn,tokio_tungstenite=warn,reqwest=warn')

class RuntimeStageObserver:
    def __init__(self,run_nonce,local_port=63801):
        if not re.fullmatch('[a-f0-9]{32}',run_nonce) or local_port!=63801:raise ValueError('observer-fixed-scope')
        self.nonce=run_nonce;self.local_port=local_port;self.current_id=None;self.provider_sha256=None;self.counts={};self.events=0;self.dropped=0;self.first_failure=None
    def tag(self,identifier):
        return hashlib.sha256(self.nonce.encode()+int(identifier).to_bytes(8,'big')).hexdigest()
    def feed(self,line):
        if not isinstance(line,str) or len(line)>8192:self.dropped+=1;return None
        parsed=re.fullmatch(r'\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+((?:common|clients)/[a-zA-Z0-9_./-]+\.rs):\d+: (.*)',line)
        if not parsed:self.dropped+=1;return None
        _,source,text=parsed.groups();event=None
        if source.endswith('clients/socks5/src/commands/run.rs'):
            match=re.fullmatch(r'YNX runtime contract ynx-mixnet-v1 applied; provider=([1-9A-HJ-NP-Za-km-z]{32,44}\.[1-9A-HJ-NP-Za-km-z]{32,44}@[1-9A-HJ-NP-Za-km-z]{32,44})',text)
            if match:
                self.provider_sha256=hashlib.sha256(match[1].encode()).hexdigest()
                event=dict(event='runtime_provider_applied',providerSHA256=self.provider_sha256,remoteConnectionProven=False)
        if source.endswith('socks5-client-core/src/lib.rs'):
            version=r'(\{"type":"(?:Legacy|Versioned)"(?:,"version":\d{1,3})?\})'
            match=re.fullmatch(r'YNX_LISTENER_CONFIG anon=(true|false) bind=127\.0\.0\.1:(\d{1,5}) connection_start_surbs=(\d{1,6}) per_request_surbs=(\d{1,6}) packet=(Mix|Outfox) provider_interface='+version+r' socks_protocol='+version,text)
            if match:
                event=dict(event='listener_protocols',anonymous=match[1]=='true',bindPort=int(match[2]),initialSURBs=int(match[3]),perRequestSURBs=int(match[4]),packet=match[5],providerInterface=json.loads(match[6]),socksProtocol=json.loads(match[7]))
        if source.endswith('client-core/src/client/real_messages_control/message_handler.rs'):
            match=re.fullmatch(r'YNX_ANON_DISPATCH queued=true stored_reply_keys=(\d{1,6}) packet=(Mix|Outfox)',text)
            if match:event=dict(event='anonymous_queued',replyKeys=int(match[1]),packet=match[2],deliveryProven=False)
        if source.endswith('socks5-client-core/src/socks/client.rs'):
            match=re.fullmatch(r'Starting proxy for www\.rfc-editor\.org:443 \(id: (\d{1,20})\)',text)
            if match:
                identifier=int(match[1])
                if identifier<2**64:
                    self.current_id=identifier;event=dict(event='current_proxy_started',connectionTagSHA256=self.tag(identifier))
            match=re.fullmatch(r'YNX_SOCKS_REQUEST version=(\d+) domain=(true|false) port=(\d+) address_bytes=(\d+) target_resolution=exit',text)
            if match:event=dict(event='socks_request',version=int(match[1]),domain=match[2]=='true',port=int(match[3]),addressBytes=int(match[4]))
        if source.endswith('client-core/src/client/received_buffer.rs') and (match:=re.fullmatch(r'YNX_REPLY_DECRYPTED encrypted_bytes=(\d{1,8})',text)):
            event=dict(event='reply_surb_decrypted',encryptedBytes=int(match[1]),connectionAssociation='not_proven')
        if source.endswith('socks5-client-core/src/socks/mixnet_responses.rs'):
            match=re.fullmatch(r'YNX_PROVIDER_RESPONSE bytes=(\d{1,8})',text)
            if match:event=dict(event='provider_response_received',bytes=int(match[1]),connectionAssociation='not_proven')
            match=re.fullmatch(r'Network requester failed on connection id (\d{1,20}) with error: (.{0,2048})',text)
            if match and int(match[1])<2**64:
                current=int(match[1])==self.current_id
                event=dict(event='requester_connection_error',currentConnection=current,connectionTagSHA256=self.tag(int(match[1])),
                           reason='filter_or_dns_rejected' if 'failed filter check' in match[2] else 'requester_error_unspecified')
            if text.startswith('failed to parse received response:'):event=dict(event='provider_response_decode_failed')
        if source.endswith('proxy-helpers/src/ordered_sender.rs'):
            pattern=r'\[(\d{1,8}) bytes\]\s+127\.0\.0\.1:'+str(self.local_port)+r' → local → mixnet → remote → www\.rfc-editor\.org:443\. Local closed: (true|false)'
            match=re.fullmatch(pattern,text)
            if match:event=dict(event='current_socket_to_mixnet',bytes=int(match[1]),closed=match[2]=='true')
        if source.endswith('proxy-helpers/src/proxy_runner/outbound.rs'):
            pattern=r'\[(\d{1,8}) bytes\]\s+www\.rfc-editor\.org:443 → remote → mixnet → local → 127\.0\.0\.1:'+str(self.local_port)+r' Remote closed: (true|false)'
            match=re.fullmatch(pattern,text)
            if match:event=dict(event='mixnet_to_current_socket',bytes=int(match[1]),closed=match[2]=='true')
            if text.startswith('failed to write response back to the socket -'):event=dict(event='local_response_write_failed')
        if source.endswith('proxy-helpers/src/connection_controller.rs'):
            match=re.fullmatch(r"Tried to write to closed connection (\d{1,20}) \((\d{1,8}) bytes were 'lost\)",text)
            if match and int(match[1])<2**64:event=dict(event='late_closed_connection_data',currentConnection=int(match[1])==self.current_id,bytes=int(match[2]),connectionTagSHA256=self.tag(int(match[1])))
            if text=="Received a 'Send' before 'Connect' - going to buffer the data":event=dict(event='controller_pending_before_connect',connectionAssociation='not_proven')
            if text.startswith('failed to write to the buffer:'):event=dict(event='ordered_buffer_write_failed')
        if event is None:self.dropped+=1;return None
        # Control is independent of the bounded diagnostic event store.  Never
        # let a full log budget suppress a current connection rejection.
        if event['event']=='requester_connection_error' and event['currentConnection'] and self.first_failure is None:
            self.first_failure=dict(fixedReason='NR_CURRENT_CONNECTION_ERROR',classification=event['reason'])
        if self.events>=256:
            if self.first_failure is None:self.first_failure=dict(fixedReason='RUNTIME_OBSERVATION_LIMIT',classification='coverage_incomplete')
            self.dropped+=1;return None
        self.events+=1;name=event['event'];self.counts[name]=self.counts.get(name,0)+1
        event['NoProductionAuthority']=True
        return event

def install_observed_child(r2,observer):
    """Wrap the existing owned lifecycle; unknown runtime lines never reach its logger."""
    Original=r2.Child
    class ObservedChild(Original):
        def line(self,text):
            if not self.runtime:return super().line(text)
            event=observer.feed(text)
            if observer.first_failure is not None and not hasattr(self.owner,'requester_failure'):
                self.owner.requester_failure=dict(**observer.first_failure,**r2.stamp())
            if event is not None:
                with self.lock:
                    if not hasattr(self,'stage_events'):self.stage_events=[]
                    if len(self.stage_events)<256:self.stage_events.append(dict(**event,**r2.stamp()))
            # Only exact lifecycle fields may enter the original ready/config/
            # public fingerprint parser. Never send generic DEBUG/error bodies.
            match=re.fullmatch(r'\S+\s+(INFO|DEBUG|WARN|ERROR|TRACE)\s+(common/[a-zA-Z0-9_./-]+\.rs):\d+: (.*)',text)
            if not match:return
            _,source,message=match.groups();allowed=False
            if source.endswith('socks5-client-core/src/lib.rs'):
                allowed=message=='Client startup finished!'
                prefix='The address of this client is: '
                if message.startswith(prefix) and r2.RECIPIENT.fullmatch(message[len(prefix):]):allowed=True
                if re.fullmatch(r'YNX_CONSUMED_CONFIG anon=(?:true|false) credentials_enabled=(?:true|false) dkg_client_created=(?:true|false) bind=127\.0\.0\.1:\d{1,5} packet=(?:Mix|Outfox) poisson_disabled=(?:true|false) loop_cover_disabled=(?:true|false) per_hop_ms=\d{1,6} send_ms=\d{1,6} cover_ms=\d{1,6}',message):allowed=True
            if source.endswith('task/src/cancellation/manager.rs') and message in ['all tracked tasks successfully shutdown','all registered tasks successfully shutdown']:allowed=True
            if allowed:super().line(text)
        def receipt(self):
            value=super().receipt();value['stageEvents']=getattr(self,'stage_events',[])
            value['unapprovedRuntimeLinesPersisted']=False
            return value
    r2.Child=ObservedChild
