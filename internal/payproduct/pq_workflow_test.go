//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	cmttypes "github.com/cometbft/cometbft/types"
)

type nativeCoreWorkflowRow struct {
	Wire          []byte
	Data          []byte
	Expected      consensus.PQTransactionProofExpectation
	Proof         consensus.PQTransactionProofRequest
	View          consensus.PQInvoiceView
	Registration  ynxbatch.Registration
	Nonce, Height uint64
}
type nativeCoreWorkflowManifest struct {
	Migration                 chain.ConsensusMigrationState
	Genesis                   []byte
	Pins                      consensus.ConsensusBootstrapPins
	Schedule                  []byte
	ScheduleHash, EngineChain string
	EngineHeight              int64
	EngineAppHash, Trusted    []byte
	Now                       time.Time
	Terms                     ynxauth.InvoiceTermsPayload
	Merchant                  string
	Network                   []byte
	NativeChainID             uint64
	Rows                      []nativeCoreWorkflowRow
}
type nativeWorkflowProofSource struct {
	trust   consensus.PQLightProofTrust
	rows    []nativeCoreWorkflowRow
	corrupt bool
}

func (s *nativeWorkflowProofSource) Trust(_ context.Context, original NativePayOriginal) (consensus.PQLightProofTrust, consensus.PQTransactionProofExpectation, error) {
	for _, row := range s.rows {
		if bytes.Equal(row.Wire, original.Member) {
			expected := row.Expected
			if s.corrupt {
				expected.Block.BlockHash = bytes.Repeat([]byte{0x44}, 32)
			}
			return s.trust, expected, nil
		}
	}
	return s.trust, consensus.PQTransactionProofExpectation{}, ErrNativePayUnavailable
}

// This test consumes real BlockExecutor results, four registered PQ validator
// commits at H/H+1 and a separately loaded pinned engine snapshot. The fixture
// exporter never writes a Pay status or supplies a substitute successful verifier.
func TestNativePayCoreWorkflow100Refund30ColdRecovery(t *testing.T) {
	runNativePayCoreWorkflow(t, false)
}
func TestNativePayVerifiedOriginalArchiveColdHTTPAndAtomicRecovery(t *testing.T) {
	runNativePayCoreWorkflow(t, true)
}
func runNativePayCoreWorkflow(t *testing.T, archiveMode bool) {
	dir := os.Getenv("PAY_CORE_WORKFLOW_DIR")
	if dir == "" {
		t.Skip("requires isolated CORE BlockExecutor fixture; run testsupport native workflow command")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f nativeCoreWorkflowManifest
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Rows) != 3 {
		t.Fatal("incomplete actual CORE fixture")
	}
	bootstrap, err := consensus.NewConsensusBootstrap(f.Genesis, f.Pins, f.Migration)
	if err != nil {
		t.Fatal(err)
	}
	engineAuth, err := consensus.NewPQEngineAuthorization(f.Schedule, f.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := consensus.LoadPQEngineSnapshot(f.Migration, filepath.Join(dir, "engine.state"), bootstrap, engineAuth, f.EngineHeight, f.EngineAppHash)
	if err != nil {
		t.Fatal(err)
	}
	var trusted cmttypes.LightBlock
	if err = cmtjson.Unmarshal(f.Trusted, &trusted); err != nil {
		t.Fatal(err)
	}
	proofSource := &nativeWorkflowProofSource{rows: f.Rows, trust: consensus.PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: &trusted, TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustLevel: cmtmath.Fraction{Numerator: 1, Denominator: 3}, Now: f.Now}}
	now := time.Now().UTC()
	parent, _ := testService(t, &fakePay{}, func() time.Time { return now })
	source := &nativeSourceFixture{}
	productMerchantID := ""
	activate := func(row nativeCoreWorkflowRow) {
		source.grant = NativePayAuthorization{BoundInvoiceID: f.Terms.InvoiceID, BoundOrderID: "order-100", BoundSessionID: f.Terms.SessionID, Principal: row.Registration.Owner, Registration: row.Registration, Height: row.Height, KeyEpoch: 1, LedgerNonce: row.Nonce, Until: now.Add(time.Hour), Current: func() error { return nil }}
		source.grant.ProductMerchantID = productMerchantID
	}
	writes, current := 0, 0
	loseRefund := true
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row := f.Rows[current]
		envelope, action, err := nativePayHTTPMember(row.Wire)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		index := uint32(0)
		nativeHash, abciHash := consensus.SignedTransactionHash(row.Wire), consensus.SignedTransactionHash(envelope)
		if r.Method == "POST" {
			body, _ := io.ReadAll(r.Body)
			if !bytes.Equal(body, row.Wire) {
				t.Error("backend received a replacement Member")
				w.WriteHeader(400)
				return
			}
			writes++
			if current == 2 && loseRefund {
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
		if strings.HasPrefix(r.URL.Path, "/invoices/pq/") {
			json.NewEncoder(w).Encode(row.View)
			return
		}
		if strings.HasSuffix(r.URL.Path, "pq-finality-proof") {
			json.NewEncoder(w).Encode(bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "collected", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, ExecutionHeight: row.Height, CometIndex: &index, ProofVerification: "not-performed", Proof: &row.Proof})
			return
		}
		json.NewEncoder(w).Encode(bftgateway.PQActionView{Type: action.Kind, Status: "committed", Committed: true, ExecutionHeight: row.Height, CometIndex: &index, ExecutionData: row.Data, Effects: json.RawMessage(row.Data), Source: "comet-rpc", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, Wire: row.Wire, Transport: envelope, From: action.Owner, Nonce: action.Nonce, Fee: action.Fee, ReadbackURL: "/transactions/pq/actions/originals/" + nativeHash, ABCIReadbackURL: "/transactions/pq/actions/" + abciHash})
	}))
	defer backend.Close()
	caller, err := NewNativePayHTTP(backend.URL, backend.Client())
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewNativePayService(parent, NativePayConfig{Genesis: f.Network, NativeChainID: f.NativeChainID, HTTP: caller, Authority: source, ProofSource: proofSource})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	intentRequest := NativeInvoiceProductIntent{ProductID: "shop.order", StoreID: "registered-original-store", SourceOrder: "order-100", Merchant: f.Merchant, Recipient: f.Terms.Recipient, Genesis: hex.EncodeToString(f.Network), NativeChainID: strconv.FormatUint(f.NativeChainID, 10), AssetID: f.Terms.AssetID, UnitVersion: f.Terms.UnitVersion, AmountAtoms: "100", DomainData: json.RawMessage(`{"orderId":"order-100","storeId":"registered-original-store","approvalRef":"original-order-approval"}`)}
	intentSource, intentReader := nativeIntentTestSource(t, parent, intentRequest, f.Terms)
	if archiveMode {
		productMerchantID = intentReader.snapshot.ProductMerchantID
		if err = parent.store.Update(func(data *Snapshot) error {
			m := data.Merchants[productMerchantID]
			m.WebhookURL = "https://public-archive.invalid/original"
			m.WebhookSecretCipher = parent.seal("PUBLIC-outbox-fixture")
			data.Merchants[m.ID] = m
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	privateServer, intents, err := NewPrivateNativePayServer(parent, service.cfg, intentSource, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	privateEndpoint := httptest.NewServer(privateServer.Handler())
	defer privateEndpoint.Close()
	privateClient, err := NewNativeInvoiceIntentClient(privateEndpoint.URL, privateEndpoint.Client())
	if err != nil {
		t.Fatal(err)
	}
	activate(f.Rows[0])
	originalIntent, err := privateClient.CreateInvoiceIntent(ctx, intentRequest, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	intentReader.snapshot.Caller = f.Merchant
	for step, row := range f.Rows {
		current = step
		activate(row)
		var prepared NativePaySigningRequest
		if step == 0 {
			var review NativeMerchantTermsReview
			review, err = privateClient.MerchantTermsReview(ctx, originalIntent.IntentID)
			prepared.Message = review.Message
		}
		if step == 1 {
			prepared, err = service.PrepareSettlement(ctx, f.Merchant, f.Terms.InvoiceID)
		}
		if step == 2 {
			prepared, err = service.PrepareRefund(ctx, f.Merchant, f.Terms.InvoiceID, "refund-30", 30)
		}
		member, e := ynxbatch.DecodeMember(row.Wire)
		if err != nil || e != nil || !bytes.Equal(prepared.Message, member.Message) {
			t.Fatal("Pay prepared message differs from actual CORE native action", err, e)
		}
		var op NativePayOperation
		if step == 0 {
			var submitted NativeInvoiceIntentView
			submitted, err = privateClient.SubmitMerchantTerms(ctx, originalIntent.IntentID, row.Wire)
			if err == nil {
				state, e := service.Read(ctx, f.Merchant, f.Terms.InvoiceID)
				if e != nil {
					t.Fatal(e)
				}
				op = state.Operations[submitted.TermsNativeHash]
			}
		}
		if step == 1 {
			op, err = service.SubmitSettlement(ctx, f.Merchant, f.Terms.InvoiceID, row.Wire)
		}
		if step == 2 {
			op, err = service.SubmitRefund(ctx, f.Merchant, f.Terms.InvoiceID, row.Wire)
		}
		if step < 2 && err != nil || step == 2 && (err == nil || op.Status != "unknown") {
			t.Fatal("unexpected submission result", step, err, op.Status)
		}
		// HTTP committed=true still has no financial effect until original proof.
		state, err := service.Read(ctx, f.Merchant, f.Terms.InvoiceID)
		if err != nil {
			t.Fatal(err)
		}
		view, err := nativeInvoiceProjection(state)
		if err != nil {
			t.Fatal(err)
		}
		if step == 1 && view["paidAtoms"] != "0" || step == 2 && view["refundedAtoms"] != "0" {
			t.Fatal("RPC changed unproven money", view)
		}
		if step == 1 {
			proofSource.corrupt = true
			if _, err = service.Reconcile(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash); err == nil {
				t.Fatal("wrong independent header accepted")
			}
			proofSource.corrupt = false
		}
		if step == 2 {
			cold, err := OpenStore(parent.store.path, parent.key)
			if err != nil {
				t.Fatal(err)
			}
			parent.store = cold
			source.grant.LedgerNonce++
			replay, err := service.SubmitRefund(ctx, f.Merchant, f.Terms.InvoiceID, row.Wire)
			if err != nil || replay.NativeHash != op.NativeHash || writes != 3 {
				t.Fatal("unknown original refund was replayed at new nonce", err, writes)
			}
		}
		if archiveMode {
			if _, e := service.ReadOriginalArchive(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash); !errors.Is(e, ErrNativePayOriginalArchiveUnavailable) {
				t.Fatal("unverified/UNKNOWN created historical archive", e)
			}
			if step == 1 {
				path := parent.store.path
				parent.store.path = path + "/cannot-write-under-file"
				_, e := service.Reconcile(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash)
				parent.store.path = path
				if e == nil {
					t.Fatal("failed durable store write committed proof/archive")
				}
				if _, e = service.ReadOriginalArchive(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash); !errors.Is(e, ErrNativePayOriginalArchiveUnavailable) {
					t.Fatal("failed commit exposed archive", e)
				}
			}
		}
		confirmed, err := service.Reconcile(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash)
		if err != nil || confirmed.Status != "confirmed" || confirmed.Effect == nil {
			t.Fatal("actual independently anchored CORE proof not admitted", step, err, confirmed.Status)
		}
		if _, err = service.Reconcile(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash); err != nil || writes != step+1 {
			t.Fatal("finality replay changed original dispatch", err, writes)
		}
		if archiveMode {
			assertNativeArchiveStep(t, service, privateClient, source, f, step, confirmed)
		}
	}
	intentResult, e := intents.ReadInvoiceIntent(ctx, originalIntent.IntentID)
	if e != nil || intentResult.State != "ISSUED" || intentResult.OriginalOperation != originalIntent.OriginalOperation || intentResult.Invoice["netPaidAtoms"] != "70" {
		t.Fatal("normal original intent reader lost independent finalized 100/30/70", e, intentResult)
	}
	state, err := service.Read(ctx, f.Merchant, f.Terms.InvoiceID)
	if err != nil {
		t.Fatal(err)
	}
	view, err := nativeInvoiceProjection(state)
	if err != nil || view["paidAtoms"] != "100" || view["refundedAtoms"] != "30" || view["netPaidAtoms"] != "70" || view["termsFeeAtoms"] != "1" || view["paymentFeeAtoms"] != "1" || view["refundFeeAtoms"] != "1" {
		t.Fatal("full actual money/fee projection", err, view)
	}
	if _, err = service.PrepareRefund(ctx, f.Merchant, f.Terms.InvoiceID, "refund-excess", 71); err == nil {
		t.Fatal("refund above remaining original principal authorized")
	}
	if archiveMode {
		backend.Close() // Existing Core/network is absent for all cold archive reads.
		assertNativeArchiveColdRecovery(t, service, privateClient, source, proofSource, f)
		assertNativeArchiveMovementReservations(t, service, source, f)
	}
	endpoint := "/v5/pay/invoices/" + f.Merchant + "/" + f.Terms.InvoiceID
	response := httptest.NewRecorder()
	service.Handler().ServeHTTP(response, httptest.NewRequest("GET", endpoint, nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"netPaidAtoms":"70"`) {
		t.Fatal("normal private product reader lost original projection", response.Code, response.Body.String())
	}
	source.denied = true
	response = httptest.NewRecorder()
	service.Handler().ServeHTTP(response, httptest.NewRequest("GET", endpoint, nil))
	if response.Code == 200 {
		t.Fatal("revoked Source read private committed invoice")
	}
	t.Log("actual CORE temporary chain: terms fee1; payment100 fee1; refund30 fee1; net70; cold UNKNOWN recovered without resend; independent H/H+1 verified; no production funds")
}
