//go:build shop_proof_interop_public && cgo && (darwin || linux)

package productreadsource

import (
	"bytes"
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"net/http"
	"testing"
)

// This test explicitly separates real C entry refusal under the normal full
// Source gate from real observed-Source continuation HTTP/custody. No PUBLIC
// authority, Session, SDK signer or normal Main proof producer is substituted.
func TestShopProofConsumerMatching(t *testing.T) {
	for _, mode := range []string{"PUBLIC_PROOF_DATA", "PUBLIC_FIRST0", "PUBLIC_FOREIGN_BORROW"} {
		t.Run("cgo-refusal-"+mode, func(t *testing.T) {
			c, calls := publicShopClient(t, publicReply)
			actual := publicReadThroughProofCgo(c, mode)
			if !actual.status.Present || actual.packet == nil || actual.original != nil || calls.Load() != 0 {
				t.Fatalf("normal full gate/borrow refusal lost original partial: %+v calls=%d", actual.status, calls.Load())
			}
			if mode == "PUBLIC_FIRST0" && actual.status.Code != 0 {
				t.Fatalf("native original present0 lost: %+v", actual.status)
			}
			if counts := publicOriginalProofCloseCounts(); counts != ([3]uint32{}) {
				t.Fatal("proof disposed before transport response debt", counts)
			}
			transport, proof := publicReleaseThroughProofCgo(actual)
			if !transport.Done || !proof.Done {
				t.Fatalf("real C response/proof physical partial cleanup: transport=%+v proof=%+v", transport, proof)
			}
			if mode == "PUBLIC_FIRST0" && (!transport.Present || transport.Code != 0 || !proof.Present || proof.Code != 0) {
				t.Fatal("first0 vs actual closure", transport, proof)
			}
			if counts := publicOriginalProofCloseCounts(); counts != ([3]uint32{1, 1, 1}) {
				t.Fatal("proof join/close/drop once", counts)
			}
			if !publicCloseProofClient(actual).Done {
				t.Fatal("C Source partial physical cleanup")
			}
			if calls.Load() != 0 {
				t.Fatal("refusal replayed an HTTP request")
			}
		})
	}
	for _, mode := range []string{"normal", "wrong-header", "partial", "late-source"} {
		t.Run("observed-continuation-"+mode, func(t *testing.T) {
			handler := func(w http.ResponseWriter, r *http.Request, a *Authority) {
				values := r.Header.Values(securelink.ProductSessionProofV2Header)
				if len(values) != 1 || values[0] != "PUBLIC_PROOF_DATA" || r.Header.Get("Content-Type") != "" || r.ContentLength != 0 || r.Method != "GET" || r.URL.RequestURI() != shopPath("order-001") {
					t.Errorf("not original finite one-header GET: %v", r.Header)
					return
				}
				if mode == "partial" {
					w.Header().Set("Content-Type", "application/json")
					w.Header().Set("Content-Length", "10")
					w.WriteHeader(200)
					_, _ = w.Write([]byte("abc"))
					return
				}
				if mode == "late-source" {
					a.Retire()
				}
				publicReply(w, r, a)
			}
			c, calls := publicShopClient(t, handler)
			value := "PUBLIC_PROOF_DATA"
			if mode == "wrong-header" {
				value = "PUBLIC\r\nINJECTION"
			}
			r, e := c.readOriginalWithProofAtObserved(context.Background(), "order-001", &securelink.ProductSessionProofV2DATA{HeaderValue: value})
			if r == nil || r.exchange == nil {
				t.Fatal("owned exchange/response partial lost", e)
			}
			if mode == "normal" {
				if e != nil || !r.original.BodyComplete || !bytes.Equal(r.original.Body, publicShopBody) || calls.Load() != 1 {
					t.Fatal("actual original packet", e, calls.Load())
				}
				if r.ctx.Err() != nil {
					t.Fatal("continuation context canceled at return", r.ctx.Err())
				}
				if e = r.exchange.Current(r.ctx); e != nil {
					t.Fatal("actual same exchange current", e)
				}
			} else {
				if e == nil || r.first == nil {
					t.Fatal("failed original continuation emitted success")
				}
				if mode == "wrong-header" {
					if calls.Load() != 0 || r.exchange.Lifetime().DispatchPossible {
						t.Fatal("bad carrier dispatched")
					}
				}
				if mode == "partial" {
					if calls.Load() != 1 || !bytes.Equal(r.original.Body, []byte("abc")) || r.original.BodyComplete {
						t.Fatal("late exact prefix dropped")
					}
				}
				if mode == "late-source" {
					if calls.Load() != 1 || !bytes.Equal(r.original.Body, publicShopBody) || !r.original.BodyComplete {
						t.Fatal("late Source dropped owned original")
					}
				}
			}
			if c.source.children.Load() != 1 {
				t.Fatal("held Source child missing")
			}
			first := r.first
			release, done := r.Release()
			if !done {
				t.Fatal("actual physical transport release", release)
			}
			if mode == "normal" && release != nil {
				t.Fatal(release)
			}
			if mode != "normal" && release != first {
				t.Fatal("original error replaced by physical receipt", first, release)
			}
			if e = r.exchange.AssertOriginalClosed(); e != nil {
				t.Fatal("missing actual socket/process/image closure witness", e)
			}
			if c.source.children.Load() != 0 {
				t.Fatal("Source released before/after wrong physical point")
			}
			if repeat, done := r.Release(); !done || repeat != first {
				t.Fatal("repeat same receipt", repeat, done)
			}
			if _, done = c.Close(); !done {
				t.Fatal("actual parent Source debt")
			}
			expected := int32(1)
			if mode == "wrong-header" {
				expected = 0
			}
			if calls.Load() != expected {
				t.Fatal("new GET/reissue during cleanup", calls.Load())
			}
		})
	}
}
