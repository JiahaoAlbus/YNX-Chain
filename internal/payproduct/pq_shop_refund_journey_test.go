//go:build pay_pq

package payproduct

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
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
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// One new staged cross-owner journey. The sidecar is the original Shop test
// binary, selected by exact immutable evidence hash. PUBLIC Source fixtures
// prepare original orders/temporary Members; actual normal Pay proof math,
// HTTP routes, Shop business effects, cold Store and return flow execute.
func TestNativePayActualShopReceiptReturnPartialRefundCold(t *testing.T) {
	runNativePayActualShopRefundCold(t, false)
}

func runNativePayActualShopRefundCold(t *testing.T, multi bool) {
	t.Helper()
	dir, driver := os.Getenv("PAY_CORE_WORKFLOW_DIR"), os.Getenv("PAY_SHOP_REFUND_DRIVER_BINARY")
	if !filepath.IsAbs(dir) || !filepath.IsAbs(driver) {
		t.Fatal("exact Core fixture and original Shop driver required")
	}
	rowCount := 3
	if multi {
		dir = os.Getenv("PAY_MULTI_REFUND_WORKFLOW_DIR")
		rowCount = 5
		if !filepath.IsAbs(dir) {
			t.Fatal("exact multi-refund fixture required")
		}
	}
	driverBytes, err := os.ReadFile(driver)
	if err != nil {
		t.Fatal(err)
	}
	driverHash := sha256.Sum256(driverBytes)
	if hex.EncodeToString(driverHash[:]) != os.Getenv("PAY_SHOP_REFUND_DRIVER_SHA256") {
		t.Fatal("Shop driver pin changed")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f nativeCoreWorkflowManifest
	if json.Unmarshal(raw, &f) != nil || len(f.Rows) != rowCount {
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
	var corePosts, coreReadsDuringReceipt atomic.Int32
	var receiptStage atomic.Bool
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if receiptStage.Load() {
			coreReadsDuringReceipt.Add(1)
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
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

	command := exec.CommandContext(t.Context(), driver, "-test.run=^TestP06OriginalPayShopDriver$", "-test.timeout=5m")
	command.Env = append(os.Environ(), "PAY_SHOP_ORIGINAL_DRIVER=1")
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := os.CreateTemp(t.TempDir(), "original-shop-stderr-")
	if err != nil {
		t.Fatal(err)
	}
	defer stderr.Close()
	command.Stderr = stderr // direct original fd; no concurrently read Buffer
	readStderr := func() string { b, _ := os.ReadFile(stderr.Name()); return string(b) }
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		_ = input.Close()
		if !waited {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	}()
	encoder := json.NewEncoder(input)
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	send := func(v any) {
		t.Helper()
		if e := encoder.Encode(v); e != nil {
			t.Fatal("Shop original driver send", e, readStderr())
		}
	}
	type message struct {
		Phase   string                     `json:"phase"`
		Request NativeInvoiceProductIntent `json:"request"`
		Result  map[string]any             `json:"result"`
	}
	receive := func(want string) message {
		t.Helper()
		var originalLog strings.Builder
		for scanner.Scan() {
			var m message
			if json.Unmarshal(scanner.Bytes(), &m) == nil && m.Phase != "" {
				if m.Phase != want {
					t.Fatal("Shop driver protocol", want, string(scanner.Bytes()), readStderr())
				}
				return m
			}
			originalLog.Write(scanner.Bytes())
			originalLog.WriteByte('\n')
		}
		t.Fatal("Shop driver stopped before", want, scanner.Err(), originalLog.String(), readStderr())
		return message{}
	}
	termsView := nativeIntentView(nativeInvoiceIntentRecord{Terms: f.Terms}).Terms
	send(map[string]any{"phase": "init", "merchant": f.Merchant, "payer": f.Terms.Payer, "genesis": hex.EncodeToString(f.Network), "nativeChainId": strconv.FormatUint(f.NativeChainID, 10), "terms": termsView, "refundId": "refund-30", "MultiRefund": multi})
	original := receive("original").Request
	if original.ProductID != "shop.order" || original.StoreID == "" || original.SourceOrder == "" || original.Merchant != f.Merchant || original.Recipient != f.Terms.Recipient || original.Genesis != hex.EncodeToString(f.Network) || original.NativeChainID != strconv.FormatUint(f.NativeChainID, 10) || original.AssetID != f.Terms.AssetID || original.UnitVersion != f.Terms.UnitVersion || original.AmountAtoms != "100" {
		t.Fatal("Shop original request changed actual Core terms")
	}
	intentSource, reader := nativeIntentTestSource(t, parent, original, f.Terms)
	reader.snapshot.Caller = f.Merchant
	server, _, err := NewPrivateNativePayServer(parent, cfg, intentSource, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var reads, preparationPosts, originalLookupPosts, unexpectedMoneyPosts atomic.Int32
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		t.Logf("ACTUAL_SHOP_PAY_REQUEST start method=%s path=%s bytes=%d", r.Method, r.URL.EscapedPath(), r.ContentLength)
		defer func() {
			t.Logf("ACTUAL_SHOP_PAY_REQUEST end method=%s path=%s elapsed=%s", r.Method, r.URL.EscapedPath(), time.Since(started))
		}()
		if r.Method == http.MethodGet {
			reads.Add(1)
		}
		if r.Method == http.MethodPost && r.URL.Path == "/v5/pay/invoice-intents" {
			preparationPosts.Add(1)
		}
		if r.Method == http.MethodPost && r.URL.Path == "/v5/pay/invoice-intents/lookup" {
			originalLookupPosts.Add(1)
		}
		if r.Method != http.MethodGet && !(r.Method == http.MethodPost && (r.URL.Path == "/v5/pay/invoice-intents" || r.URL.Path == "/v5/pay/invoice-intents/lookup")) {
			unexpectedMoneyPosts.Add(1)
			w.WriteHeader(405)
			return
		}
		server.Handler().ServeHTTP(w, r)
	}))
	defer endpoint.Close()
	client, err := NewNativeInvoiceIntentClient(endpoint.URL, endpoint.Client())
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
	// Follow the real chronology: Shop prepares the original before any money
	// archive exists. The old failed duplicate-prepare fixture remains separate
	// evidence; it is never retried or relabelled as a known outcome.
	send(map[string]any{"phase": "prepare", "origin": endpoint.URL, "original": original})
	receive("prepared")
	intent, err := client.LookupInvoiceIntent(ctx, original)
	if err != nil {
		t.Fatal(err)
	}
	advance := func(i int) {
		t.Helper()
		activate(i)
		row := f.Rows[i]
		var op NativePayOperation
		if i == 0 {
			intents, e := NewNativeInvoiceIntents(service, intentSource)
			if e != nil {
				t.Fatal(e)
			}
			v, e := intents.SubmitMerchantTerms(ctx, intent.IntentID, row.Wire)
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
			t.Fatal(err)
		}
		if _, e := service.Reconcile(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash); e != nil {
			t.Fatal(e)
		}
	}
	// Prepare historical PUBLIC originals through normal service, never fabricate
	// an archive/receipt or mutate the Shop database from the Pay owner.
	advance(0)
	advance(1)
	issued, err := client.ReadInvoiceIntent(ctx, intent.IntentID)
	if err != nil {
		t.Fatal(err)
	}
	receiptStage.Store(true)
	send(map[string]any{"phase": "paid", "origin": endpoint.URL, "original": original, "invoiceIntent": issued})
	beforeRefund := receive("refund").Result
	if corePosts.Load() != 2 || beforeRefund["paidAtoms"] != "100" {
		t.Fatal("Shop receipt stage sent a money action")
	}
	var result map[string]any
	var stageResults []map[string]any
	for i := 2; i < len(f.Rows); i++ {
		receiptStage.Store(false)
		advance(i)
		if i == len(f.Rows)-1 {
			core.Close()
		}
		cold, e := OpenStore(parent.store.path, parent.key)
		if e != nil {
			t.Fatal(e)
		}
		parent.store = cold
		payDiskBefore, e := os.ReadFile(parent.store.path)
		if e != nil {
			t.Fatal(e)
		}
		receiptStage.Store(true)
		send(map[string]any{"phase": "refunded"})
		phase := "done"
		if i < len(f.Rows)-1 {
			phase = "refund-progress"
		}
		result = receive(phase).Result
		stageResults = append(stageResults, result)
		wantRefund, wantNet := "30", "70"
		if multi {
			wantRefund = []string{"30", "50", "100"}[i-2]
			wantNet = []string{"70", "50", "0"}[i-2]
		}
		if result["paidAtoms"] != "100" || result["refundedAtoms"] != wantRefund || result["netPaidAtoms"] != wantNet {
			t.Fatal("Shop original cumulative stage", i, result)
		}
		payDiskAfter, e := os.ReadFile(parent.store.path)
		if e != nil || !bytes.Equal(payDiskBefore, payDiskAfter) {
			t.Fatal("receipt stage changed original Pay disk", i, e)
		}
	}
	_ = input.Close()
	for scanner.Scan() {
	} // original Go test binary's final PASS
	if scanner.Err() != nil {
		t.Fatal(scanner.Err())
	}
	err = command.Wait()
	waited = true
	if err != nil {
		t.Fatal("original Shop driver", err, readStderr())
	}
	wantRefund, wantNet := "30", "70"
	if multi {
		wantRefund, wantNet = "100", "0"
	}
	for k, want := range map[string]string{"paidAtoms": "100", "refundedAtoms": wantRefund, "netPaidAtoms": wantNet} {
		if result[k] != want {
			t.Fatal("Shop original amount", k, result)
		}
	}
	for _, k := range []string{"cold", "duplicateSafe", "returnReceived", "restocked"} {
		if result[k] != true {
			t.Fatal("Shop original acceptance", k, result)
		}
	}
	if unexpectedMoneyPosts.Load() != 0 || corePosts.Load() != int32(rowCount) || coreReadsDuringReceipt.Load() != 0 || reads.Load() == 0 || preparationPosts.Load() != 1 || originalLookupPosts.Load() != 1 {
		t.Fatal("receipt recovery queried Core or sent money", unexpectedMoneyPosts.Load(), corePosts.Load(), coreReadsDuringReceipt.Load(), reads.Load())
	}
	t.Logf("ACTUAL_PAY_SHOP_STAGED_RECEIPT_RETURN %s", mustNativeReceiptJSON(map[string]any{"original": original, "beforeRefund": beforeRefund, "result": result, "stageResults": stageResults, "sameBlockCumulative": multi, "CoreReceiptCalls": coreReadsDuringReceipt.Load(), "PayGET": reads.Load(), "originalPreparationPOST": preparationPosts.Load(), "originalQueryOnlyLookupPOST": originalLookupPosts.Load(), "moneyPOST": unexpectedMoneyPosts.Load(), "CoreSetupMemberPOST": corePosts.Load(), "CoreOfflineAfterRefund": true, "PayColdDiskUnchanged": true, "RootAdmission": false, "funds": false}))
}
func mustNativeReceiptJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
