//go:build pay_pq && pay_order_operation_recovery

package payproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Import the existing three PUBLIC original Members once, losing their real
// transport acknowledgements. No fixture edits a durable operation to UNKNOWN,
// recreates an invoice, signs, or executes consensus. Actual normal r6/Main
// consumers reconcile those same identities using the original H/H+1 proofs.
func TestNativeOriginalOrderOperationNormalMainUnknownColdRecovery(t *testing.T) {
	dir, node, driver := os.Getenv("PAY_CORE_WORKFLOW_DIR"), os.Getenv("PAY_NODE_BINARY"), os.Getenv("PAY_ORDER_OPERATION_DRIVER")
	for _, p := range []string{dir, node, driver} {
		if !filepath.IsAbs(p) {
			t.Fatal("exact original Core fixture/Node/normal consumer required")
		}
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f nativeCoreWorkflowManifest
	if json.Unmarshal(raw, &f) != nil || len(f.Rows) != 3 {
		t.Fatal("complete fixed three-row original required")
	}
	bootstrap, err := consensus.NewConsensusBootstrap(f.Genesis, f.Pins, f.Migration)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := consensus.NewPQEngineAuthorization(f.Schedule, f.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := consensus.LoadPQEngineSnapshot(f.Migration, filepath.Join(dir, "engine.state"), bootstrap, auth, f.EngineHeight, f.EngineAppHash)
	if err != nil {
		t.Fatal(err)
	}
	var trusted cmttypes.LightBlock
	if err = cmtjson.Unmarshal(f.Trusted, &trusted); err != nil {
		t.Fatal(err)
	}
	proofs := &nativeWorkflowProofSource{rows: f.Rows, trust: consensus.PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: &trusted, TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustLevel: cmtmath.Fraction{Numerator: 1, Denominator: 3}, Now: f.Now}}
	var selected, corePosts, reconciles, lostReplies atomic.Int32
	var loseReply atomic.Bool
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row := f.Rows[selected.Load()]
		envelope, action, e := nativePayHTTPMember(row.Wire)
		if e != nil {
			t.Error(e)
			w.WriteHeader(500)
			return
		}
		if r.Method == "POST" {
			body, _ := io.ReadAll(r.Body)
			if !bytes.Equal(body, row.Wire) || corePosts.Add(1) != selected.Load()+1 {
				t.Error("repeated/replaced PUBLIC original dispatch")
				w.WriteHeader(409)
				return
			}
			connection, _, e := w.(http.Hijacker).Hijack()
			if e != nil {
				t.Error(e)
				return
			}
			_ = connection.Close()
			return
		}
		nativeHash, abciHash := consensus.SignedTransactionHash(row.Wire), consensus.SignedTransactionHash(envelope)
		index := uint32(0)
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/invoices/pq/") {
			_ = json.NewEncoder(w).Encode(row.View)
			return
		}
		if strings.HasSuffix(r.URL.Path, "pq-finality-proof") {
			_ = json.NewEncoder(w).Encode(bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "collected", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, ExecutionHeight: row.Height, CometIndex: &index, ProofVerification: "not-performed", Proof: &row.Proof})
			return
		}
		_ = json.NewEncoder(w).Encode(bftgateway.PQActionView{Type: action.Kind, Status: "committed", Committed: true, ExecutionHeight: row.Height, CometIndex: &index, ExecutionData: row.Data, Effects: json.RawMessage(row.Data), Source: "comet-rpc", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, Wire: row.Wire, Transport: envelope, From: action.Owner, Nonce: action.Nonce, Fee: action.Fee, ReadbackURL: nativePayOriginalPath + nativeHash, ABCIReadbackURL: "/transactions/pq/actions/" + abciHash})
	}))
	defer core.Close()
	now := time.Now().UTC()
	parent, _ := testService(t, &fakePay{}, func() time.Time { return now })
	source := &nativeSourceFixture{}
	caller, err := NewNativePayHTTP(core.URL, core.Client())
	if err != nil {
		t.Fatal(err)
	}
	cfg := NativePayConfig{Genesis: f.Network, NativeChainID: f.NativeChainID, HTTP: caller, Authority: source, ProofSource: proofs}
	service, err := NewNativePayService(parent, cfg)
	if err != nil {
		t.Fatal(err)
	}
	original := NativeInvoiceProductIntent{ProductID: "shop.order", StoreID: "registered-original-store", SourceOrder: "order:100", Merchant: f.Merchant, Recipient: f.Terms.Recipient, Genesis: hex.EncodeToString(f.Network), NativeChainID: strconv.FormatUint(f.NativeChainID, 10), AssetID: f.Terms.AssetID, UnitVersion: f.Terms.UnitVersion, AmountAtoms: "100", DomainData: json.RawMessage(`{"orderId":"order:100","storeId":"registered-original-store","approvalRef":"PUBLIC-original-order"}`)}
	intentSource, reader := nativeIntentTestSource(t, parent, original, f.Terms)
	reader.snapshot.Caller = f.Merchant
	var endpoint *httptest.Server
	var client *NativeInvoiceIntentClient
	start := func() {
		server, _, e := NewPrivateNativePayServer(parent, cfg, intentSource, buildinfo.Info{}, nil)
		if e != nil {
			t.Fatal(e)
		}
		handler := server.Handler()
		endpoint = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "POST" && strings.Contains(r.URL.Path, "/operations/") && strings.HasSuffix(r.URL.Path, "/reconcile") {
				reconciles.Add(1)
				if loseReply.Swap(false) {
					response := httptest.NewRecorder()
					handler.ServeHTTP(response, r)
					if response.Code != 200 {
						t.Errorf("lost original reconcile not persisted: %d %s", response.Code, response.Body.String())
					}
					connection, _, e := w.(http.Hijacker).Hijack()
					if e != nil {
						t.Error(e)
						return
					}
					lostReplies.Add(1)
					_ = connection.Close()
					return
				}
			}
			handler.ServeHTTP(w, r)
		}))
		client, e = NewNativeInvoiceIntentClient(endpoint.URL, endpoint.Client())
		if e != nil {
			t.Fatal(e)
		}
	}
	start()
	defer func() { endpoint.Close() }()
	activate := func(i int) {
		row := f.Rows[i]
		selected.Store(int32(i))
		source.grant = NativePayAuthorization{ProductMerchantID: reader.snapshot.ProductMerchantID, Principal: row.Registration.Owner, Registration: row.Registration, BoundInvoiceID: f.Terms.InvoiceID, BoundOrderID: original.SourceOrder, BoundSessionID: f.Terms.SessionID, Height: row.Height, KeyEpoch: 1, LedgerNonce: row.Nonce, Until: now.Add(time.Hour), Current: func() error { return nil }}
	}
	cold := func() {
		endpoint.Close()
		store, e := OpenStore(parent.store.path, parent.key)
		if e != nil {
			t.Fatal(e)
		}
		parent.store = store
		start()
	}
	run := func(i int, mode string) {
		command := exec.CommandContext(t.Context(), node, driver)
		body, _ := json.Marshal(map[string]any{"original": original, "origin": endpoint.URL, "invoiceId": f.Terms.InvoiceID, "nativeHash": consensus.SignedTransactionHash(f.Rows[i].Wire), "kind": []string{"invoice_terms", "invoice_settle", "invoice_refund"}[i], "mode": mode})
		command.Stdin = bytes.NewReader(body)
		output, e := command.CombinedOutput()
		if e != nil {
			t.Fatalf("normal original-operation consumer: %v\n%s", e, output)
		}
		t.Logf("ORIGINAL_OPERATION_MAIN %s", bytes.TrimSpace(output))
	}
	ctx := context.Background()
	activate(0)
	intent, err := client.CreateInvoiceIntent(ctx, original, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	for i, row := range f.Rows {
		activate(i)
		hash := consensus.SignedTransactionHash(row.Wire)
		if i == 0 {
			_, err = client.SubmitMerchantTerms(ctx, intent.IntentID, row.Wire)
		} else if i == 1 {
			_, err = service.SubmitSettlement(ctx, f.Merchant, f.Terms.InvoiceID, row.Wire)
		} else {
			_, err = service.SubmitRefund(ctx, f.Merchant, f.Terms.InvoiceID, row.Wire)
		}
		if err == nil {
			t.Fatal("lost original Core ACK reported known", i)
		}
		state, e := service.Read(ctx, f.Merchant, f.Terms.InvoiceID)
		if e != nil || state.Operations[hash].Status != "unknown" {
			t.Fatal("actual durable UNKNOWN not retained", i, e)
		}
		before := state.Operations[hash].NativePayOriginal
		cold()
		mode := "recover"
		if i == 1 {
			mode = "lost"
			loseReply.Store(true)
		}
		run(i, mode)
		state, e = service.Read(ctx, f.Merchant, f.Terms.InvoiceID)
		after := state.Operations[hash]
		if e != nil || after.Status != "confirmed" || hashJSON(before) != hashJSON(after.NativePayOriginal) || corePosts.Load() != int32(i+1) {
			t.Fatal("same original identity/Member/nonce changed during recovery", i, e)
		}
		if i > 0 {
			if _, e = client.ReadOriginalArchiveReceipt(ctx, original, f.Terms.InvoiceID, hash, proofs, func() error { return nil }); e != nil {
				t.Fatal("independent original receipt", e)
			}
		}
	}
	cold()
	core.Close() // Cold read recovery must not depend on the collector's uptime.
	before, err := os.ReadFile(parent.store.path)
	if err != nil {
		t.Fatal(err)
	}
	run(2, "readonly")
	after, err := os.ReadFile(parent.store.path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("cold readonly original recovery mutated Store", err)
	}
	source.denied = true
	run(2, "revoked")
	if corePosts.Load() != 3 || reconciles.Load() != 3 || lostReplies.Load() != 1 {
		t.Fatal("extra original dispatch/reconcile", corePosts.Load(), reconciles.Load(), lostReplies.Load())
	}
	t.Log("ORIGINAL_OPERATION_RECOVERY terms+settle+refund actualLostCoreACK=3 sameOriginalReconciles=3 lostReconcileReply=1 coldStoreReopens=4 independentOriginalProofs=true originalMemberNoncePreserved=true coldReadonlyDiskExact=true cleanupRetireJoinClose=true PUBLICSourceOnly=true signing=0 realFunds=0")
}
