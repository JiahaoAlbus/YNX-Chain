//go:build securelink_openssl && cgo && (darwin || linux)

package securelink

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

// A context wrapper cannot revive the actual original request's lifetime.
type liveLookingCallerContext struct{ context.Context }

func (liveLookingCallerContext) Deadline() (time.Time, bool) {
	return time.Now().Add(time.Second), true
}
func (liveLookingCallerContext) Done() <-chan struct{} { return nil }
func (liveLookingCallerContext) Err() error            { return nil }

// This verifies the actual OS IPC -> actual native TLS -> private material
// pipeline. Opaque application fixtures are not an admitted Auth Source or
// whole-response proof. Auth owns those independent production checks.
func TestProtectedMaterialActualIPCCallerAndNativeExchange(t *testing.T) {
	f := newTLSFixture(t)
	requestWire := []byte(`{"grant":"opaque-original","holder":"unchanged"}`)
	responseWire := []byte(`{"opaque":"original-authority-response"}`)
	var tlsCalls atomic.Int32
	address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tlsCalls.Add(1)
		body, err := io.ReadAll(r.Body)
		if err != nil || !bytes.Equal(body, requestWire) {
			t.Error("original authority wire changed", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(responseWire)
	}))
	peer := fixedClientFixture(t, f, address)
	type captured struct {
		material *ProtectedExchange
		ctx      context.Context
	}
	completed := make(chan captured, 1)
	_, local, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caller, err := LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			http.Error(w, "unavailable", 503)
			return
		}
		derived, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		_, denied := peer.Exchange(derived, "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
			// Original Auth may have waited between caller acquisition and the
			// final write. Mutating that local route must refuse dispatch even
			// while the outer TLS channel and timeout are still valid.
			r.Method = http.MethodDelete
			return WireRequest{Body: requestWire, ContentType: "application/json"}, nil
		})
		r.Method = http.MethodPost
		var beforeWrite *DispatchError
		if !errors.As(denied, &beforeWrite) || beforeWrite.DispatchPossible || tlsCalls.Load() != 0 {
			t.Error("lost original caller fell through to ordinary TLS dispatch", denied)
		}
		response, err := peer.Exchange(derived, "shop.order.read", func(ctx context.Context, actual AuthenticatedChannel) (WireRequest, error) {
			fromCtx, err := LocalCallerFromContext(ctx)
			if err != nil || fromCtx != caller || len(actual.Exporter) != 32 {
				return WireRequest{}, ErrDenied
			}
			localMaterial, err := fromCtx.Current(ctx)
			if err != nil || !bytes.Equal(localMaterial.RequestBody, requestWire) {
				return WireRequest{}, ErrDenied
			}
			return WireRequest{Body: requestWire, ContentType: "application/json"}, nil
		})
		if err != nil {
			t.Error(err)
			http.Error(w, "unavailable", 503)
			return
		}
		material, err := ProtectedExchangeFromResponse(derived, response)
		if err != nil {
			t.Error(err)
			http.Error(w, "unavailable", 503)
			return
		}
		value, err := material.Current(derived)
		if err != nil || !bytes.Equal(value.Caller.RequestBody, requestWire) || !bytes.Equal(value.Request.Body, requestWire) || !bytes.Equal(value.ResponseBody, responseWire) || value.Operation.Path != "/api/tools/shop.order.read" || value.StatusCode != 200 {
			t.Error("actual caller/channel/original materials differ", err)
		}
		value.Caller.RequestBody[0] ^= 1
		value.Request.Body[0] ^= 1
		value.ResponseBody[0] ^= 1
		value.Channel.Exporter[0] ^= 1
		value.Profile.Operations[0].Path = "/forged"
		again, err := material.Current(derived)
		if err != nil || !bytes.Equal(again.Request.Body, requestWire) || !bytes.Equal(again.ResponseBody, responseWire) || again.Profile.Operations[0].Path != "/api/tools/shop.order.read" {
			t.Error("material mutation changed the private exchange", err)
		}
		for _, mutate := range []func(*WireResponse){
			func(r *WireResponse) { r.Body = []byte(`{"ok":true}`) },
			func(r *WireResponse) { r.StatusCode = 201 },
			func(r *WireResponse) { r.ContentType = "application/cbor" },
			func(r *WireResponse) { r.Channel.Exporter = make([]byte, 32) },
		} {
			changed := response
			mutate(&changed)
			if _, err := ProtectedExchangeFromResponse(derived, changed); err == nil {
				t.Error("altered response became original exchange material")
			}
		}
		if _, err := material.Current(context.Background()); err == nil {
			t.Error("different caller context acquired the exchange")
		}
		copied := *material
		if _, err := copied.Current(derived); err == nil {
			t.Error("copied handle acquired a new exchange")
		}
		completed <- captured{material, r.Context()}
		if _, err := peer.RevokeService("adapter.ynx.test", 1); err != nil {
			t.Error(err)
		}
		if _, err := material.Current(derived); err == nil {
			t.Error("revoked actual TLS endpoint retained current material")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response.Body)
	}), localTestRoute())
	response, err := local.Call(context.Background(), http.MethodPost, "/authority/prepare", "application/json", requestWire)
	if err != nil || !bytes.Equal(response.Body, responseWire) || tlsCalls.Load() != 1 {
		t.Fatal("real local caller/native pipeline failed", err, tlsCalls.Load())
	}
	old := <-completed
	if _, err = old.material.Current(old.ctx); err == nil {
		t.Fatal("finished local request retained a usable exchange")
	}
	// A new, unrevoked TLS client still cannot reinterpret a stale real local
	// caller as an ordinary non-IPC request, even if its outer ctx hides cancel.
	fresh := fixedClientFixture(t, f, address)
	prepared := false
	_, err = fresh.Exchange(liveLookingCallerContext{old.ctx}, "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
		prepared = true
		return WireRequest{Body: requestWire, ContentType: "application/json"}, nil
	})
	var stale *DispatchError
	if !errors.As(err, &stale) || stale.DispatchPossible || prepared || tlsCalls.Load() != 1 {
		t.Fatal("stale original caller downgraded to an ordinary exchange", err, prepared)
	}
}

func TestProtectedMaterialDispatchErrorsPreserveUncertainty(t *testing.T) {
	f := newTLSFixture(t)
	var calls atomic.Int32
	address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{\"x\":")
		_ = conn.Close()
	}))
	peer := fixedClientFixture(t, f, address)
	cause := errors.New("original before-send denial")
	_, err := peer.Exchange(context.Background(), "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) { return WireRequest{}, cause })
	var phase *DispatchError
	if !errors.Is(err, cause) || !errors.As(err, &phase) || phase.DispatchPossible || calls.Load() != 0 {
		t.Fatal("pre-send failure changed cause or claimed dispatch", err)
	}
	_, err = peer.Exchange(context.Background(), "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
		return WireRequest{Body: []byte(`{"op":"original-only"}`), ContentType: "application/json"}, nil
	})
	phase = nil
	// An unclean TLS close may reject the read before the partial HTTP body
	// reaches Go. Preserve that actual native first cause and observed count;
	// do not translate it into an invented HTTP EOF or complete receipt.
	if err == nil || !errors.As(err, &phase) || !phase.DispatchPossible || phase.Cause == nil || !errors.Is(err, phase.Cause) || phase.PartialResponseBytes < 0 || phase.PartialResponseBytes > 5 || calls.Load() != 1 {
		t.Fatal("partial response lost original uncertainty or retried", err, phase, calls.Load())
	}
}
