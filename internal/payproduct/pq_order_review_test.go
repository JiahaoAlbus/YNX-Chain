//go:build pay_pq && pay_order_consumer

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

// New order-bound review delta: the journey under test only prepares and
// cancels the original Main review. Between stages, setup imports two already
// signed PUBLIC historical Members and their independent proofs. No new key,
// signature, consensus execution, webhook or live funds are involved.
func TestNativeOriginalOrderNormalTermsPayerRefundReview(t *testing.T) {
	fixture, node, driver := os.Getenv("PAY_ORDER_REVIEW_FIXTURE"), os.Getenv("PAY_NODE_BINARY"), os.Getenv("PAY_ORDER_REVIEW_DRIVER")
	for _, p := range []string{fixture, node, driver} {
		if !filepath.IsAbs(p) {
			t.Fatal("exact public review inputs required")
		}
	}
	raw, err := os.ReadFile(filepath.Join(fixture, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f nativeCoreWorkflowManifest
	if json.Unmarshal(raw, &f) != nil || len(f.Rows) != 3 {
		t.Fatal("original review fixture required")
	}
	bootstrap, err := consensus.NewConsensusBootstrap(f.Genesis, f.Pins, f.Migration)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := consensus.NewPQEngineAuthorization(f.Schedule, f.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := consensus.LoadPQEngineSnapshot(f.Migration, filepath.Join(fixture, "engine.state"), bootstrap, auth, f.EngineHeight, f.EngineAppHash)
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
	source.intent = NativeInvoiceProductIntent{ProductID: "shop.order", StoreID: "public-original-store", SourceOrder: "order-100", Merchant: f.Merchant, Recipient: f.Terms.Recipient, Genesis: strings.ToLower(f.Pins.OriginalGenesisHash), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", AmountAtoms: "100", DomainData: json.RawMessage(`{"orderId":"order-100","storeId":"public-original-store","approvalRef":"PUBLIC-original-order-review-only"}`)}
	payout, _ := accountaddress.Encode(f.Terms.Recipient)
	owner, _ := accountaddress.Encode(f.Merchant)
	registered, err := parent.Onboard(OnboardInput{DisplayName: "PUBLIC original order review", PayoutAddress: payout, OwnerAccount: owner, IdempotencyKey: "public-original-order-review"})
	if err != nil {
		t.Fatal(err)
	}
	source.merchantID = registered.Merchant.ID
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		source.mu.Lock()
		defer source.mu.Unlock()
		var row nativeCoreWorkflowRow
		found := false
		if r.Method == "POST" {
			body, _ := io.ReadAll(r.Body)
			if source.posts >= 2 || !bytes.Equal(body, f.Rows[source.posts].Wire) {
				t.Error("unexpected or replacement PUBLIC setup Member")
				w.WriteHeader(409)
				return
			}
			row = f.Rows[source.posts]
			source.posts++
			source.nonces[row.Registration.Owner] = row.Nonce + 1
			found = true
		} else if strings.HasPrefix(r.URL.Path, "/invoices/pq/") {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(f.Rows[max(source.posts-1, 0)].View)
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
			_ = json.NewEncoder(w).Encode(bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "collected", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, ExecutionHeight: row.Height, CometIndex: &index, ProofVerification: "not-performed", Proof: &row.Proof})
			return
		}
		_ = json.NewEncoder(w).Encode(bftgateway.PQActionView{Type: action.Kind, Status: "committed", Committed: true, Source: "comet-rpc", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, Wire: row.Wire, Transport: envelope, ExecutionHeight: row.Height, CometIndex: &index, ExecutionData: row.Data, Effects: json.RawMessage(row.Data), From: action.Owner, Nonce: action.Nonce, Fee: 1, ReadbackURL: "/transactions/pq/actions/originals/" + nativeHash, ABCIReadbackURL: "/transactions/pq/actions/" + abciHash})
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
	cfg := NativePayConfig{Genesis: f.Network, NativeChainID: f.NativeChainID, HTTP: caller, Authority: source, ProofSource: proofs}
	server, intents, err := NewPrivateNativePayServer(parent, cfg, binding, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	native, err := NewNativePayService(parent, cfg)
	if err != nil {
		t.Fatal(err)
	}
	var effectPOST int
	product := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.URL.Path != "/v5/pay/invoice-intents/lookup" && !strings.HasSuffix(r.URL.Path, "/merchant-review") && !strings.HasSuffix(r.URL.Path, "/review") && !strings.HasSuffix(r.URL.Path, "/refund-review") {
			effectPOST++
			w.WriteHeader(405)
			return
		}
		server.Handler().ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), nativeClientActorKey{}, r.Header.Get("X-PUBLIC-QA-Actor"))))
	}))
	defer product.Close()
	merchantCtx := context.WithValue(t.Context(), nativeClientActorKey{}, f.Merchant)
	intent, err := intents.CreateInvoiceIntent(merchantCtx, source.intent, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	for stage := 0; stage < 3; stage++ {
		before, e := os.ReadFile(parent.store.path)
		if e != nil {
			t.Fatal(e)
		}
		input, _ := json.Marshal(map[string]any{"original": source.intent, "origin": product.URL, "stage": stage, "intentId": intent.IntentID, "invoiceId": f.Terms.InvoiceID})
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		cmd := exec.CommandContext(ctx, node, driver)
		cmd.Stdin = bytes.NewReader(input)
		cmd.Env = append(os.Environ(), "PAY_CLIENT_QA_MANIFEST="+filepath.Join(fixture, "manifest.json"))
		out, e := cmd.CombinedOutput()
		cancel()
		if e != nil {
			t.Fatalf("order review stage %d: %v %s", stage, e, out)
		}
		t.Logf("ACTUAL_ORIGINAL_ORDER_REVIEW %s", bytes.TrimSpace(out))
		after, e := os.ReadFile(parent.store.path)
		if e != nil || !bytes.Equal(before, after) {
			t.Fatal("review/cancel changed original Pay Store", stage, e)
		}
		if stage == 0 {
			if _, e = intents.SubmitMerchantTerms(merchantCtx, intent.IntentID, f.Rows[0].Wire); e != nil {
				t.Fatal(e)
			}
			if _, e = intents.ReconcileInvoiceIntent(merchantCtx, intent.IntentID); e != nil {
				t.Fatal(e)
			}
		}
		if stage == 1 {
			payerCtx := context.WithValue(t.Context(), nativeClientActorKey{}, f.Terms.Payer)
			if _, e = native.SubmitSettlement(payerCtx, f.Merchant, f.Terms.InvoiceID, f.Rows[1].Wire); e != nil {
				t.Fatal(e)
			}
			if _, e = native.Reconcile(payerCtx, f.Merchant, f.Terms.InvoiceID, consensus.SignedTransactionHash(f.Rows[1].Wire)); e != nil {
				t.Fatal(e)
			}
		}
	}
	if effectPOST != 0 || source.posts != 2 {
		t.Fatal("review journey sent a Member", effectPOST, source.posts)
	}
	t.Log("ACTUAL_ORIGINAL_ORDER_REVIEW_COMPLETE merchantTerms=1 payer=1 refund=1 sameOriginalMainPublish=3 cancelOnce=3 signing=0 effectPOST=0 historicalPUBLICSetupMembers=2 consensusExecution=0 genuineSource=false")
}
