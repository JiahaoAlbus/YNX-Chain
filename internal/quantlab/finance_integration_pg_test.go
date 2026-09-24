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
	t.Cleanup(func() {
		if err := first.Close(); err != nil {
			t.Errorf("close first tenant server: %v", err)
		}
	})
	store := first.baseService.store.(*postgresStateStore)
	var nonces []string
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE left(state_key, length($1)) = $1`, namespace+":tenant:"); err != nil {
			t.Errorf("clean tenant states: %v", err)
		}
		if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key = $1 OR state_key = $2`, namespace, namespace+":tenant_"+strings.Repeat("c", 64)); err != nil {
			t.Errorf("clean adjacent namespace states: %v", err)
		}
		for _, nonce := range nonces {
			if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_finance_read_nonces WHERE nonce = $1`, nonce); err != nil {
				t.Errorf("clean read nonce: %v", err)
			}
		}
	})
	var localeOrder, byteOrder bool
	if err := store.db.QueryRow(`SELECT 'qa:tenant:aaa' < 'qa:tenant;', 'qa:tenant:aaa' COLLATE "C" < 'qa:tenant;'`).Scan(&localeOrder, &byteOrder); err != nil {
		t.Fatal(err)
	}
	if !byteOrder {
		t.Fatal("bytewise tenant bound is not ordered")
	}
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
	// A neighboring namespace must not enter the tenant range even when the
	// database's locale sorts punctuation differently from byte order.
	if _, err := store.db.Exec(`INSERT INTO ynx_quant_state (state_key, revision, payload) VALUES ($1, 1, '{}'::jsonb)`, namespace+":tenant_"+strings.Repeat("c", 64)); err != nil {
		t.Fatal(err)
	}
	second, err := NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := second.Close(); err != nil {
			t.Errorf("close second tenant server: %v", err)
		}
	})
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
