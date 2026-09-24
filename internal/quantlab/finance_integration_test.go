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

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
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
		Capabilities      []string            `json:"capabilities"`
		Payload           financeQuantPayload `json:"payload"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.SourceID != "quant" || envelope.AuthorizedAccount != account || len(envelope.Payload.Strategies) != 0 || len(envelope.Payload.Experiments) != 0 || len(envelope.Payload.Paper) != 0 || len(envelope.Payload.Mandates) != 1 || len(envelope.Payload.Executions) != 1 || envelope.Payload.TenantStates != 1 || envelope.Payload.Mandates[0].StrategyHash != first.StrategyHash {
		t.Fatalf("unexpected account evidence: %+v", envelope)
	}
	if strings.Contains(strings.Join(envelope.Capabilities, ","), "quant.pnl.read") || strings.Contains(recorder.Body.String(), `"userNetPnl"`) || strings.Contains(recorder.Body.String(), `"strategyName"`) || strings.Contains(recorder.Body.String(), `"StrategyHash"`) {
		t.Fatalf("Finance Quant payload is not using its stable account contract: %s", recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "wallet-proof") || strings.Contains(recorder.Body.String(), other) || strings.Contains(recorder.Body.String(), second.StrategyHash) || strings.Contains(recorder.Body.String(), "brokerProof") || strings.Contains(recorder.Body.String(), "walletSignature") || strings.Contains(recorder.Body.String(), "idempotencyKey") {
		t.Fatal("Finance evidence leaked credentials or another account's Quant state")
	}
	contract := finance.AcceptedReadSourceContract{Accepted: true, SourceID: "quant", Owner: "08-quant-lab", OwnerContractVersion: FinanceReadContractVersion, PayloadSchema: FinanceReadPayloadSchema, AllowedCapabilities: FinanceReadCapabilities}
	if _, err := finance.ValidateReadSourceEnvelope(recorder.Body.Bytes(), account, contract, now); err != nil {
		t.Fatalf("Finance rejected Quant owner envelope: %v", err)
	}
	replay := httptest.NewRecorder()
	server.ServeHTTP(replay, request)
	if replay.Code != http.StatusUnauthorized {
		t.Fatalf("replayed credential status=%d", replay.Code)
	}
}

func TestFinanceReadDoesNotExposeSameTenantPaperOrResearchAcrossAccounts(t *testing.T) {
	now := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)
	secret := "quant-finance-read-same-tenant-1234567890"
	base := filepath.Join(t.TempDir(), "quant.json")
	config := Config{StatePath: base, Now: func() time.Time { return now }, FinanceReadKey: secret, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}}
	server, err := NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	accountA := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	accountB := "ynx100f25pex4saeuaftzgx7s45wjzcyywhyl48mjt"
	tenantPath := filepath.Join(base+".tenants", strings.Repeat("3", 64)+".json")
	config.StatePath, config.FinanceReadKey = tenantPath, ""
	service, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	experiment, err := service.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	a := validMandate(now, experiment.Strategy.StrategyHash)
	a.Account = accountA
	aRegistered, err := service.RegisterMandate(a)
	if err != nil {
		t.Fatal(err)
	}
	b := validMandate(now, experiment.Strategy.StrategyHash)
	b.Account, b.Nonce, b.DeviceID = accountB, 2, "other-wallet-device"
	bRegistered, err := service.RegisterMandate(b)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SubmitTestnetWithSession(context.Background(), bRegistered.Digest, "buy", 1_000_000, 1, "finance-read-b-only-order", "wallet-order-signature", "one-time-session", validRisk(now)); err != nil {
		t.Fatal(err)
	}
	// Paper has no wallet provenance in persisted Quant state. A B-only
	// activity sentinel must not become a claimed balance for account A.
	service.mu.Lock()
	service.state.Paper.Cash = 987654321
	service.state.Paper.RealizedPnL = 123456789
	err = service.save()
	service.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if paper := service.Snapshot()["paper"].(PaperState); paper.Cash != 987654321 {
		t.Fatal("Quant professional Paper state was altered")
	}
	read := func(account string) (int, []byte, financeQuantPayload) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, FinanceReadRoute, nil)
		if err := readintegration.Sign(req, secret, "finance", "quant", account, now); err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		server.ServeHTTP(response, req)
		var envelope struct {
			Payload financeQuantPayload `json:"payload"`
		}
		if response.Code == http.StatusOK && json.Unmarshal(response.Body.Bytes(), &envelope) != nil {
			t.Fatal("invalid Finance envelope")
		}
		return response.Code, response.Body.Bytes(), envelope.Payload
	}
	status, body, payload := read(accountA)
	if status != http.StatusOK || len(payload.Mandates) != 1 || payload.Mandates[0].Digest != aRegistered.Digest || len(payload.Executions) != 0 || len(payload.Paper) != 0 || len(payload.Experiments) != 0 || len(payload.Strategies) != 0 {
		t.Fatalf("account A received tenant-wide or B-only state: %d %s", status, body)
	}
	for _, private := range []string{accountB, bRegistered.Digest, "987654321", "123456789", "finance-read-b-only-order", `"attribution"`} {
		if strings.Contains(string(body), private) {
			t.Fatalf("account A leaked %q: %s", private, body)
		}
	}
	status, body, payload = read(accountB)
	if status != http.StatusOK || len(payload.Mandates) != 1 || payload.Mandates[0].Digest != bRegistered.Digest || len(payload.Executions) != 1 || len(payload.Paper) != 0 {
		t.Fatalf("account B did not receive only its mandate-bound state: %d %s", status, body)
	}
	status, body, _ = read("ynx1zp6c2ra98djygdwldzx75jqwzgvgyjy7gu862s")
	if status != http.StatusNotFound {
		t.Fatalf("unregistered account status=%d body=%s", status, body)
	}
}
