//go:build pay_pq && pay_multi_refund

package payproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	cmttypes "github.com/cometbft/cometbft/types"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// This new delta consumes a new actual Core fixture. No old webhook, Native
// Root0, Wallet Member5, container or unrelated signature matrix is rerun.
func TestNativePayActualShopSameBlockCumulativeRefundCold(t *testing.T) {
	runNativePayActualShopRefundCold(t, true)
}

func TestNativePaySameBlockPartialRefundsThenFullColdReceipt(t *testing.T) {
	dir := os.Getenv("PAY_MULTI_REFUND_WORKFLOW_DIR")
	if !filepath.IsAbs(dir) {
		t.Fatal("new exact multi-refund Core fixture required")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f nativeCoreWorkflowManifest
	if json.Unmarshal(raw, &f) != nil || len(f.Rows) != 5 {
		t.Fatal("complete original fixture required")
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
	var current atomic.Int32
	var corePosts atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row := f.Rows[current.Load()]
		envelope, action, e := nativePayHTTPMember(row.Wire)
		if e != nil {
			t.Error(e)
			w.WriteHeader(500)
			return
		}
		nativeHash, abciHash := consensus.SignedTransactionHash(row.Wire), consensus.SignedTransactionHash(envelope)
		index := uint32(row.Expected.Index)
		if r.Method == "POST" {
			body, _ := io.ReadAll(r.Body)
			if !bytes.Equal(body, row.Wire) {
				t.Error("fixture replacement Member")
				w.WriteHeader(400)
				return
			}
			corePosts.Add(1)
		}
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

	if f.Rows[2].Height != f.Rows[3].Height || f.Rows[2].Expected.Index != 0 || f.Rows[3].Expected.Index != 1 {
		t.Fatal("actual same-block index delta missing")
	}
	original := NativeInvoiceProductIntent{ProductID: "shop.order", StoreID: "store-multi-original", SourceOrder: "order:multi:100", Merchant: f.Merchant, Recipient: f.Terms.Recipient, Genesis: hex.EncodeToString(f.Network), NativeChainID: strconv.FormatUint(f.NativeChainID, 10), AssetID: f.Terms.AssetID, UnitVersion: f.Terms.UnitVersion, AmountAtoms: "100", DomainData: json.RawMessage(`{"orderId":"order:multi:100","approvalRef":"PUBLIC-original-multi-price"}`)}
	intentSource, reader := nativeIntentTestSource(t, parent, original, f.Terms)
	reader.snapshot.Caller = f.Merchant
	server, _, err := NewPrivateNativePayServer(parent, cfg, intentSource, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var reads, posts atomic.Int32
	var reading atomic.Bool
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if reading.Load() {
			if r.Method != http.MethodGet {
				posts.Add(1)
				w.WriteHeader(405)
				return
			}
			reads.Add(1)
		}
		server.Handler().ServeHTTP(w, r)
	}))
	defer endpoint.Close()
	// Explicit bounded PUBLIC test client, within the existing Product transport
	// contract's 30s maximum. No production timeout/profile is changed.
	transport := &http.Transport{DisableKeepAlives: true}
	t.Cleanup(transport.CloseIdleConnections)
	client, err := NewNativeInvoiceIntentClient(endpoint.URL, &http.Client{Transport: transport, Timeout: 30 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	activate := func(i int) {
		row := f.Rows[i]
		current.Store(int32(i))
		source.grant = NativePayAuthorization{ProductMerchantID: reader.snapshot.ProductMerchantID, Principal: row.Registration.Owner, Registration: row.Registration, BoundInvoiceID: f.Terms.InvoiceID, BoundOrderID: original.SourceOrder, BoundSessionID: f.Terms.SessionID, Height: row.Height, KeyEpoch: 1, LedgerNonce: row.Nonce, Until: now.Add(time.Hour), Current: func() error { return nil }}
	}
	ctx := context.Background()
	activate(0)
	intent, err := client.CreateInvoiceIntent(ctx, original, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	for i, row := range f.Rows {
		activate(i)
		var op NativePayOperation
		if i == 0 {
			v, e := client.SubmitMerchantTerms(ctx, intent.IntentID, row.Wire)
			if e != nil {
				t.Fatal(e)
			}
			state, e := service.Read(ctx, f.Merchant, f.Terms.InvoiceID)
			if e != nil {
				t.Fatal(e)
			}
			op = state.Operations[v.TermsNativeHash]
		} else if i == 1 {
			op, err = service.SubmitSettlement(ctx, f.Merchant, f.Terms.InvoiceID, row.Wire)
		} else {
			op, err = service.SubmitRefund(ctx, f.Merchant, f.Terms.InvoiceID, row.Wire)
		}
		if err != nil {
			t.Fatal("original temporary Member setup", i, err)
		}
		if _, e := service.Reconcile(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash); e != nil {
			t.Fatal("actual independent original proof", i, e)
		}
	}
	if corePosts.Load() != 5 {
		t.Fatal("original temporary setup count", corePosts.Load())
	}
	core.Close()
	reading.Store(true)
	cold, err := OpenStore(parent.store.path, parent.key)
	if err != nil {
		t.Fatal(err)
	}
	parent.store = cold
	before, err := os.ReadFile(parent.store.path)
	if err != nil {
		t.Fatal(err)
	}
	// Request only the existing normal compact product projection. That path
	// independently verifies each original; archived anchors are not trust.
	path := "/v5/pay/products/shop.order/order%3Amulti%3A100/invoices/" + f.Merchant + "/" + f.Terms.InvoiceID + "/archive-reconciliation"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.http.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	response.Body.Close()
	if err != nil || response.StatusCode != 200 {
		t.Fatal("normal full refund projection", response.StatusCode, err, string(data))
	}
	var result NativePayArchiveReconciliation
	if err = strictJSON(data, &result); err != nil {
		t.Fatal(err)
	}
	if result.PaidAtoms != "100" || result.RefundedAtoms != "100" || result.NetPaidAtoms != "0" || !result.CompleteKnownOriginals || len(result.Receipts) != 4 || len(result.PendingOriginals) != 0 {
		t.Fatal("full refund totals or known original count", result)
	}
	ids := []string{"refund-first-30", "refund-second-20", "refund-final-50"}
	totals := []string{"30", "50", "100"}
	for i, r := range result.Receipts[1:] {
		if r.RefundID != ids[i] || r.RefundedAtoms != totals[i] || r.Recipient != f.Terms.Payer || r.Payer != f.Terms.Payer || r.SettlementNativeHash != result.Receipts[0].NativeHash || r.AssetID != f.Terms.AssetID || r.UnitVersion != f.Terms.UnitVersion {
			t.Fatal("original refund identity/cumulative binding", i, r)
		}
	}
	if result.Receipts[1].ExecutionHeight != result.Receipts[2].ExecutionHeight || result.Receipts[1].ExecutionIndex != "0" || result.Receipts[2].ExecutionIndex != "1" {
		t.Fatal("normal receipt lost real same-block transaction indices")
	}
	// Ordinary intent/invoice reads must fit the existing stricter Product 1MiB
	// cap, retain exact Wallet settlement Members, and leave disk originals intact.
	view, err := client.ReadInvoiceIntent(ctx, intent.IntentID)
	if err != nil {
		t.Fatal("normal full-refund intent read", err)
	}
	projected, err := json.Marshal(view)
	if err != nil || len(projected) > 1<<20 {
		t.Fatal("normal invoice exceeds existing Product response cap", len(projected), err)
	}
	var projection struct {
		Invoice struct {
			Operations map[string]struct {
				Member      []byte          `json:"member"`
				Envelope    json.RawMessage `json:"envelope"`
				Observation json.RawMessage `json:"observation"`
			} `json:"operations"`
		} `json:"invoice"`
	}
	if err = json.Unmarshal(projected, &projection); err != nil || len(projection.Invoice.Operations) != 5 {
		t.Fatal("normal operation projection lost original identities", err)
	}
	for _, row := range f.Rows {
		op := projection.Invoice.Operations[consensus.SignedTransactionHash(row.Wire)]
		if !bytes.Equal(op.Member, row.Wire) || len(op.Envelope) != 0 || len(op.Observation) != 0 {
			t.Fatal("invoice projection changed Member or repeated large collector originals")
		}
	}
	t.Logf("NORMAL_FULL_REFUND_INTENT_BYTES=%d existingProductCap=%d", len(projected), 1<<20)
	// Independently anchored raw reader refuses a modified original expected
	// index. Only the read response is changed, never Core/Store/trust or grant.
	tamperClient := &http.Client{Timeout: 30 * time.Second, Transport: multiRefundIndexTamper{base: transport}}
	tampered, err := NewNativeInvoiceIntentClient(endpoint.URL, tamperClient)
	if err != nil {
		t.Fatal(err)
	}
	hash := consensus.SignedTransactionHash(f.Rows[3].Wire)
	if _, e := tampered.ReadOriginalArchiveReceipt(ctx, original, f.Terms.InvoiceID, hash, proofs, func() error { return nil }); e == nil || !strings.Contains(e.Error(), "independent archive expectation differs from original") {
		t.Fatal("altered actual index1 was not refused by independent expected binding", e)
	}
	after, err := os.ReadFile(parent.store.path)
	if err != nil || !bytes.Equal(before, after) || posts.Load() != 0 || corePosts.Load() != 5 {
		t.Fatal("read-only full refund changed original state or sent funds", err)
	}
	t.Logf("ACTUAL_SAME_BLOCK_FULL_REFUND %s", mustNativeReceiptJSON(map[string]any{"paid": "100", "refunds": ids, "cumulative": totals, "net": "0", "sameBlockIndices": []string{"0", "1"}, "receipts": result.Receipts, "CoreOffline": true, "coldStoreUnchanged": true, "wrongIndexRejected": true, "GET": reads.Load(), "POST": posts.Load(), "CoreFixtureSetupPOST": corePosts.Load(), "RootAdmission": false, "realFunds": false}))
}

type multiRefundIndexTamper struct{ base http.RoundTripper }

func (m multiRefundIndexTamper) RoundTrip(r *http.Request) (*http.Response, error) {
	response, err := m.base.RoundTrip(r)
	if err != nil {
		return response, err
	}
	if strings.Contains(r.URL.Path, "/originals/") && response.StatusCode == 200 {
		raw, e := io.ReadAll(io.LimitReader(response.Body, NativePayOriginalArchiveMaxBytes+1))
		response.Body.Close()
		if e != nil {
			return nil, e
		}
		var archive NativePayOriginalArchive
		if e = strictJSON(raw, &archive); e != nil {
			return nil, e
		}
		archive.Expected.Index = 0
		// An untrusted archive can recompute its plain DATA digest. Independent
		// Source expectations and actual proof coordinates must still reject it.
		archive.Digest = nativeArchiveDigest(archive)
		changed, e := json.Marshal(archive)
		if e != nil {
			return nil, e
		}
		response.Body = io.NopCloser(bytes.NewReader(changed))
		response.ContentLength = int64(len(changed))
		response.Header.Set("Content-Length", strconv.Itoa(len(changed)))
	}
	return response, nil
}
