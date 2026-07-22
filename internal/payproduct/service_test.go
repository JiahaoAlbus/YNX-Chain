package payproduct

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
type fixedAI struct{}

func (a *blockingAI) Complete(ctx context.Context, _, _ string) (string, string, string, int64, error) {
	close(a.started)
	<-ctx.Done()
	return "YNX AI Gateway", "test-model", "", 0, ctx.Err()
}

func (fixedAI) Complete(context.Context, string, string) (string, string, string, int64, error) {
	return "YNX AI Gateway", "provider-backed-test-model", "Risk explanation grounded in the selected invoice; human approval does not move funds.", 42, nil
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
	restarted, err := New(Config{StorePath: path, IntegrityKey: bytes32(7), GatewayKey: bytes32(8), BootstrapKey: strings.Repeat("b", 24), PublicBaseURL: "https://pay.example", PayAPI: pay, Now: func() time.Time { return now }})
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
	attempts := 0
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		eventID, deliveryID, timestamp, payloadHash, version, signed := r.Header.Get("X-YNX-Event-ID"), r.Header.Get("X-YNX-Delivery-ID"), r.Header.Get("X-YNX-Timestamp"), r.Header.Get("X-YNX-Payload-SHA256"), r.Header.Get("X-YNX-Signature-Version"), r.Header.Get("X-YNX-Signature")
		if signed == "" || eventID == "" || deliveryID == "" || timestamp == "" || payloadHash == "" || version == "" {
			t.Error("webhook signature headers missing")
		}
		if eventID != deliveryID || version != fmt.Sprint(merchant.SecretVersion) {
			t.Error("webhook delivery identity or signature version is inconsistent")
		}
		parsed, err := time.Parse(time.RFC3339Nano, timestamp)
		if err != nil {
			t.Errorf("webhook timestamp is not canonical: %v", err)
		}
		body, _ := io.ReadAll(r.Body)
		secret, _ := service.open(merchant.WebhookSecretCipher)
		if payloadHash != hexSHA(body) {
			t.Error("webhook payload hash does not match exact body")
		}
		want := "v" + version + "=" + hmacHex([]byte(secret), webhookSigningMaterial(deliveryID, parsed, payloadHash))
		if !hmac.Equal([]byte(signed), []byte(want)) {
			t.Errorf("webhook signature does not bind event ID, timestamp, and exact body")
		}
		if attempts == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
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
		if err != nil || d.Status != "retrying" || d.Attempt != 1 {
			t.Fatalf("webhook failure did not persist a retry: %+v %v", d, err)
		}
		d, err = service.Deliver(context.Background(), id)
		if err != nil || d.Status != "delivered" || d.Attempt != 2 {
			t.Fatalf("webhook retry did not deliver idempotently: %+v %v", d, err)
		}
	}
}

type roundTripRewrite struct{ target string }

func (r roundTripRewrite) RoundTrip(req *http.Request) (*http.Response, error) {
	req.URL, _ = url.Parse(r.target)
	return http.DefaultTransport.RoundTrip(req)
}

func TestGatewayBoundPaymentCreatesPayerCases(t *testing.T) {
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
	session := WalletSession{ID: "gateway-pay-session-123456", Account: account, ProductClientID: walletProductClientID, BundleID: walletBundleID, ProductDeviceAlgorithm: walletDeviceAlgorithm, SessionBinding: strings.Repeat("a", 64), Scopes: append([]string(nil), walletScopes...), ExpiresAt: now.Add(3 * time.Minute)}
	pay.settlement = chain.PaySettlement{ID: "fedcba9876543210fedcba98", IntentID: invoice.IntentID, InvoiceID: invoice.CentralID, Merchant: merchant.ID, PayoutAddress: merchant.PayoutAddress, Payer: account, Amount: 11, Currency: NativeAsset, TransactionHash: "0x" + strings.Repeat("e", 64), BlockNumber: 3, Status: "paid", AuditHash: strings.Repeat("f", 64), CreatedAt: now}
	intent, result := signedPaymentFixture(t, now, invoice, session, accountKey)
	if _, err := service.SubmitSignedSettlement(context.Background(), session, invoice.ID, intent, result, "settle-key-03"); err != nil {
		t.Fatal(err)
	}
	tampered := intent
	tampered.Amount++
	if _, err := service.SubmitSignedSettlement(context.Background(), session, invoice.ID, tampered, result, "settle-key-04"); err == nil {
		t.Fatal("tampered signed payment intent was accepted")
	}
	if _, err := service.CreateRefundRequest(session, invoice.ID, 5, "item not delivered", "refund-key-01"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateDispute(session, invoice.ID, "merchant did not deliver the item", "dispute-key-01", []string{"trust.case-123"}); err != nil {
		t.Fatal(err)
	}
}

func signedPaymentFixture(t *testing.T, now time.Time, invoice Invoice, session WalletSession, accountKey *secp256k1.PrivateKey) (SignedPaymentIntent, WalletPaymentResult) {
	t.Helper()
	intent := SignedPaymentIntent{Version: "1", IntentType: "pay.ynxt.transfer", RequestID: "payment_request_abcdefghijklmnop", ChainID: ChainID, ProductClientID: walletProductClientID, BundleID: walletBundleID, SessionBinding: session.SessionBinding, InvoiceID: invoice.ID, CentralInvoiceID: invoice.CentralID, MerchantID: invoice.MerchantID, MerchantName: invoice.MerchantName, PayoutAddress: invoice.PayoutAddress, Amount: invoice.Amount, Asset: invoice.Asset, Fee: invoice.Fee, Total: invoice.Amount + invoice.Fee, QuoteIssuedAt: now.Format("2006-01-02T15:04:05.000Z"), QuoteExpiresAt: now.Add(3 * time.Minute).Format("2006-01-02T15:04:05.000Z"), InvoiceSignature: invoice.Signature, Callback: "ynxpay://payment-result"}
	result := WalletPaymentResult{Version: "1", IntentDigest: digestCanonical(walletPayIntentDomain, intent), RequestID: intent.RequestID, InvoiceID: intent.InvoiceID, ChainID: intent.ChainID, Account: session.Account, AccountPublicKey: hex.EncodeToString(accountKey.PubKey().SerializeCompressed()), TransactionHash: "0x" + strings.Repeat("e", 64), IssuedAt: now.Format("2006-01-02T15:04:05.000Z")}
	unsigned := map[string]any{"version": result.Version, "intentDigest": result.IntentDigest, "requestId": result.RequestID, "invoiceId": result.InvoiceID, "chainId": result.ChainID, "account": result.Account, "accountPublicKey": result.AccountPublicKey, "transactionHash": result.TransactionHash, "issuedAt": result.IssuedAt}
	digest := sha256.Sum256([]byte(walletPayResultDomain + "\n" + string(mustCanonical(unsigned))))
	result.WalletSignature = hex.EncodeToString(secpECDSA.SignCompact(accountKey, digest[:], true)[1:])
	return intent, result
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
	sessionBody := []byte(fmt.Sprintf(`{"merchantId":%q}`, onboardResult.Merchant.ID))
	req, _ = http.NewRequest(http.MethodPost, server.URL+"/v1/merchant/sessions", bytes.NewReader(sessionBody))
	signMerchantGatewayRequest(t, req, sessionBody, address, now, "smoke-gateway-nonce-123456")
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("Wallet/Gateway merchant session failed: %v status=%v", err, resp.StatusCode)
	}
	var consoleSession MerchantSessionResult
	if err := json.NewDecoder(resp.Body).Decode(&consoleSession); err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	path := "/v1/merchant/state"
	req, _ = http.NewRequest(http.MethodGet, server.URL+path, nil)
	req.Header.Set("Authorization", "Bearer "+consoleSession.Token)
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("signed merchant state smoke failed: %v status=%v", err, resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestMerchantRoleMatrixAndMembershipChangeInvalidatesSession(t *testing.T) {
	now := time.Date(2026, 7, 18, 13, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	ownerAccount := merchant.PayoutAddress
	owner := MerchantPrincipal{Merchant: merchant, Account: ownerAccount, Role: "owner", Session: "owner-session"}
	if _, err := service.UpsertMerchantMember(owner, ownerAccount, "viewer"); err == nil || !strings.Contains(err.Error(), "at least one") {
		t.Fatalf("last owner demotion was not rejected: %v", err)
	}
	roles := []string{"owner", "finance", "developer", "support", "viewer"}
	wants := map[string]map[string]bool{
		"owner":     {"read": true, "invoice": true, "reconcile": true, "case": true, "webhook": true, "ai-run": true, "ai-review": true, "members": true, "provider-manage": true, "provider-test": true},
		"finance":   {"read": true, "invoice": true, "reconcile": true, "case": true, "ai-run": true, "ai-review": true},
		"developer": {"read": true, "webhook": true, "provider-manage": true, "provider-test": true},
		"support":   {"read": true, "case": true, "ai-run": true},
		"viewer":    {"read": true},
	}
	for _, role := range roles {
		for _, permission := range []string{"read", "invoice", "reconcile", "case", "webhook", "ai-run", "ai-review", "members", "provider-manage", "provider-test"} {
			if got := roleAllows(role, permission); got != wants[role][permission] {
				t.Fatalf("role=%s permission=%s got=%v want=%v", role, permission, got, wants[role][permission])
			}
		}
	}
	memberKey := secp256k1.PrivKeyFromBytes(bytes32(9))
	memberHex, _ := consensus.NativeAddress(memberKey.PubKey().SerializeCompressed())
	memberAccount, _ := accountaddress.Encode(memberHex)
	member, err := service.UpsertMerchantMember(owner, memberAccount, "viewer")
	if err != nil {
		t.Fatal(err)
	}
	token := "viewer-console-session-token-123456"
	session := MerchantConsoleSession{ID: "mcs_viewer_session_123", MerchantID: merchant.ID, Account: member.Account, Role: member.Role, TokenHash: hashString(token), ExpiresAt: now.Add(10 * time.Minute), CreatedAt: now}
	if err := service.store.Update(func(data *Snapshot) error { data.ConsoleSessions[session.ID] = session; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := service.AuthenticateMerchantSession("Bearer " + session.ID + "." + token); err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpsertMerchantMember(owner, memberAccount, "developer"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.AuthenticateMerchantSession("Bearer " + session.ID + "." + token); err == nil || !strings.Contains(err.Error(), "membership changed") {
		t.Fatalf("old role session was not invalidated: %v", err)
	}
	if _, err := service.UpsertMerchantMember(MerchantPrincipal{Merchant: merchant, Account: memberAccount, Role: "developer"}, ownerAccount, "viewer"); err == nil {
		t.Fatal("non-owner changed merchant membership")
	}
}

func TestMerchantGatewayAssertionRejectsReplayAndBodySubstitution(t *testing.T) {
	now := time.Date(2026, 7, 18, 14, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	body := []byte(fmt.Sprintf(`{"merchantId":%q}`, merchant.ID))
	makeRequest := func(payload []byte, nonce string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "https://pay.example/v1/merchant/sessions", bytes.NewReader(payload))
		signMerchantGatewayRequest(t, req, body, merchant.PayoutAddress, now, nonce)
		return req
	}
	if _, err := service.CompleteMerchantSession(makeRequest(body, "merchant-replay-nonce-123456"), body, merchant.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CompleteMerchantSession(makeRequest(body, "merchant-replay-nonce-123456"), body, merchant.ID); err == nil || !strings.Contains(err.Error(), "replay") {
		t.Fatalf("replay accepted: %v", err)
	}
	tampered := []byte(fmt.Sprintf(`{"merchantId":%q,"extra":"substitution"}`, merchant.ID))
	if _, err := service.CompleteMerchantSession(makeRequest(tampered, "merchant-body-nonce-123456"), tampered, merchant.ID); err == nil {
		t.Fatal("body substitution accepted")
	}
}

func TestPayGatewayAssertionBindsActiveSessionAndRejectsReplayTamperAndCrossApp(t *testing.T) {
	now := time.Date(2026, 7, 18, 15, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	key := secp256k1.PrivKeyFromBytes(bytes32(6))
	accountHex, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	account, _ := accountaddress.Encode(accountHex)
	body := []byte(`{"reason":"not delivered"}`)
	makeRequest := func(payload []byte, nonce string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "https://pay.example/v1/invoices/inv_aaaaaaaaaaaaaaaaaaaa/refund-requests", bytes.NewReader(payload))
		signPayGatewayRequest(t, req, body, account, now, nonce)
		return req
	}
	session, err := service.VerifyPayGateway(makeRequest(body, "pay-gateway-nonce-123456"), body)
	if err != nil {
		t.Fatal(err)
	}
	if session.Account != account || session.SessionBinding != strings.Repeat("b", 64) || !sameStrings(session.Scopes, walletScopes) {
		t.Fatalf("wrong Pay principal: %+v", session)
	}
	if _, err := service.VerifyPayGateway(makeRequest(body, "pay-gateway-nonce-123456"), body); err == nil || !strings.Contains(err.Error(), "replay") {
		t.Fatalf("replay accepted: %v", err)
	}
	tampered := []byte(`{"reason":"redirected body"}`)
	if _, err := service.VerifyPayGateway(makeRequest(tampered, "pay-body-nonce-123456"), tampered); err == nil {
		t.Fatal("body substitution accepted")
	}
	cross := makeRequest(body, "pay-cross-app-nonce-123456")
	cross.Header.Set("X-YNX-Product", "ynx-card")
	if _, err := service.VerifyPayGateway(cross, body); err == nil {
		t.Fatal("cross-product assertion accepted")
	}
}

func signPayGatewayRequest(t *testing.T, req *http.Request, signedBody []byte, account string, now time.Time, nonce string) {
	t.Helper()
	issued, expires := now.UTC(), now.UTC().Add(3*time.Minute)
	headers := map[string]string{"X-YNX-Account": account, "X-YNX-Session-ID": "gateway-pay-session-123456", "X-YNX-Device-ID": "pay-device-123456", "X-YNX-Product": walletProduct, "X-YNX-Client": walletProductClientID, "X-YNX-Bundle": walletBundleID, "X-YNX-Callback": walletCallback, "X-YNX-Chain": ChainID, "X-YNX-Scopes": strings.Join(walletScopes, " "), "X-YNX-Session-Binding": strings.Repeat("b", 64), "X-YNX-Request-Digest": strings.Repeat("c", 64), "X-YNX-Issued-At": issued.Format(time.RFC3339Nano), "X-YNX-Expires-At": expires.Format(time.RFC3339Nano), "X-YNX-Nonce": nonce}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	bodyHash := sha256.Sum256(signedBody)
	material := strings.Join([]string{gatewayDomain, req.Method, req.URL.EscapedPath(), hex.EncodeToString(bodyHash[:]), account, headers["X-YNX-Session-ID"], headers["X-YNX-Device-ID"], walletProduct, walletProductClientID, walletBundleID, walletCallback, ChainID, strings.Join(walletScopes, " "), headers["X-YNX-Session-Binding"], headers["X-YNX-Request-Digest"], headers["X-YNX-Issued-At"], headers["X-YNX-Expires-At"], nonce}, "\n")
	req.Header.Set("X-YNX-Gateway-Signature", hmacHex(bytes32(8), []byte(material)))
}

func signMerchantGatewayRequest(t *testing.T, req *http.Request, body []byte, account string, now time.Time, nonce string) {
	t.Helper()
	issued, expires := now.UTC(), now.UTC().Add(3*time.Minute)
	headers := map[string]string{
		"X-YNX-Account": account, "X-YNX-Session-ID": "gateway-session-123456", "X-YNX-Device-ID": "merchant-device-123456",
		"X-YNX-Product": MerchantProductID, "X-YNX-Client": MerchantClientID, "X-YNX-Bundle": MerchantBundleID,
		"X-YNX-Callback": MerchantCallback, "X-YNX-Chain": ChainID, "X-YNX-Scopes": strings.Join(merchantConsoleScopes, " "),
		"X-YNX-Request-Digest": strings.Repeat("a", 64), "X-YNX-Issued-At": issued.Format(time.RFC3339Nano),
		"X-YNX-Expires-At": expires.Format(time.RFC3339Nano), "X-YNX-Nonce": nonce,
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	bodyHash := sha256.Sum256(body)
	material := strings.Join([]string{gatewayDomain, req.Method, req.URL.EscapedPath(), hex.EncodeToString(bodyHash[:]), account, headers["X-YNX-Session-ID"], headers["X-YNX-Device-ID"], MerchantProductID, MerchantClientID, MerchantBundleID, MerchantCallback, ChainID, strings.Join(merchantConsoleScopes, " "), headers["X-YNX-Request-Digest"], headers["X-YNX-Issued-At"], headers["X-YNX-Expires-At"], nonce}, "\n")
	req.Header.Set("X-YNX-Gateway-Signature", hmacHex(bytes32(8), []byte(material)))
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
	run, err := service.StartAI(context.Background(), merchant, AIRunInput{Workflow: "reconciliation_explanation", ContextIDs: []string{invoice.ID}, Permission: "allow-once", OutputLanguage: "zh-Hans"})
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
	if _, err := service.StartAI(context.Background(), otherMerchant, AIRunInput{Workflow: "anomaly_review", ContextIDs: []string{invoice.ID}, Permission: "allow-once", OutputLanguage: "en"}); err == nil {
		t.Fatal("cross-merchant AI context was accepted")
	}
}

func TestAIRiskExplanationRequiresHumanApprovalAndNeverExecutesPayment(t *testing.T) {
	now := time.Date(2026, 7, 15, 15, 30, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.ID, merchant.PayoutAddress, 9
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 9, ExpiresInMinutes: 30, IdempotencyKey: "ai-approval-invoice-01"})
	if err != nil {
		t.Fatal(err)
	}
	service.ai = fixedAI{}
	run, err := service.StartAI(context.Background(), merchant, AIRunInput{Workflow: "anomaly_review", ContextIDs: []string{invoice.ID}, Permission: "allow-once", OutputLanguage: "ar"})
	if err != nil {
		t.Fatal(err)
	}
	var review AIRun
	for range 100 {
		state, _ := service.SnapshotForMerchant(merchant.ID)
		review = state.AIRuns[run.ID]
		if review.Status == "review" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if review.Status != "review" || review.Provider != "YNX AI Gateway" || review.Model != "provider-backed-test-model" || review.Result == "" {
		t.Fatalf("AI risk explanation is not reviewable: %+v", review)
	}
	applied, err := service.ReviewAI(merchant, run.ID, "applied")
	if err != nil || applied.Status != "applied" || applied.Decision != "applied" {
		t.Fatalf("AI approval failed: %+v %v", applied, err)
	}
	unchanged, err := service.Invoice(context.Background(), invoice.ID)
	if err != nil || unchanged.Status != "pending" || unchanged.Settlement != nil {
		t.Fatalf("AI approval executed or fabricated a payment: %+v %v", unchanged, err)
	}
	state, _ := service.SnapshotForMerchant(merchant.ID)
	foundAudit := false
	for _, entry := range state.Audit {
		if entry.Action == "ai.review" && entry.ObjectID == run.ID && entry.Outcome == "applied" && strings.Contains(entry.Detail, "does not execute financial action") {
			foundAudit = true
		}
	}
	if !foundAudit {
		t.Fatal("AI approval audit boundary is missing")
	}
}

func testService(t *testing.T, pay *fakePay, now func() time.Time) (*Service, string) {
	t.Helper()
	path := t.TempDir() + "/state.json"
	service, err := New(Config{StorePath: path, IntegrityKey: bytes32(7), GatewayKey: bytes32(8), BootstrapKey: strings.Repeat("b", 24), PublicBaseURL: "https://pay.example", PayAPI: pay, Now: now})
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
