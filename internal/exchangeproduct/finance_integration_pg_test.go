package exchangeproduct

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

func TestFinanceReadPostgresCrossInstanceNonceAndPersistedAccount(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_EXCHANGE_POSTGRES_TEST_URL is not configured")
	}
	key := strings.Repeat("e", 32)
	config := Config{StateDatabaseURL: databaseURL, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback"}
	firstService, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer firstService.Close()
	store := firstService.stateRepository.(*postgresStateRepository)
	if store.schemaMode != "revision" {
		t.Skip("revision-layout PostgreSQL database is required; integrity layout is covered separately")
	}
	var nonce string
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = store.db.ExecContext(ctx, `DELETE FROM ynx_exchange_state WHERE id = 'primary'`)
		if nonce != "" {
			_, _ = store.db.ExecContext(ctx, `DELETE FROM ynx_exchange_finance_read_nonces WHERE nonce = $1`, nonce)
		}
	})
	if _, err := firstService.CreditTestQuote(adminKey, alice, 3_000_000, "finance-pg-credit"); err != nil {
		t.Fatal(err)
	}
	secondService, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer secondService.Close()
	first, second := NewServer(firstService), NewServer(secondService)
	for _, server := range []*Server{first, second} {
		if err := server.ConfigureFinanceReadKey(key); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(http.MethodGet, FinanceReadRoute, nil)
	if err := readintegration.Sign(req, key, "finance", "exchange", alice, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	nonce = req.Header.Get(readintegration.HeaderNonce)
	one := httptest.NewRecorder()
	first.ServeHTTP(one, req)
	if one.Code != http.StatusOK || !strings.Contains(one.Body.String(), "3000000") {
		t.Fatalf("first PG read status=%d body=%s", one.Code, one.Body.String())
	}
	two := httptest.NewRecorder()
	second.ServeHTTP(two, req)
	if two.Code != http.StatusServiceUnavailable {
		t.Fatalf("second instance accepted replay: %d", two.Code)
	}
}
