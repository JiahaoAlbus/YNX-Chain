//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// These temporary independent keys and loopback HTTP responses test the actual
// native codec, dual-signature Members and caller wire. They are not chain
// execution, a finality anchor, a paid invoice or authorization for real funds.
type nativePayHTTPFixture struct {
	wire, transport []byte
	action          ynxauth.Action
	view            bftgateway.PQActionView
}

func newNativePayHTTPFixture(t *testing.T, n int) nativePayHTTPFixture {
	t.Helper()
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	network := bytes.Repeat([]byte{0x39}, 32)
	owner := "0x" + strings.Repeat("11", 20)
	payload, err := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceTerms, ynxauth.InvoiceTermsPayload{InvoiceID: "invoice-100", SessionID: "session:100", Recipient: "0x" + strings.Repeat("22", 20), AssetID: "YNXT", UnitVersion: "1", FeeRule: "native-transfer-fee-one/v1", KeyEpoch: 1, Revision: 1, Amount: 100, MaxFee: 1, ExpiresAt: 100})
	if err != nil {
		t.Fatal(err)
	}
	action := ynxauth.Action{ChainID: network, NativeChainID: 6423, Owner: owner, Nonce: 9007199254740993, Fee: 1, Kind: ynxauth.ActionInvoiceTerms, Payload: payload}
	messages := make([][]byte, n)
	for i := range messages {
		a := action
		a.Nonce += uint64(i)
		messages[i], err = a.SigningBytes()
		if err != nil {
			t.Fatal(err)
		}
	}
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, uint32(n-1))
	if err != nil {
		t.Fatal(err)
	}
	wire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: network, Purpose: ynxauth.TransactionPurpose, Optimized: true, ResolveTrustedOwner: func(ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		return ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: owner, Purpose: ynxauth.TransactionPurpose, PolicyRevision: "isolated-http-fixture", ChainID: network, PKA: public.PKA, PKB: public.PKB, Enabled: true, ActiveFrom: 1}, nil
	}})
	if err != nil || verifier.VerifyOne(wire, 1) != nil {
		t.Fatalf("real dual-signature Member fixture failed: %v", err)
	}
	// Neither branch alone may qualify even this isolated fixture's Member.
	for _, branch := range []string{"ML-DSA-87", "SLH-DSA-SHA2-256f"} {
		changed, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "ML-DSA-87" {
			changed.Certificate.SigmaA[0] ^= 1
		} else {
			changed.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeMember(changed)
		if err != nil || verifier.VerifyOne(bad, 1) == nil {
			t.Fatalf("fixture accepted a broken %s branch: %v", branch, err)
		}
	}
	transport, decoded, err := nativePayHTTPMember(wire)
	if err != nil {
		t.Fatal(err)
	}
	nativeHash, abciHash := consensus.SignedTransactionHash(wire), consensus.SignedTransactionHash(transport)
	view := bftgateway.PQActionView{Type: decoded.Kind, Status: "unknown", Source: "comet-rpc", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, Wire: bytes.Clone(wire), Transport: bytes.Clone(transport), From: decoded.Owner, Fee: decoded.Fee, Nonce: decoded.Nonce, ReadbackURL: "/transactions/pq/actions/originals/" + nativeHash, ABCIReadbackURL: "/transactions/pq/actions/" + abciHash}
	return nativePayHTTPFixture{wire: wire, transport: transport, action: decoded, view: view}
}

func nativePayHTTPWrite(t *testing.T, w http.ResponseWriter, status int, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Error(err)
	}
}

func TestNativePayHTTPExactRoutesOriginalAndUnverifiedObservations(t *testing.T) {
	f := newNativePayHTTPFixture(t, 1)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.RawQuery != "" || r.Header.Get("Accept") != "application/json" {
			t.Error("native caller changed query or response grammar")
		}
		switch r.Method + " " + r.URL.Path {
		case "POST /transactions/pq/actions/broadcast":
			raw, err := io.ReadAll(r.Body)
			if err != nil || !bytes.Equal(raw, f.wire) || r.Header.Get("Content-Type") != "application/octet-stream" {
				t.Error("broadcast did not carry exact original Member bytes")
			}
			nativePayHTTPWrite(t, w, http.StatusAccepted, f.view)
		case "GET /transactions/pq/actions/originals/" + f.view.NativeTransactionHash:
			nativePayHTTPWrite(t, w, http.StatusOK, f.view)
		case "GET /transactions/pq/actions/originals/" + f.view.NativeTransactionHash + "/pq-finality-proof":
			nativePayHTTPWrite(t, w, http.StatusAccepted, bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "pending", NativeTransactionHash: f.view.NativeTransactionHash, ProofVerification: "not-performed"})
		case "GET /invoices/pq/" + f.action.Owner + "/invoice-100":
			// Deliberately only an observation; the caller's separate proof/history
			// acceptance must reject this as insufficient evidence to release funds.
			nativePayHTTPWrite(t, w, http.StatusOK, consensus.PQInvoiceView{Source: "comet-rpc", CommittedHeight: 9007199254740993, Record: consensus.PQInvoiceRecord{Merchant: f.action.Owner, InvoiceID: "invoice-100", RefundedAtoms: 9007199254740995}})
		default:
			t.Errorf("native caller used an invented route: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	caller, err := NewNativePayHTTP(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	view, err := caller.Submit(context.Background(), f.wire)
	if err != nil || view.Status != "unknown" || view.Committed || !bytes.Equal(view.Transport, f.transport) || view.Nonce != f.action.Nonce {
		t.Fatal("submission observation was lost or upgraded to success", err)
	}
	view, err = caller.Original(context.Background(), view.NativeTransactionHash)
	if err != nil || view.Status != "unknown" || view.Committed {
		t.Fatal("HTTP 200 original was upgraded to payment success", err)
	}
	finality, err := caller.Finality(context.Background(), view.NativeTransactionHash)
	if err != nil || finality.Status != "pending" || finality.IndependentFinality || finality.Proof != nil {
		t.Fatal("collector acknowledgement was upgraded to finality", err)
	}
	invoice, err := caller.Invoice(context.Background(), f.action.Owner, "invoice-100")
	if err != nil || invoice.CommittedHeight != 9007199254740993 || invoice.Record.RefundedAtoms != 9007199254740995 || calls.Load() != 4 {
		t.Fatal("invoice route or exact integer observation changed", err)
	}
}

func TestNativePayHTTPPreservesLegalN4MemberWithoutRebatching(t *testing.T) {
	f := newNativePayHTTPFixture(t, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if r.Method != "POST" || r.URL.Path != "/transactions/pq/actions/broadcast" || !bytes.Equal(raw, f.wire) {
			t.Error("legal N4 Member was changed instead of preserved")
		}
		nativePayHTTPWrite(t, w, http.StatusAccepted, f.view)
	}))
	defer server.Close()
	caller, err := NewNativePayHTTP(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := caller.Submit(context.Background(), f.wire); err != nil {
		t.Fatal(err)
	}
}

func TestNativePayHTTPResponseLossReadsOriginalWithoutResubmit(t *testing.T) {
	f := newNativePayHTTPFixture(t, 1)
	var posts, reads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			raw, _ := io.ReadAll(r.Body)
			if !bytes.Equal(raw, f.wire) {
				t.Error("loss fixture received another Member")
			}
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = connection.Close() // The request arrived; its response is lost.
			return
		}
		reads.Add(1)
		if r.URL.Path != "/transactions/pq/actions/originals/"+f.view.NativeTransactionHash {
			t.Error("recovery changed original operation identity")
		}
		nativePayHTTPWrite(t, w, http.StatusOK, f.view)
	}))
	defer server.Close()
	caller, err := NewNativePayHTTP(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	_, err = caller.Submit(context.Background(), f.wire)
	var failure *NativePayHTTPError
	if !errors.As(err, &failure) || !failure.Uncertain || failure.StatusCode != 0 || posts.Load() != 1 {
		t.Fatalf("response loss did not preserve one uncertain dispatch: %v posts=%d", err, posts.Load())
	}
	view, err := caller.Original(context.Background(), f.view.NativeTransactionHash)
	if err != nil || view.NativeTransactionHash != f.view.NativeTransactionHash || posts.Load() != 1 || reads.Load() != 1 {
		t.Fatal("recovery repeated the POST or changed the operation", err)
	}
}

func TestNativePayHTTPRejectsMismatchedOrMalformedActionResponses(t *testing.T) {
	f := newNativePayHTTPFixture(t, 1)
	valid, err := json.Marshal(f.view)
	if err != nil {
		t.Fatal(err)
	}
	mutate := func(change func(*bftgateway.PQActionView)) []byte {
		v := f.view
		change(&v)
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	cases := map[string][]byte{
		"wrong member":        mutate(func(v *bftgateway.PQActionView) { v.Wire = []byte("replacement") }),
		"wrong transport":     mutate(func(v *bftgateway.PQActionView) { v.Transport = []byte(`{}`) }),
		"wrong native hash":   mutate(func(v *bftgateway.PQActionView) { v.NativeTransactionHash = "0x" + strings.Repeat("00", 32) }),
		"wrong ABCI hash":     mutate(func(v *bftgateway.PQActionView) { v.ABCITransactionHash = "0x" + strings.Repeat("00", 32) }),
		"wrong kind":          mutate(func(v *bftgateway.PQActionView) { v.Type = ynxauth.ActionInvoiceRefund }),
		"wrong owner":         mutate(func(v *bftgateway.PQActionView) { v.From = "0x" + strings.Repeat("33", 20) }),
		"wrong nonce":         mutate(func(v *bftgateway.PQActionView) { v.Nonce++ }),
		"wrong fee":           mutate(func(v *bftgateway.PQActionView) { v.Fee++ }),
		"external readback":   mutate(func(v *bftgateway.PQActionView) { v.ReadbackURL = "https://unapproved.example/collect" }),
		"paid status":         mutate(func(v *bftgateway.PQActionView) { v.Status = "paid" }),
		"false committed":     mutate(func(v *bftgateway.PQActionView) { v.Committed = true }),
		"missing original":    []byte(`{"status":"unknown","nativeTransactionHash":"` + f.view.NativeTransactionHash + `"}`),
		"unknown field":       append(append([]byte{}, valid[:len(valid)-1]...), []byte(`,"paymentApproved":true}`)...),
		"duplicate field":     append(append([]byte{}, valid[:len(valid)-1]...), []byte(`,"nativeTransactionHash":"`+f.view.NativeTransactionHash+`"}`)...),
		"trailing object":     append(bytes.Clone(valid), []byte(` {}`)...),
		"non-string integer":  bytes.Replace(valid, []byte(`"nonce":"9007199254740993"`), []byte(`"nonce":9007199254740993`), 1),
		"invalid JSON":        []byte(`{"nativeTransactionHash":`),
		"invalid UTF8":        append([]byte(`{"error":"`), []byte{0xff, '"', '}'}...),
		"nested duplicate":    mutate(func(v *bftgateway.PQActionView) { v.Effects = json.RawMessage(`{"a":1,"a":2}`) }),
		"non-object response": []byte(`null`),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			var posts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				posts.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(raw)
			}))
			defer server.Close()
			caller, err := NewNativePayHTTP(server.URL, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			_, err = caller.Submit(context.Background(), f.wire)
			var failure *NativePayHTTPError
			if !errors.As(err, &failure) || !failure.Uncertain || failure.StatusCode != 200 || posts.Load() != 1 {
				t.Fatalf("mismatched response did not remain one uncertain original: %v", err)
			}
			if _, err := caller.Original(context.Background(), f.view.NativeTransactionHash); err == nil {
				t.Fatal("original lookup accepted mismatched/malformed observation")
			}
		})
	}
}

type nativePayHTTPRoundTrip func(*http.Request) (*http.Response, error)

func (f nativePayHTTPRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestNativePayHTTPOriginTransportAndCanonicalInputGuards(t *testing.T) {
	var calls atomic.Int32
	client := &http.Client{Transport: nativePayHTTPRoundTrip(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, errors.New("unexpected network request")
	})}
	for _, origin := range []string{"", "/relative", "http://service.example", "https://service.example/path", "https://user@service.example", "https://service.example?key=value", "https://service.example#fragment", "https://Service.example", "https://service.example.", "https://service.example:0", "https://service.example:0443", "https://service.example:", "https://service.example/%2e%2e", "https://service.example?", "https://service.example\\other"} {
		if _, err := NewNativePayHTTP(origin, client); err == nil {
			t.Fatalf("invalid service origin accepted: %s", origin)
		}
	}
	for _, missing := range []*http.Client{nil, {}} {
		if _, err := NewNativePayHTTP("https://service.example", missing); err == nil {
			t.Fatal("missing explicit transport acquired ordinary HTTP fallback")
		}
	}
	caller, err := NewNativePayHTTP("https://service.example/", client)
	if err != nil {
		t.Fatal(err)
	}
	for _, hash := range []string{"", "0X" + strings.Repeat("11", 32), "0x" + strings.Repeat("AA", 32), "0x" + strings.Repeat("11", 32) + "/finality", "0x" + strings.Repeat("11", 32) + "?url=elsewhere"} {
		if _, err := caller.Original(context.Background(), hash); err == nil {
			t.Fatal("noncanonical original hash accepted")
		}
		if _, err := caller.Finality(context.Background(), hash); err == nil {
			t.Fatal("noncanonical finality hash accepted")
		}
	}
	for _, subject := range []struct{ merchant, id string }{{"0x" + strings.Repeat("AA", 20), "invoice-100"}, {"0x" + strings.Repeat("11", 20), "Invoice-100"}, {"0x" + strings.Repeat("11", 20), "../other"}, {"0x" + strings.Repeat("11", 20), "invoice/other"}} {
		if _, err := caller.Invoice(context.Background(), subject.merchant, subject.id); err == nil {
			t.Fatal("noncanonical invoice subject accepted")
		}
	}
	if _, err := caller.Submit(context.Background(), []byte("replacement")); err == nil {
		t.Fatal("non-Member submitted")
	}
	if calls.Load() != 0 {
		t.Fatal("rejected input reached the transport")
	}
}

func TestNativePayHTTPInvoiceRejectsOtherSubjectsAndExactCancellation(t *testing.T) {
	merchant := "0x" + strings.Repeat("11", 20)
	for _, tc := range []struct {
		name string
		view consensus.PQInvoiceView
	}{
		{"wrong merchant", consensus.PQInvoiceView{Source: "comet-rpc", CommittedHeight: 1, Record: consensus.PQInvoiceRecord{Merchant: "0x" + strings.Repeat("22", 20), InvoiceID: "invoice-100"}}},
		{"wrong invoice", consensus.PQInvoiceView{Source: "comet-rpc", CommittedHeight: 1, Record: consensus.PQInvoiceRecord{Merchant: merchant, InvoiceID: "invoice-001"}}},
		{"no committed snapshot", consensus.PQInvoiceView{Source: "comet-rpc", Record: consensus.PQInvoiceRecord{Merchant: merchant, InvoiceID: "invoice-100"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { nativePayHTTPWrite(t, w, 200, tc.view) }))
			defer s.Close()
			h, err := NewNativePayHTTP(s.URL, s.Client())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := h.Invoice(context.Background(), merchant, "invoice-100"); err == nil {
				t.Fatal("HTTP success substituted another invoice observation")
			}
		})
	}
	client := &http.Client{Transport: nativePayHTTPRoundTrip(func(r *http.Request) (*http.Response, error) {
		return nil, r.Context().Err()
	})}
	h, err := NewNativePayHTTP("https://service.example", client)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = h.Invoice(ctx, merchant, "invoice-100")
	var failure *NativePayHTTPError
	if !errors.Is(err, context.Canceled) || !errors.As(err, &failure) || failure.Uncertain {
		t.Fatal("read cancellation lost its original cause or acquired a submitted effect", err)
	}
}

func TestNativePayHTTPRedirectStatusBoundsAndCollectorAuthority(t *testing.T) {
	f := newNativePayHTTPFixture(t, 1)
	var destinationCalls, callerRedirects atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { destinationCalls.Add(1) }))
	defer destination.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", destination.URL+"/replace")
		nativePayHTTPWrite(t, w, http.StatusTemporaryRedirect, f.view)
	}))
	defer server.Close()
	client := server.Client()
	client.Timeout = 5 * time.Second
	client.CheckRedirect = func(*http.Request, []*http.Request) error { callerRedirects.Add(1); return nil }
	caller, err := NewNativePayHTTP(server.URL, client)
	if err != nil {
		t.Fatal(err)
	}
	_, err = caller.Submit(context.Background(), f.wire)
	var failure *NativePayHTTPError
	if !errors.As(err, &failure) || !failure.Uncertain || failure.StatusCode != 307 || destinationCalls.Load() != 0 || callerRedirects.Load() != 0 {
		t.Fatal("redirect selected another destination or lost uncertainty", err)
	}
	if caller.client == client || caller.client.Timeout != client.Timeout || client.CheckRedirect(nil, nil) != nil || callerRedirects.Load() != 1 {
		t.Fatal("constructor changed caller-owned client configuration")
	}
	for _, tc := range []struct {
		name string
		send func(http.ResponseWriter)
	}{
		{"oversized content length", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Length", "8388609")
			w.WriteHeader(200)
		}},
		{"oversized stream", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(200)
			w.(http.Flusher).Flush()
			_, _ = io.WriteString(w, strings.Repeat(" ", consensus.MaxPQWalletQueryBytes+1))
		}},
		{"wrong content type", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, "upstream page")
		}},
		{"HTTP rejection", func(w http.ResponseWriter) { nativePayHTTPWrite(t, w, 422, f.view) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { tc.send(w) }))
			defer s.Close()
			h, err := NewNativePayHTTP(s.URL, s.Client())
			if err != nil {
				t.Fatal(err)
			}
			_, err = h.Submit(context.Background(), f.wire)
			var failure *NativePayHTTPError
			if !errors.As(err, &failure) || !failure.Uncertain {
				t.Fatal("failed POST lost original uncertain classification", err)
			}
		})
	}
	for _, authority := range []struct {
		name   string
		change func(*bftgateway.PQFinalityView)
	}{
		{"false independent finality", func(v *bftgateway.PQFinalityView) { v.IndependentFinality = true }},
		{"false verification", func(v *bftgateway.PQFinalityView) { v.ProofVerification = "verified" }},
		{"wrong original", func(v *bftgateway.PQFinalityView) { v.NativeTransactionHash = "0x" + strings.Repeat("00", 32) }},
		{"missing proof", func(v *bftgateway.PQFinalityView) { v.Status = "collected" }},
	} {
		t.Run(authority.name, func(t *testing.T) {
			view := bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "pending", NativeTransactionHash: f.view.NativeTransactionHash, ProofVerification: "not-performed"}
			authority.change(&view)
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { nativePayHTTPWrite(t, w, 200, view) }))
			defer s.Close()
			h, err := NewNativePayHTTP(s.URL, s.Client())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := h.Finality(context.Background(), f.view.NativeTransactionHash); err == nil {
				t.Fatal("collector supplied replacement identity or independent authority")
			}
		})
	}
}
