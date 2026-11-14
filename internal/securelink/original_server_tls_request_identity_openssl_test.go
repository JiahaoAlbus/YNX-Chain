//go:build securelink_openssl && cgo

package securelink

import (
	"bufio"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

func waitOriginalRequestIdentityTest[T any](t *testing.T, ctx context.Context, ch <-chan T) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-ctx.Done():
		t.Fatalf("original request identity control timed out: %v", ctx.Err())
		var zero T
		return zero
	}
}

// Real OpenSSL mTLS with a PUBLIC credential borrow. Only the issuer and
// pre-cancel barriers are test controlled; the HTTP request and socket are live.
func TestOriginalServerTLSOriginalRequestIdentity(t *testing.T) {
	fixture := newTLSFixture(t)
	t.Run("wrapper_close", func(t *testing.T) { testOriginalServerTLSOriginalRequestIdentity(t, fixture, false) })
	t.Run("native_close", func(t *testing.T) { testOriginalServerTLSOriginalRequestIdentity(t, fixture, true) })
	t.Run("cloud_finite_get", func(t *testing.T) { testOriginalCloudFiniteGETRequestTransport(t, fixture) })
}

func testOriginalCloudFiniteGETRequestTransport(t *testing.T, fixture tlsFixture) {
	t.Helper()
	owner, borrow, _ := publicOriginalServerTLS(t, fixture)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	const prefix = "/api/v1/ide/deployments/"
	const path = prefix + "PUBLIC_original_operation_0001"
	const proof = "PUBLIC_proof"
	type observation struct {
		request         *http.Request
		cloud, original OriginalFiniteGETRequestTransport
		cloudErr        error
		originalErr     error
		cloneErr        error
		overBoundErr    error
		mutatedPathErr  error
		mutatedHostErr  error
	}
	observed := make(chan observation, 1)
	server := &http.Server{ReadHeaderTimeout: time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cloud, cloudErr := owner.OriginalCloudFiniteGETRequestTransport(r)
		original, originalErr := owner.OriginalFiniteGETRequestTransport(r)
		_, cloneErr := owner.OriginalCloudFiniteGETRequestTransport(r.Clone(r.Context()))
		var overBoundErr error
		if r.RequestURI == path {
			r.Header.Set("X-Public-Fixture", strings.Repeat("a", MaxProductSessionProofV4RequestHeaderBytes))
			_, overBoundErr = owner.OriginalCloudFiniteGETRequestTransport(r)
			r.Header.Del("X-Public-Fixture")
		}
		var mutatedPathErr, mutatedHostErr error
		if r.RequestURI == "/PUBLIC-first" || r.RequestURI == path {
			oldURL, oldTarget := r.URL, r.RequestURI
			mutatedURL := *oldURL
			mutatedURL.Path = path + "/logs"
			r.URL, r.RequestURI = &mutatedURL, mutatedURL.Path
			_, mutatedPathErr = owner.OriginalCloudFiniteGETRequestTransport(r)
			r.URL, r.RequestURI = oldURL, oldTarget
		}
		if r.RequestURI == path {
			oldHost := r.Host
			r.Host = "other.ynx.test"
			_, mutatedHostErr = owner.OriginalCloudFiniteGETRequestTransport(r)
			r.Host = oldHost
		}
		observed <- observation{r, cloud, original, cloudErr, originalErr, cloneErr, overBoundErr, mutatedPathErr, mutatedHostErr}
		w.WriteHeader(http.StatusNoContent)
	})}
	serveDone := make(chan error, 1)
	go func() { serveDone <- owner.Serve(server) }()
	t.Cleanup(func() {
		owner.Retire()
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := waitOriginalRequestIdentityTest(t, cleanup, serveDone); !errors.Is(err, http.ErrServerClosed) {
			t.Error(err)
		}
		if err := owner.Join(cleanup); err != nil {
			t.Error(err)
		} else if err = owner.Close(); err != nil {
			t.Error(err)
		}
	})
	client := dialNative(t, fixture, borrow.listener.Addr().String())
	deadline, _ := ctx.Deadline()
	if err := client.SetDeadline(deadline); err != nil {
		t.Fatal(err)
	}
	exporter, err := client.ExportKeyingMaterial("EXPORTER-Channel-Binding", nil, 32)
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(client)
	call := func(method, target, extra, body string) observation {
		t.Helper()
		wire := method + " " + target + " HTTP/1.1\r\nHost: adapter.ynx.test\r\n" +
			ProductSessionProofV4Header + ": " + proof + "\r\n" + extra + "\r\n" + body
		if _, err := io.WriteString(client, wire); err != nil {
			t.Fatal(err)
		}
		response, err := http.ReadResponse(reader, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := response.Body.Close(); err != nil || response.StatusCode != http.StatusNoContent || response.Close {
			t.Fatalf("actual PUBLIC response: status=%d close=%t err=%v", response.StatusCode, response.Close, err)
		}
		return waitOriginalRequestIdentityTest(t, ctx, observed)
	}
	for _, suffix := range []string{"", "/logs", "/runtime", "/usage", "/usage/records", "/billing/2024-02-29", "/billing/2024-02-29/native-intent"} {
		got := call(http.MethodGet, path+suffix, "", "")
		if got.cloudErr != nil || got.originalErr != nil || got.cloud != got.original ||
			got.cloud.ChannelSHA256 != sha256.Sum256(exporter) || got.cloud.ProofSHA256 != sha256.Sum256([]byte(proof)) ||
			!errors.Is(got.cloneErr, ErrDenied) || suffix == "" && (!errors.Is(got.overBoundErr, ErrDenied) ||
			!errors.Is(got.mutatedPathErr, ErrDenied) || !errors.Is(got.mutatedHostErr, ErrDenied)) {
			t.Fatalf("fixed Cloud route %q did not retain the exact live evidence: %+v", suffix, got)
		}
		waitOriginalRequestIdentityTest(t, ctx, got.request.Context().Done())
		if evidence, err := owner.OriginalCloudFiniteGETRequestTransport(got.request); err == nil || evidence != (OriginalFiniteGETRequestTransport{}) {
			t.Fatalf("finished Cloud request remained available: %v", err)
		}
	}
	for _, tc := range []struct {
		name, method, target, header, body string
		genericStillAvailable              bool
	}{
		{"foreign", http.MethodGet, "/PUBLIC-first", "", "", true},
		{"query", http.MethodGet, path + "?", "", "", true},
		{"encoded path", http.MethodGet, path + "/%6cogs", "", "", true},
		{"absolute target", http.MethodGet, "https://adapter.ynx.test" + path, "", "", true},
		{"short operation", http.MethodGet, prefix + "short", "", "", true},
		{"long operation", http.MethodGet, prefix + strings.Repeat("a", 129), "", "", true},
		{"invalid day", http.MethodGet, path + "/billing/2023-02-29", "", "", true},
		{"foreign suffix", http.MethodGet, path + "/usage/other", "", "", true},
		{"duplicate proof", http.MethodGet, path, "x-ynx-product-session-proof-v4: PUBLIC_second\r\n", "", false},
		{"mixed proof", http.MethodGet, path, "X-YNX-Product-Session-Proof-V2: PUBLIC_second\r\n", "", false},
		{"body", http.MethodGet, path, "Content-Length: 1\r\n", "x", false},
		{"POST", http.MethodPost, path, "Content-Length: 0\r\n", "", false},
	} {
		got := call(tc.method, tc.target, tc.header, tc.body)
		if !errors.Is(got.cloudErr, ErrDenied) || got.cloud != (OriginalFiniteGETRequestTransport{}) ||
			(got.originalErr == nil) != tc.genericStillAvailable || tc.name == "foreign" && !errors.Is(got.mutatedPathErr, ErrDenied) {
			t.Fatalf("%s changed fixed or generic transport evidence: %+v", tc.name, got)
		}
	}
}

func testOriginalServerTLSOriginalRequestIdentity(t *testing.T, fixture tlsFixture, closeFromNative bool) {
	t.Helper()
	owner, borrow, _ := publicOriginalServerTLS(t, fixture)
	foreign, _, _ := publicOriginalServerTLS(t, fixture)
	rawBarrier := &authorityCloseBarrier{entered: make(chan struct{}), release: make(chan struct{})}
	defer rawBarrier.unblock()
	if closeFromNative {
		owner.state.listener = authorityBarrierListener{Listener: borrow.listener, barrier: rawBarrier}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	expected, err := owner.Identity(ctx)
	if err != nil {
		t.Fatal(err)
	}
	type observed struct {
		identity ServerTLSIdentity
		err      error
	}
	observe := func(o *OriginalServerTLS, r *http.Request) observed {
		identity, e := o.OriginalRequestIdentity(r)
		return observed{identity, e}
	}
	assertRefused := func(label string, got observed) {
		t.Helper()
		if got.err == nil || !reflect.DeepEqual(got.identity, ServerTLSIdentity{}) {
			t.Fatalf("%s returned identity or no error: zero=%t err=%v", label, reflect.DeepEqual(got.identity, ServerTLSIdentity{}), got.err)
		}
	}
	type observations struct {
		request                    *http.Request
		original, fresh            observed
		clone, foreign, fabricated observed
		transport                  OriginalFiniteGETRequestTransport
		transportErr               error
		changedProof, clonedProof  error
	}
	first := make(chan observations, 1)
	secondRequest := make(chan *http.Request, 1)
	late := make(chan observed, 1)
	lateCurrent := make(chan error, 1)
	type transportObservation struct {
		evidence OriginalFiniteGETRequestTransport
		err      error
	}
	lateTransport := make(chan transportObservation, 1)
	startRead, resumeIssuer, resumeClose := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var startOnce, issuerOnce, closeOnce sync.Once
	start := func() { startOnce.Do(func() { close(startRead) }) }
	allowIssuer := func() { issuerOnce.Do(func() { close(resumeIssuer) }) }
	allowClose := func() { closeOnce.Do(func() { close(resumeClose) }) }
	defer func() { start(); allowIssuer(); allowClose() }()
	server := &http.Server{ReadHeaderTimeout: time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/PUBLIC-close-race" {
			secondRequest <- r
			<-startRead
			go func() { late <- observe(owner, r) }()
			go func() {
				evidence, err := owner.OriginalFiniteGETRequestTransport(r)
				lateTransport <- transportObservation{evidence, err}
			}()
			lateCurrent <- owner.CurrentOriginalRequest(r)
			<-resumeClose
			return
		}
		original := observe(owner, r)
		fresh := observe(owner, r)
		transport, transportErr := owner.OriginalFiniteGETRequestTransport(r)
		_, clonedProof := owner.OriginalFiniteGETRequestTransport(r.Clone(r.Context()))
		proof := r.Header.Get(ProductSessionProofV4Header)
		r.Header.Set(ProductSessionProofV4Header, "Changed_Original_Proof")
		_, changedProof := owner.OriginalFiniteGETRequestTransport(r)
		r.Header.Set(ProductSessionProofV4Header, proof)
		first <- observations{
			request: r, original: original, fresh: fresh,
			clone: observe(owner, r.Clone(r.Context())), foreign: observe(foreign, r),
			fabricated: observe(owner, httptest.NewRequest(http.MethodGet, "https://adapter.ynx.test/PUBLIC-first", nil)),
			transport:  transport, transportErr: transportErr, changedProof: changedProof, clonedProof: clonedProof,
		}
		_, _ = io.WriteString(w, "PUBLIC original request")
	})}
	serveDone := make(chan error, 1)
	go func() { serveDone <- owner.Serve(server) }()
	client := dialNative(t, fixture, borrow.listener.Addr().String())
	deadline, _ := ctx.Deadline()
	if err = client.SetDeadline(deadline); err != nil {
		t.Fatal(err)
	}
	writeRequest := func(target string) {
		t.Helper()
		if _, e := io.WriteString(client, "GET "+target+" HTTP/1.1\r\nHost: adapter.ynx.test\r\nX-YNX-Product-Session-Proof-V4: PUBLIC_proof\r\n\r\n"); e != nil {
			t.Fatal(e)
		}
	}
	writeRequest("/PUBLIC-first")
	response, err := http.ReadResponse(bufio.NewReader(client), nil)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK || string(body) != "PUBLIC original request" || response.Close {
		t.Fatalf("actual keep-alive mTLS response: status=%d close=%t body=%q err=%v", response.StatusCode, response.Close, body, err)
	}
	got := waitOriginalRequestIdentityTest(t, ctx, first)
	exporter, err := client.ExportKeyingMaterial("EXPORTER-Channel-Binding", nil, 32)
	if err != nil || got.transportErr != nil || got.transport.ChannelSHA256 != sha256.Sum256(exporter) ||
		got.transport.ProofSHA256 != sha256.Sum256([]byte("PUBLIC_proof")) || !errors.Is(got.changedProof, ErrDenied) || !errors.Is(got.clonedProof, ErrDenied) {
		t.Fatalf("original FiniteGET proof and channel binding: export=%v transport=%v changed=%v clone=%v", err, got.transportErr, got.changedProof, got.clonedProof)
	}
	for _, result := range []observed{got.original, got.fresh} {
		if result.err != nil || !reflect.DeepEqual(result.identity, expected) {
			t.Fatalf("request identity differs from the actual listener certificate/SPKI: %v", result.err)
		}
	}
	got.original.identity.CertificateDER[0] ^= 0xff
	got.original.identity.SPKIDER[0] ^= 0xff
	if !reflect.DeepEqual(got.fresh.identity, expected) {
		t.Fatal("request identity exposed another observation's DER storage")
	}
	assertRefused("cloned request", got.clone)
	assertRefused("foreign listener with the same certificate", got.foreign)
	assertRefused("fabricated request", got.fabricated)
	waitOriginalRequestIdentityTest(t, ctx, got.request.Context().Done())
	assertRefused("original request after handler exit", observe(owner, got.request))
	if err := owner.CurrentOriginalRequest(got.request); err == nil {
		t.Fatal("finished request remained current on keep-alive connection")
	}
	if closed, err := owner.OriginalRequestClosed(got.request); closed || err != nil {
		t.Fatalf("HTTP handler exit replaced physical close: closed=%t err=%v", closed, err)
	}

	writeRequest("/PUBLIC-close-race")
	r := waitOriginalRequestIdentityTest(t, ctx, secondRequest)
	conn, ok := r.Context().Value(originalServerTLSConnKey{}).(*originalServerTLSConn)
	if !ok || conn != got.request.Context().Value(originalServerTLSConnKey{}) || r.Context().Err() != nil {
		t.Fatal("second request did not reuse the current original mTLS connection")
	}
	issuerEntered, closeEntered := make(chan struct{}), make(chan struct{})
	var issuerCalls atomic.Int32
	borrow.setCurrent(func(callCtx context.Context) error {
		if callCtx != r.Context() {
			return callCtx.Err()
		}
		if issuerCalls.Add(1) == 3 {
			close(issuerEntered)
		}
		<-resumeIssuer
		return nil
	})
	conn.mu.Lock()
	originalCancel := conn.cancel
	if originalCancel == nil || conn.closed {
		conn.mu.Unlock()
		t.Fatal("original connection is already closed or lacks its cancel callback")
	}
	var nativeConn *native.Conn
	if closeFromNative {
		nativeConn = conn.tls
	} else {
		conn.cancel = func(cause error) {
			close(closeEntered)
			<-resumeClose
			originalCancel(cause)
		}
	}
	conn.mu.Unlock()
	start()
	waitOriginalRequestIdentityTest(t, ctx, issuerEntered)
	connectionClosed := make(chan error, 1)
	if closeFromNative {
		if nativeConn == nil {
			t.Fatal("live request lacks the original OpenSSL connection")
		}
		rawBarrier.armed.Store(true)
		go func() { connectionClosed <- nativeConn.Close() }()
		waitOriginalRequestIdentityTest(t, ctx, rawBarrier.entered)
		conn.mu.Lock()
		wrapperClosed := conn.closed
		conn.mu.Unlock()
		if wrapperClosed {
			t.Fatal("HTTP wrapper masked native close selection")
		}
	} else {
		go func() { connectionClosed <- conn.Close() }()
		waitOriginalRequestIdentityTest(t, ctx, closeEntered)
	}
	if r.Context().Err() != nil || owner.Lifetime().Retired {
		t.Fatal("connection-close window was masked by context cancellation or listener retirement")
	}
	for _, original := range []*http.Request{got.request, r} {
		if closed, err := owner.OriginalRequestClosed(original); closed || err != nil {
			t.Fatalf("close selection replaced physical completion: closed=%t err=%v", closed, err)
		}
	}
	allowIssuer()
	assertRefused("original connection closed during issuer current", waitOriginalRequestIdentityTest(t, ctx, late))
	if err := waitOriginalRequestIdentityTest(t, ctx, lateCurrent); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("Current accepted the original connection after close selection: %v", err)
	}
	if seen := waitOriginalRequestIdentityTest(t, ctx, lateTransport); !errors.Is(seen.err, net.ErrClosed) || seen.evidence != (OriginalFiniteGETRequestTransport{}) {
		t.Fatalf("transport evidence escaped after close selection: %v", seen.err)
	}
	if issuerCalls.Load() != 3 || r.Context().Err() != nil {
		t.Fatalf("expected all issuer observations with live request context: calls=%d context=%v", issuerCalls.Load(), r.Context().Err())
	}
	rawBarrier.unblock()
	allowClose()
	if err = waitOriginalRequestIdentityTest(t, ctx, connectionClosed); err != nil {
		t.Fatal(err)
	}
	owner.Retire()
	if err = waitOriginalRequestIdentityTest(t, ctx, serveDone); !errors.Is(err, http.ErrServerClosed) {
		t.Fatal(err)
	}
	if err = owner.Join(ctx); err != nil || borrow.releases.Load() != 0 {
		t.Fatalf("request/connection drain: %v %+v", err, owner.Lifetime())
	}
	for _, original := range []*http.Request{got.request, r} {
		if closed, err := owner.OriginalRequestClosed(original); !closed || err != nil {
			t.Fatalf("same request lost its physical close witness: closed=%t err=%v", closed, err)
		}
		if closed, err := owner.OriginalRequestClosed(original.Clone(original.Context())); closed || !errors.Is(err, ErrDenied) {
			t.Fatalf("cloned request gained a physical close witness: closed=%t err=%v", closed, err)
		}
		if closed, err := foreign.OriginalRequestClosed(original); closed || !errors.Is(err, ErrDenied) {
			t.Fatalf("foreign listener gained a physical close witness: closed=%t err=%v", closed, err)
		}
	}
	if err = owner.Close(); err != nil || !owner.Lifetime().PhysicalComplete || borrow.releases.Load() != 1 {
		t.Fatalf("physical close: %v %+v", err, owner.Lifetime())
	}
}
