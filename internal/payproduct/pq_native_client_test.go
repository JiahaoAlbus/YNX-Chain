//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	cmttypes "github.com/cometbft/cometbft/types"
)

type nativeClientActorKey struct{}
type nativeClientQASource struct {
	mu         sync.Mutex
	f          nativeCoreWorkflowManifest
	posts      int
	nonces     map[string]uint64
	intent     NativeInvoiceProductIntent
	merchantID string
	now        time.Time
}

func (s *nativeClientQASource) Authorize(ctx context.Context, a NativePayAccess) (NativePayAuthorization, error) {
	actor, _ := ctx.Value(nativeClientActorKey{}).(string)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.f.Rows {
		if r.Registration.Owner == actor {
			return NativePayAuthorization{BoundInvoiceID: s.f.Terms.InvoiceID, BoundOrderID: "order-100", BoundSessionID: s.f.Terms.SessionID, Principal: actor, ProductMerchantID: s.merchantID, Registration: r.Registration, Height: s.f.Rows[min(s.posts, 2)].Height, KeyEpoch: 1, LedgerNonce: s.nonces[actor], Until: s.now.Add(time.Hour), Current: func() error { return nil }}, nil
		}
	}
	return NativePayAuthorization{}, ErrNativePayUnavailable
}
func (s *nativeClientQASource) ReadInvoiceIntentSource(ctx context.Context, a NativeInvoiceIntentAccess) (NativeInvoiceSourceSnapshot, error) {
	actor, _ := ctx.Value(nativeClientActorKey{}).(string)
	if actor != s.f.Merchant && actor != s.f.Terms.Payer {
		return NativeInvoiceSourceSnapshot{}, ErrNativePayUnavailable
	}
	return NativeInvoiceSourceSnapshot{Caller: actor, Intent: s.intent, ProductMerchantID: s.merchantID, MerchantAccount: s.f.Merchant, StoreID: s.intent.StoreID, Terms: s.f.Terms, AllowedOperations: []string{"create", "read", "lookup", "merchant_review", "submit_merchant_member", "reconcile"}, Until: s.now.Add(time.Hour), Current: func() error { return nil }}, nil
}

// Public actor header and supplied Core Members are EXPLICIT QA controls only.
// No production constructor accepts them; no real Main approval is asserted.
func TestNativePayBusinessClientOriginalHTTPWorkflow(t *testing.T) {
	fixtureDir := os.Getenv("PAY_CLIENT_WORKFLOW_DIR")
	driver := os.Getenv("PAY_CLIENT_WORKFLOW_DRIVER")
	if fixtureDir == "" || driver == "" {
		t.Skip("requires actual client + frozen public CORE fixture")
	}
	raw, err := os.ReadFile(filepath.Join(fixtureDir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f nativeCoreWorkflowManifest
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	bootstrap, err := consensus.NewConsensusBootstrap(f.Genesis, f.Pins, f.Migration)
	if err != nil {
		t.Fatal(err)
	}
	engine, err := consensus.NewPQEngineAuthorization(f.Schedule, f.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := consensus.LoadPQEngineSnapshot(f.Migration, filepath.Join(fixtureDir, "engine.state"), bootstrap, engine, f.EngineHeight, f.EngineAppHash)
	if err != nil {
		t.Fatal(err)
	}
	var trusted cmttypes.LightBlock
	if err = cmtjson.Unmarshal(f.Trusted, &trusted); err != nil {
		t.Fatal(err)
	}
	proofs := &nativeWorkflowProofSource{rows: f.Rows, trust: consensus.PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: &trusted, TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustLevel: cmtmath.Fraction{Numerator: 1, Denominator: 3}, Now: f.Now}}
	now := time.Now().UTC()
	parent, _ := testService(t, &fakePay{}, func() time.Time { return now })
	source := &nativeClientQASource{f: f, now: now, nonces: map[string]uint64{f.Merchant: 1, f.Terms.Payer: 1}}
	source.intent = NativeInvoiceProductIntent{ProductID: "shop.order", StoreID: "qa-original-store", SourceOrder: "order-100", Merchant: f.Merchant, Recipient: f.Terms.Recipient, Genesis: strings.ToLower(f.Pins.OriginalGenesisHash), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", AmountAtoms: "100", DomainData: json.RawMessage(`{"orderId":"order-100","storeId":"qa-original-store","approvalRef":"PUBLIC-QA-ONLY"}`)}
	var eventMu sync.Mutex
	received := map[string]bool{}
	secret := ""
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		id := r.Header.Get("X-YNX-Event-ID")
		at, e := time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Timestamp"))
		if e != nil || r.Header.Get("X-YNX-Payload-SHA256") != hexSHA(body) || r.Header.Get("X-YNX-Signature") != "v1="+hmacHex([]byte(secret), webhookSigningMaterial(id, at, hexSHA(body))) {
			t.Error("original event callback signature changed")
			w.WriteHeader(403)
			return
		}
		eventMu.Lock()
		received[id] = true
		eventMu.Unlock()
		w.WriteHeader(204)
	}))
	defer receiver.Close()
	parent.client = receiver.Client()
	payout, _ := accountaddress.Encode(f.Terms.Recipient)
	owner, _ := accountaddress.Encode(f.Merchant)
	onboard, err := parent.Onboard(OnboardInput{DisplayName: "Client QA original merchant", PayoutAddress: payout, OwnerAccount: owner, WebhookURL: receiver.URL, IdempotencyKey: "client-qa-registered-merchant"})
	if err != nil {
		t.Fatal(err)
	}
	source.merchantID = onboard.Merchant.ID
	secret = onboard.WebhookSecret
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		source.mu.Lock()
		defer source.mu.Unlock()
		var row nativeCoreWorkflowRow
		found := false
		if r.Method == "POST" {
			var body bytes.Buffer
			body.ReadFrom(r.Body)
			if source.posts >= len(f.Rows) || !bytes.Equal(body.Bytes(), f.Rows[source.posts].Wire) {
				t.Error("replacement or repeated original reached Core adapter")
				w.WriteHeader(409)
				return
			}
			row = f.Rows[source.posts]
			source.posts++
			source.nonces[row.Registration.Owner] = row.Nonce + 1
			found = true
			if source.posts == 2 {
				connection, _, e := w.(http.Hijacker).Hijack()
				if e != nil {
					t.Error(e)
					return
				}
				connection.Close()
				return
			}
		} else if strings.HasPrefix(r.URL.Path, "/invoices/pq/") {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(f.Rows[max(source.posts-1, 0)].View)
			return
		} else {
			for _, candidate := range f.Rows[:source.posts] {
				if strings.Contains(r.URL.Path, consensus.SignedTransactionHash(candidate.Wire)) {
					row = candidate
					found = true
					break
				}
			}
		}
		if !found {
			w.WriteHeader(404)
			return
		}
		envelope, action, e := nativePayHTTPMember(row.Wire)
		if e != nil {
			t.Error(e)
			w.WriteHeader(500)
			return
		}
		nativeHash, abciHash, index := consensus.SignedTransactionHash(row.Wire), consensus.SignedTransactionHash(envelope), uint32(0)
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "pq-finality-proof") {
			json.NewEncoder(w).Encode(bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "collected", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, ExecutionHeight: row.Height, CometIndex: &index, ProofVerification: "not-performed", Proof: &row.Proof})
			return
		}
		json.NewEncoder(w).Encode(bftgateway.PQActionView{Type: action.Kind, Status: "committed", Committed: true, Source: "comet-rpc", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, Wire: row.Wire, Transport: envelope, ExecutionHeight: row.Height, CometIndex: &index, ExecutionData: row.Data, Effects: json.RawMessage(row.Data), From: action.Owner, Nonce: action.Nonce, Fee: 1, ReadbackURL: "/transactions/pq/actions/originals/" + nativeHash, ABCIReadbackURL: "/transactions/pq/actions/" + abciHash})
	}))
	defer backend.Close()
	caller, err := NewNativePayHTTP(backend.URL, backend.Client())
	if err != nil {
		t.Fatal(err)
	}
	binding, err := NewRegisteredNativeInvoiceIntentSource(parent, source)
	if err != nil {
		t.Fatal(err)
	}
	server, intents, err := NewPrivateNativePayServer(parent, NativePayConfig{Genesis: f.Network, NativeChainID: f.NativeChainID, HTTP: caller, Authority: source, ProofSource: proofs}, binding, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	product := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/PUBLIC-QA-ONLY/cold" {
			cold, e := OpenStore(parent.store.path, parent.key)
			if e != nil {
				t.Error(e)
				w.WriteHeader(500)
				return
			}
			parent.store = cold
			w.WriteHeader(204)
			return
		}
		actor := r.Header.Get("X-PUBLIC-QA-Actor")
		server.Handler().ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), nativeClientActorKey{}, actor)))
	}))
	defer product.Close()
	ctx := context.WithValue(context.Background(), nativeClientActorKey{}, f.Merchant)
	intent, err := intents.CreateInvoiceIntent(ctx, source.intent, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	run := exec.Command("node", driver)
	run.Env = append(os.Environ(), "PAY_CLIENT_QA_ORIGIN="+product.URL, "PAY_CLIENT_QA_INTENT="+intent.IntentID, "PAY_CLIENT_QA_MANIFEST="+filepath.Join(fixtureDir, "manifest.json"))
	output, e := run.CombinedOutput()
	if e != nil {
		t.Fatalf("native business client workflow: %v\n%s", e, output)
	}
	source.mu.Lock()
	posts := source.posts
	source.mu.Unlock()
	if posts != 3 {
		t.Fatal("client workflow changed original Core dispatch count", posts)
	}
	var eventIDs []string
	if err = parent.store.View(func(data Snapshot) error {
		for id, d := range data.Deliveries {
			if d.MerchantID == source.merchantID {
				eventIDs = append(eventIDs, id)
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(eventIDs) != 3 {
		t.Fatal("funds effects did not atomically enqueue original callbacks", len(eventIDs))
	}
	for _, id := range eventIDs {
		if d, e := parent.Deliver(context.Background(), id); e != nil || d.Status != "delivered" {
			t.Fatal("original signed event callback failed", e, d.Status)
		}
		if _, e := parent.Deliver(context.Background(), id); e != nil {
			t.Fatal(e)
		}
	}
	eventMu.Lock()
	events := len(received)
	eventMu.Unlock()
	if events != 3 {
		t.Fatal("original callback events duplicated/lost", events)
	}
	t.Log(strings.TrimSpace(string(output)))
	t.Log("original terms/payment/refund event outbox delivered once each over temporary TLS; original signed IDs retained")
}
