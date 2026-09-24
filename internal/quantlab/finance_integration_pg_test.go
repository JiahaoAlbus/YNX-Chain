package quantlab

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

// This integration test runs against an explicitly supplied disposable PG
// database. The same signed read must be consumed across separate processes.
func TestFinanceReadPostgresTenantAndCrossInstanceReplay(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	now := time.Now().UTC()
	secret := "quant-finance-postgres-test-key-1234567890"
	namespace := "quant-finance-it-" + strings.ToLower(strings.ReplaceAll(t.Name(), "/", "-")) + "-" + strings.ReplaceAll(now.Format("150405.000000000"), ".", "")
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	other := "ynx100f25pex4saeuaftzgx7s45wjzcyywhyl48mjt"
	config := Config{StatePath: filepath.Join(t.TempDir(), "quant.json"), DatabaseURL: databaseURL, StateNamespace: namespace, FinanceReadKey: secret, Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}}
	first, err := NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	store := first.baseService.store.(*postgresStateStore)
	var nonces []string
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE left(state_key, length($1)) = $1`, namespace+":tenant:")
		_, _ = store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key = $1`, namespace)
		for _, nonce := range nonces {
			_, _ = store.db.ExecContext(ctx, `DELETE FROM ynx_quant_finance_read_nonces WHERE nonce = $1`, nonce)
		}
	})
	seed := func(id, address, hash string) {
		t.Helper()
		cfg := config
		cfg.StateNamespace = namespace + ":tenant:" + strings.Repeat(id, 64)
		cfg.FinanceReadKey = ""
		service, err := New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer service.Close()
		mandate := validMandate(now, hash)
		mandate.Account = address
		if _, err := service.RegisterMandate(mandate); err != nil {
			t.Fatal(err)
		}
	}
	seed("a", account, strings.Repeat("a", 64))
	seed("b", other, strings.Repeat("b", 64))
	second, err := NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	request := func(address string) *http.Request {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, FinanceReadRoute, nil)
		if err := readintegration.Sign(req, secret, "finance", "quant", address, now); err != nil {
			t.Fatal(err)
		}
		nonces = append(nonces, req.Header.Get(readintegration.HeaderNonce))
		return req
	}
	signed := request(account)
	response := httptest.NewRecorder()
	first.ServeHTTP(response, signed)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), strings.Repeat("a", 64)) || strings.Contains(response.Body.String(), other) {
		t.Fatalf("first PG read status=%d body=%s", response.Code, response.Body.String())
	}
	replay := httptest.NewRecorder()
	second.ServeHTTP(replay, signed)
	if replay.Code != http.StatusServiceUnavailable {
		t.Fatalf("second instance accepted same nonce: %d", replay.Code)
	}
	restarted := httptest.NewRecorder()
	second.ServeHTTP(restarted, request(account))
	if restarted.Code != http.StatusOK || strings.Contains(restarted.Body.String(), other) {
		t.Fatalf("second instance did not read correct PG tenant: %d %s", restarted.Code, restarted.Body.String())
	}
}
