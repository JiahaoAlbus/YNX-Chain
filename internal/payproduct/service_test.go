package payproduct

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type fakePay struct {
	mu            sync.Mutex
	invoice       chain.Invoice
	settlement    chain.PaySettlement
	settlementErr error
	intentCalls   int
	invoiceCalls  int
}
type blockingAI struct{ started chan struct{} }

func (a *blockingAI) Complete(ctx context.Context, _, _ string) (string, string, string, int64, error) {
	close(a.started)
	<-ctx.Done()
	return "YNX AI Gateway", "test-model", "", 0, ctx.Err()
}

func (f *fakePay) CreateIntent(_ context.Context, m, p string, a int64, k string) (chain.PayIntent, error) {
	f.mu.Lock()
	f.intentCalls++
	f.mu.Unlock()
	return chain.PayIntent{ID: "0123456789abcdef01234567", Merchant: m, PayoutAddress: p, Amount: a, Currency: NativeAsset, Status: "created", CreatedAt: time.Now().UTC(), IdempotencyKey: k}, nil
}
func (f *fakePay) CreateInvoice(_ context.Context, intent string, h int64, k string) (chain.Invoice, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.invoiceCalls++
	f.invoice = chain.Invoice{ID: "abcdef0123456789abcdef01", IntentID: intent, Merchant: f.invoice.Merchant, PayoutAddress: f.invoice.PayoutAddress, Amount: f.invoice.Amount, Currency: NativeAsset, Status: "issued", CreatedAt: time.Now().UTC(), DueAt: time.Now().UTC().Add(time.Duration(h) * time.Hour), IdempotencyKey: k}
	return f.invoice, nil
}
func (f *fakePay) Invoice(_ context.Context, id string) (chain.Invoice, error) { return f.invoice, nil }
func (f *fakePay) Settle(_ context.Context, id, payer, tx, key string) (chain.PaySettlement, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.settlementErr != nil {
		return chain.PaySettlement{}, f.settlementErr
	}
	return f.settlement, nil
}
func (f *fakePay) Settlement(_ context.Context, id string) (chain.PaySettlement, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.settlementErr != nil {
		return chain.PaySettlement{}, f.settlementErr
	}
	if f.settlement.ID == "" {
		return chain.PaySettlement{}, errors.New("not found")
	}
	return f.settlement, nil
}
func (f *fakePay) CreateRefund(context.Context, string, int64, string, string) (chain.RefundRecord, error) {
	return chain.RefundRecord{}, nil
}

func TestAuthoritativePaymentPersistenceIdempotencyAndTamper(t *testing.T) {
	now := time.Date(2026, 7, 15, 10, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, path := testService(t, pay, func() time.Time { return now })
	merchant, cred := onboard(t, service)
	pay.invoice.Merchant = merchant.ID
	pay.invoice.PayoutAddress = merchant.PayoutAddress
	pay.invoice.Amount = 25
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Description: "Coffee", Amount: 25, ExpiresInMinutes: 30, IdempotencyKey: "invoice-key-01"})
	if err != nil {
		t.Fatal(err)
	}
	replay, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Description: "Coffee", Amount: 25, ExpiresInMinutes: 30, IdempotencyKey: "invoice-key-01"})
	if err != nil || replay.ID != invoice.ID {
		t.Fatalf("invoice replay failed: %+v %v", replay, err)
	}
	if invoice.Status == "committed" || invoice.Settlement != nil {
		t.Fatal("invoice became committed without evidence")
	}
	publicKey, _ := hex.DecodeString(invoice.SigningPublicKey)
	signature, _ := hex.DecodeString(invoice.Signature)
	if !ed25519.Verify(publicKey, invoiceSigningMaterial(invoice), signature) {
		t.Fatal("merchant invoice signature did not verify")
	}
	tamperedInvoice := invoice
	tamperedInvoice.Amount++
	if ed25519.Verify(publicKey, invoiceSigningMaterial(tamperedInvoice), signature) {
		t.Fatal("tampered invoice retained a valid signature")
	}
	pay.settlement = chain.PaySettlement{ID: "fedcba9876543210fedcba98", IntentID: invoice.IntentID, InvoiceID: invoice.CentralID, Merchant: merchant.ID, PayoutAddress: merchant.PayoutAddress, Payer: merchant.PayoutAddress, Amount: 25, Currency: NativeAsset, TransactionHash: "0x" + strings.Repeat("a", 64), BlockNumber: 91, Status: "paid", AuditHash: strings.Repeat("b", 64), CreatedAt: now.Add(time.Minute)}
	committed, err := service.SubmitSettlement(context.Background(), invoice.ID, merchant.PayoutAddress, pay.settlement.TransactionHash, "settle-key-01")
	if err != nil || committed.Status != "committed" || committed.Settlement == nil || committed.Settlement.Source != "authoritative-central-pay-api" {
		t.Fatalf("settlement not accepted: %+v %v", committed, err)
	}
	restarted, err := New(Config{StorePath: path, IntegrityKey: bytes32(7), BootstrapKey: strings.Repeat("b", 24), PublicBaseURL: "https://pay.example", PayAPI: pay, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := restarted.Invoice(context.Background(), invoice.ID)
	if err != nil || persisted.Status != "committed" {
		t.Fatalf("restart lost state: %+v %v", persisted, err)
	}
	timestamp := now.Format(time.RFC3339)
	body := []byte(`{"amount":1}`)
	nonce := "nonce-1234567890123456"
	material := strings.Join([]string{"YNX_PAY_PRODUCT_REQUEST_V1", "POST", "/v1/merchant/catalog", hexSHA(body), timestamp, nonce}, "\n")
	auth := "YNX:" + merchant.ID + ":" + timestamp + ":" + nonce + ":" + hmacHex([]byte(cred), []byte(material))
	if _, err := restarted.Authenticate("POST", "/v1/merchant/catalog", body, auth); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.Authenticate("POST", "/v1/merchant/catalog", body, auth); err == nil || !strings.Contains(err.Error(), "replay") {
		t.Fatalf("request replay accepted: %v", err)
	}
	raw, _ := os.ReadFile(path)
	raw[len(raw)/2] ^= 1
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStore(path, bytes32(7)); err == nil {
		t.Fatalf("tampered store accepted: %v", err)
	}
}

func TestSettlementMismatchExpiryAndWebhookRetry(t *testing.T) {
	now := time.Date(2026, 7, 15, 11, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant = merchant.ID
	pay.invoice.PayoutAddress = merchant.PayoutAddress
	pay.invoice.Amount = 8
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 8, ExpiresInMinutes: 1, IdempotencyKey: "invoice-key-02"})
	if err != nil {
		t.Fatal(err)
	}
	pay.settlement = chain.PaySettlement{ID: "fedcba9876543210fedcba98", IntentID: invoice.IntentID, InvoiceID: invoice.CentralID, Merchant: merchant.ID, PayoutAddress: merchant.PayoutAddress, Amount: 9, Currency: NativeAsset, TransactionHash: "0x" + strings.Repeat("c", 64), BlockNumber: 2, Status: "paid", AuditHash: strings.Repeat("d", 64), CreatedAt: now}
	if _, err := service.SubmitSettlement(context.Background(), invoice.ID, merchant.PayoutAddress, pay.settlement.TransactionHash, "settle-key-02"); err == nil || !strings.Contains(err.Error(), "mismatched") {
		t.Fatalf("mismatched evidence accepted: %v", err)
	}
	now = now.Add(2 * time.Minute)
	expired, err := service.Invoice(context.Background(), invoice.ID)
	if err != nil || expired.Status != "expired" {
		t.Fatalf("expiry failed: %+v %v", expired, err)
	}
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-YNX-Signature") == "" || r.Header.Get("X-YNX-Event-ID") == "" {
			t.Error("webhook signature headers missing")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()
	merchant.WebhookURL = strings.Replace(receiver.URL, "http://", "https://", 1)
	service.client = receiver.Client()
	service.client.Transport = roundTripRewrite{target: receiver.URL}
	if err := service.queueWebhook(merchant, "invoice.expired", invoice.ID); err != nil {
		t.Fatal(err)
	}
	state, _ := service.SnapshotForMerchant(merchant.ID)
	for id := range state.Deliveries {
		d, err := service.Deliver(context.Background(), id)
		if err != nil || d.Status != "delivered" {
			t.Fatalf("webhook delivery failed: %+v %v", d, err)
		}
	}
}

type roundTripRewrite struct{ target string }

func (r roundTripRewrite) RoundTrip(req *http.Request) (*http.Response, error) {
	req.URL, _ = url.Parse(r.target)
	return http.DefaultTransport.RoundTrip(req)
}

func TestWalletSignInRejectsReplayAndCreatesPayerCases(t *testing.T) {
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant = merchant.ID
	pay.invoice.PayoutAddress = merchant.PayoutAddress
	pay.invoice.Amount = 11
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 11, ExpiresInMinutes: 20, IdempotencyKey: "invoice-key-03"})
	if err != nil {
		t.Fatal(err)
	}
	accountKey := secp256k1.PrivKeyFromBytes(bytes32(9))
	accountHex, _ := consensus.NativeAddress(accountKey.PubKey().SerializeCompressed())
	account, _ := accountaddress.Encode(accountHex)
	devicePub, devicePriv, _ := ed25519.GenerateKey(rand.Reader)
	challenge, err := service.CreateWalletChallenge(WalletChallengeInput{Account: account, DevicePublicKey: nativewallet.EncodePublicKey(devicePub)})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := base64.RawURLEncoding.DecodeString(challenge.Challenge.SignBytes)
	digest := sha256.Sum256(payload)
	accountSig := secpECDSA.Sign(accountKey, digest[:]).Serialize()
	input := WalletSessionInput{ChallengeID: challenge.Challenge.ID, AccountPublicKey: hex.EncodeToString(accountKey.PubKey().SerializeCompressed()), AccountSignature: hex.EncodeToString(accountSig), DeviceSignature: nativewallet.Sign(devicePriv, payload)}
	sessionResult, err := service.CompleteWalletSession(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.CompleteWalletSession(input); err == nil || !strings.Contains(err.Error(), "replay") {
		t.Fatalf("wallet challenge replay accepted: %v", err)
	}
	session, err := service.AuthenticateWallet("Bearer " + sessionResult.SessionID + "." + sessionResult.Token)
	if err != nil {
		t.Fatal(err)
	}
	pay.settlement = chain.PaySettlement{ID: "fedcba9876543210fedcba98", IntentID: invoice.IntentID, InvoiceID: invoice.CentralID, Merchant: merchant.ID, PayoutAddress: merchant.PayoutAddress, Payer: account, Amount: 11, Currency: NativeAsset, TransactionHash: "0x" + strings.Repeat("e", 64), BlockNumber: 3, Status: "paid", AuditHash: strings.Repeat("f", 64), CreatedAt: now}
	if _, err := service.SubmitSettlement(context.Background(), invoice.ID, account, pay.settlement.TransactionHash, "settle-key-03"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateRefundRequest(session, invoice.ID, 5, "item not delivered", "refund-key-01"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateDispute(session, invoice.ID, "merchant did not deliver the item", "dispute-key-01", []string{"trust.case-123"}); err != nil {
		t.Fatal(err)
	}
}

func TestHTTPProductSmoke(t *testing.T) {
	now := time.Date(2026, 7, 15, 13, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	resp, err := http.Get(server.URL + "/health")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("health smoke failed: %v status=%v", err, resp)
	}
	_ = resp.Body.Close()
	key := secp256k1.PrivKeyFromBytes(bytes32(4))
	hexAddress, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	address, _ := accountaddress.Encode(hexAddress)
	body := []byte(fmt.Sprintf(`{"displayName":"Smoke Merchant","payoutAddress":%q,"idempotencyKey":"smoke-onboard-01"}`, address))
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/merchants/onboard", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Bootstrap-Key", strings.Repeat("b", 24))
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("onboarding smoke failed: %v status=%v", err, resp.StatusCode)
	}
	var onboardResult OnboardResult
	if err := json.NewDecoder(resp.Body).Decode(&onboardResult); err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	timestamp := now.Format(time.RFC3339)
	nonce := "smoke-nonce-1234567890"
	path := "/v1/merchant/state"
	material := strings.Join([]string{"YNX_PAY_PRODUCT_REQUEST_V1", "GET", path, hexSHA(nil), timestamp, nonce}, "\n")
	req, _ = http.NewRequest(http.MethodGet, server.URL+path, nil)
	req.Header.Set("Authorization", "YNX:"+onboardResult.Merchant.ID+":"+timestamp+":"+nonce+":"+hmacHex([]byte(onboardResult.Credential), []byte(material)))
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("signed merchant state smoke failed: %v status=%v", err, resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestConcurrentInvoiceIdempotencyCreatesOneCentralPair(t *testing.T) {
	now := time.Date(2026, 7, 15, 14, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.ID, merchant.PayoutAddress, 18
	const workers = 12
	results := make(chan string, workers)
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 18, ExpiresInMinutes: 20, IdempotencyKey: "concurrent-invoice-01"})
			if err != nil {
				errs <- err
				return
			}
			results <- invoice.ID
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	var id string
	for result := range results {
		if id == "" {
			id = result
		}
		if result != id {
			t.Fatalf("concurrent result changed: %s != %s", result, id)
		}
	}
	pay.mu.Lock()
	defer pay.mu.Unlock()
	if pay.intentCalls != 1 || pay.invoiceCalls != 1 {
		t.Fatalf("central API called %d intents and %d invoices", pay.intentCalls, pay.invoiceCalls)
	}
}

func TestAIUsesAuthorizedRecordsAndCanCancelWithoutExecutingAction(t *testing.T) {
	now := time.Date(2026, 7, 15, 15, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.ID, merchant.PayoutAddress, 6
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 6, ExpiresInMinutes: 30, IdempotencyKey: "ai-invoice-key-01"})
	if err != nil {
		t.Fatal(err)
	}
	ai := &blockingAI{started: make(chan struct{})}
	service.ai = ai
	run, err := service.StartAI(context.Background(), merchant, AIRunInput{Workflow: "reconciliation_explanation", ContextIDs: []string{invoice.ID}, Permission: "allow-once"})
	if err != nil || run.Status != "running" {
		t.Fatalf("AI run did not start: %+v %v", run, err)
	}
	<-ai.started
	cancelled, err := service.ReviewAI(merchant, run.ID, "cancelled")
	if err != nil || cancelled.Status != "cancelled" {
		t.Fatalf("AI cancel failed: %+v %v", cancelled, err)
	}
	time.Sleep(10 * time.Millisecond)
	state, _ := service.SnapshotForMerchant(merchant.ID)
	if state.AIRuns[run.ID].Status != "cancelled" {
		t.Fatalf("provider completion overrode cancellation: %+v", state.AIRuns[run.ID])
	}
	otherKey := secp256k1.PrivKeyFromBytes(bytes32(6))
	otherHex, _ := consensus.NativeAddress(otherKey.PubKey().SerializeCompressed())
	otherAddress, _ := accountaddress.Encode(otherHex)
	otherResult, err := service.Onboard(OnboardInput{DisplayName: "Other Merchant", PayoutAddress: otherAddress, IdempotencyKey: "other-onboard-01"})
	if err != nil {
		t.Fatal(err)
	}
	var otherMerchant Merchant
	_ = service.store.View(func(data Snapshot) error { otherMerchant = data.Merchants[otherResult.Merchant.ID]; return nil })
	if _, err := service.StartAI(context.Background(), otherMerchant, AIRunInput{Workflow: "anomaly_review", ContextIDs: []string{invoice.ID}, Permission: "allow-once"}); err == nil {
		t.Fatal("cross-merchant AI context was accepted")
	}
}

func testService(t *testing.T, pay *fakePay, now func() time.Time) (*Service, string) {
	t.Helper()
	path := t.TempDir() + "/state.json"
	service, err := New(Config{StorePath: path, IntegrityKey: bytes32(7), BootstrapKey: strings.Repeat("b", 24), PublicBaseURL: "https://pay.example", PayAPI: pay, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	return service, path
}
func onboard(t *testing.T, s *Service) (Merchant, string) {
	t.Helper()
	key := secp256k1.PrivKeyFromBytes(bytes32(5))
	addressHex, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	address, _ := accountaddress.Encode(addressHex)
	out, err := s.Onboard(OnboardInput{DisplayName: "Truth Coffee", PayoutAddress: address, IdempotencyKey: "onboard-key-01"})
	if err != nil {
		t.Fatal(err)
	}
	var merchant Merchant
	if err := s.store.View(func(data Snapshot) error { merchant = data.Merchants[out.Merchant.ID]; return nil }); err != nil {
		t.Fatal(err)
	}
	return merchant, out.Credential
}
func bytes32(v byte) []byte { return []byte(strings.Repeat(string([]byte{v}), 32)) }
