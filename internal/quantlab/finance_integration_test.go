package quantlab

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

func TestFinanceReadEndpointAggregatesOnlyAuthorizedAccountAndRejectsReplay(t *testing.T) {
	now := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)
	secret := "quant-finance-read-test-key-1234567890"
	base := filepath.Join(t.TempDir(), "quant.json")
	server, err := NewTenantServer(Config{StatePath: base, Now: func() time.Time { return now }, FinanceReadKey: secret, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}}, "all")
	if err != nil {
		t.Fatal(err)
	}
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	other := "ynx100f25pex4saeuaftzgx7s45wjzcyywhyl48mjt"
	service, err := New(Config{StatePath: filepath.Join(base+".tenants", strings.Repeat("1", 64)+".json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err := service.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	first := validMandate(now, experiment.Strategy.StrategyHash)
	first.Account, first.BundleID, first.DeviceID = account, "com.ynxweb4.quant.web", "finance-read-device"
	registered, err := service.RegisterMandate(first)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SubmitTestnetWithSession(context.Background(), registered.Digest, "buy", 1_000_000, 1, "finance-read-order-1", "wallet-order-signature", "one-time-session", validRisk(now)); err != nil {
		t.Fatal(err)
	}
	second := validMandate(now, strings.Repeat("b", 64))
	second.Account = other
	otherService, err := New(Config{StatePath: filepath.Join(base+".tenants", strings.Repeat("2", 64)+".json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := otherService.RegisterMandate(second); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, FinanceReadRoute, nil)
	if err := readintegration.Sign(request, secret, "finance", "quant", account, now); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var envelope struct {
		SourceID          string              `json:"sourceId"`
		AuthorizedAccount string              `json:"authorizedAccount"`
		Payload           financeQuantPayload `json:"payload"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.SourceID != "quant" || envelope.AuthorizedAccount != account || len(envelope.Payload.Strategies) != 1 || len(envelope.Payload.Experiments) != 1 || len(envelope.Payload.Mandates) != 1 || len(envelope.Payload.Executions) != 1 || envelope.Payload.TenantStates != 1 || envelope.Payload.Mandates[0].StrategyHash != first.StrategyHash {
		t.Fatalf("unexpected account evidence: %+v", envelope)
	}
	if !strings.Contains(recorder.Body.String(), `"strategyName":"Transparent moving average"`) || !strings.Contains(recorder.Body.String(), `"userNetPnl"`) || strings.Contains(recorder.Body.String(), `"StrategyHash"`) {
		t.Fatalf("Finance Quant payload is not using its stable account contract: %s", recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "wallet-proof") || strings.Contains(recorder.Body.String(), other) || strings.Contains(recorder.Body.String(), second.StrategyHash) {
		t.Fatal("Finance evidence leaked credentials or another account's Quant state")
	}
	replay := httptest.NewRecorder()
	server.ServeHTTP(replay, request)
	if replay.Code != http.StatusUnauthorized {
		t.Fatalf("replayed credential status=%d", replay.Code)
	}
}
