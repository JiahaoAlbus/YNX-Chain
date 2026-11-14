//go:build pay_pq

package payproduct

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Called by the actual normal archive fixture after Core is offline and Pay
// has cold-opened its original Store. This is real Unix IO into the same normal
// product handler, not a synthetic HTTP status handler or a Root grant.
func verifyNativeArchiveUnixNormalRead(t *testing.T, root string, normal http.Handler, original NativeInvoiceProductIntent, invoice, hash string) {
	t.Helper()
	if !filepath.IsAbs(root) {
		t.Fatal("owned short absolute Unix root required")
	}
	dir, err := os.MkdirTemp(root, "p06-archive-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	base := "/v5/pay/products/" + original.ProductID + "/" + strings.ReplaceAll(original.SourceOrder, ":", "%3A") + "/invoices/" + original.Merchant + "/" + invoice
	paths := []string{base + "/originals/" + hash + "/receipt", base + "/archive-reconciliation"}
	if !strings.Contains(base, "%3A") {
		t.Fatal("new wire delta not exercised")
	}
	var entered atomic.Int32
	cfg := securelink.LocalCallerServerConfig{Service: "pay-products", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid()}
	for _, path := range paths {
		cfg.Routes = append(cfg.Routes, securelink.LocalCallerRoute{Method: http.MethodGet, Path: path, MaxBodyBytes: 0, Timeout: 15 * time.Second})
	}
	cfg.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caller, e := securelink.LocalCallerFromRequest(r)
		if e != nil {
			t.Error("real original Unix caller missing", e)
			http.Error(w, "denied", 403)
			return
		}
		if e = caller.CurrentOriginalCaller(r); e != nil {
			t.Error("original same-request current", e)
		}
		if caller.CurrentOriginalCaller(r.Clone(r.Context())) == nil {
			t.Error("cloned request acquired caller")
		}
		material, e := caller.Current(r.Context())
		if e != nil || material.Path != r.RequestURI || r.URL.RawPath != r.RequestURI {
			t.Error("canonical original wire capability changed", e)
		}
		entered.Add(1)
		normal.ServeHTTP(w, r)
	})
	if _, e := securelink.NewLocalCallerServer(cfg); e == nil {
		t.Fatal("generic server widened escaped route policy")
	}
	server, err := securelink.NewProductLocalCallerServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(dir, "pay.sock")
	listener, err := securelink.ListenPrivate(socket, cfg.PeerUID)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	t.Cleanup(func() {
		_ = server.Retire()
		_ = listener.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if e := server.Join(ctx); e != nil {
			t.Error(e)
		}
		select {
		case <-done:
		case <-ctx.Done():
			t.Error("original Unix did not drain")
		}
		if e := server.Close(); e != nil {
			t.Error(e)
		}
	})
	request := func(path string) (int, []byte) {
		t.Helper()
		connection, e := net.DialTimeout("unix", socket, time.Second)
		if e != nil {
			t.Fatal(e)
		}
		defer connection.Close()
		_ = connection.SetDeadline(time.Now().Add(20 * time.Second))
		if _, e = fmt.Fprintf(connection, "GET %s HTTP/1.1\r\nHost: pay-products\r\nConnection: close\r\n\r\n", path); e != nil {
			t.Fatal(e)
		}
		response, e := http.ReadResponse(bufio.NewReader(connection), nil)
		if e != nil {
			t.Fatal(e)
		}
		defer response.Body.Close()
		raw, e := io.ReadAll(io.LimitReader(response.Body, 2<<20))
		if e != nil {
			t.Fatal(e)
		}
		return response.StatusCode, raw
	}
	for _, path := range paths {
		code, raw := request(path)
		if code != 200 || !bytes.Contains(raw, []byte(`"proofVerification":"original-independent-core-verifier"`)) || !bytes.Contains(raw, []byte(`"refundedAtoms":"30"`)) || !bytes.Contains(raw, []byte(`"refundId":"refund-30"`)) {
			t.Fatal("normal archived Unix receipt failed", code, string(raw))
		}
	}
	before := entered.Load()
	for _, path := range []string{strings.ReplaceAll(paths[0], "%3A", ":"), strings.ReplaceAll(paths[0], "%3A", "%3a"), strings.ReplaceAll(paths[0], "%3A", "%253A"), strings.ReplaceAll(paths[0], "%3A", "%2F"), paths[0] + "?x=1"} {
		code, _ := request(path)
		if code < 400 {
			t.Fatal("noncanonical Unix alias admitted", path, code)
		}
	}
	if entered.Load() != before || before != 2 {
		t.Fatal("invalid wire reached normal Source handler", entered.Load(), before)
	}
	t.Log("ACTUAL_PAY_ARCHIVE_UNIX canonical%3A=2 normalVerifiedReceipt=true sameRequestCaller=true clonedCallerDenied=true aliasesDeniedBeforeHandler=5 genericServerUnchanged=true CoreOffline=true RootAdmission=false")
}
