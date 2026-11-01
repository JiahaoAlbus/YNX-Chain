//go:build securelink_openssl && cgo

package securelink

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

type tlsFixture struct{ dir, root string }

func newTLSFixture(t *testing.T) tlsFixture {
	t.Helper()
	f := tlsFixture{dir: t.TempDir()}
	run := func(args ...string) {
		t.Helper()
		if out, err := exec.Command("openssl", args...).CombinedOutput(); err != nil {
			t.Fatalf("isolated certificate fixture %s: %v %s", args[0], err, out)
		}
	}
	path := func(n string) string { return filepath.Join(f.dir, n) }
	run("genpkey", "-algorithm", "ML-DSA-87", "-out", path("root.key"))
	run("req", "-new", "-x509", "-key", path("root.key"), "-subj", "/CN=isolated-http-link-root", "-days", "1", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", path("root.pem"))
	for i, v := range []struct{ name, san, eku string }{{"server", "adapter.ynx.test", "serverAuth"}, {"client", "pay.ynx.test", "clientAuth"}} {
		run("genpkey", "-algorithm", "ML-DSA-87", "-out", path(v.name+".key"))
		run("req", "-new", "-key", path(v.name+".key"), "-subj", "/CN=unused", "-out", path(v.name+".csr"))
		ext := []byte("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=" + v.eku + "\nsubjectAltName=DNS:" + v.san + "\n")
		if err := os.WriteFile(path(v.name+".ext"), ext, 0600); err != nil {
			t.Fatal(err)
		}
		run("x509", "-req", "-in", path(v.name+".csr"), "-CA", path("root.pem"), "-CAkey", path("root.key"), "-set_serial", []string{"1", "2"}[i], "-days", "1", "-extfile", path(v.name+".ext"), "-out", path(v.name+".pem"))
	}
	b, err := os.ReadFile(path("root.pem"))
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(b)
	if block == nil {
		t.Fatal("bad isolated root")
	}
	h := sha256.Sum256(block.Bytes)
	f.root = hex.EncodeToString(h[:])
	return f
}
func (f tlsFixture) config(server bool) native.Config {
	name, peer := "client", "adapter.ynx.test"
	if server {
		name, peer = "server", "pay.ynx.test"
	}
	return native.Config{CertFile: filepath.Join(f.dir, name+".pem"), KeyFile: filepath.Join(f.dir, name+".key"), CAFile: filepath.Join(f.dir, "root.pem"), PeerSAN: peer, Server: server}
}
func (f tlsFixture) policy(server bool) Policy {
	p := fixturePolicy()
	p.Edges[0].Roots[0].Fingerprint = f.root
	if !server {
		p.Edges[0].LocalSAN = "pay.ynx.test"
		p.Edges[0].PeerSAN = "adapter.ynx.test"
	}
	return p
}

type runningHTTP struct {
	server  *HTTPServer
	gate    *Gate
	address string
	calls   atomic.Int32
	conns   chan *native.Conn
}

func startHTTP(t *testing.T, f tlsFixture) *runningHTTP {
	return startHTTPWithHeaderLimit(t, f, 5*time.Second)
}
func startHTTPWithHeaderLimit(t *testing.T, f tlsFixture, headerTimeout time.Duration) *runningHTTP {
	t.Helper()
	g, err := NewGate(f.policy(true))
	if err != nil {
		t.Fatal(err)
	}
	r := &runningHTTP{gate: g, conns: make(chan *native.Conn, 32)}
	s, err := NewHTTPServer(HTTPServerConfig{TLS: f.config(true), Gate: g, EdgeID: "pay-adapter", Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.calls.Add(1)
		p := req.Context().Value(connKey{}).(*pendingConn)
		c, _ := p.secure()
		r.conns <- c
		_, _ = io.WriteString(w, "protected-business-response")
	})})
	if err != nil {
		t.Fatal(err)
	}
	r.server = s
	s.server.ReadHeaderTimeout = headerTimeout
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	r.address = l.Addr().String()
	done := make(chan error, 1)
	go func() { done <- s.Serve(l) }()
	t.Cleanup(func() { _ = s.Close(); <-done })
	return r
}
func clientHTTP(t *testing.T, f tlsFixture, r *runningHTTP) *http.Client {
	t.Helper()
	g, _ := NewGate(f.policy(false))
	client, err := NewHTTPClient(HTTPClientConfig{TLS: f.config(false), Gate: g, EdgeID: "pay-adapter", Address: r.address, Origin: "https://adapter.ynx.test", Timeout: 3 * time.Second, MaxConnections: 2})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Transport.(*Transport).Close() })
	return client
}
func readHTTP(t *testing.T, client *http.Client, path string) {
	t.Helper()
	resp, err := client.Get("https://adapter.ynx.test" + path)
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil || resp.StatusCode != 200 || string(b) != "protected-business-response" {
		t.Fatalf("protected handler: %d %q %v", resp.StatusCode, b, err)
	}
}
func dialNative(t *testing.T, f tlsFixture, address string) *native.Conn {
	t.Helper()
	c, err := native.NewContext(f.config(false))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	raw, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, err := c.Client(ctx, raw)
	if err != nil {
		_ = raw.Close()
		t.Fatal(err)
	}
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}
func TestLINK01RealHandlerMethodSpoofAndRevokedConnection(t *testing.T) {
	f := newTLSFixture(t)
	r := startHTTP(t, f)
	client := clientHTTP(t, f, r)
	readHTTP(t, client, "/settlement")
	first := <-r.conns
	readHTTP(t, client, "/settlement")
	if next := <-r.conns; next != first {
		t.Fatal("bounded authenticated pool did not reuse connection")
	}
	conn := dialNative(t, f, r.address)
	reader := bufio.NewReader(conn)
	for _, test := range []struct {
		method string
		header bool
	}{{"DELETE", false}, {"GET", true}} {
		req, _ := http.NewRequest(test.method, "https://adapter.ynx.test/settlement", nil)
		if test.header {
			req.Header.Set("X-YNX-Service-ID", "pay.ynx.test")
		}
		if err := req.Write(conn); err != nil {
			t.Fatal(err)
		}
		resp, err := http.ReadResponse(reader, req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Fatal("actual handler accepted wrong method or injected peer", resp.StatusCode)
		}
	}
	if r.calls.Load() != 2 {
		t.Fatal("rejected request reached business handler")
	}
	n, err := r.gate.RevokeService("pay.ynx.test", 1)
	if err != nil || n < 1 {
		t.Fatal("open connection was not actively revoked", n, err)
	}
	resp, err := client.Get("https://adapter.ynx.test/settlement")
	if resp != nil {
		_ = resp.Body.Close()
	}
	if err == nil {
		t.Fatal("revoked connection executed business")
	}
	if r.calls.Load() != 2 {
		t.Fatal("revocation dispatched new business")
	}
}

// The Auth fixture below checks binding and dynamic-state call-through. It is
// deliberately not a dual-signature crypto implementation or production Auth.
type readAuthorityFixture struct {
	revoked atomic.Bool
	checks  atomic.Int32
}

func (a *readAuthorityFixture) VerifyReadProof(ctx context.Context, b ReadBinding, proof []byte) error {
	if b.Domain != "YNX-LINK-READ/v1" || b.ChannelBinding == "" || string(proof) != "isolated-auth-fixture-A-and-B" {
		return ErrDenied
	}
	return nil
}
func (a *readAuthorityFixture) CheckRead(context.Context, ReadBinding, Tool, Ref) error {
	a.checks.Add(1)
	if a.revoked.Load() {
		return ErrRevoked
	}
	return nil
}
func TestLINK020304ActualChannelBindingDynamicRevocationAndWriteDenial(t *testing.T) {
	f := newTLSFixture(t)
	r := startHTTP(t, f)
	client := clientHTTP(t, f, r)
	readHTTP(t, client, "/settlement")
	conn := <-r.conns
	auth := &readAuthorityFixture{}
	if err := r.gate.ConfigureReadFastPath(auth, []Tool{{ID: "lookup", Revision: "1", Method: "GET", Path: "/settlement", Risk: "read"}, {ID: "transfer", Revision: "1", Method: "POST", Path: "/settle", Risk: "asset"}}, 16); err != nil {
		t.Fatal(err)
	}
	i := ReadIdentity{Realm: "realm", Tenant: "tenant", Agent: "agent", AgentEpoch: "1", Grant: "grant", GrantRev: "1", Audience: "adapter.ynx.test"}
	challenge, err := r.gate.IssueReadChallenge(context.Background(), conn, "pay-adapter", "GET", "/settlement", i, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := r.gate.BindReadChannel(context.Background(), conn, challenge.ID, []byte("isolated-auth-fixture-A-and-B"))
	if err != nil {
		t.Fatal(err)
	}
	alias := *conn
	i.Agent = "second-agent"
	if _, err = r.gate.IssueReadChallenge(context.Background(), &alias, "pay-adapter", "GET", "/settlement", i, time.Minute); err == nil {
		t.Fatal("copied handle bound second Agent to same actual TLS connection")
	}
	if _, err = r.gate.BindReadChannel(context.Background(), conn, challenge.ID, []byte("isolated-auth-fixture-A-and-B")); err == nil {
		t.Fatal("challenge replay accepted")
	}
	resource := Ref{Realm: "realm", Tenant: "tenant", Kind: "order", ID: "order-1", Rev: "1"}
	if _, err = r.gate.CheckReadFastPath(context.Background(), conn, handle, "transfer", resource, "1"); err == nil {
		t.Fatal("asset action entered read fast path")
	}
	if _, err = r.gate.CheckReadFastPath(context.Background(), conn, handle, "lookup", resource, "1"); err != nil {
		t.Fatal(err)
	}
	if _, err = r.gate.CheckReadFastPath(context.Background(), conn, handle, "lookup", resource, "1"); !errors.Is(err, ErrReplay) {
		t.Fatal("sequence replay", err)
	}
	other := dialNative(t, f, r.address)
	req, _ := http.NewRequest("GET", "https://adapter.ynx.test/settlement", nil)
	if err = req.Write(other); err != nil {
		t.Fatal(err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(other), req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	otherServer := <-r.conns
	if _, err = r.gate.CheckReadFastPath(context.Background(), otherServer, handle, "lookup", resource, "2"); err == nil {
		t.Fatal("handle migrated to another TLS connection")
	}
	auth.revoked.Store(true)
	if _, err = r.gate.CheckReadFastPath(context.Background(), conn, handle, "lookup", resource, "2"); !errors.Is(err, ErrRevoked) {
		t.Fatal("warm dynamic revocation bypass", err)
	}
	if auth.checks.Load() != 2 {
		t.Fatal("dynamic authority was cached")
	}
	n, err := r.gate.CloseRevokedSessions(Ref{Realm: "realm", Tenant: "tenant", Kind: "agent", ID: "agent"}, "2")
	if err != nil || n != 1 {
		t.Fatal("principal connection not closed", n, err)
	}
	if conn.Snapshot().Verified {
		t.Fatal("revoked TLS endpoint remained open")
	}
	if _, err = r.gate.CheckReadFastPath(context.Background(), conn, handle, "lookup", resource, "2"); err == nil {
		t.Fatal("old handle survived close")
	}
}

func TestLINK01HandshakePreservesHTTPHeaderDeadline(t *testing.T) {
	f := newTLSFixture(t)
	r := startHTTPWithHeaderLimit(t, f, 250*time.Millisecond)
	conn := dialNative(t, f, r.address)
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	start := time.Now()
	var b [1]byte
	_, err := conn.Read(b[:])
	if err == nil {
		t.Fatal("idle peer unexpectedly received business bytes")
	}
	if time.Since(start) > 700*time.Millisecond {
		t.Fatal("native handshake erased HTTP header timeout", err)
	}
	if r.calls.Load() != 0 {
		t.Fatal("idle peer reached handler")
	}
}

func TestLINK02ExpiredBindingCannotRebindSameConnection(t *testing.T) {
	f := newTLSFixture(t)
	r := startHTTP(t, f)
	client := clientHTTP(t, f, r)
	readHTTP(t, client, "/settlement")
	conn := <-r.conns
	if err := r.gate.ConfigureReadFastPath(&readAuthorityFixture{}, []Tool{{ID: "lookup", Revision: "1", Method: "GET", Path: "/settlement", Risk: "read"}}, 16); err != nil {
		t.Fatal(err)
	}
	i := ReadIdentity{Realm: "realm", Tenant: "tenant", Agent: "agent-A", AgentEpoch: "1", Grant: "grant", GrantRev: "1", Audience: "adapter.ynx.test"}
	c, err := r.gate.IssueReadChallenge(context.Background(), conn, "pay-adapter", "GET", "/settlement", i, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := r.gate.BindReadChannel(context.Background(), conn, c.ID, []byte("isolated-auth-fixture-A-and-B"))
	if err != nil {
		t.Fatal(err)
	}
	r.gate.mu.Lock()
	r.gate.read.sessions[handle].binding.Expires = time.Now().Add(-time.Second)
	r.gate.mu.Unlock()
	i.Agent = "agent-B"
	if _, err = r.gate.IssueReadChallenge(context.Background(), conn, "pay-adapter", "GET", "/settlement", i, time.Minute); err == nil {
		t.Fatal("same connection rebound another Agent after expiry")
	}
	if conn.Snapshot().Verified {
		t.Fatal("expired bound connection remained alive")
	}
}

func TestLINK01RootRotationWindowAndCertificateRevocation(t *testing.T) {
	old := newTLSFixture(t)
	previous := startHTTP(t, old)
	oldClient := clientHTTP(t, old, previous)
	readHTTP(t, oldClient, "/settlement")
	oldConn := <-previous.conns
	next := newTLSFixture(t)
	bundle := filepath.Join(next.dir, "bundle.pem")
	oldPEM, err := os.ReadFile(filepath.Join(old.dir, "root.pem"))
	if err != nil {
		t.Fatal(err)
	}
	newPEM, err := os.ReadFile(filepath.Join(next.dir, "root.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(bundle, append(oldPEM, newPEM...), 0600); err != nil {
		t.Fatal(err)
	}
	policy := next.policy(true)
	policy.Edges[0].Epoch = 2
	policy.Edges[0].Roots = append(policy.Edges[0].Roots, Root{Fingerprint: old.root, Until: time.Now().Add(-time.Second)})
	if err = previous.gate.ReplacePolicy(policy); err != nil {
		t.Fatal(err)
	}
	if oldConn.Snapshot().Verified {
		t.Fatal("old channel survived policy rotation")
	}
	serverTLS := next.config(true)
	serverTLS.CAFile = bundle
	conns := make(chan *native.Conn, 4)
	server, err := NewHTTPServer(HTTPServerConfig{TLS: serverTLS, Gate: previous.gate, EdgeID: "pay-adapter", Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.Context().Value(connKey{}).(*pendingConn)
		c, _ := p.secure()
		conns <- c
		_, _ = io.WriteString(w, "protected-business-response")
	})})
	if err != nil {
		t.Fatal(err)
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(l) }()
	defer func() { _ = server.Close(); <-done }()
	newClient := clientHTTP(t, next, &runningHTTP{address: l.Addr().String()})
	readHTTP(t, newClient, "/settlement")
	newConn := <-conns
	// Both roots are cryptographically trusted by the TLS endpoint. Only the
	// explicitly unexpired root window may pass the real business handler.
	oldTLS := old.config(false)
	oldTLS.CAFile = bundle
	clientGate, _ := NewGate(next.policy(false))
	expiredRootClient, err := NewHTTPClient(HTTPClientConfig{TLS: oldTLS, Gate: clientGate, EdgeID: "pay-adapter", Address: l.Addr().String(), Origin: "https://adapter.ynx.test", Timeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer expiredRootClient.Transport.(*Transport).Close()
	resp, err := expiredRootClient.Get("https://adapter.ynx.test/settlement")
	if err != nil {
		t.Fatal("expected handshake success followed by root-window rejection", err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("expired old root reached handler", resp.StatusCode)
	}
	if n, err := previous.gate.RevokeCertificate(newConn.Snapshot().PeerFingerprint); err != nil || n != 1 {
		t.Fatal("certificate revocation did not close current connection", n, err)
	}
	if newConn.Snapshot().Verified {
		t.Fatal("revoked certificate retained live channel")
	}
}
