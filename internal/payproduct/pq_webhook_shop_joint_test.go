//go:build pay_pq && pay_webhook_shop_joint

package payproduct

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
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

// New cross-owner callback combination. No BlockExecutor/export/funds suite is
// rerun: exact original Members/proofs from the retained fixture initialize a
// PUBLIC historical adapter. Receipt GETs still execute the original verifier.
// This is a refusal control: the original Shop archive digests are immutable,
// so newly reconstructed archives must not be accepted as the old originals.
func TestNativeWebhookActualShopTLSColdInboxRefusesReplacementArchive(t *testing.T) {
	driver, inputFile := os.Getenv("PAY_SHOP_NOTIFICATION_DRIVER_BINARY"), os.Getenv("PAY_SHOP_NOTIFICATION_INPUT")
	if !filepath.IsAbs(driver) || !filepath.IsAbs(inputFile) {
		t.Fatal("frozen original Shop driver/input required")
	}
	raw, err := os.ReadFile(driver)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != os.Getenv("PAY_SHOP_NOTIFICATION_DRIVER_SHA256") {
		t.Fatal("Shop original binary pin differs")
	}
	var in struct {
		Original          NativeInvoiceProductIntent `json:"original"`
		SourcePath        string                     `json:"sourcePath"`
		SourceSHA256      string                     `json:"sourceSHA256"`
		OrderID           string                     `json:"orderId"`
		CoreFixtureDir    string
		OriginalPayOrigin string
	}
	raw, err = os.ReadFile(inputFile)
	if err != nil || json.Unmarshal(raw, &in) != nil {
		t.Fatal("original combination input", err)
	}
	sourceBytes, err := os.ReadFile(in.SourcePath)
	if err != nil {
		t.Fatal(err)
	}
	sourceHash := sha256.Sum256(sourceBytes)
	if hex.EncodeToString(sourceHash[:]) != in.SourceSHA256 || in.OrderID != in.Original.SourceOrder {
		t.Fatal("original frozen Shop source/reference differs")
	}
	raw, err = os.ReadFile(filepath.Join(in.CoreFixtureDir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f nativeCoreWorkflowManifest
	if json.Unmarshal(raw, &f) != nil || len(f.Rows) != 3 || hex.EncodeToString(f.Network) != in.Original.Genesis || f.Merchant != in.Original.Merchant {
		t.Fatal("matching retained original Core fixture required")
	}
	bootstrap, err := consensus.NewConsensusBootstrap(f.Genesis, f.Pins, f.Migration)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := consensus.NewPQEngineAuthorization(f.Schedule, f.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := consensus.LoadPQEngineSnapshot(f.Migration, filepath.Join(in.CoreFixtureDir, "engine.state"), bootstrap, auth, f.EngineHeight, f.EngineAppHash)
	if err != nil {
		t.Fatal(err)
	}
	var trusted cmttypes.LightBlock
	if err = cmtjson.Unmarshal(f.Trusted, &trusted); err != nil {
		t.Fatal(err)
	}
	proofs := &nativeWorkflowProofSource{rows: f.Rows, trust: consensus.PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: &trusted, TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustLevel: cmtmath.Fraction{Numerator: 1, Denominator: 3}, Now: f.Now}}
	var index, setupPosts atomic.Int32
	historical := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row := f.Rows[index.Load()]
		envelope, action, e := nativePayHTTPMember(row.Wire)
		if e != nil {
			t.Error(e)
			w.WriteHeader(500)
			return
		}
		nativeHash, abciHash := consensus.SignedTransactionHash(row.Wire), consensus.SignedTransactionHash(envelope)
		i := uint32(row.Expected.Index)
		if r.Method == "POST" {
			body, _ := io.ReadAll(r.Body)
			if !bytes.Equal(body, row.Wire) {
				t.Error("replacement original reached historical adapter")
				w.WriteHeader(400)
				return
			}
			setupPosts.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/invoices/pq/") {
			_ = json.NewEncoder(w).Encode(row.View)
			return
		}
		if strings.HasSuffix(r.URL.Path, "pq-finality-proof") {
			_ = json.NewEncoder(w).Encode(bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "collected", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, ExecutionHeight: row.Height, CometIndex: &i, ProofVerification: "not-performed", Proof: &row.Proof})
			return
		}
		_ = json.NewEncoder(w).Encode(bftgateway.PQActionView{Type: action.Kind, Status: "committed", Committed: true, ExecutionHeight: row.Height, CometIndex: &i, ExecutionData: row.Data, Effects: json.RawMessage(row.Data), Source: "comet-rpc", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, Wire: row.Wire, Transport: envelope, From: action.Owner, Nonce: action.Nonce, Fee: action.Fee, ReadbackURL: nativePayOriginalPath + nativeHash, ABCIReadbackURL: "/transactions/pq/actions/" + abciHash})
	}))
	defer historical.Close()
	now := time.Now().UTC()
	parent, _ := testService(t, &fakePay{}, func() time.Time { return now })
	resultDir := os.Getenv("PAY_SHOP_NOTIFICATION_RESULT_DIR")
	if !filepath.IsAbs(resultDir) {
		t.Fatal("owned absolute PUBLIC evidence directory required")
	}
	if err = os.MkdirAll(resultDir, 0700); err != nil {
		t.Fatal(err)
	}
	// Keep actual produced evidence after both success and failure. This Store
	// contains PUBLIC test credentials only (testService's known bytes32(7)).
	t.Cleanup(func() {
		data, e := os.ReadFile(parent.store.path)
		if e == nil {
			e = os.WriteFile(filepath.Join(resultDir, "PUBLIC-reconstructed-pay-store.json"), data, 0600)
		}
		if e != nil {
			t.Error("preserve PUBLIC reconstructed Pay Store", e)
		}
	})
	source := &nativeSourceFixture{}
	caller, err := NewNativePayHTTP(historical.URL, historical.Client())
	if err != nil {
		t.Fatal(err)
	}
	cfg := NativePayConfig{Genesis: f.Network, NativeChainID: f.NativeChainID, HTTP: caller, Authority: source, ProofSource: proofs}
	service, err := NewNativePayService(parent, cfg)
	if err != nil {
		t.Fatal(err)
	}
	intentSource, reader := nativeIntentTestSource(t, parent, in.Original, f.Terms)
	reader.snapshot.Caller = f.Merchant
	payServer, intents, err := NewPrivateNativePayServer(parent, cfg, intentSource, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var payGET, payWrites atomic.Int32
	payHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			payWrites.Add(1)
			w.WriteHeader(405)
			return
		}
		payGET.Add(1)
		payServer.Handler().ServeHTTP(w, r)
	})
	originalURL, err := url.Parse(in.OriginalPayOrigin)
	if err != nil || originalURL.Scheme != "http" || originalURL.Hostname() != "127.0.0.1" || originalURL.Port() == "" || originalURL.User != nil || originalURL.Path != "" || originalURL.RawQuery != "" || originalURL.Fragment != "" {
		t.Fatal("exact retained PUBLIC loopback authority required")
	}
	listener, err := net.Listen("tcp", originalURL.Host)
	if err != nil {
		t.Fatal("original PUBLIC authority occupied; no alternate peer permitted", err)
	}
	payOriginal := httptest.NewUnstartedServer(payHandler)
	payOriginal.Listener.Close()
	payOriginal.Listener = listener
	payOriginal.Start()
	defer payOriginal.Close()
	if payOriginal.URL != in.OriginalPayOrigin {
		t.Fatal("original PUBLIC authority changed", payOriginal.URL)
	}
	var merchant Merchant
	parent.store.View(func(data Snapshot) error { merchant = data.Merchants[reader.snapshot.ProductMerchantID]; return nil })
	secret, err := parent.open(merchant.WebhookSecretCipher)
	if err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(t.Context(), driver, "-test.run=^TestNativePayNotificationOriginalReadDriver$", "-test.timeout=3m")
	command.Env = append(os.Environ(), "P07_PUBLIC_PAY_NOTIFICATION_DRIVER=1")
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := os.CreateTemp(resultDir, "original-Shop-notification-stderr-")
	if err != nil {
		t.Fatal(err)
	}
	defer stderr.Close()
	command.Stderr = stderr
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		_ = stdin.Close()
		if !waited {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	}()
	enc := json.NewEncoder(stdin)
	scan := bufio.NewScanner(stdout)
	scan.Buffer(make([]byte, 4096), 1<<20)
	exchange := func(value any) map[string]any {
		t.Helper()
		if e := enc.Encode(value); e != nil {
			t.Fatal(e)
		}
		for scan.Scan() {
			line := scan.Text()
			if strings.HasPrefix(line, "P07_NOTIFICATION_JSON ") {
				var v map[string]any
				if e := json.Unmarshal([]byte(strings.TrimPrefix(line, "P07_NOTIFICATION_JSON ")), &v); e != nil {
					t.Fatal(e)
				}
				return v
			}
		}
		diagnostic, _ := os.ReadFile(stderr.Name())
		t.Fatal("original Shop driver stopped", scan.Err(), string(diagnostic))
		return nil
	}
	init := exchange(map[string]any{"command": "init", "sourcePath": in.SourcePath, "sourceSHA256": in.SourceSHA256, "orderId": in.OrderID, "origin": in.OriginalPayOrigin, "originalPUBLICHTTP": true, "merchantId": merchant.ID, "secretHex": hex.EncodeToString([]byte(secret)), "secretVersion": merchant.SecretVersion})
	endpoint, ok := init["endpoint"].(string)
	if !ok || init["sourceOrder"] != in.OrderID || init["paidAtoms"] != "100" || init["refundedAtoms"] != "30" || init["netPaidAtoms"] != "70" {
		t.Fatal("original partial order changed", init)
	}
	ca := x509.NewCertPool()
	if !ca.AppendCertsFromPEM([]byte(init["caPEM"].(string))) {
		t.Fatal("original Shop PUBLIC TLS CA missing")
	}
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: ca, MinVersion: tls.VersionTLS13}, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	capture := &nativeWebhookCaptureTransport{base: transport}
	parent.client = &http.Client{Transport: capture, Timeout: 10 * time.Second}
	if err = parent.SetWebhook(merchant, endpoint); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	activate := func(i int) {
		row := f.Rows[i]
		index.Store(int32(i))
		source.grant = NativePayAuthorization{ProductMerchantID: merchant.ID, Principal: row.Registration.Owner, Registration: row.Registration, BoundInvoiceID: f.Terms.InvoiceID, BoundOrderID: in.Original.SourceOrder, BoundSessionID: f.Terms.SessionID, Height: row.Height, KeyEpoch: 1, LedgerNonce: row.Nonce, Until: now.Add(time.Hour), Current: func() error { return nil }}
	}
	activate(0)
	intent, err := intents.CreateInvoiceIntent(ctx, in.Original, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	for i, row := range f.Rows {
		activate(i)
		var op NativePayOperation
		if i == 0 {
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
		if _, err = service.Reconcile(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash); err != nil {
			t.Fatal(err)
		}
	}
	historical.Close() // new normal receipt GETs must verify retained archives offline
	refundHash := consensus.SignedTransactionHash(f.Rows[2].Wire)
	var delivery WebhookDelivery
	parent.store.View(func(data Snapshot) error {
		for _, d := range data.Deliveries {
			if d.ObjectID == refundHash && d.ParentDeliveryID == "" {
				delivery = d
			}
		}
		return nil
	})
	if delivery.ID == "" || delivery.NativeInvoice == nil || delivery.NativeInvoice.SourceOrder != in.OrderID {
		t.Fatal("verified native original did not queue exact callback reference")
	}
	sent, err := parent.Deliver(ctx, delivery.ID)
	if err != nil || sent.Status != "delivered" || sent.HTTPStatus != 202 || sent.Attempt != 1 {
		t.Fatal("original sender to actual Shop receiver", err, sent.Status, sent.HTTPStatus)
	}
	accepted := exchange(map[string]any{"command": "inspect"})
	gotReads := accepted["qualifiedOriginalGETs"]
	if accepted["originalNotificationCount"] != float64(1) || gotReads != nil && len(gotReads.([]any)) != 0 {
		t.Fatal("callback alone borrowed receipt authority", accepted)
	}
	exchange(map[string]any{"command": "cold"})
	request, body := capture.copyRequest()
	if request == nil {
		t.Fatal("normal sender request not captured")
	}
	request.Body = io.NopCloser(bytes.NewReader(body))
	request.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }
	duplicateClient := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := duplicateClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 202 {
		t.Fatal("valid network duplicate after Shop cold reopen", response.StatusCode)
	}
	duplicate := exchange(map[string]any{"command": "inspect"})
	if duplicate["originalNotificationCount"] != float64(1) {
		t.Fatal("same event forked original inbox", duplicate)
	}
	cold, err := OpenStore(parent.store.path, parent.key)
	if err != nil {
		t.Fatal(err)
	}
	parent.store = cold
	before, err := os.ReadFile(parent.store.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = parent.Deliver(ctx, delivery.ID); err != nil || capture.count.Load() != 1 {
		t.Fatal("cold acknowledged producer sent a new attempt", err, capture.count.Load())
	}
	// Exercise the normal qualified read before the Shop refusal. The proof is
	// independently valid, while the archive identity differs from the original
	// accepted at the prior run. Neither timestamp nor previous digest is forged.
	path := "/v5/pay/products/shop.order/" + in.OrderID + "/invoices/" + f.Merchant + "/" + f.Terms.InvoiceID + "/archive-reconciliation"
	response, err = payOriginal.Client().Get(payOriginal.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	var reconstructed NativePayArchiveReconciliation
	err = json.NewDecoder(response.Body).Decode(&reconstructed)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || reconstructed.PaidAtoms != "100" || reconstructed.RefundedAtoms != "30" || reconstructed.NetPaidAtoms != "70" || len(reconstructed.Receipts) != 2 {
		t.Fatal("normal independent archived read failed", err, response.StatusCode)
	}
	var originalShop struct {
		Orders map[string]struct {
			NativePayment struct {
				Receipts []struct {
					NativeHash    string `json:"nativeHash"`
					ArchiveDigest string `json:"archiveDigest"`
				}
			}
		}
	}
	if json.Unmarshal(sourceBytes, &originalShop) != nil || len(originalShop.Orders[in.OrderID].NativePayment.Receipts) != 2 {
		t.Fatal("retained original receipt identities missing")
	}
	originalDigests := map[string]string{}
	for _, r := range originalShop.Orders[in.OrderID].NativePayment.Receipts {
		originalDigests[r.NativeHash] = r.ArchiveDigest
	}
	for _, r := range reconstructed.Receipts {
		if originalDigests[r.NativeHash] == "" || originalDigests[r.NativeHash] == r.ArchiveDigest {
			t.Fatal("refusal control requires same operation and different archive identity")
		}
	}
	observed := exchange(map[string]any{"command": "read"})
	if observed["httpStatus"] != float64(409) || observed["sameFrozenOrigin"] != true || observed["originalBindingPreflightError"] != "" {
		t.Fatal("replacement archive must fail after original binding passes", observed)
	}
	exchange(map[string]any{"command": "cold"})
	again := exchange(map[string]any{"command": "read"})
	if again["httpStatus"] != float64(409) || again["originalNotificationCount"] != float64(1) || again["paidAtoms"] != "100" || again["refundedAtoms"] != "30" || again["netPaidAtoms"] != "70" {
		t.Fatal("cold refusal changed original projection", again)
	}
	refs := again["notifications"].([]any)
	if len(refs) != 1 || refs[0].(map[string]any)["observedOrderId"] != "" {
		t.Fatal("rejected replacement archive linked the inbox", again)
	}
	after, err := os.ReadFile(parent.store.path)
	if err != nil || !bytes.Equal(before, after) || payWrites.Load() != 0 || payGET.Load() != 3 || setupPosts.Load() != 3 {
		t.Fatal("receipt reads changed Pay or dispatched money", err, payWrites.Load(), payGET.Load(), setupPosts.Load())
	}
	sourceAfter, err := os.ReadFile(in.SourcePath)
	if err != nil || !bytes.Equal(sourceBytes, sourceAfter) {
		t.Fatal("original retained Shop source changed", err)
	}
	exchange(map[string]any{"command": "stop"})
	_ = stdin.Close()
	for scan.Scan() {
	}
	err = command.Wait()
	waited = true
	if err != nil {
		diagnostic, _ := os.ReadFile(stderr.Name())
		t.Fatal(err, string(diagnostic))
	}
	t.Logf("ACTUAL_PAY_SHOP_CALLBACK_REPLACEMENT_ARCHIVE_REFUSED %s", mustNativeReceiptJSON(map[string]any{"sentStatus": 202, "networkDuplicateStatus": 202, "producerAttempts": sent.Attempt, "ShopInbox": 1, "ShopObservedOrder": "", "qualifiedReplacementReadStatus": 409, "sameFrozenOrigin": true, "independentArchiveGETStatus": 200, "originalArchiveReplacementRefused": true, "positiveOriginalReceiptAcceptance": false, "priorArchiveDigests": originalDigests, "publicPayStore": filepath.Join(resultDir, "PUBLIC-reconstructed-pay-store.json"), "originalPayReaderTransport": "retained PUBLIC loopback HTTP", "notificationTransport": "TLS1.3", "paid": "100", "refunded": "30", "net": "70", "PayOriginalGET": payGET.Load(), "PayMoneyPOST": payWrites.Load(), "historicalAdapterSetupPOST": setupPosts.Load(), "newCoreExecution": false, "CoreOfflineDuringRead": true, "PayReadDiskUnchanged": true, "originalShopSourceUnchanged": true, "ShopCloneState": init["statePath"], "publicSourceFixture": true, "RootAdmission": false, "realFunds": false}))
}

type nativeWebhookCaptureTransport struct {
	base    http.RoundTripper
	mu      sync.Mutex
	request *http.Request
	body    []byte
	count   atomic.Int32
}

func (c *nativeWebhookCaptureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	body, e := r.GetBody()
	if e != nil {
		return nil, e
	}
	raw, e := io.ReadAll(body)
	body.Close()
	if e != nil {
		return nil, e
	}
	copy := r.Clone(context.Background())
	copy.Header = r.Header.Clone()
	copy.Body = nil
	c.mu.Lock()
	c.request = copy
	c.body = bytes.Clone(raw)
	c.mu.Unlock()
	c.count.Add(1)
	return c.base.RoundTrip(r)
}
func (c *nativeWebhookCaptureTransport) copyRequest() (*http.Request, []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.request == nil {
		return nil, nil
	}
	return c.request.Clone(context.Background()), bytes.Clone(c.body)
}
