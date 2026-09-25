package exchangeproduct

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

const (
	FinanceReadRoute           = "/v1/integrations/finance/account"
	FinanceReadEnvelopeVersion = "finance-source-read-envelope-v1"
	FinanceReadContractVersion = "exchange-finance-read-v1"
	FinanceReadPayloadSchema   = "ynx-exchange-finance-account-v1"
)

var financeReadCapabilities = []string{
	"exchange.subaccount.read", "exchange.orders.read", "exchange.fills.read", "exchange.fees.read",
}

// ConfigureFinanceReadKey enables the server-to-server Finance read route.
// An absent key leaves it unavailable; it never grants a browser session.
func (s *Server) ConfigureFinanceReadKey(key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		s.financeRead = nil
		return nil
	}
	verifier, err := readintegration.NewVerifier(key, "finance", "exchange", s.service.cfg.Now)
	if err != nil {
		return err
	}
	if store, ok := s.service.store.(*postgresStateStore); ok {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS ynx_exchange_finance_read_nonces (
			nonce TEXT PRIMARY KEY,
			expires_at TIMESTAMPTZ NOT NULL
		)`); err != nil {
			return err
		}
		if _, err := store.db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS ynx_exchange_finance_read_nonces_expiry ON ynx_exchange_finance_read_nonces (expires_at)`); err != nil {
			return err
		}
	}
	s.financeRead = verifier
	return nil
}

type financeOrder struct {
	ID          string    `json:"id"`
	Market      string    `json:"market"`
	Side        string    `json:"side"`
	Type        string    `json:"type"`
	PriceMicro  int64     `json:"priceMicro"`
	AmountMicro int64     `json:"amountMicro"`
	FilledMicro int64     `json:"filledMicro"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type financeFill struct {
	ID          string    `json:"id"`
	Market      string    `json:"market"`
	Side        string    `json:"side"`
	PriceMicro  int64     `json:"priceMicro"`
	AmountMicro int64     `json:"amountMicro"`
	FeeMicro    int64     `json:"feeMicro"`
	CreatedAt   time.Time `json:"createdAt"`
}

type financeExchangePayload struct {
	Product        string         `json:"product"`
	ProductVersion string         `json:"productVersion"`
	BuildCommit    string         `json:"buildCommit"`
	Market         string         `json:"market"`
	StateBackend   string         `json:"stateBackend"`
	MultiInstance  bool           `json:"multiInstance"`
	Balances       []Balance      `json:"balances"`
	Orders         []financeOrder `json:"orders"`
	Fills          []financeFill  `json:"fills"`
	Fees           []FeeRecord    `json:"fees"`
}

func (s *Server) financeAccount(w http.ResponseWriter, r *http.Request) {
	if s.financeRead == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "finance read is not configured"})
		return
	}
	account, err := s.financeRead.Verify(r, FinanceReadRoute)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid Finance read credential"})
		return
	}
	account, err = nativewallet.NormalizeNativeAddress(account)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid Finance read account"})
		return
	}
	if ok, err := s.claimFinanceReadNonce(r.Header.Get(readintegration.HeaderNonce)); err != nil || !ok {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Finance read replay protection unavailable or nonce already used"})
		return
	}
	if !s.service.hasPersistedFinanceAccount(account) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no Exchange economic account record"})
		return
	}
	snapshot := s.service.Snapshot(account)
	payload := financeExchangePayload{Product: ProductID, ProductVersion: Version, BuildCommit: BuildCommit, Market: DefaultMarket, StateBackend: snapshot.SourceMetadata.StateBackend, MultiInstance: snapshot.SourceMetadata.MultiInstance, Balances: snapshot.Balances, Orders: make([]financeOrder, 0, len(snapshot.Orders)), Fills: make([]financeFill, 0, len(snapshot.Trades)), Fees: snapshot.Fees}
	for _, order := range snapshot.Orders {
		payload.Orders = append(payload.Orders, financeOrder{ID: order.ID, Market: order.Market, Side: order.Side, Type: order.Type, PriceMicro: order.PriceMicro, AmountMicro: order.AmountMicro, FilledMicro: order.FilledMicro, Status: order.Status, CreatedAt: order.CreatedAt, UpdatedAt: order.UpdatedAt})
	}
	for _, trade := range snapshot.Trades {
		fill := financeFill{ID: trade.ID, Market: trade.Market, PriceMicro: trade.PriceMicro, AmountMicro: trade.AmountMicro, CreatedAt: trade.CreatedAt}
		if trade.Buyer == account {
			fill.Side, fill.FeeMicro = "buy", trade.BuyerFeeMicro
		} else {
			fill.Side, fill.FeeMicro = "sell", trade.SellerFeeMicro
		}
		payload.Fills = append(payload.Fills, fill)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"envelopeVersion": FinanceReadEnvelopeVersion,
		"sourceId":        "exchange", "owner": "07-exchange", "network": ChainID,
		"nativeAsset": NativeAsset, "authorizedAccount": account,
		"ownerContractVersion": FinanceReadContractVersion, "payloadSchema": FinanceReadPayloadSchema,
		"asOf": snapshot.SourceMetadata.AsOf, "asOfKind": "exchange-persisted-state-observed-at",
		"coverage":   "authorized Exchange balances, orders, fills and fees from persisted Testnet venue state",
		"syncStatus": "authoritative-persisted-exchange-state", "readOnly": true,
		"capabilities": financeReadCapabilities, "payload": payload,
	})
}

func (s *Server) claimFinanceReadNonce(nonce string) (bool, error) {
	store, ok := s.service.store.(*postgresStateStore)
	if !ok {
		// The JSON state backend is explicitly single-host and not deployable in
		// multi-instance mode. The shared verifier already consumes this nonce.
		return true, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_exchange_finance_read_nonces WHERE nonce IN (
		SELECT nonce FROM ynx_exchange_finance_read_nonces WHERE expires_at < NOW() ORDER BY expires_at LIMIT 64
	)`); err != nil {
		return false, err
	}
	result, err := store.db.ExecContext(ctx, `INSERT INTO ynx_exchange_finance_read_nonces (nonce, expires_at) VALUES ($1, NOW() + INTERVAL '1 minute') ON CONFLICT (nonce) DO NOTHING`, nonce)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (s *Service) hasPersistedFinanceAccount(account string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, balance := range s.state.Balances {
		if balance.Account == account {
			return true
		}
	}
	for _, order := range s.state.Orders {
		if order.Account == account {
			return true
		}
	}
	for _, trade := range s.state.Trades {
		if trade.Buyer == account || trade.Seller == account {
			return true
		}
	}
	return false
}
