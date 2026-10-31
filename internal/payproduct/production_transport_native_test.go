//go:build pay_securelink && securelink_openssl && cgo

package payproduct

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// Synthetic certificate fixture follows LINK f9878971; no live credentials.
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

func TestProductionPayCallerUsesNativeExactRoutes(t *testing.T) {
	f := newTLSFixture(t)
	routes := []securelink.Route{{Method: "GET", Path: "/health", Risk: "read"}, {Method: "POST", Path: "/pay/invoices", Risk: "write"}, {Method: "GET", Path: "/pay/invoices/invoice-100", Risk: "read"}}
	edge := securelink.Edge{ID: "pay-adapter", LocalSAN: "adapter.ynx.test", PeerSAN: "pay.ynx.test", Epoch: 1, Roots: []securelink.Root{{Fingerprint: f.root, Until: time.Now().Add(time.Hour)}}, Routes: routes}
	gate, err := securelink.NewGate(securelink.Policy{Edges: []securelink.Edge{edge}})
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	server, err := securelink.NewHTTPServer(securelink.HTTPServerConfig{TLS: f.config(true), Gate: gate, EdgeID: edge.ID, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer synthetic-pay-key" {
			t.Error("original credential wire changed")
		}
		if r.Method == "POST" {
			raw, _ := io.ReadAll(r.Body)
			var input map[string]any
			if json.Unmarshal(raw, &input) != nil || input["intentId"] != "intent-100" || input["idempotencyKey"] != "original-operation" {
				t.Error("original request binding changed")
			}
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"invoice-100","intentId":"intent-100","amount":100,"currency":"YNXT","status":"issued"}`)
	})})
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	defer func() { server.Close(); <-done }()
	edge.LocalSAN, edge.PeerSAN = "pay.ynx.test", "adapter.ynx.test"
	cfg := productionLinkConfig{TLS: f.config(false), Policy: securelink.Policy{Edges: []securelink.Edge{edge}}, EdgeID: edge.ID, Address: listener.Addr().String(), Origin: "https://adapter.ynx.test", TimeoutSeconds: 3, MaxConnections: 2}
	path := filepath.Join(t.TempDir(), "edge.json")
	raw, _ := json.Marshal(cfg)
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	pay, err := NewProductionHTTPPayAPI(cfg.Origin, "synthetic-pay-key", path)
	if err != nil {
		t.Fatal(err)
	}
	defer pay.Client.Transport.(*securelink.Transport).Close()
	if err = pay.Health(context.Background()); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		invoice, err := pay.CreateInvoice(context.Background(), "intent-100", 1, "original-operation")
		if err != nil || invoice.ID != "invoice-100" {
			t.Fatal("protected original caller failed", err)
		}
	}
	if _, err = pay.Invoice(context.Background(), "invoice-100"); err != nil {
		t.Fatal(err)
	}
	before := calls.Load()
	if _, err = pay.Invoice(context.Background(), "unapproved-invoice"); err == nil {
		t.Fatal("dynamic ID expanded policy")
	}
	if _, err = pay.Settle(context.Background(), "invoice-100", "payer", "0xunused", "original-op"); err == nil {
		t.Fatal("unapproved funds route reached adapter")
	}
	if _, err = pay.CreateRefund(context.Background(), "intent-100", 30, "test", "refund-op"); err == nil {
		t.Fatal("unapproved refund route reached adapter")
	}
	if calls.Load() != before {
		t.Fatal("denied route reached real native handler")
	}
	if before != 4 {
		t.Fatal("write was cached or wire count changed", before)
	}
	if _, err = NewProductionHTTPPayAPI("https://other.invalid", "synthetic-pay-key", path); err == nil {
		t.Fatal("origin substitution accepted")
	}
	cfg.TLS.CertFile = ""
	raw, _ = json.Marshal(cfg)
	os.WriteFile(path, raw, 0600)
	if _, err = NewProductionHTTPPayAPI(cfg.Origin, "synthetic-pay-key", path); err == nil {
		t.Fatal("missing mTLS certificate downgraded")
	}
}
