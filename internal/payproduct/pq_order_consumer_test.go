//go:build pay_pq && pay_order_consumer

package payproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Reopens the retained PUBLIC Pay Store through the normal handler and original
// Main product wrapper in fresh Node processes. No Member is signed or sent;
// historical independent proofs are verified using their original engine input.
func TestNativeOriginalOrderNormalMainColdRetainedReceipt(t *testing.T) {
	node, driver, source, fixture := os.Getenv("PAY_NODE_BINARY"), os.Getenv("PAY_ORDER_CONSUMER_DRIVER"), os.Getenv("PAY_STORE_RETAINED_SOURCE"), os.Getenv("PAY_CORE_WORKFLOW_DIR")
	for _, p := range []string{node, driver, source, fixture} {
		if !filepath.IsAbs(p) {
			t.Fatal("exact original Node/driver/retained Store/Core input required")
		}
	}
	raw, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != os.Getenv("PAY_STORE_RETAINED_SHA256") {
		t.Fatal("retained original Store pin differs")
	}
	file := filepath.Join(t.TempDir(), "PUBLIC-original-pay-store.json")
	if err = os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	manifest, err := os.ReadFile(filepath.Join(fixture, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f nativeCoreWorkflowManifest
	if json.Unmarshal(manifest, &f) != nil || len(f.Rows) != 3 {
		t.Fatal("original three-row engine fixture required")
	}
	bootstrap, err := consensus.NewConsensusBootstrap(f.Genesis, f.Pins, f.Migration)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := consensus.NewPQEngineAuthorization(f.Schedule, f.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	engine, err := consensus.LoadPQEngineSnapshot(f.Migration, filepath.Join(fixture, "engine.state"), bootstrap, auth, f.EngineHeight, f.EngineAppHash)
	if err != nil {
		t.Fatal(err)
	}
	var trusted cmttypes.LightBlock
	if err = cmtjson.Unmarshal(f.Trusted, &trusted); err != nil {
		t.Fatal(err)
	}
	proofs := &nativeWorkflowProofSource{rows: f.Rows, trust: consensus.PQLightProofTrust{Snapshot: engine, TrustedLightBlock: &trusted, TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustLevel: cmtmath.Fraction{Numerator: 1, Denominator: 3}, Now: f.Now}}
	var revoked atomic.Bool
	current := func() error {
		if revoked.Load() {
			return ErrNativePayUnavailable
		}
		return nil
	}
	var original NativeInvoiceProductIntent
	var intent nativeInvoiceIntentRecord
	var state NativePayInvoice
	var lookup, reads, effects atomic.Int32
	start := func() *httptest.Server {
		parent, e := New(Config{StorePath: file, IntegrityKey: bytes32(7), GatewayKey: bytes32(8), BootstrapKey: "PUBLIC-original-order-read-only", PublicBaseURL: "https://public.invalid", PayAPI: &fakePay{}})
		if e != nil {
			t.Fatal(e)
		}
		caller, e := NewNativePayHTTP("http://127.0.0.1:1", &http.Client{Transport: archiveOfflineTransport{}, Timeout: time.Second})
		if e != nil {
			t.Fatal(e)
		}
		cfg := NativePayConfig{Genesis: f.Network, NativeChainID: f.NativeChainID, HTTP: caller, ProofSource: proofs,
			Authority: &nativeSourceFixture{grant: NativePayAuthorization{Principal: f.Merchant, Height: 1, Until: time.Now().Add(time.Hour), Current: current}}}
		native, e := NewNativePayService(parent, cfg)
		if e != nil {
			t.Fatal(e)
		}
		loader := &NativeInvoiceIntents{native: native}
		e = parent.store.View(func(data Snapshot) error {
			found := 0
			for id, record := range data.BusinessDispatches {
				if record.Operation != "native.invoice.intent" {
					continue
				}
				var ok bool
				intent, ok, e = loader.load(data, id)
				if e != nil || !ok {
					t.Fatal("retained original intent unavailable", e)
				}
				original = intent.Request
				state, ok, e = native.load(data, intent.Merchant, intent.Terms.InvoiceID)
				if e != nil || !ok {
					t.Fatal("retained original invoice unavailable", e)
				}
				found++
			}
			if found != 1 || original.ProductID != "shop.order" || state.ProductMerchantID == "" {
				t.Fatal("exact single retained Shop order required")
			}
			return nil
		})
		if e != nil {
			t.Fatal(e)
		}
		reader := &nativeIntentSourceFixture{snapshot: NativeInvoiceSourceSnapshot{Caller: f.Merchant, Intent: original, ProductMerchantID: state.ProductMerchantID, MerchantAccount: original.Merchant, StoreID: original.StoreID, Terms: intent.Terms, AllowedOperations: []string{"read", "lookup", "reconcile"}, Until: time.Now().Add(time.Hour), Current: current}}
		registered, e := NewRegisteredNativeInvoiceIntentSource(parent, reader)
		if e != nil {
			t.Fatal(e)
		}
		server, _, e := NewPrivateNativePayServer(parent, cfg, registered, buildinfo.Info{}, nil)
		if e != nil {
			t.Fatal(e)
		}
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "POST" && r.URL.Path == "/v5/pay/invoice-intents/lookup" {
				lookup.Add(1)
			} else if r.Method == "GET" {
				reads.Add(1)
			} else {
				effects.Add(1)
				w.WriteHeader(405)
				return
			}
			server.Handler().ServeHTTP(w, r)
		}))
	}
	for _, scenario := range []string{"lost-lookup", "cold-receipts", "revoked"} {
		endpoint := start()
		if scenario == "revoked" {
			revoked.Store(true)
		}
		if len(state.RefundOperations) != 1 {
			t.Fatal("exact original partial refund required")
		}
		refundHash := ""
		for _, hash := range state.RefundOperations {
			refundHash = hash
		}
		input, _ := json.Marshal(map[string]any{"original": original, "intentId": intent.ID, "invoiceId": intent.Terms.InvoiceID, "sessionId": intent.Terms.SessionID, "settlementHash": state.SettlementOperation, "refundHash": refundHash, "origin": endpoint.URL, "scenario": scenario})
		ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
		command := exec.CommandContext(ctx, node, driver)
		command.Stdin = bytes.NewReader(input)
		out, e := command.CombinedOutput()
		cancel()
		endpoint.Close()
		if e != nil {
			t.Fatalf("normal original order %s: %v %s", scenario, e, out)
		}
		t.Logf("ACTUAL_ORIGINAL_ORDER_MAIN %s", bytes.TrimSpace(out))
		after, e := os.ReadFile(file)
		if e != nil || !bytes.Equal(after, raw) {
			t.Fatal("original Pay Store changed during read-only order continuation", scenario, e)
		}
	}
	after, err := os.ReadFile(source)
	if err != nil || !bytes.Equal(after, raw) || effects.Load() != 0 || lookup.Load() != 6 || reads.Load() != 4 {
		t.Fatalf("original order read counts or retained source changed: lookup=%d GET=%d effects=%d err=%v", lookup.Load(), reads.Load(), effects.Load(), err)
	}
	t.Logf("ACTUAL_ORIGINAL_ORDER_COLD processes=3 lookupPOST=%d GET=%d effectPOST=0 signing=0 CoreExecution=0 originalStoreBytesUnchanged=true independentHistoricalProof=true originalMainWrapper=true genuineSource=false", lookup.Load(), reads.Load())
}
