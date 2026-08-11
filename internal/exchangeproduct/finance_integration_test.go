package exchangeproduct

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

func TestFinanceReadIntegrationReturnsOnlyAuthorizedSanitizedEvidence(t *testing.T) {
	now := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)
	secret := strings.Repeat("f", 32)
	service, _, _ := newTestService(t)
	service.cfg.FinanceReadKey = secret
	service.cfg.Now = func() time.Time { return now }
	service.mu.Lock()
	service.state.Balances[balanceKey(alice, NativeAsset)] = Balance{Account: alice, Asset: NativeAsset, AvailableMicro: 9 * AmountScale, ReservedMicro: AmountScale}
	service.state.Orders["order-private"] = Order{ID: "order-private", Account: alice, Market: DefaultMarket, Side: "buy", Type: "limit", TimeInForce: "gtc", PriceMicro: 2 * AmountScale, AmountMicro: 3 * AmountScale, Status: "open", WalletAuthorized: true, AuthorizationDigest: "must-not-leak", CreatedAt: now.Add(-time.Minute), UpdatedAt: now}
	service.state.Orders["other-account"] = Order{ID: "other-account", Account: bob, Market: DefaultMarket, Status: "open", AuthorizationDigest: "other-secret"}
	service.mu.Unlock()

	server := NewServer(service)
	request := httptest.NewRequest(http.MethodGet, "https://exchange.test"+FinanceReadRoute, nil)
	if err := readintegration.Sign(request, secret, "finance", "exchange", alice, now); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var envelope struct {
		EnvelopeVersion      string          `json:"envelopeVersion"`
		AuthorizedAccount    string          `json:"authorizedAccount"`
		OwnerContractVersion string          `json:"ownerContractVersion"`
		PayloadSchema        string          `json:"payloadSchema"`
		ReadOnly             bool            `json:"readOnly"`
		Capabilities         []string        `json:"capabilities"`
		Payload              json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.EnvelopeVersion != FinanceReadEnvelopeVersion || envelope.AuthorizedAccount != alice || envelope.OwnerContractVersion != FinanceReadContractVersion || envelope.PayloadSchema != FinanceReadPayloadSchema || !envelope.ReadOnly || len(envelope.Capabilities) != len(FinanceReadCapabilities) {
		t.Fatalf("unexpected envelope: %+v", envelope)
	}
	payload := string(envelope.Payload)
	for _, forbidden := range []string{"must-not-leak", "other-secret", "other-account", "authorizationDigest", "walletPublicKey", "session"} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("payload leaked %q: %s", forbidden, payload)
		}
	}
	if !strings.Contains(payload, `"id":"order-private"`) || !strings.Contains(payload, `"availableMicro":9000000`) {
		t.Fatalf("authorized evidence missing: %s", payload)
	}

	replay := httptest.NewRecorder()
	server.ServeHTTP(replay, request)
	if replay.Code != http.StatusUnauthorized {
		t.Fatalf("replay status=%d body=%s", replay.Code, replay.Body.String())
	}
}

func TestFinanceReadIntegrationFailsClosed(t *testing.T) {
	service, _, _ := newTestService(t)
	server := NewServer(service)
	request := httptest.NewRequest(http.MethodGet, "https://exchange.test"+FinanceReadRoute, nil)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured status=%d", recorder.Code)
	}
	_, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback", RequiredConfirmations: 3, MakerFeeBPS: 10, TakerFeeBPS: 20, FinanceReadKey: "short"})
	if err == nil {
		t.Fatal("short Finance read key was accepted")
	}
}
