//go:build (linux || darwin) && securelink_openssl && cgo && securelink_public_server_tls_test

package securelink

// This explicitly selected PUBLIC test fixture is not a normal issuer. It has
// no certificate, Source, receiver-row, URL or provider input. A testing.TB is
// required and all keys are disposable test assets. Never add this tag to a
// product build or treat its identity as an independently reviewed Root row.
import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

const publicServerTLSFixtureHost = "public-cloud.example"
const publicServerTLSFixturePath = "/api/v1/ide/deployments/PUBLIC_original_operation_0001"

// PUBLICOriginalServerTLSFixture permits cross-package consumer tests to use
// the same actual PQ listener and original request. It does not supply Auth's
// Source, SQL, DEVICE/session proof, receiver release or business admission.
type PUBLICOriginalServerTLSFixture struct {
	owner     *OriginalServerTLS
	client    *native.Context
	address   string
	serveDone chan error
	mu        sync.Mutex
	active    *PUBLICOriginalServerTLSRequest
}

// PUBLICOriginalServerTLSRequest keeps one actual handler/request alive until
// Close has read the complete response and joined the native client work.
// A copied request remains a copy and cannot pass CurrentOriginalRequest.
type PUBLICOriginalServerTLSRequest struct {
	fixture  *PUBLICOriginalServerTLSFixture
	target   string
	request  *http.Request
	ready    chan struct{}
	release  chan struct{}
	done     chan struct{}
	workErr  error
	once     sync.Once
	closeErr error
}

type publicConsumerServerTLSBorrow struct {
	profile    originalServerTLSProfile
	listener   net.Listener
	actual     *native.Context
	retireOnce sync.Once
	retireErr  error
}

func (*publicConsumerServerTLSBorrow) originalServerTLSBorrowHeld() bool { return true }
func (*publicConsumerServerTLSBorrow) currentOriginalServerTLSCredential(ctx context.Context) error {
	return ctx.Err()
}
func (b *publicConsumerServerTLSBorrow) originalServerTLSProfile(context.Context) (originalServerTLSProfile, error) {
	return b.profile, nil
}
func (b *publicConsumerServerTLSBorrow) retireOriginalServerTLSCredential() {
	b.retireOnce.Do(func() { b.retireErr = b.listener.Close() })
}
func (b *publicConsumerServerTLSBorrow) releaseOriginalServerTLSCredential(context.Context) (bool, bool, error) {
	if b.retireErr != nil {
		return false, false, b.retireErr
	}
	if _, err := b.actual.ServerIdentity(); !errors.Is(err, net.ErrClosed) {
		return false, false, errors.New("PUBLIC fixture credential released before SSL_CTX close")
	}
	return true, true, nil
}

// NewPUBLICOriginalServerTLSFixture has no caller-selectable identity or Source.
// It generates only fixed temporary ML-DSA-87 test assets, then uses the real
// native Context, private borrow, OriginalServerTLS.Serve and mTLS client.
func NewPUBLICOriginalServerTLSFixture(t testing.TB) *PUBLICOriginalServerTLSFixture {
	t.Helper()
	directory := t.TempDir()
	asset := func(name string) string { return filepath.Join(directory, name) }
	run := func(args ...string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if raw, err := exec.CommandContext(ctx, "openssl", args...).CombinedOutput(); err != nil {
			t.Fatalf("PUBLIC PQ fixture %s: %v %s", args[0], err, raw)
		}
	}
	run("genpkey", "-algorithm", "ML-DSA-87", "-out", asset("root.key"))
	run("req", "-new", "-x509", "-key", asset("root.key"), "-subj", "/CN=PUBLIC-test-only-not-Root", "-days", "1", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", asset("root.pem"))
	for i, identity := range []struct{ name, san, eku string }{{"server", publicServerTLSFixtureHost, "serverAuth"}, {"client", "public-ide-client.example", "clientAuth"}} {
		run("genpkey", "-algorithm", "ML-DSA-87", "-out", asset(identity.name+".key"))
		run("req", "-new", "-key", asset(identity.name+".key"), "-subj", "/CN=PUBLIC-test-only", "-out", asset(identity.name+".csr"))
		ext := "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=" + identity.eku + "\nsubjectAltName=DNS:" + identity.san + "\n"
		if err := os.WriteFile(asset(identity.name+".ext"), []byte(ext), 0600); err != nil {
			t.Fatal(err)
		}
		run("x509", "-req", "-in", asset(identity.name+".csr"), "-CA", asset("root.pem"), "-CAkey", asset("root.key"), "-set_serial", fmt.Sprint(i+1), "-days", "1", "-extfile", asset(identity.name+".ext"), "-out", asset(identity.name+".pem"))
	}
	actual, err := native.NewContext(native.Config{CertFile: asset("server.pem"), KeyFile: asset("server.key"), CAFile: asset("root.pem"), PeerSAN: "public-ide-client.example", Server: true})
	if err != nil {
		t.Fatal(err)
	}
	info, err := actual.ServerIdentity()
	if err != nil {
		_ = actual.Close()
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		_ = actual.Close()
		t.Fatal(err)
	}
	now := time.Now()
	borrow := &publicConsumerServerTLSBorrow{actual: actual, listener: listener, profile: originalServerTLSProfile{
		sourceID: "PUBLIC_SOURCE", instanceID: "PUBLIC_INSTANCE", issuerRef: "PUBLIC_ISSUER_NOT_ROOT", credentialRef: "PUBLIC_CREDENTIAL_NOT_ROOT",
		targetOrigin: "https://" + publicServerTLSFixtureHost, serverName: publicServerTLSFixtureHost, peerSAN: "public-ide-client.example",
		listenNetwork: "tcp", listenAddress: listener.Addr().String(), certificateSHA256: info.CertificateSHA256, spkiSHA256: info.SPKISHA256,
		credentialEpoch: 1, credentialFrom: now.Add(-time.Minute), credentialUntil: now.Add(time.Minute),
	}}
	owner, err := newOriginalServerTLS(context.Background(), &HTTPServer{tls: actual}, listener, borrow, nil)
	if err != nil {
		// A nonnil partial owner owns its original context and borrow.
		if owner != nil {
			owner.Retire()
			_ = owner.Join(context.Background())
			_ = owner.Close()
		} else {
			err = errors.Join(err, listener.Close(), actual.Close())
		}
		t.Fatal(err)
	}
	f := &PUBLICOriginalServerTLSFixture{owner: owner, address: listener.Addr().String(), serveDone: make(chan error, 1)}
	t.Cleanup(func() {
		owner.Retire()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := owner.Join(ctx); err != nil {
			t.Errorf("PUBLIC listener actual Join: %v", err)
		} else if err := owner.Close(); err != nil || !owner.Lifetime().PhysicalComplete || owner.Lifetime().BorrowHeld {
			t.Errorf("PUBLIC listener actual Close: %v %+v", err, owner.Lifetime())
		}
		select {
		case err := <-f.serveDone:
			if !errors.Is(err, http.ErrServerClosed) {
				t.Errorf("PUBLIC listener Serve return: %v", err)
			}
		case <-ctx.Done():
			t.Errorf("PUBLIC listener Serve debt remains: %v", ctx.Err())
		}
		if f.client != nil {
			if err := f.client.Close(); err != nil {
				t.Errorf("PUBLIC client context Close: %v", err)
			}
		}
	})
	f.client, err = native.NewContext(native.Config{CertFile: asset("client.pem"), KeyFile: asset("client.key"), CAFile: asset("root.pem"), PeerSAN: publicServerTLSFixtureHost})
	if err != nil {
		// Serve still starts so the registered cleanup has a real completion.
		go func() { f.serveDone <- owner.Serve(&http.Server{}) }()
		t.Fatal(err)
	}
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		active := f.active
		f.mu.Unlock()
		if active == nil || r.Method != "GET" || r.RequestURI != active.target || r.Host != publicServerTLSFixtureHost {
			http.Error(w, "PUBLIC fixed fixture request required", http.StatusBadRequest)
			return
		}
		active.request = r
		close(active.ready)
		select {
		case <-active.release:
		case <-r.Context().Done():
		}
		w.WriteHeader(http.StatusNoContent)
	})}
	go func() { f.serveDone <- owner.Serve(server) }()
	return f
}

func (f *PUBLICOriginalServerTLSFixture) OriginalServerTLS() *OriginalServerTLS { return f.owner }

// BeginOriginalGET accepts only the V4 proof carrier DATA; it neither parses nor
// approves it. The route, Host, certificates and private credential are fixed.
// Cleanup is registered before dispatch, including a failed/partial handshake.
func (f *PUBLICOriginalServerTLSFixture) BeginOriginalGET(t testing.TB, proofHeader string) *PUBLICOriginalServerTLSRequest {
	return f.beginOriginalGET(t, publicServerTLSFixturePath, proofHeader)
}

// BeginOriginalLogsGET is the second fixed finite route used to verify that
// sequential original request contexts do not borrow one another's principal.
func (f *PUBLICOriginalServerTLSFixture) BeginOriginalLogsGET(t testing.TB, proofHeader string) *PUBLICOriginalServerTLSRequest {
	return f.beginOriginalGET(t, publicServerTLSFixturePath+"/logs", proofHeader)
}

func (f *PUBLICOriginalServerTLSFixture) beginOriginalGET(t testing.TB, target, proofHeader string) *PUBLICOriginalServerTLSRequest {
	t.Helper()
	if len(proofHeader) > 196608 || strings.ContainsAny(proofHeader, "\r\n") {
		t.Fatal("PUBLIC fixture requires one bounded header value")
	}
	r := &PUBLICOriginalServerTLSRequest{fixture: f, target: target, ready: make(chan struct{}), release: make(chan struct{}), done: make(chan struct{})}
	f.mu.Lock()
	if f.active != nil {
		f.mu.Unlock()
		t.Fatal("PUBLIC fixture already holds an original request")
	}
	f.active = r
	f.mu.Unlock()
	t.Cleanup(func() {
		if err := r.Close(); err != nil {
			t.Errorf("PUBLIC request actual response/client drain: %v", err)
		}
	})
	go func() {
		err := func() (result error) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			raw, err := (&net.Dialer{}).DialContext(ctx, "tcp", f.address)
			if err != nil {
				return err
			}
			conn, err := f.client.Client(ctx, raw)
			if err != nil {
				return errors.Join(err, raw.Close())
			}
			defer func() { result = errors.Join(result, conn.Close()) }()
			if err := conn.SetDeadline(time.Now().Add(30 * time.Second)); err != nil {
				return err
			}
			wire := "GET " + target + " HTTP/1.1\r\nHost: " + publicServerTLSFixtureHost + "\r\nConnection: close\r\nX-YNX-Product-Session-Proof-V4: " + proofHeader + "\r\n\r\n"
			if _, err := io.WriteString(conn, wire); err != nil {
				return err
			}
			response, err := http.ReadResponse(bufio.NewReader(conn), nil)
			if err != nil {
				return err
			}
			_, bodyErr := io.Copy(io.Discard, response.Body)
			closeErr := response.Body.Close()
			if response.StatusCode != http.StatusNoContent {
				return errors.Join(fmt.Errorf("PUBLIC response status %d", response.StatusCode), bodyErr, closeErr)
			}
			return errors.Join(bodyErr, closeErr)
		}()
		r.workErr = err
		close(r.done)
	}()
	select {
	case <-r.ready:
		return r
	case <-r.done:
		t.Fatalf("PUBLIC original request did not enter actual handler: %v", r.workErr)
	}
	return nil
}

func (r *PUBLICOriginalServerTLSRequest) OriginalRequest() *http.Request { return r.request }

func (r *PUBLICOriginalServerTLSRequest) Close() error {
	r.once.Do(func() {
		close(r.release)
		<-r.done
		r.closeErr = r.workErr
		r.fixture.mu.Lock()
		if r.fixture.active == r {
			r.fixture.active = nil
		}
		r.fixture.mu.Unlock()
	})
	return r.closeErr
}
