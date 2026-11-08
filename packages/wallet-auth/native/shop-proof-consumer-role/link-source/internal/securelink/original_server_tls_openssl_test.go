//go:build securelink_openssl && cgo

package securelink

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

func publicOriginalServerTLS(t *testing.T, f tlsFixture) (*OriginalServerTLS, *publicServerTLSBorrow, *native.Context) {
	t.Helper()
	actual, e := native.NewContext(f.config(true))
	if e != nil {
		t.Fatal(e)
	}
	info, e := actual.ServerIdentity()
	if e != nil {
		_ = actual.Close()
		t.Fatal(e)
	}
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		_ = actual.Close()
		t.Fatal(e)
	}
	now := time.Now()
	p := &publicServerTLSBorrow{listener: listener, profile: originalServerTLSProfile{sourceID: "PUBLIC_SOURCE", instanceID: "PUBLIC_INSTANCE", issuerRef: "PUBLIC_ISSUER_NOT_ROOT", credentialRef: "PUBLIC_CREDENTIAL_NOT_ROOT", targetOrigin: "https://adapter.ynx.test", serverName: "adapter.ynx.test", peerSAN: "pay.ynx.test", listenNetwork: "tcp", listenAddress: listener.Addr().String(), certificateSHA256: info.CertificateSHA256, spkiSHA256: info.SPKISHA256, credentialEpoch: 1, credentialFrom: now.Add(-time.Minute), credentialUntil: now.Add(time.Minute)}}
	p.release = func() (bool, bool, error) {
		if _, e := actual.ServerIdentity(); !errors.Is(e, net.ErrClosed) {
			return false, false, errors.New("SSL_CTX still live when original credential FD borrow released")
		}
		return true, true, nil
	}
	out, e := newOriginalServerTLS(context.Background(), &HTTPServer{tls: actual}, listener, p, nil)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		out.Retire()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if e := out.Join(ctx); e == nil {
			_ = out.Close()
		}
	})
	return out, p, actual
}
func originalServerTLSClient(t *testing.T, f tlsFixture, address string, hold ...bool) (*native.Conn, *http.Response, error) {
	t.Helper()
	client, e := native.NewContext(f.config(false))
	if e != nil {
		return nil, nil, e
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	raw, e := (&net.Dialer{}).DialContext(ctx, "tcp", address)
	if e != nil {
		return nil, nil, e
	}
	conn, e := client.Client(ctx, raw)
	if e != nil {
		_ = raw.Close()
		return nil, nil, e
	}
	request := "GET /PUBLIC-transport-only HTTP/1.1\r\nHost: adapter.ynx.test\r\nConnection: close\r\n"
	if len(hold) != 0 && hold[0] {
		request += "X-PUBLIC-Hold: yes\r\n"
	}
	request += "\r\n"
	if _, e = io.WriteString(conn, request); e != nil {
		_ = conn.Close()
		return nil, nil, e
	}
	response, e := http.ReadResponse(bufio.NewReader(conn), nil)
	return conn, response, e
}
func TestOriginalServerTLSActualContextRequestAndDrain(t *testing.T) {
	f := newTLSFixture(t)
	owner, borrow, _ := publicOriginalServerTLS(t, f)
	before, e := owner.Identity(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	before.CertificateDER[0] ^= 255
	before.SPKIDER[0] ^= 255
	before.DNSNames[0] = "forged.test"
	after, e := owner.Identity(context.Background())
	if e != nil || after.DNSNames[0] == "forged.test" || after.CertificateDER[0] == before.CertificateDER[0] || after.SPKIDER[0] == before.SPKIDER[0] {
		t.Fatal("caller changed actual context identity")
	}
	seen := make(chan error, 4)
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	server := &http.Server{ReadHeaderTimeout: time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		e := owner.CurrentOriginalRequest(r)
		if e == nil && owner.CurrentOriginalRequest(r.Clone(r.Context())) == nil {
			e = errors.New("cloned request minted transport")
		}
		if e == nil && owner.CurrentOriginalRequest(httptest.NewRequest("GET", "https://adapter.ynx.test/PUBLIC", nil)) == nil {
			e = errors.New("httptest minted transport")
		}
		seen <- e
		if r.Header.Get("X-PUBLIC-Hold") == "yes" {
			close(entered)
			<-r.Context().Done()
			<-release
			return
		}
		_, _ = io.WriteString(w, "PUBLIC actual PQ listener, no business admission")
	})}
	serveDone := make(chan error, 1)
	go func() { serveDone <- owner.Serve(server) }()
	conn, res, e := originalServerTLSClient(t, f, borrow.listener.Addr().String())
	if e != nil {
		t.Fatal(e)
	}
	body, e := io.ReadAll(res.Body)
	_ = res.Body.Close()
	_ = conn.Close()
	if e != nil || res.StatusCode != 200 || !strings.Contains(string(body), "PUBLIC actual PQ") {
		t.Fatalf("actual listener: %v %d %q", e, res.StatusCode, body)
	}
	if e = <-seen; e != nil {
		t.Fatal(e)
	}
	// One independent operation cancellation cannot revoke the whole listener.
	opCtx, cancelOp := context.WithCancel(context.Background())
	callbackEntered := make(chan struct{})
	callbackRelease := make(chan struct{})
	borrow.setCurrent(func(ctx context.Context) error { close(callbackEntered); <-callbackRelease; return ctx.Err() })
	currentDone := make(chan error, 1)
	go func() { currentDone <- owner.Current(opCtx) }()
	<-callbackEntered
	cancelOp()
	close(callbackRelease)
	if e = <-currentDone; !errors.Is(e, context.Canceled) || owner.Lifetime().Retired || owner.FirstCause() != nil {
		t.Fatalf("request cancellation retired issuer: %v %+v", e, owner.Lifetime())
	}
	borrow.setCurrent(nil)
	conn, res, e = originalServerTLSClient(t, f, borrow.listener.Addr().String())
	if e != nil {
		t.Fatal(e)
	}
	_, _ = io.ReadAll(res.Body)
	_ = res.Body.Close()
	_ = conn.Close()
	if e = <-seen; e != nil {
		t.Fatal(e)
	}
	heldDone := make(chan error, 1)
	go func() {
		conn, response, e := originalServerTLSClient(t, f, borrow.listener.Addr().String(), true)
		if response != nil {
			_ = response.Body.Close()
		}
		if conn != nil {
			_ = conn.Close()
		}
		heldDone <- e
	}()
	<-entered
	if e = <-seen; e != nil {
		t.Fatal(e)
	}
	owner.Retire()
	probe, cancelProbe := context.WithCancel(context.Background())
	cancelProbe()
	if !errors.Is(owner.Join(probe), context.Canceled) || owner.Close() == nil || borrow.releases.Load() != 0 || owner.Lifetime().PhysicalComplete {
		t.Fatal("inflight real handler prematurely released credential/context")
	}
	unblock()
	if e = <-heldDone; e == nil {
		t.Fatal("retired held request emitted HTTP success")
	}
	if e = <-serveDone; !errors.Is(e, http.ErrServerClosed) {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if e = owner.Join(ctx); e != nil {
		t.Fatal(e)
	}
	if borrow.releases.Load() != 0 || owner.Lifetime().PhysicalComplete {
		t.Fatal("join released original credential too early")
	}
	if e = owner.Close(); e != nil || !owner.Lifetime().PhysicalComplete || borrow.releases.Load() != 1 {
		t.Fatalf("physical close: %v %+v", e, owner.Lifetime())
	}
}
