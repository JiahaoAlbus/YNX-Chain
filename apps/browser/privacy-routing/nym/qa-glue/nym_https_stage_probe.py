"""Fixed RFC HTTPS stage diagnostic through one loopback SOCKS5h connection.

No target/URL/CA/proxy override, redirect, retry, profile or identity interface.
Run only under a separately scheduled PUBLIC QA scope; never normal admission.
"""
import argparse,hashlib,http.client,json,os,socket,ssl,threading,time
from pathlib import Path

HOST='www.rfc-editor.org';PATH='/rfc/rfc1928.txt';BODY_LIMIT=65536;HEADER_LIMIT=16384
RFC_BYTES=19741;RFC_SHA256='ddc2916419a52bedae0fc7d0c051ea513e88c2b930dda27128982fb0c1d6fe2a'

class PhaseFailure(Exception):pass

class SocketDeadlines:
    """Close only this retained socket on a stage/absolute deadline, even on drip reads."""
    def __init__(self,sock,absolute):
        self.sock=sock;self.absolute=absolute;self.stage=absolute;self.expired=None;self.done=False
        self.cv=threading.Condition();self.thread=threading.Thread(target=self.watch,name='owned-socket-deadline')
        self.thread.start()
    def set_socket(self,sock):
        with self.cv:
            self.sock=sock
            if self.expired:
                try:socket.socket.shutdown(sock,socket.SHUT_RDWR)
                except OSError:pass
                raise PhaseFailure(self.expired)
    def begin_stage(self,seconds):
        with self.cv:
            if self.expired:raise PhaseFailure(self.expired)
            self.stage=min(self.absolute,time.monotonic()+seconds);self.cv.notify_all()
    def watch(self):
        with self.cv:
            while not self.done:
                remaining=min(self.stage,self.absolute)-time.monotonic()
                if remaining>0:self.cv.wait(remaining);continue
                self.expired='ABSOLUTE_REQUEST_DEADLINE' if self.absolute<=self.stage else 'STAGE_TIMEOUT'
                try:socket.socket.shutdown(self.sock,socket.SHUT_RDWR)
                except OSError:pass
                return
    def finish(self):
        with self.cv:self.done=True;self.cv.notify_all()
        self.thread.join(timeout=1)
        return not self.thread.is_alive()

class HeaderReader:
    def __init__(self,inner):self.inner=inner;self.header_done=False;self.header_bytes=0
    def readline(self,limit=-1):
        if not self.header_done:
            remaining=HEADER_LIMIT-self.header_bytes
            limit=min(limit if limit>=0 else remaining+1,remaining+1)
        data=self.inner.readline(limit)
        if not self.header_done:
            self.header_bytes+=len(data)
            if self.header_bytes>HEADER_LIMIT:raise PhaseFailure('HTTP_HEADERS_LIMIT')
        return data
    def __getattr__(self,name):return getattr(self.inner,name)

class ResponseSocket:
    def __init__(self,sock):self.reader=HeaderReader(sock.makefile('rb'))
    def makefile(self,*_,**__):return self.reader

def verified_context():
    context=ssl.create_default_context()
    if not context.check_hostname or context.verify_mode!=ssl.CERT_REQUIRED:raise PhaseFailure('TLS_VERIFICATION_NOT_REQUIRED')
    return context

def read_rfc_body(response,progress):
    body=bytearray()
    while True:
        chunk=response.read1(min(8192,BODY_LIMIT-len(body)+1))
        if not chunk:break
        body.extend(chunk)
        if len(body)>BODY_LIMIT:raise PhaseFailure('HTTP_BODY_LIMIT')
        progress()
    # HTTPResponse.read1() permits an early EOF without IncompleteRead.  Do not
    # mistake a truncated response containing the two markers for completion.
    if response.length is not None and response.length!=0:
        raise PhaseFailure('HTTP_BODY_TRUNCATED')
    if b'RFC 1928' not in body or b'SOCKS' not in body:raise PhaseFailure('HTTP_BODY_NOT_RFC')
    if len(body)!=RFC_BYTES or hashlib.sha256(body).hexdigest()!=RFC_SHA256:
        raise PhaseFailure('HTTP_BODY_DOCUMENT_PIN_MISMATCH')
    return body

def over_connected_proxy(sock,emit,deadline):
    """One connected own proxy socket. Socketpair injection is used only by tests."""
    phase='socks_greeting';tls=None;response=None;tls_verified=False;guard=SocketDeadlines(sock,deadline)
    def timeout(cap):
        remaining=deadline-time.monotonic()
        if remaining<=0:raise PhaseFailure('ABSOLUTE_REQUEST_DEADLINE')
        (tls if tls is not None else sock).settimeout(min(cap,remaining))
    def exact(n):
        data=bytearray()
        while len(data)<n:
            timeout(8);chunk=sock.recv(n-len(data))
            if not chunk:raise PhaseFailure('SOCKS_EOF')
            data.extend(chunk)
        return bytes(data)
    try:
        guard.begin_stage(8);timeout(8);emit(phase);sock.sendall(b'\x05\x01\x00')
        if exact(2)!=b'\x05\x00':raise PhaseFailure('SOCKS_AUTH_REJECTED')
        phase='socks_domain_connect';guard.begin_stage(8);emit(phase,ATYP=3,port=443)
        host=HOST.encode('ascii');sock.sendall(b'\x05\x01\x00\x03'+bytes([len(host)])+host+b'\x01\xbb')
        head=exact(4)
        if head[:3]!=b'\x05\x00\x00':raise PhaseFailure('SOCKS_CONNECT_REJECTED')
        if head[3]==1:exact(4)
        elif head[3]==4:exact(16)
        elif head[3]==3:exact(exact(1)[0])
        else:raise PhaseFailure('SOCKS_REPLY_ATYP')
        exact(2);emit('socks_local_ack',remoteTCPOrDNSProven=False)
        phase='tls_handshake';emit(phase,certificateRequired=True,hostnameCheck=True)
        guard.begin_stage(35)
        context=verified_context();timeout(35)
        tls=context.wrap_socket(sock,server_hostname=HOST,do_handshake_on_connect=False)
        guard.set_socket(tls)
        timeout(35);tls.do_handshake()
        tls_verified=True
        emit('tls_verified',protocol=tls.version(),NOProductionAuthority=True)
        phase='http_headers';guard.begin_stage(20);timeout(20);emit(phase)
        tls.sendall(b'GET /rfc/rfc1928.txt HTTP/1.1\r\nHost: www.rfc-editor.org\r\nAccept: text/plain\r\nConnection: close\r\n\r\n')
        wrapper=ResponseSocket(tls);response=http.client.HTTPResponse(wrapper,method='GET');response.begin();wrapper.reader.header_done=True
        emit('http_status',status=response.status,headerBytes=wrapper.reader.header_bytes)
        if response.status!=200:raise PhaseFailure('HTTP_STATUS_NOT_200')
        if response.length is not None and response.length>BODY_LIMIT:raise PhaseFailure('HTTP_BODY_LENGTH_LIMIT')
        phase='http_body';guard.begin_stage(20);timeout(20);emit(phase)
        body=read_rfc_body(response,lambda:guard.begin_stage(20))
        result=dict(httpStatus=200,bodyBytes=len(body),bodySHA256=hashlib.sha256(body).hexdigest(),tlsHandshakeVerified=True,
                    bodyVerification='complete-HTTP-framing-and-fixed-RFC-length-SHA256',
                    targetDNSOnLocalHost=False,normalProductionAuthority=False)
        emit('https_body_verified',**result)
        return result
    except BaseException as error:
        if guard.expired:code=guard.expired
        elif isinstance(error,PhaseFailure):code=str(error)
        elif isinstance(error,ssl.SSLCertVerificationError):code='TLS_CERTIFICATE_REJECTED'
        elif isinstance(error,ssl.SSLError):code='TLS_NEGOTIATION_FAILED'
        elif isinstance(error,(socket.timeout,TimeoutError)):code='STAGE_TIMEOUT'
        elif isinstance(error,http.client.HTTPException):code='HTTP_PROTOCOL_ERROR'
        elif isinstance(error,OSError):code='SOCKET_IO_FAILED'
        else:code='UNEXPECTED_STAGE_FAILURE'
        emit('first_failure',phase=phase,code=code,exceptionType=type(error).__name__,tlsHandshakeVerified=tls_verified,
             tlsSuccessProof='VERIFIED_HANDSHAKE_ONLY' if tls_verified else 'NO_TLS_SUCCESS_PROOF')
        raise PhaseFailure(phase+':'+code) from None
    finally:
        stopped=guard.finish()
        if response is not None:response.close()
        if tls is not None:tls.close()
        sock.close()
        if not stopped:emit('socket_deadline_owner_unknown',NoProductionAuthority=True)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',type=int,required=True);p.add_argument('--local-port',type=int,required=True)
    p.add_argument('--expires-at',type=int,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();os.umask(0o077)
    if a.port!=63781 or a.local_port!=63801 or not time.time()<a.expires_at<=time.time()+110:raise SystemExit('fixed-stage-scope-rejected')
    a.output.mkdir(mode=0o700,exist_ok=False);started=time.monotonic();deadline=started+min(85,a.expires_at-time.time())
    events=[];failure=None;result=None
    def emit(event,**values):
        if len(events)>=24:raise PhaseFailure('EVENT_LIMIT')
        entry=dict(event=event,elapsedMilliseconds=int((time.monotonic()-started)*1000),**values);events.append(entry)
        print(json.dumps(entry),flush=True)
    sock=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    try:
        emit('local_proxy_tcp');sock.settimeout(min(8,deadline-time.monotonic()));sock.bind(('127.0.0.1',63801));sock.connect(('127.0.0.1',63781))
        if sock.getpeername()!=('127.0.0.1',63781):raise PhaseFailure('LOCAL_PROXY_PEER_MISMATCH')
        result=over_connected_proxy(sock,emit,deadline)
    except BaseException as error:
        failure=dict(type=type(error).__name__,fixedReason=str(error) if isinstance(error,PhaseFailure) else 'LOCAL_PROXY_CONNECT_FAILED')
    finally:
        sock.close()
        value=dict(schema='YNX_NYM_PUBLIC_HTTPS_STAGE_RESULT_V1',events=events,firstFailure=failure,result=result,
                   elapsedSeconds=time.monotonic()-started,normalProductionAuthority=False,privateKeyOrProfileAccess=False)
        (a.output/'result.json').write_text(json.dumps(value,indent=2)+'\n')
    return 1 if failure else 0

if __name__=='__main__':raise SystemExit(main())
