package exchangeproduct

import (
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

const (
	FinanceReadRoute           = "/v1/integrations/finance/account"
	FinanceReadEnvelopeVersion = "finance-source-read-envelope-v1"
	FinanceReadContractVersion = "exchange-finance-read-v1"
	FinanceReadPayloadSchema   = "ynx-exchange-finance-account-v1"
)

var FinanceReadCapabilities = []string{
	"exchange.subaccount.read",
	"exchange.orders.read",
	"exchange.fills.read",
	"exchange.fees.read",
	"exchange.margin.read",
	"exchange.funding.read",
	"exchange.risk.read",
}

type financeOrder struct {
	ID          string    `json:"id"`
	Market      string    `json:"market"`
	Side        string    `json:"side"`
	Type        string    `json:"type"`
	TimeInForce string    `json:"timeInForce"`
	PriceMicro  int64     `json:"priceMicro"`
	AmountMicro int64     `json:"amountMicro"`
	FilledMicro int64     `json:"filledMicro"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type financeTrade struct {
	ID          string    `json:"id"`
	Market      string    `json:"market"`
	Side        string    `json:"side"`
	PriceMicro  int64     `json:"priceMicro"`
	AmountMicro int64     `json:"amountMicro"`
	FeeMicro    int64     `json:"feeMicro"`
	CreatedAt   time.Time `json:"createdAt"`
}

type financePerpetualOrder struct {
	ID                  string    `json:"id"`
	Market              string    `json:"market"`
	Side                string    `json:"side"`
	Type                string    `json:"type"`
	TimeInForce         string    `json:"timeInForce"`
	PriceMicro          int64     `json:"priceMicro"`
	AmountMicro         int64     `json:"amountMicro"`
	FilledMicro         int64     `json:"filledMicro"`
	Leverage            int64     `json:"leverage"`
	ReduceOnly          bool      `json:"reduceOnly"`
	ReservedMarginMicro int64     `json:"reservedMarginMicro"`
	Status              string    `json:"status"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type financeExchangePayload struct {
	Product             string                  `json:"product"`
	ProductVersion      string                  `json:"productVersion"`
	BuildCommit         string                  `json:"buildCommit"`
	Balances            []Balance               `json:"balances"`
	Orders              []financeOrder          `json:"orders"`
	Trades              []financeTrade          `json:"trades"`
	Fees                []FeeRecord             `json:"fees"`
	MarginAccount       MarginAccount           `json:"marginAccount"`
	EquityMicro         int64                   `json:"equityMicro"`
	FreeCollateralMicro int64                   `json:"freeCollateralMicro"`
	Positions           []PerpetualPosition     `json:"positions"`
	PerpetualOrders     []financePerpetualOrder `json:"perpetualOrders"`
	PerpetualTrades     []financeTrade          `json:"perpetualTrades"`
	Funding             []FundingSettlement     `json:"funding"`
	OracleStatus        string                  `json:"oracleStatus"`
}

func (s *Server) financeAccount(w http.ResponseWriter, r *http.Request) {
	if s.financeRead == nil {
		writeError(w, http.StatusServiceUnavailable, "integration_unavailable", "Finance read integration is not configured")
		return
	}
	account, err := s.financeRead.Verify(r, FinanceReadRoute)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_read_credential", "Finance read credential is invalid")
		return
	}
	account, err = nativewallet.NormalizeNativeAddress(account)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_read_account", "Finance read account is invalid")
		return
	}

	snapshot := s.service.Snapshot(account)
	orders := make([]financeOrder, 0, len(snapshot.Orders))
	for _, order := range snapshot.Orders {
		orders = append(orders, financeOrder{ID: order.ID, Market: order.Market, Side: order.Side, Type: order.Type, TimeInForce: order.TimeInForce, PriceMicro: order.PriceMicro, AmountMicro: order.AmountMicro, FilledMicro: order.FilledMicro, Status: order.Status, CreatedAt: order.CreatedAt, UpdatedAt: order.UpdatedAt})
	}
	trades := make([]financeTrade, 0, len(snapshot.Trades))
	for _, trade := range snapshot.Trades {
		side, fee := "sell", trade.SellerFeeMicro
		if trade.Buyer == account {
			side, fee = "buy", trade.BuyerFeeMicro
		}
		trades = append(trades, financeTrade{ID: trade.ID, Market: trade.Market, Side: side, PriceMicro: trade.PriceMicro, AmountMicro: trade.AmountMicro, FeeMicro: fee, CreatedAt: trade.CreatedAt})
	}
	perpetualOrders := make([]financePerpetualOrder, 0, len(snapshot.Margin.Orders))
	for _, order := range snapshot.Margin.Orders {
		perpetualOrders = append(perpetualOrders, financePerpetualOrder{ID: order.ID, Market: order.Market, Side: order.Side, Type: order.Type, TimeInForce: order.TimeInForce, PriceMicro: order.PriceMicro, AmountMicro: order.AmountMicro, FilledMicro: order.FilledMicro, Leverage: order.Leverage, ReduceOnly: order.ReduceOnly, ReservedMarginMicro: order.ReservedMarginMicro, Status: order.Status, CreatedAt: order.CreatedAt, UpdatedAt: order.UpdatedAt})
	}
	perpetualTrades := make([]financeTrade, 0, len(snapshot.Margin.Trades))
	for _, trade := range snapshot.Margin.Trades {
		side, fee := "sell", trade.SellerFeeMicro
		if trade.Buyer == account {
			side, fee = "buy", trade.BuyerFeeMicro
		}
		perpetualTrades = append(perpetualTrades, financeTrade{ID: trade.ID, Market: trade.Market, Side: side, PriceMicro: trade.PriceMicro, AmountMicro: trade.AmountMicro, FeeMicro: fee, CreatedAt: trade.CreatedAt})
	}
	payload := financeExchangePayload{
		Product: ProductID, ProductVersion: Version, BuildCommit: BuildCommit,
		Balances: snapshot.Balances, Orders: orders, Trades: trades, Fees: snapshot.Fees,
		MarginAccount: snapshot.Margin.Account, EquityMicro: snapshot.Margin.EquityMicro,
		FreeCollateralMicro: snapshot.Margin.FreeCollateralMicro, Positions: snapshot.Margin.Positions,
		PerpetualOrders: perpetualOrders, PerpetualTrades: perpetualTrades,
		Funding: snapshot.Margin.Funding, OracleStatus: snapshot.Margin.OracleStatus,
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"envelopeVersion":      FinanceReadEnvelopeVersion,
		"sourceId":             "exchange",
		"owner":                "07-exchange",
		"network":              ChainID,
		"nativeAsset":          NativeAsset,
		"authorizedAccount":    account,
		"ownerContractVersion": FinanceReadContractVersion,
		"payloadSchema":        FinanceReadPayloadSchema,
		"asOf":                 s.service.cfg.Now().UTC(),
		"asOfKind":             "exchange-state-observed-at",
		"coverage":             "authorized balances, spot and perpetual orders and fills, fees, margin, positions, funding and risk status",
		"syncStatus":           "authoritative-persisted-exchange-state",
		"readOnly":             true,
		"capabilities":         append([]string(nil), FinanceReadCapabilities...),
		"payload":              payload,
	})
}
