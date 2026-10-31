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
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type nativeSourceFixture struct {
	grant  NativePayAuthorization
	denied bool
}

func (f *nativeSourceFixture) Authorize(context.Context, NativePayAccess) (NativePayAuthorization, error) {
	if f.denied {
		return f.grant, ErrNativePayUnavailable
	}
	return f.grant, nil
}

type nativeServiceFixture struct {
	service  *NativePayService
	source   *nativeSourceFixture
	key      *ynxbatch.PrivateKey
	terms    ynxauth.InvoiceTermsPayload
	network  []byte
	merchant string
	writes   int
	loss     bool
	wire     []byte
}

func newNativeServiceFixture(t *testing.T) *nativeServiceFixture {
	t.Helper()
	key, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(key.Destroy)
	now := time.Now().UTC()
	parent, _ := testService(t, &fakePay{}, func() time.Time { return now })
	network := bytes.Repeat([]byte{0x73}, 32)
	merchant := "0x" + strings.Repeat("11", 20)
	source := &nativeSourceFixture{grant: NativePayAuthorization{BoundOrderID: "order-100", BoundInvoiceID: "invoice-100", BoundSessionID: "session-100", Principal: merchant, Height: 5, KeyEpoch: 1, LedgerNonce: 1, Until: now.Add(time.Hour), Current: func() error { return nil }, Registration: ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: merchant, Purpose: "TX-BATCH", PolicyRevision: "independent-test-registration", ChainID: network, PKA: pub.PKA, PKB: pub.PKB, Enabled: true, ActiveFrom: 1}}}
	f := &nativeServiceFixture{source: source, key: key, network: network, merchant: merchant, terms: ynxauth.InvoiceTermsPayload{InvoiceID: "invoice-100", SessionID: "session-100", Recipient: merchant, Payer: "0x" + strings.Repeat("22", 20), AssetID: "YNXT", UnitVersion: "1", FeeRule: "native-transfer-fee-one/v1", KeyEpoch: 1, Revision: 1, Amount: 100, MaxFee: 1, ExpiresAt: 100}}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			f.writes++
			f.wire, _ = io.ReadAll(r.Body)
			if f.loss {
				connection, _, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Error(err)
					return
				}
				connection.Close()
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "pq-finality-proof") {
			json.NewEncoder(w).Encode(bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "pending", NativeTransactionHash: consensus.SignedTransactionHash(f.wire), ProofVerification: "not-performed"})
			return
		}
		envelope, action, err := nativePayHTTPMember(f.wire)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		nativeHash, abciHash := consensus.SignedTransactionHash(f.wire), consensus.SignedTransactionHash(envelope)
		json.NewEncoder(w).Encode(bftgateway.PQActionView{Type: action.Kind, Status: "unknown", Source: "comet-rpc", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, Wire: f.wire, Transport: envelope, From: action.Owner, Nonce: action.Nonce, Fee: action.Fee, ReadbackURL: "/transactions/pq/actions/originals/" + nativeHash, ABCIReadbackURL: "/transactions/pq/actions/" + abciHash})
	}))
	t.Cleanup(backend.Close)
	caller, err := NewNativePayHTTP(backend.URL, backend.Client())
	if err != nil {
		t.Fatal(err)
	}
	f.service, err = NewNativePayService(parent, NativePayConfig{Genesis: network, NativeChainID: 6423, HTTP: caller, Authority: source})
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func (f *nativeServiceFixture) sign(t *testing.T, kind string, payload any, nonce uint64) []byte {
	t.Helper()
	body, err := ynxauth.EncodeActionPayload(kind, payload)
	if err != nil {
		t.Fatal(err)
	}
	action := ynxauth.Action{ChainID: f.network, NativeChainID: 6423, Owner: f.merchant, Nonce: nonce, Fee: 1, Kind: kind, Payload: body}
	message, err := action.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.merchant, Purpose: "TX-BATCH"}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}
func TestNativePayTermsUnknownColdReplayDoesNotResendOrClaimRPCPayment(t *testing.T) {
	f := newNativeServiceFixture(t)
	f.loss = true
	wire := f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)
	op, err := f.service.RegisterTerms(context.Background(), "order-100", wire)
	if err == nil || op.Status != "unknown" || f.writes != 1 {
		t.Fatal("lost response failed to retain original operation", err, op.Status)
	}
	store, err := OpenStore(f.service.parent.store.path, f.service.parent.key)
	if err != nil {
		t.Fatal(err)
	}
	f.service.parent.store = store
	f.source.grant.LedgerNonce = 2 // independent source may advance after remote effect
	replay, err := f.service.RegisterTerms(context.Background(), "order-100", wire)
	if err != nil || replay.NativeHash != op.NativeHash || f.writes != 1 {
		t.Fatal("cold replay re-authorized/resubmitted original nonce", err)
	}
	if _, err = f.service.Reconcile(context.Background(), f.merchant, "invoice-100", op.NativeHash); !errors.Is(err, ErrNativePayUnavailable) {
		t.Fatal("RPC-only observation became independent finality", err)
	}
	state, err := f.service.Read(context.Background(), f.merchant, "invoice-100")
	if err != nil {
		t.Fatal(err)
	}
	view, err := nativeInvoiceProjection(state)
	if err != nil || view["paidAtoms"] != "0" || view["status"] != "awaiting_terms_finality" {
		t.Fatal("unverified terms exposed a payment", err, view)
	}
	if _, err = f.service.PrepareSettlement(context.Background(), f.merchant, "invoice-100"); err == nil {
		t.Fatal("unverified merchant terms authorized payment preparation")
	}
	f.source.denied = true
	if _, err = f.service.Read(context.Background(), f.merchant, "invoice-100"); err == nil {
		t.Fatal("revoked source read original private order")
	}
}
func TestNativePayTermsProducerUsesCoreMessageAndRejectsUnboundBills(t *testing.T) {
	f := newNativeServiceFixture(t)
	prepared, err := f.service.PrepareTerms(context.Background(), "order-100", f.terms)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := ynxauth.DecodeAction(prepared.Message)
	if err != nil || decoded.Kind != ynxauth.ActionInvoiceTerms || decoded.Owner != f.merchant || decoded.Nonce != 2 || prepared.Status != "awaiting_original_merchant_native_signature" {
		t.Fatal("unsigned producer diverged from sole Core message", err)
	}
	f.source.grant.BoundOrderID = "another-unpriced-bill"
	if _, err = f.service.PrepareTerms(context.Background(), "order-100", f.terms); err == nil {
		t.Fatal("unapproved bill obtained merchant signing request")
	}
	if f.writes != 0 {
		t.Fatal("unsigned quote submitted an effect")
	}
}
func TestNativePayRealANDAndFrozenTermsAreRequiredBeforeHTTP(t *testing.T) {
	f := newNativeServiceFixture(t)
	wire := f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)
	for _, branch := range []string{"A", "B"} {
		m, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "A" {
			m.Certificate.SigmaA[0] ^= 1
		} else {
			m.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeMember(m)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.service.RegisterTerms(context.Background(), "order-100", bad); err == nil {
			t.Fatal("damaged dual-signature branch reached original dispatcher")
		}
	}
	if f.writes != 0 {
		t.Fatal("bad merchant authority reached HTTP")
	}
	if _, err := f.service.RegisterTerms(context.Background(), "order-100", wire); err != nil {
		t.Fatal(err)
	}
	changed := f.terms
	changed.Amount = 1
	if _, err := f.service.RegisterTerms(context.Background(), "order-100", f.sign(t, ynxauth.ActionInvoiceTerms, changed, 2)); err == nil {
		t.Fatal("small amount replaced immutable signed terms")
	}
	if f.writes != 1 {
		t.Fatal("conflicting terms were sent")
	}
}
func TestNativePayHandlerKeepsMissingAuthorityAndRequestAmbiguityClosed(t *testing.T) {
	f := newNativeServiceFixture(t)
	server := NewClosedProductionServerWithLogger(f.service.parent, buildinfo.Info{}, nil)
	request := httptest.NewRequest("GET", "/v5/pay/invoices/merchant/id", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != 503 {
		t.Fatal("unmounted native authority opened normal production route")
	}
	if err := server.MountNativePay(f.service); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest("POST", "/v5/pay/invoices", strings.NewReader(`{"sourceOrder":"order-100","sourceOrder":"another","member":""}`))
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code < 400 || f.writes != 0 {
		t.Fatal("ambiguous request reached native effect")
	}
}
