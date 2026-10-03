package payproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type controlledMerchantVerifier struct {
	account, binding string
	counter          atomic.Int32
	now              func() time.Time
	active           atomic.Bool
	deadline         time.Time
	seen             func()
}

func (v *controlledMerchantVerifier) verify(r *http.Request, body []byte) (*merchantAdmission, error) {
	n := v.counter.Add(1)
	sum := sha256.Sum256(body)
	nonce := strings.Repeat("n", 32) + string(rune('A'+n))
	if r.Header.Get("QA-Nonce") != "" {
		nonce = r.Header.Get("QA-Nonce")
	}
	a := &merchantAdmission{account: v.account, binding: v.binding, nonce: nonce, digest: hex.EncodeToString(sum[:]), method: r.Method, path: r.URL.Path, expires: v.deadline, proofExpires: v.now().Add(time.Minute)}
	a.refresh = func(context.Context) (func() error, time.Time, error) {
		if v.seen != nil {
			v.seen()
		}
		return func() error {
			if !v.active.Load() {
				return merchantDenied("ACTOR_REVOKED", 401)
			}
			return nil
		}, v.deadline, nil
	}
	return a, nil
}
func merchantBusinessQA(t *testing.T) (*Service, Merchant, *controlledMerchantVerifier, *Server) {
	t.Helper()
	s, _ := testService(t, &fakePay{}, time.Now)
	merchant, _ := onboard(t, s)
	v := &controlledMerchantVerifier{account: merchant.PayoutAddress, binding: strings.Repeat("b", 64), now: s.now, deadline: s.now().Add(10 * time.Minute)}
	v.active.Store(true)
	return s, merchant, v, newMerchantBusinessServer(s, v)
}
func merchantQARequest(server *Server, method, path, body, token, nonce string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if nonce != "" {
		r.Header.Set("QA-Nonce", nonce)
	}
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, r)
	return w
}
func merchantQASession(t *testing.T, server *Server, merchant Merchant, nonce string) MerchantSessionResult {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"merchantId": merchant.ID})
	w := merchantQARequest(server, "POST", "/v1/merchant/sessions", string(body), "", nonce)
	var out MerchantSessionResult
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &out) != nil {
		t.Fatalf("session %d %s", w.Code, w.Body)
	}
	return out
}
func merchantCounts(t *testing.T, s *Service) (int, int, int) {
	t.Helper()
	var actions, sessions, catalog int
	if err := s.store.View(func(d Snapshot) error {
		actions = len(d.MerchantActions)
		sessions = len(d.ConsoleSessions)
		catalog = len(d.Catalog)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return actions, sessions, catalog
}
func TestMerchantCanonicalOriginalCarrierAndLostResponseRecovery(t *testing.T) {
	s, m, v, server := merchantBusinessQA(t)
	nonce := strings.Repeat("original", 5)
	first := merchantQASession(t, server, m, nonce)
	reopened, err := OpenStore(s.store.path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = reopened
	server = newMerchantBusinessServer(s, v)
	w := merchantQARequest(server, "GET", "/v1/merchant/sessions/"+nonce, "", "", "")
	var recovered MerchantSessionResult
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &recovered) != nil || recovered.Token != first.Token || recovered.SessionID != first.SessionID {
		t.Fatalf("original carrier recovery %d %s", w.Code, w.Body)
	}
	second := merchantQASession(t, server, m, "")
	if second.Token != first.Token {
		t.Fatal("new carrier minted for original binding")
	}
	_, sessions, _ := merchantCounts(t, s)
	if sessions != 1 {
		t.Fatal(sessions)
	}
	w = merchantQARequest(server, "POST", "/v1/merchant/sessions", `{"merchantId":"`+m.ID+`"}`, "", nonce)
	if w.Code != 409 {
		t.Fatalf("replay %d %s", w.Code, w.Body)
	}
	w = merchantQARequest(server, "GET", "/v1/merchant/state", "", first.Token, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), m.DisplayName) || strings.Contains(w.Body.String(), "tokenCipher") || strings.Contains(w.Body.String(), "merchantActions") {
		t.Fatalf("private snapshot %d %s", w.Code, w.Body)
	}
	v.binding = strings.Repeat("c", 64)
	w = merchantQARequest(server, "GET", "/v1/merchant/state", "", first.Token, "")
	if w.Code != 401 || strings.Contains(w.Body.String(), m.DisplayName) {
		t.Fatal("cross binding leaked", w.Code)
	}
}
func TestMerchantCanonicalUnavailableNeverFallsBack(t *testing.T) {
	s, m, _, _ := merchantBusinessQA(t)
	server := newMerchantBusinessServer(s, nil)
	for _, path := range []string{"/v1/merchant/sessions", "/v1/merchant/invoices", "/v1/invoices/original/settlements"} {
		w := merchantQARequest(server, "POST", path, `{"merchantId":"`+m.ID+`"}`, "mcs_legacy.original", "")
		if w.Code != 503 {
			t.Fatal(path, w.Code)
		}
	}
	actions, sessions, _ := merchantCounts(t, s)
	if actions != 0 || sessions != 0 {
		t.Fatal("unavailable effects")
	}
}
func TestMerchantCanonicalNonceAndBusinessEffectAtomic(t *testing.T) {
	for _, failure := range []string{"inactive-member", "wrong-role", "expired-session", "revoked-actor", "persist-failure"} {
		t.Run(failure, func(t *testing.T) {
			s, m, v, server := merchantBusinessQA(t)
			carrier := merchantQASession(t, server, m, "")
			before, _, _ := merchantCounts(t, s)
			switch failure {
			case "inactive-member", "wrong-role":
				_ = s.store.Update(func(d *Snapshot) error {
					key := m.ID + ":" + v.account
					member := d.MerchantMembers[key]
					if failure == "inactive-member" {
						member.Status = "revoked"
					} else {
						member.Role = "viewer"
					}
					d.MerchantMembers[key] = member
					return nil
				})
			case "expired-session":
				v.deadline = time.Now().Add(-time.Second)
			case "revoked-actor":
				v.active.Store(false)
			case "persist-failure":
				s.store.path = t.TempDir() + "/directory"
				if err := os.Mkdir(s.store.path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			w := merchantQARequest(server, "POST", "/v1/merchant/catalog", `{"name":"Never commit","amount":8,"idempotencyKey":"atomic-qa-key"}`, carrier.Token, "")
			if w.Code < 400 {
				t.Fatal(w.Code, w.Body)
			}
			after, _, catalog := merchantCounts(t, s)
			if after != before || catalog != 0 {
				t.Fatal("nonce or effect committed on failure", before, after, catalog)
			}
		})
	}
}
func TestMerchantCanonicalQueuedActorAndFullSessionExpiry(t *testing.T) {
	for _, change := range []string{"actor", "full-session", "membership"} {
		t.Run(change, func(t *testing.T) {
			s, m, v, _ := merchantBusinessQA(t)
			request := httptest.NewRequest("POST", "/v1/merchant/catalog", bytes.NewBufferString(`{}`))
			a, err := v.verify(request, []byte(`{}`))
			if err != nil {
				t.Fatal(err)
			}
			a.merchantID = m.ID
			child := s.merchantScope(context.Background(), a, "invoice")
			read := make(chan struct{}, 1)
			v.seen = func() {
				select {
				case read <- struct{}{}:
				default:
				}
			}
			s.store.mu.Lock()
			result := make(chan error, 1)
			go func() {
				result <- child.store.Update(func(d *Snapshot) error { d.Catalog["forbidden"] = CatalogItem{ID: "forbidden"}; return nil })
			}()
			<-read
			switch change {
			case "actor":
				v.active.Store(false)
			case "full-session":
				a.expires = time.Now().Add(-time.Second)
			case "membership":
				member := s.store.data.MerchantMembers[m.ID+":"+v.account]
				member.Status = "revoked"
				s.store.data.MerchantMembers[m.ID+":"+v.account] = member
			}
			s.store.mu.Unlock()
			if err := <-result; err == nil {
				t.Fatal("queued stale authority committed")
			}
			actions, _, catalog := merchantCounts(t, s)
			if actions != 0 || catalog != 0 {
				t.Fatal(actions, catalog)
			}
		})
	}
}
func TestMerchantCanonicalViewRefreshNeverHoldsStoreLock(t *testing.T) {
	s, m, v, _ := merchantBusinessQA(t)
	r := httptest.NewRequest("GET", "/v1/merchant/state", nil)
	a, _ := v.verify(r, nil)
	a.merchantID = m.ID
	original := a.refresh
	a.refresh = func(ctx context.Context) (func() error, time.Time, error) {
		if !s.store.mu.TryLock() {
			return nil, time.Time{}, errors.New("authority I/O under store lock")
		}
		s.store.mu.Unlock()
		return original(ctx)
	}
	child := s.merchantScope(context.Background(), a, "read")
	if err := child.store.Update(func(*Snapshot) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := child.store.View(func(Snapshot) error { return nil }); err != nil {
		t.Fatal(err)
	}
}

type lostMerchantPay struct {
	*fakePay
	calls   atomic.Int32
	started chan struct{}
	release chan struct{}
}

func (p *lostMerchantPay) CreateIntent(ctx context.Context, m, payout string, amount int64, key string) (chain.PayIntent, error) {
	p.calls.Add(1)
	if p.started != nil {
		close(p.started)
		<-p.release
	}
	return chain.PayIntent{}, errors.New("original provider response lost")
}
func TestMerchantCanonicalProviderUnknownRetainsReservationAndNeverResends(t *testing.T) {
	s, m, v, _ := merchantBusinessQA(t)
	provider := &lostMerchantPay{fakePay: &fakePay{}}
	s.pay = provider
	for i := 0; i < 2; i++ {
		r := httptest.NewRequest("POST", "/v1/merchant/invoices", bytes.NewBufferString(`{}`))
		a, _ := v.verify(r, []byte(`{}`))
		a.merchantID = m.ID
		child := s.merchantScope(context.Background(), a, "invoice")
		_, err := child.pay.CreateIntent(context.Background(), m.CentralMerchantID, m.PayoutAddress, 8, "original-provider-key")
		if err == nil || !strings.Contains(err.Error(), "RECOVERY_REQUIRED") {
			t.Fatal(err)
		}
	}
	if provider.calls.Load() != 1 {
		t.Fatal("unknown provider redispatched", provider.calls.Load())
	}
	_ = s.store.View(func(d Snapshot) error {
		if len(d.BusinessDispatches) != 1 {
			t.Fatal("original reservation absent")
		}
		for _, record := range d.BusinessDispatches {
			if record.Phase != "recovery_required" || record.IdempotencyKey != "original-provider-key" || record.Account != v.account {
				t.Fatal(record)
			}
		}
		return nil
	})
	reopened, err := OpenStore(s.store.path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = reopened
	r := httptest.NewRequest("POST", "/v1/merchant/invoices", bytes.NewBufferString(`{}`))
	a, _ := v.verify(r, []byte(`{}`))
	a.merchantID = m.ID
	child := s.merchantScope(context.Background(), a, "invoice")
	_, _ = child.pay.CreateIntent(context.Background(), m.CentralMerchantID, m.PayoutAddress, 8, "original-provider-key")
	if provider.calls.Load() != 1 {
		t.Fatal("restart resend")
	}
}
func TestMerchantCanonicalLogoutDuringProviderKeepsOriginalUnknown(t *testing.T) {
	s, m, v, _ := merchantBusinessQA(t)
	provider := &lostMerchantPay{fakePay: &fakePay{}, started: make(chan struct{}), release: make(chan struct{})}
	s.pay = provider
	r := httptest.NewRequest("POST", "/v1/merchant/invoices", bytes.NewBufferString(`{}`))
	a, _ := v.verify(r, []byte(`{}`))
	a.merchantID = m.ID
	child := s.merchantScope(context.Background(), a, "invoice")
	done := make(chan error, 1)
	go func() {
		_, err := child.pay.CreateIntent(context.Background(), m.CentralMerchantID, m.PayoutAddress, 8, "original-late-key")
		done <- err
	}()
	<-provider.started
	v.active.Store(false)
	close(provider.release)
	if <-done == nil {
		t.Fatal("late unknown activated")
	}
	_ = s.store.View(func(d Snapshot) error {
		if len(d.BusinessDispatches) != 1 || len(d.Invoices) != 0 {
			t.Fatal("lost original record or activated invoice")
		}
		return nil
	})
}

func TestMerchantCanonicalUnknownCannotRebindOrChangeRequest(t *testing.T) {
	s, m, v, _ := merchantBusinessQA(t)
	provider := &lostMerchantPay{fakePay: &fakePay{}}
	s.pay = provider
	for _, change := range []string{"original", "new-binding", "changed-body"} {
		if change == "new-binding" {
			v.binding = strings.Repeat("c", 64)
		}
		r := httptest.NewRequest("POST", "/v1/merchant/invoices", bytes.NewBufferString(`{}`))
		a, _ := v.verify(r, []byte(`{}`))
		a.merchantID = m.ID
		child := s.merchantScope(context.Background(), a, "invoice")
		amount := int64(8)
		if change == "changed-body" {
			amount = 9
		}
		_, err := child.pay.CreateIntent(context.Background(), m.CentralMerchantID, m.PayoutAddress, amount, "original-no-rebind-key")
		if err == nil {
			t.Fatal("original unknown substituted")
		}
	}
	if provider.calls.Load() != 1 {
		t.Fatal("original unknown resent across session", provider.calls.Load())
	}
}
func TestMerchantClosedProductionReadinessAndLegacyCarrier(t *testing.T) {
	s, m, _, _ := merchantBusinessQA(t)
	server := NewClosedProductionServerWithLogger(s, buildinfo.Info{}, nil)
	for _, path := range []string{"/health/ready", "/v1/merchant/state"} {
		w := merchantQARequest(server, "GET", path, "", "mcs_legacy.original", "")
		if w.Code != 503 {
			t.Fatal("closed production ready/private fallback", path, w.Code, w.Body)
		}
	}
	w := merchantQARequest(server, "POST", "/v1/merchant/sessions", `{"merchantId":"`+m.ID+`"}`, "", "")
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	actions, sessions, _ := merchantCounts(t, s)
	if actions != 0 || sessions != 0 {
		t.Fatal("closed production effect")
	}
}

func TestMerchantCanonicalInvoiceKeepsOriginalSigningAndIdempotency(t *testing.T) {
	s, m, _, server := merchantBusinessQA(t)
	provider := &fakePay{invoice: chain.Invoice{Merchant: m.CentralMerchantID, PayoutAddress: m.PayoutAddress, Amount: 8}}
	s.pay = provider
	carrier := merchantQASession(t, server, m, "")
	body := `{"description":"Original signed invoice","amount":8,"tipAmount":0,"expiresInMinutes":30,"idempotencyKey":"original-signed-invoice-key"}`
	w := merchantQARequest(server, "POST", "/v1/merchant/invoices", body, carrier.Token, "")
	var invoice Invoice
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &invoice) != nil || invoice.Signature == "" || invoice.SigningPublicKey != m.InvoiceSigningPublicKey || invoice.Amount != 8 {
		t.Fatal("original invoice effect", w.Code, w.Body.String())
	}
	nonce := strings.Repeat("cached_action_nonce", 2)
	w = merchantQARequest(server, "POST", "/v1/merchant/invoices", body, carrier.Token, nonce)
	if w.Code != 201 {
		t.Fatal("original idempotent recovery", w.Code, w.Body.String())
	}
	if provider.intentCalls != 1 || provider.invoiceCalls != 1 {
		t.Fatal("provider repeated original invoice")
	}
	w = merchantQARequest(server, "POST", "/v1/merchant/invoices", body, carrier.Token, nonce)
	if w.Code != 409 {
		t.Fatal("cached private response bypassed nonce", w.Code, w.Body.String())
	}
	if err := s.store.View(func(d Snapshot) error {
		if len(d.Invoices) != 1 || len(d.BusinessDispatches) != 2 || d.Merchants[m.ID].InvoiceSigningPrivateCipher != m.InvoiceSigningPrivateCipher || d.Merchants[m.ID].CredentialCipher != m.CredentialCipher {
			t.Fatal("original seal/keys/records replaced")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
