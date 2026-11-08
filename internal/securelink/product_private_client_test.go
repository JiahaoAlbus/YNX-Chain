//go:build linux || darwin

package securelink

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func productPrivateTestRequest(op uint32) productPrivateRequest {
	p := productPrivateTemplates[op]
	for label, value := range map[string]string{"{intentId}": "npi_" + strings.Repeat("a", 48), "{merchant}": "0x" + strings.Repeat("b", 40), "{nativeHash}": "0x" + strings.Repeat("c", 64), "{invoiceId}": "invoice:original", "{sourceOrder}": "Order%3AOriginal", "{productId}": "shop.order"} {
		if op >= 12 && label == "{invoiceId}" {
			value = "Invoice%3AOriginal"
		}
		p = strings.ReplaceAll(p, label, value)
	}
	r := productPrivateRequest{operation: op, path: p, method: http.MethodGet}
	if op == 0 || op == 1 || op == 2 || op == 6 || op == 7 || op == 8 || op == 9 {
		r.method = http.MethodPost
		r.contentType = "application/json"
		r.body = []byte(`{"PUBLIC":"opaque"}`)
	}
	return r
}

func TestProductPrivateRoutesStableR2(t *testing.T) {
	for op := uint32(0); op < productPrivateOperationCount; op++ {
		r := productPrivateTestRequest(op)
		err := productPrivateRoute(r)
		if op == 10 {
			if err == nil {
				t.Fatal("LOCAL slot entered HTTP")
			}
			continue
		}
		if err != nil {
			t.Fatalf("actual table op%d: %v", op, err)
		}
	}
	r := productPrivateTestRequest(12)
	for _, bad := range []string{strings.Replace(r.path, "%3A", "%253A", 1), strings.Replace(r.path, "%3A", "%3a", 1), strings.Replace(r.path, "%3A", "%2F", 1), strings.Replace(r.path, "%3A", "%3F", 1), strings.Replace(r.path, "%3A", ":", 1), r.path + "?q=1", r.path + "#x", r.path + "/", strings.Replace(r.path, "shop.order", "other", 1)} {
		copy := r
		copy.path = bad
		if productPrivateRoute(copy) == nil {
			t.Fatalf("noncanonical archive accepted: %s", bad)
		}
	}
	for _, change := range []func(*productPrivateRequest){func(r *productPrivateRequest) { r.method = "POST" }, func(r *productPrivateRequest) { r.contentType = "application/json" }, func(r *productPrivateRequest) { r.body = []byte("x") }} {
		copy := r
		change(&copy)
		if productPrivateRoute(copy) == nil {
			t.Fatal("GET payload/method alias accepted")
		}
	}
	post := productPrivateTestRequest(0)
	post.body = nil
	if productPrivateRoute(post) == nil {
		t.Fatal("empty POST accepted")
	}
	ordinary := productPrivateTestRequest(4)
	ordinary.path = strings.Replace(ordinary.path, "invoice:original", "Invoice", 1)
	if productPrivateRoute(ordinary) == nil {
		t.Fatal("ordinary ID acquired archive grammar")
	}
}

func TestProductPrivateClientObservedWriteCancellationAndDrain(t *testing.T) {
	var calls atomic.Int32
	route := LocalCallerRoute{Method: http.MethodPost, Path: productPrivateTemplates[0], MaxBodyBytes: 1 << 20, Timeout: 2 * time.Second}
	_, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); _, _ = w.Write([]byte("PUBLIC")) }), route)
	owner, err := newProductPrivateClient(context.Background(), productPrivateProfile{cfg: client.cfg, enabled: 1})
	if err != nil {
		t.Fatal(err)
	}
	req := productPrivateTestRequest(0)
	first := errors.New("PUBLIC original per-call fence denied")
	out, err := owner.request(req, func() error {
		if !owner.mu.TryLock() {
			t.Error("native write callback ran under owner mutex")
		} else {
			owner.mu.Unlock()
		}
		return first
	})
	var dispatch *DispatchError
	if !errors.Is(err, first) || !errors.As(err, &dispatch) || dispatch.DispatchPossible || out.PacketPresent || calls.Load() != 0 {
		t.Fatal("write fence dispatched", out, err, calls.Load())
	}
	// Distinct actual Auth permissions may authorize later explicit requests;
	// transport never substitutes an operation-index-wide once bit for Auth.
	for i := 0; i < 2; i++ {
		out, err = owner.request(req, func() error { return nil })
		if err != nil || !out.BodyComplete || string(out.Body) != "PUBLIC" {
			t.Fatal("independent call failed", out, err)
		}
	}
	if calls.Load() != 2 {
		t.Fatal("automatic retry or missing dispatch", calls.Load())
	}
	owner.retire()
	if done, err := owner.drain(); !done || !errors.Is(err, first) {
		t.Fatal("physical drain erased first cause", done, err)
	}
	if _, err := owner.request(req, func() error { t.Error("retired request called native fence"); return nil }); !errors.Is(err, ErrDenied) {
		t.Fatal("retired owner reused", err)
	}
}
