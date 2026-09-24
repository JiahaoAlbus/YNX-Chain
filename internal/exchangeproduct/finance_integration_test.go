package exchangeproduct

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

func TestFinanceReadUsesPersistedAccountAndRejectsReplayOrCrossAccount(t *testing.T) {
	service, _, _ := newTestService(t)
	key := strings.Repeat("e", 32)
	if _, err := service.CreditTestQuote("Bearer "+adminKey, alice, 7_000_000, "finance-alice-credit"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreditTestQuote("Bearer "+adminKey, bob, 11_000_000, "finance-bob-credit"); err != nil {
		t.Fatal(err)
	}
	server := NewServer(service)
	if err := server.ConfigureFinanceReadKey(key); err != nil {
		t.Fatal(err)
	}
	read := func(account string) (*httptest.ResponseRecorder, *http.Request) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, FinanceReadRoute, nil)
		if err := readintegration.Sign(req, key, "finance", "exchange", account, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		server.ServeHTTP(response, req)
		return response, req
	}
	aliceResponse, signed := read(alice)
	if aliceResponse.Code != http.StatusOK {
		t.Fatalf("alice status=%d body=%s", aliceResponse.Code, aliceResponse.Body.String())
	}
	var envelope struct {
		EnvelopeVersion   string `json:"envelopeVersion"`
		SourceID          string `json:"sourceId"`
		AuthorizedAccount string `json:"authorizedAccount"`
		Payload           struct {
			Balances []Balance `json:"balances"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(aliceResponse.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.EnvelopeVersion != FinanceReadEnvelopeVersion || envelope.SourceID != "exchange" || envelope.AuthorizedAccount != alice || len(envelope.Payload.Balances) != 2 || envelope.Payload.Balances[1].AvailableMicro != 7_000_000 {
		t.Fatalf("unexpected Alice evidence: %+v", envelope)
	}
	if strings.Contains(aliceResponse.Body.String(), bob) || strings.Contains(aliceResponse.Body.String(), "11000000") || strings.Contains(aliceResponse.Body.String(), adminKey) {
		t.Fatal("Alice read leaked Bob or server credentials")
	}
	replay := httptest.NewRecorder()
	server.ServeHTTP(replay, signed)
	if replay.Code != http.StatusUnauthorized {
		t.Fatalf("replay status=%d", replay.Code)
	}
	bobResponse, _ := read(bob)
	if bobResponse.Code != http.StatusOK || strings.Contains(bobResponse.Body.String(), alice) {
		t.Fatalf("Bob read leaked Alice: %d %s", bobResponse.Code, bobResponse.Body.String())
	}
	missing, _ := read(carol)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing economic account status=%d", missing.Code)
	}
	unsigned := httptest.NewRecorder()
	server.ServeHTTP(unsigned, httptest.NewRequest(http.MethodGet, FinanceReadRoute, nil))
	if unsigned.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned status=%d", unsigned.Code)
	}
	config := service.cfg
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	server = NewServer(reopened)
	if err := server.ConfigureFinanceReadKey(key); err != nil {
		t.Fatal(err)
	}
	restarted, _ := read(alice)
	if restarted.Code != http.StatusOK || !strings.Contains(restarted.Body.String(), "7000000") {
		t.Fatalf("restarted read did not use durable state: %d %s", restarted.Code, restarted.Body.String())
	}
}
