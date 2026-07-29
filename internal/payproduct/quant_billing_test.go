package payproduct

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestQuantBillingUsesSignedExternalHighWaterMarkEvidence(t *testing.T) {
	now := time.Date(2026, 7, 27, 14, 0, 0, 0, time.UTC)
	pay := &fakePay{now: func() time.Time { return now }}
	verifierPrivate := ed25519.NewKeyFromSeed(bytes32(9))
	verifierPublic := verifierPrivate.Public().(ed25519.PublicKey)
	service, _ := quantTestService(t, pay, now, map[string]ed25519.PublicKey{"quant-ledger-v1": verifierPublic})
	merchant, _ := onboard(t, service)
	payer := quantAddress(t, 10)
	wrongPayer := quantAddress(t, 11)
	pay.invoice.Merchant = merchant.ID
	pay.invoice.PayoutAddress = merchant.PayoutAddress
	pay.invoice.Amount = 90

	evidence := signedQuantEvidence(merchant.ID, payer, verifierPrivate, now)
	bill, err := service.CreateQuantBill(context.Background(), merchant, QuantBillInput{Evidence: evidence, ExpiresInMinutes: 30, IdempotencyKey: "quant-bill-key-01"})
	if err != nil {
		t.Fatal(err)
	}
	if bill.Breakdown.AdjustedEndEquityYNXT != 1300 || bill.Breakdown.HighWaterMarkBaseYNXT != 1100 || bill.Breakdown.EligibleProfitYNXT != 200 || bill.Breakdown.PerformanceFeeYNXT != 40 || bill.Breakdown.TotalServiceFeeYNXT != 90 || bill.Breakdown.NewHighWaterMarkYNXT != 1260 {
		t.Fatalf("unexpected high-water-mark calculation: %+v", bill.Breakdown)
	}
	if !bill.Breakdown.ExternalPnLRequired || bill.Breakdown.FrontendPnLAccepted || bill.Breakdown.ManagerDeclaredPnL {
		t.Fatalf("unsafe Quant evidence authority flags: %+v", bill.Breakdown)
	}
	invoice, err := service.Invoice(context.Background(), bill.InvoiceID)
	if err != nil {
		t.Fatal(err)
	}
	if invoice.Version != 5 || invoice.ServiceBillID != bill.ID || invoice.ServiceEvidenceDigest != bill.EvidenceDigest || invoice.ExpectedPayer != payer || invoice.ExpectedPayerHash != bill.PayerAccountHash || invoice.Amount != 90 {
		t.Fatalf("Quant Invoice v5 binding is incomplete: %+v", invoice)
	}
	invoicePublicKey, _ := hex.DecodeString(invoice.SigningPublicKey)
	invoiceSignature, _ := hex.DecodeString(invoice.Signature)
	if !ed25519.Verify(invoicePublicKey, invoiceSigningMaterial(invoice), invoiceSignature) {
		t.Fatal("Quant Invoice v5 signature did not verify")
	}
	publicInvoice := publicInvoice(invoice)
	if publicInvoice.ExpectedPayer != "" || !ed25519.Verify(invoicePublicKey, invoiceSigningMaterial(publicInvoice), invoiceSignature) {
		t.Fatal("public Quant Invoice leaked payer or lost independent verification")
	}
	publicBill := publicQuantBill(bill)
	if publicBill.PayerAccount != "" || publicBill.Evidence.PayerAccount != "" || publicBill.PayerAccountHash == "" || !ed25519.Verify(verifierPublic, quantEvidenceSigningMaterial(publicBill.Evidence), mustHex(t, publicBill.Evidence.Signature)) {
		t.Fatal("public Quant bill redaction or evidence verification failed")
	}

	replay, err := service.CreateQuantBill(context.Background(), merchant, QuantBillInput{Evidence: evidence, ExpiresInMinutes: 30, IdempotencyKey: "quant-bill-key-01"})
	if err != nil || replay.ID != bill.ID || replay.InvoiceID != bill.InvoiceID {
		t.Fatalf("Quant bill idempotent replay failed: %+v %v", replay, err)
	}

	pay.settlement = chain.PaySettlement{ID: "quantsettlement012345678901", IntentID: invoice.IntentID, InvoiceID: invoice.CentralID, Merchant: merchant.ID, PayoutAddress: merchant.PayoutAddress, Payer: wrongPayer, Amount: 90, Currency: NativeAsset, TransactionHash: "0x" + strings.Repeat("a", 64), BlockNumber: 500, Status: "paid", IdempotencyKey: "quant-settle-01", AuditHash: strings.Repeat("b", 64), CreatedAt: now.Add(time.Minute)}
	if _, err := service.SubmitSettlement(context.Background(), invoice.ID, wrongPayer, pay.settlement.TransactionHash, "quant-settle-01"); err == nil {
		t.Fatal("Quant Invoice accepted settlement from the wrong payer")
	}
	pay.settlement.Payer = payer
	if _, err := service.SubmitSettlement(context.Background(), invoice.ID, payer, pay.settlement.TransactionHash, "quant-settle-01"); err != nil {
		t.Fatal(err)
	}
	committed, err := service.QuantBill(context.Background(), bill.ID)
	if err != nil || committed.Status != "committed" {
		t.Fatalf("Quant bill did not follow authoritative Invoice state: %+v %v", committed, err)
	}
}

func TestQuantBillingRejectsTamperStaleAndUnapprovedEvidence(t *testing.T) {
	now := time.Date(2026, 7, 27, 14, 0, 0, 0, time.UTC)
	pay := &fakePay{now: func() time.Time { return now }}
	privateKey := ed25519.NewKeyFromSeed(bytes32(12))
	publicKey := privateKey.Public().(ed25519.PublicKey)
	service, _ := quantTestService(t, pay, now, map[string]ed25519.PublicKey{"quant-ledger-v1": publicKey})
	merchant, _ := onboard(t, service)
	payer := quantAddress(t, 13)
	base := signedQuantEvidence(merchant.ID, payer, privateKey, now)

	tampered := base
	tampered.EndEquityYNXT++
	if _, err := service.CreateQuantBill(context.Background(), merchant, QuantBillInput{Evidence: tampered, ExpiresInMinutes: 30, IdempotencyKey: "quant-tamper-01"}); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("tampered Quant evidence was not rejected: %v", err)
	}
	stale := base
	stale.AsOf = now.Add(-25 * time.Hour)
	stale.ExpiresAt = stale.AsOf.Add(time.Hour)
	stale.Signature = hex.EncodeToString(ed25519.Sign(privateKey, quantEvidenceSigningMaterial(stale)))
	if _, err := service.CreateQuantBill(context.Background(), merchant, QuantBillInput{Evidence: stale, ExpiresInMinutes: 30, IdempotencyKey: "quant-stale-001"}); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("stale Quant evidence was not rejected: %v", err)
	}
	unsafeRate := base
	unsafeRate.PerformanceFeeBPS = maxPerformanceFeeBPS + 1
	unsafeRate.Signature = hex.EncodeToString(ed25519.Sign(privateKey, quantEvidenceSigningMaterial(unsafeRate)))
	if _, err := service.CreateQuantBill(context.Background(), merchant, QuantBillInput{Evidence: unsafeRate, ExpiresInMinutes: 30, IdempotencyKey: "quant-rate-0001"}); err == nil {
		t.Fatal("unsafe Quant performance fee rate was accepted")
	}
	badFlows := base
	badFlows.EndEquityYNXT = 1
	badFlows.NetExternalFlowsYNXT = 2
	badFlows.Signature = hex.EncodeToString(ed25519.Sign(privateKey, quantEvidenceSigningMaterial(badFlows)))
	if _, err := service.CreateQuantBill(context.Background(), merchant, QuantBillInput{Evidence: badFlows, ExpiresInMinutes: 30, IdempotencyKey: "quant-flow-0001"}); err == nil {
		t.Fatal("invalid Quant net-flow adjustment was accepted")
	}
	unapprovedService, _ := quantTestService(t, pay, now, nil)
	unapprovedMerchant, _ := onboard(t, unapprovedService)
	unapproved := signedQuantEvidence(unapprovedMerchant.ID, payer, privateKey, now)
	if _, err := unapprovedService.CreateQuantBill(context.Background(), unapprovedMerchant, QuantBillInput{Evidence: unapproved, ExpiresInMinutes: 30, IdempotencyKey: "quant-unapproved"}); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("Quant billing without verifier configuration did not fail closed: %v", err)
	}
}

func TestQuantVerifierConfigurationRejectsNormalizedIDCollision(t *testing.T) {
	publicKey := ed25519.NewKeyFromSeed(bytes32(16)).Public().(ed25519.PublicKey)
	if _, _, err := prepareQuantEvidenceConfig(map[string]ed25519.PublicKey{"quant-ledger-v1": publicKey, " quant-ledger-v1 ": publicKey}, time.Hour); err == nil || !strings.Contains(err.Error(), "collide") {
		t.Fatalf("normalized verifier ID collision was accepted: %v", err)
	}
}

func TestQuantBillingExcludesDepositsFromPerformanceProfit(t *testing.T) {
	now := time.Date(2026, 7, 27, 14, 0, 0, 0, time.UTC)
	pay := &fakePay{now: func() time.Time { return now }}
	privateKey := ed25519.NewKeyFromSeed(bytes32(14))
	publicKey := privateKey.Public().(ed25519.PublicKey)
	service, _ := quantTestService(t, pay, now, map[string]ed25519.PublicKey{"quant-ledger-v1": publicKey})
	merchant, _ := onboard(t, service)
	payer := quantAddress(t, 15)
	pay.invoice.Merchant = merchant.ID
	pay.invoice.PayoutAddress = merchant.PayoutAddress
	pay.invoice.Amount = 1
	evidence := signedQuantEvidence(merchant.ID, payer, privateKey, now)
	evidence.StartEquityYNXT = 1000
	evidence.EndEquityYNXT = 1500
	evidence.NetExternalFlowsYNXT = 500
	evidence.PreviousHighWaterMark = 1000
	evidence.ComputeFeeYNXT = 1
	evidence.DataFeeYNXT = 0
	evidence.SubscriptionFeeYNXT = 0
	evidence.ManagementFeeYNXT = 0
	evidence.Signature = hex.EncodeToString(ed25519.Sign(privateKey, quantEvidenceSigningMaterial(evidence)))
	bill, err := service.CreateQuantBill(context.Background(), merchant, QuantBillInput{Evidence: evidence, ExpiresInMinutes: 30, IdempotencyKey: "quant-deposit-01"})
	if err != nil {
		t.Fatal(err)
	}
	if bill.Breakdown.AdjustedEndEquityYNXT != 1000 || bill.Breakdown.EligibleProfitYNXT != 0 || bill.Breakdown.PerformanceFeeYNXT != 0 || bill.Breakdown.TotalServiceFeeYNXT != 1 {
		t.Fatalf("capital deposit was misclassified as performance profit: %+v", bill.Breakdown)
	}
}

func TestQuantBillingHTTPRoleAndPublicRedaction(t *testing.T) {
	now := time.Date(2026, 7, 27, 14, 0, 0, 0, time.UTC)
	pay := &fakePay{now: func() time.Time { return now }}
	privateKey := ed25519.NewKeyFromSeed(bytes32(17))
	publicKey := privateKey.Public().(ed25519.PublicKey)
	service, _ := quantTestService(t, pay, now, map[string]ed25519.PublicKey{"quant-ledger-v1": publicKey})
	merchant, _ := onboard(t, service)
	payer := quantAddress(t, 18)
	pay.invoice.Merchant = merchant.ID
	pay.invoice.PayoutAddress = merchant.PayoutAddress
	pay.invoice.Amount = 90
	evidence := signedQuantEvidence(merchant.ID, payer, privateKey, now)
	server := NewServer(service).Handler()

	financeAccount := quantAddress(t, 19)
	financeToken := "finance-quant-session-token-123456"
	developerAccount := quantAddress(t, 20)
	developerToken := "developer-quant-session-token-123456"
	if err := service.store.Update(func(data *Snapshot) error {
		data.MerchantMembers[merchant.ID+":"+financeAccount] = MerchantMember{ID: "mem_quant_finance", MerchantID: merchant.ID, Account: financeAccount, Role: "finance", Status: "active", CreatedAt: now, UpdatedAt: now}
		data.ConsoleSessions["mcs_quant_finance"] = MerchantConsoleSession{ID: "mcs_quant_finance", MerchantID: merchant.ID, Account: financeAccount, Role: "finance", TokenHash: hashString(financeToken), ExpiresAt: now.Add(time.Hour), CreatedAt: now}
		data.MerchantMembers[merchant.ID+":"+developerAccount] = MerchantMember{ID: "mem_quant_developer", MerchantID: merchant.ID, Account: developerAccount, Role: "developer", Status: "active", CreatedAt: now, UpdatedAt: now}
		data.ConsoleSessions["mcs_quant_developer"] = MerchantConsoleSession{ID: "mcs_quant_developer", MerchantID: merchant.ID, Account: developerAccount, Role: "developer", TokenHash: hashString(developerToken), ExpiresAt: now.Add(time.Hour), CreatedAt: now}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	input := QuantBillInput{Evidence: evidence, ExpiresInMinutes: 30, IdempotencyKey: "quant-http-bill-01"}
	body, _ := json.Marshal(input)
	developerRequest := httptest.NewRequest(http.MethodPost, "/v1/merchant/quant-bills", bytes.NewReader(body))
	developerRequest.Header.Set("Authorization", "Bearer mcs_quant_developer."+developerToken)
	developerResponse := httptest.NewRecorder()
	server.ServeHTTP(developerResponse, developerRequest)
	if developerResponse.Code != http.StatusForbidden {
		t.Fatalf("developer created Quant bill: status=%d body=%s", developerResponse.Code, developerResponse.Body.String())
	}

	financeRequest := httptest.NewRequest(http.MethodPost, "/v1/merchant/quant-bills", bytes.NewReader(body))
	financeRequest.Header.Set("Authorization", "Bearer mcs_quant_finance."+financeToken)
	financeResponse := httptest.NewRecorder()
	server.ServeHTTP(financeResponse, financeRequest)
	if financeResponse.Code != http.StatusCreated {
		t.Fatalf("finance Quant bill creation failed: status=%d body=%s", financeResponse.Code, financeResponse.Body.String())
	}
	if strings.Contains(financeResponse.Body.String(), payer) || strings.Contains(financeResponse.Body.String(), `"payerAccount":"`) {
		t.Fatal("merchant HTTP response leaked the raw Quant payer")
	}
	var created QuantBill
	if err := json.Unmarshal(financeResponse.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.InvoiceID == "" || created.PayerAccountHash == "" {
		t.Fatalf("public Quant bill response is incomplete: %+v", created)
	}

	publicRequest := httptest.NewRequest(http.MethodGet, "/v1/quant-bills/"+created.ID, nil)
	publicResponse := httptest.NewRecorder()
	server.ServeHTTP(publicResponse, publicRequest)
	if publicResponse.Code != http.StatusOK || strings.Contains(publicResponse.Body.String(), payer) || strings.Contains(publicResponse.Body.String(), `"payerAccount":"`) {
		t.Fatalf("public Quant response is unsafe: status=%d body=%s", publicResponse.Code, publicResponse.Body.String())
	}
}

func quantTestService(t *testing.T, pay *fakePay, now time.Time, verifiers map[string]ed25519.PublicKey) (*Service, string) {
	t.Helper()
	path := t.TempDir() + "/state.json"
	service, err := New(Config{StorePath: path, IntegrityKey: bytes32(7), GatewayKey: bytes32(8), BootstrapKey: strings.Repeat("b", 24), PublicBaseURL: "https://pay.example", PayAPI: pay, QuantEvidenceKeys: verifiers, QuantEvidenceMaxAge: 24 * time.Hour, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	return service, path
}

func signedQuantEvidence(merchantID, payer string, privateKey ed25519.PrivateKey, now time.Time) QuantBillingEvidence {
	publicKey := privateKey.Public().(ed25519.PublicKey)
	evidence := QuantBillingEvidence{
		Version:                 quantEvidenceVersion,
		EvidenceID:              "quant-evidence-0001",
		MerchantID:              merchantID,
		PayerAccount:            payer,
		PayerAccountHash:        hashString("YNX_QUANT_PAYER_V1", payer),
		InvoicePayerAccountHash: hashString("YNX_PAY_EXPECTED_PAYER_V1", payer),
		ServiceReference:        "strategy-period-2026-07",
		PeriodStart:             now.Add(-30 * 24 * time.Hour),
		PeriodEnd:               now.Add(-time.Hour),
		StartEquityYNXT:         1000,
		EndEquityYNXT:           1400,
		NetExternalFlowsYNXT:    100,
		PreviousHighWaterMark:   1100,
		PerformanceFeeBPS:       2000,
		ComputeFeeYNXT:          10,
		DataFeeYNXT:             5,
		SubscriptionFeeYNXT:     20,
		ManagementFeeYNXT:       15,
		Asset:                   NativeAsset,
		Network:                 ChainID,
		Source:                  "ynx-data-fabric-ledger",
		SourceVersion:           1,
		AsOf:                    now.Add(-time.Minute),
		ExpiresAt:               now.Add(time.Hour),
		EvidenceKeyID:           "quant-ledger-v1",
		EvidencePublicKey:       hex.EncodeToString(publicKey),
		SignatureAlgorithm:      "ed25519",
	}
	evidence.Signature = hex.EncodeToString(ed25519.Sign(privateKey, quantEvidenceSigningMaterial(evidence)))
	return evidence
}

func quantAddress(t *testing.T, seed byte) string {
	t.Helper()
	key := secp256k1.PrivKeyFromBytes(bytes32(seed))
	hexAddress, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	address, err := accountaddress.Encode(hexAddress)
	if err != nil {
		t.Fatal(err)
	}
	return address
}

func mustHex(t *testing.T, value string) []byte {
	t.Helper()
	raw, err := hex.DecodeString(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
