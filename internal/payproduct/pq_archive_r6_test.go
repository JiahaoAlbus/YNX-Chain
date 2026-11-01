//go:build pay_pq

package payproduct

import (
	"bufio"
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
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

// This new delta reuses the original actual BlockExecutor H/H+1 inputs. Setup
// installs only PUBLIC authority/temporary Member fixtures through the normal
// service; the journey under test has only GETs, no old webhook/money matrix.
func TestNativePayR6ActualArchiveClientNormalHTTPColdAndMerchantReceipt(t *testing.T) {
	dir := os.Getenv("PAY_CORE_WORKFLOW_DIR")
	driver := os.Getenv("PAY_R6_ARCHIVE_CLIENT_DRIVER")
	node := os.Getenv("PAY_NODE_BINARY")
	if !filepath.IsAbs(dir) || !filepath.IsAbs(driver) || !filepath.IsAbs(node) {
		t.Fatal("exact original Core fixture/Node/r6 driver required")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f nativeCoreWorkflowManifest
	if json.Unmarshal(raw, &f) != nil || len(f.Rows) != 3 {
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
		index := uint32(0)
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
	original := NativeInvoiceProductIntent{ProductID: "shop.order", StoreID: "registered-original-store", SourceOrder: "order-100", Merchant: f.Merchant, Recipient: f.Terms.Recipient, Genesis: hex.EncodeToString(f.Network), NativeChainID: strconv.FormatUint(f.NativeChainID, 10), AssetID: f.Terms.AssetID, UnitVersion: f.Terms.UnitVersion, AmountAtoms: "100", DomainData: json.RawMessage(`{"orderId":"order-100","storeId":"registered-original-store","approvalRef":"original-order-approval"}`)}
	intentSource, reader := nativeIntentTestSource(t, parent, original, f.Terms)
	reader.snapshot.Caller = f.Merchant
	var endpoint *httptest.Server
	var client *NativeInvoiceIntentClient
	var recovery atomic.Bool
	var lost atomic.Bool
	var getCount, postCount, lostCount atomic.Int32
	start := func() {
		server, _, e := NewPrivateNativePayServer(parent, cfg, intentSource, buildinfo.Info{}, nil)
		if e != nil {
			t.Fatal(e)
		}
		handler := server.Handler()
		endpoint = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if recovery.Load() {
				if r.Method != "GET" {
					postCount.Add(1)
					w.WriteHeader(405)
					return
				}
				getCount.Add(1)
			}
			if recovery.Load() && strings.Contains(r.URL.Path, "/originals/") && lost.Swap(false) {
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, r)
				if response.Code != 200 {
					t.Error("lost-response fixture did not read original")
				}
				connection, _, e := w.(http.Hijacker).Hijack()
				if e != nil {
					t.Error(e)
					return
				}
				lostCount.Add(1)
				connection.Close()
				return
			}
			handler.ServeHTTP(w, r)
		}))
		transport := &http.Transport{DisableKeepAlives: true}
		t.Cleanup(transport.CloseIdleConnections)
		client, e = NewNativeInvoiceIntentClient(endpoint.URL, &http.Client{Transport: transport, Timeout: 15 * time.Second})
		if e != nil {
			t.Fatal(e)
		}
	}
	start()
	defer func() { endpoint.Close() }()
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
			view, e := client.SubmitMerchantTerms(ctx, intent.IntentID, row.Wire)
			if e != nil {
				t.Fatal(e)
			}
			state, e := service.Read(ctx, f.Merchant, f.Terms.InvoiceID)
			if e != nil {
				t.Fatal(e)
			}
			op = state.Operations[view.TermsNativeHash]
		} else if i == 1 {
			op, err = service.SubmitSettlement(ctx, f.Merchant, f.Terms.InvoiceID, row.Wire)
		} else {
			op, err = service.SubmitRefund(ctx, f.Merchant, f.Terms.InvoiceID, row.Wire)
		}
		if err != nil {
			t.Fatal(err)
		}
		if _, err = service.Reconcile(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash); err != nil {
			t.Fatal("normal archived setup", err)
		}
	}
	if corePosts.Load() != 3 {
		t.Fatal("incomplete PUBLIC archived setup")
	}
	core.Close()
	recovery.Store(true)
	settlementHash := consensus.SignedTransactionHash(f.Rows[1].Wire)
	refundHash := consensus.SignedTransactionHash(f.Rows[2].Wire)
	proofs.corrupt = true
	if _, err = client.ReadOriginalArchiveReceipt(ctx, original, f.Terms.InvoiceID, settlementHash, proofs, func() error { return nil }); err == nil {
		t.Fatal("archive self-anchor replaced independent Source")
	}
	proofs.corrupt = false
	diskBefore, err := os.ReadFile(parent.store.path)
	if err != nil {
		t.Fatal(err)
	}
	lost.Store(true)
	command := exec.CommandContext(t.Context(), node, driver)
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
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
	_ = encoder.Encode(map[string]any{"origin": endpoint.URL, "original": original, "invoiceId": f.Terms.InvoiceID, "settlementHash": settlementHash, "refundHash": refundHash})
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	done := false
	restarts := 0
	for scanner.Scan() {
		var message struct {
			Type      string `json:"type"`
			Reference struct {
				ProductID   string `json:"productId"`
				SourceOrder string `json:"sourceOrder"`
				Merchant    string `json:"merchant"`
				InvoiceID   string `json:"invoiceId"`
				NativeHash  string `json:"nativeHash"`
				Origin      string `json:"origin"`
				Method      string `json:"method"`
				Path        string `json:"path"`
			} `json:"reference"`
			Result json.RawMessage `json:"result"`
		}
		if err = json.Unmarshal(scanner.Bytes(), &message); err != nil {
			t.Fatal(err)
		}
		if message.Type == "done" {
			done = true
			t.Logf("R6_SHOP_READ_RECEIPT %s", message.Result)
			break
		}
		ref := message.Reference
		if ref.ProductID != original.ProductID || ref.SourceOrder != original.SourceOrder || ref.Merchant != f.Merchant || ref.InvoiceID != f.Terms.InvoiceID {
			t.Fatal("r6 selected a different original product/order/invoice")
		}
		var result any
		var failure error
		switch message.Type {
		case "private-read":
			prefix := "/v5/pay/products/" + original.ProductID + "/" + original.SourceOrder + "/invoices/" + f.Merchant + "/" + f.Terms.InvoiceID
			allowed := ref.Path == prefix+"/archive-reconciliation"
			if strings.HasPrefix(ref.Path, prefix+"/originals/") && strings.HasSuffix(ref.Path, "/receipt") {
				hash := strings.TrimSuffix(strings.TrimPrefix(ref.Path, prefix+"/originals/"), "/receipt")
				allowed = nativePayHTTPHash(hash)
			}
			if ref.Origin != endpoint.URL || ref.Method != "GET" || !allowed {
				t.Fatal("original transport target/method changed")
			}
			request, e := http.NewRequestWithContext(ctx, http.MethodGet, client.http.origin+ref.Path, nil)
			if e != nil {
				t.Fatal(e)
			}
			request.GetBody = nil
			response, e := client.http.client.Do(request)
			if e != nil {
				failure = nativePayHTTPFailure(http.MethodGet, ref.Path, 0, e)
			} else {
				body, e := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
				response.Body.Close()
				if e != nil || len(body) > 2<<20 {
					t.Fatal("bounded original compact response required", e)
				}
				result = map[string]any{"method": http.MethodGet, "requestPath": ref.Path, "status": response.StatusCode, "contentType": response.Header.Get("Content-Type"), "cacheControl": response.Header.Get("Cache-Control"), "body": body}
			}
		case "receipt":
			result, failure = client.ReadOriginalArchiveReceipt(ctx, original, ref.InvoiceID, ref.NativeHash, proofs, func() error { return nil })
		case "reconciliation":
			result, failure = client.ReadOriginalArchiveReconciliation(ctx, original, ref.InvoiceID, proofs, func() error { return nil })
		case "restart":
			endpoint.Close()
			cold, e := OpenStore(parent.store.path, parent.key)
			if e != nil {
				t.Fatal(e)
			}
			parent.store = cold
			start()
			restarts++
			result = map[string]any{"cold": true, "origin": endpoint.URL}
		case "revoke":
			source.denied = true
			result = map[string]bool{"revoked": true}
		default:
			t.Fatal("unexpected r6 operation", message.Type)
		}
		if failure != nil {
			code, status := "NATIVE_PAY_ARCHIVE_RECEIPT_BINDING", 409
			var transport *NativePayHTTPError
			if errors.Is(failure, ErrNativePayOriginalArchiveUnavailable) {
				code = "NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE"
			} else if errors.Is(failure, ErrNativePayUnavailable) {
				code = "NATIVE_PAY_AUTHORITY_UNAVAILABLE"
				status = 503
			} else if errors.As(failure, &transport) && transport.StatusCode == 0 {
				code = "NATIVE_PAY_ARCHIVE_QUERY_UNAVAILABLE"
				status = 0
			}
			if e := encoder.Encode(map[string]any{"error": code, "status": status}); e != nil {
				t.Fatal(e)
			}
		} else if e := encoder.Encode(map[string]any{"result": result}); e != nil {
			t.Fatal(e)
		}
	}
	if err = scanner.Err(); err != nil {
		t.Fatal(err)
	}
	_ = input.Close()
	err = command.Wait()
	waited = true
	if err != nil {
		t.Fatal("actual r6 consumer", err, stderr.String())
	}
	diskAfter, _ := os.ReadFile(parent.store.path)
	if !done || restarts != 1 || lostCount.Load() != 1 || postCount.Load() != 0 || corePosts.Load() != 3 || !bytes.Equal(diskBefore, diskAfter) {
		t.Fatal("recovery changed original Store, replayed or missed cold/lost-response delta", done, restarts, lostCount.Load(), postCount.Load())
	}
	t.Logf("R6_ACTUAL_NORMAL_CLIENT coldHTTPStore=true lostArchiveGET1=true sameOriginalQuery=true GET=%d POST=0 CoreOffline=true independentVerifier=true wrongAnchorDenied=true missing409=true revoked503=true originalDiskUnchanged=true PUBLICSourceOnly=true", getCount.Load())
}
