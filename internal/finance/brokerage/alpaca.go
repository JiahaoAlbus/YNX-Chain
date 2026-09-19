package brokerage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Never return provider body, authorization headers, URLs containing credentials
// or transport errors to the browser/logs. Request IDs are bounded audit metadata.
type Error struct {
	Code       string
	RequestID  string
	HTTPStatus int
}

func (e *Error) Error() string { return e.Code }

var auditID = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type Asset struct {
	ID       string `json:"id"`
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Class    string `json:"class"`
	Status   string `json:"providerStatus"`
	Tradable bool   `json:"tradable"`
}
type AssetResult struct {
	Provider    string  `json:"provider"`
	Environment string  `json:"environment"`
	RequestID   string  `json:"requestId"`
	Assets      []Asset `json:"assets"`
}
type Account struct {
	ID                   string `json:"providerAccountId"`
	Status               string `json:"providerStatus"`
	Currency             string `json:"currency"`
	Cash                 string `json:"cash"`
	BuyingPower          string `json:"buyingPower"`
	TradingBlocked       bool   `json:"tradingBlocked"`
	AccountBlocked       bool   `json:"accountBlocked"`
	TradeSuspendedByUser bool   `json:"tradeSuspendedByUser"`
	RequestID            string `json:"requestId"`
}

type Order struct {
	ID            string `json:"providerOrderId"`
	ClientOrderID string `json:"clientOrderId"`
	AssetID       string `json:"assetId"`
	Symbol        string `json:"symbol"`
	Side          string `json:"side"`
	Qty           string `json:"qty"`
	FilledQty     string `json:"filledQty"`
	Type          string `json:"type"`
	LimitPrice    string `json:"limitPrice"`
	TimeInForce   string `json:"timeInForce"`
	ExtendedHours bool   `json:"extendedHours"`
	Status        string `json:"providerStatus"`
	SubmittedAt   string `json:"submittedAt"`
}

type Position struct {
	AssetID      string `json:"assetId"`
	Symbol       string `json:"symbol"`
	Qty          string `json:"qty"`
	AvailableQty string `json:"availableQty"`
	AveragePrice string `json:"averageEntryPrice"`
	MarketValue  string `json:"marketValue"`
}

type AccountSnapshot struct {
	Provider    string     `json:"provider"`
	Environment string     `json:"environment"`
	RequestIDs  []string   `json:"requestIds"`
	Account     Account    `json:"account"`
	Orders      []Order    `json:"orders"`
	Positions   []Position `json:"positions"`
}
type Quote struct {
	Symbol    string `json:"symbol"`
	BidPrice  string `json:"bidPrice"`
	AskPrice  string `json:"askPrice"`
	BidSize   string `json:"bidSize"`
	AskSize   string `json:"askSize"`
	Timestamp string `json:"timestamp"`
	Feed      string `json:"feed"`
	RequestID string `json:"requestId"`
}

type SubmitOrderRequest struct {
	ClientOrderID string `json:"client_order_id"`
	AssetID       string `json:"asset_id"`
	Symbol        string `json:"symbol"`
	Side          string `json:"side"`
	Qty           string `json:"qty"`
	Type          string `json:"type"`
	LimitPrice    string `json:"limit_price"`
	TimeInForce   string `json:"time_in_force"`
	ExtendedHours bool   `json:"extended_hours"`
}

// Account IDs must be obtained from a persistent owner-checked mapping, never a
// browser-supplied provider ID or one global ACCOUNT_ID environment variable.
type AccountResolver interface {
	ResolveBrokerAccount(context.Context, string, string, string) (string, error)
}
type BrokerageAdapter interface {
	Capabilities() map[string]string
	Assets(context.Context) (AssetResult, error)
	Quote(context.Context, string) (Quote, error)
	Account(context.Context, string, AccountResolver) (Account, error)
	Orders(context.Context, string, AccountResolver) ([]Order, string, error)
	Positions(context.Context, string, AccountResolver) ([]Position, string, error)
	Reconcile(context.Context, string, AccountResolver) (AccountSnapshot, error)
	SubmitOrder(context.Context, string, AccountResolver, SubmitOrderRequest) (Order, error)
	CancelOrder(context.Context, string, AccountResolver, string) error
}
type Alpaca struct {
	cfg     Config
	client  *http.Client
	mu      sync.Mutex
	token   string
	expires time.Time
}

func NewAlpaca(cfg Config) *Alpaca {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	return &Alpaca{cfg: cfg, client: &http.Client{Timeout: 10 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (a *Alpaca) Capabilities() map[string]string {
	return map[string]string{
		"assets": "implemented_read_only", "accountStatus": "requires_persistent_owner_mapping",
		"quotes": "implemented_read_only_requires_market_data_entitlement", "submit": "implemented_activation_gated",
		"cancel": "implemented_activation_gated", "positions": "implemented_read_only", "cash": "implemented_read_only",
		"events": "strict_tenant_bound_sse_parser_implemented_worker_transport_not_activated", "reconciliation": "implemented_bounded_read_only", "live": "forbidden",
	}
}
func (a *Alpaca) exchange(ctx context.Context, req *http.Request, out any) (string, error) {
	return a.exchangeStatus(ctx, req, out, http.StatusOK)
}
func (a *Alpaca) exchangeStatus(ctx context.Context, req *http.Request, out any, accepted ...int) (string, error) {
	req = req.WithContext(ctx)
	req.Header.Set("Accept", "application/json")
	res, err := a.client.Do(req)
	if err != nil {
		return "", &Error{Code: "PROVIDER_UNAVAILABLE"}
	}
	defer res.Body.Close()
	id := res.Header.Get("X-Request-ID")
	if !auditID.MatchString(id) {
		id = ""
	}
	statusAccepted := false
	for _, status := range accepted {
		statusAccepted = statusAccepted || res.StatusCode == status
	}
	if !statusAccepted {
		code := "PROVIDER_REJECTED"
		switch res.StatusCode {
		case 401:
			code = "AUTHENTICATION_FAILED"
		case 403:
			code = "PERMISSION_DENIED"
		case 429:
			code = "RATE_LIMITED"
		}
		return id, &Error{Code: code, RequestID: id, HTTPStatus: res.StatusCode}
	}
	typ, _, err := mime.ParseMediaType(res.Header.Get("Content-Type"))
	if err != nil || typ != "application/json" {
		return id, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (4<<20)+1))
	if err != nil || len(data) > 4<<20 || out == nil || json.Unmarshal(data, out) != nil {
		return id, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
	}
	return id, nil
}
func (a *Alpaca) authorize(ctx context.Context, req *http.Request) error {
	if !a.cfg.ready() {
		return &Error{Code: "BROKER_NOT_CONFIGURED"}
	}
	if a.cfg.authMode == "legacy_basic" {
		req.SetBasicAuth(a.cfg.key, a.cfg.secret)
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.token == "" || time.Now().Add(30*time.Second).After(a.expires) {
		form := url.Values{"grant_type": {"client_credentials"}, "client_id": {a.cfg.key}, "client_secret": {a.cfg.secret}}
		tokenReq, _ := http.NewRequest(http.MethodPost, TokenURL, strings.NewReader(form.Encode()))
		tokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		var token struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int    `json:"expires_in"`
			TokenType   string `json:"token_type"`
		}
		started := time.Now()
		if _, err := a.exchange(ctx, tokenReq, &token); err != nil {
			return err
		}
		if token.TokenType != "Bearer" || token.ExpiresIn <= 30 || token.ExpiresIn > 3600 || len(token.AccessToken) == 0 || len(token.AccessToken) > 16384 || strings.ContainsAny(token.AccessToken, " \t\r\n\x00") {
			return &Error{Code: "TOKEN_PROTOCOL_ERROR"}
		}
		a.token = token.AccessToken
		a.expires = started.Add(time.Duration(token.ExpiresIn) * time.Second)
	}
	req.Header.Set("Authorization", "Bearer "+a.token)
	return nil
}
func (a *Alpaca) get(ctx context.Context, path string, out any) (string, error) {
	return a.getOrigin(ctx, BrokerOrigin, path, out)
}
func (a *Alpaca) getOrigin(ctx context.Context, origin, path string, out any) (string, error) {
	req, _ := http.NewRequest(http.MethodGet, origin+path, nil)
	if err := a.authorize(ctx, req); err != nil {
		return "", err
	}
	return a.exchange(ctx, req, out)
}
func (a *Alpaca) Quote(ctx context.Context, symbol string) (Quote, error) {
	if !regexp.MustCompile(`^[A-Z][A-Z0-9.]{0,11}$`).MatchString(symbol) {
		return Quote{}, &Error{Code: "MARKET_DATA_REQUEST_INVALID"}
	}
	var raw struct {
		Symbol string `json:"symbol"`
		Quote  struct {
			AskPrice  json.Number `json:"ap"`
			AskSize   json.Number `json:"as"`
			BidPrice  json.Number `json:"bp"`
			BidSize   json.Number `json:"bs"`
			Timestamp string      `json:"t"`
		} `json:"quote"`
	}
	requestID, err := a.getOrigin(ctx, MarketDataOrigin, "/v2/stocks/"+url.PathEscape(symbol)+"/quotes/latest?feed=iex&currency=USD", &raw)
	if err != nil {
		return Quote{}, err
	}
	if raw.Symbol != symbol || !providerDecimal.MatchString(raw.Quote.AskPrice.String()) || !providerDecimal.MatchString(raw.Quote.AskSize.String()) || !providerDecimal.MatchString(raw.Quote.BidPrice.String()) || !providerDecimal.MatchString(raw.Quote.BidSize.String()) {
		return Quote{}, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: requestID}
	}
	if _, err := time.Parse(time.RFC3339Nano, raw.Quote.Timestamp); err != nil {
		return Quote{}, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: requestID}
	}
	return Quote{Symbol: symbol, BidPrice: raw.Quote.BidPrice.String(), AskPrice: raw.Quote.AskPrice.String(), BidSize: raw.Quote.BidSize.String(), AskSize: raw.Quote.AskSize.String(), Timestamp: raw.Quote.Timestamp, Feed: "iex", RequestID: requestID}, nil
}
func (a *Alpaca) Assets(ctx context.Context) (AssetResult, error) {
	var raw []struct {
		ID       string `json:"id"`
		Symbol   string `json:"symbol"`
		Name     string `json:"name"`
		Class    string `json:"class"`
		Status   string `json:"status"`
		Tradable bool   `json:"tradable"`
	}
	id, err := a.get(ctx, "/v1/assets?status=active&asset_class=us_equity", &raw)
	if err != nil {
		return AssetResult{}, err
	}
	result := AssetResult{Provider: Provider, Environment: "sandbox", RequestID: id, Assets: []Asset{}}
	if raw == nil {
		return result, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
	}
	seen := map[string]bool{}
	for _, r := range raw {
		if !uuid.MatchString(r.ID) || r.Symbol == "" || len(r.Symbol) > 32 || r.Name == "" || r.Class != "us_equity" || r.Status != "active" || seen[r.ID] {
			return AssetResult{}, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
		}
		seen[r.ID] = true
		result.Assets = append(result.Assets, Asset{r.ID, r.Symbol, r.Name, r.Class, r.Status, r.Tradable})
	}
	return result, nil
}
func (a *Alpaca) Account(ctx context.Context, owner string, resolver AccountResolver) (Account, error) {
	if !a.cfg.ready() {
		return Account{}, &Error{Code: "BROKER_NOT_CONFIGURED"}
	}
	if owner == "" || resolver == nil {
		return Account{}, &Error{Code: "ACCOUNT_NOT_LINKED"}
	}
	account, err := resolver.ResolveBrokerAccount(ctx, owner, Provider, "sandbox")
	if err != nil || !uuid.MatchString(account) {
		return Account{}, &Error{Code: "ACCOUNT_NOT_LINKED"}
	}
	var raw struct {
		ID                   string `json:"id"`
		Status               string `json:"status"`
		Currency             string `json:"currency"`
		Cash                 string `json:"cash"`
		BuyingPower          string `json:"buying_power"`
		TradingBlocked       *bool  `json:"trading_blocked"`
		AccountBlocked       *bool  `json:"account_blocked"`
		TradeSuspendedByUser *bool  `json:"trade_suspended_by_user"`
	}
	id, err := a.get(ctx, "/v1/trading/accounts/"+account+"/account", &raw)
	if err != nil {
		return Account{}, err
	}
	if raw.ID != account || raw.Status == "" || raw.Currency != "USD" || !providerDecimal.MatchString(raw.Cash) || !providerDecimal.MatchString(raw.BuyingPower) || raw.TradingBlocked == nil || raw.AccountBlocked == nil || raw.TradeSuspendedByUser == nil {
		return Account{}, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
	}
	return Account{ID: raw.ID, Status: raw.Status, Currency: raw.Currency, Cash: raw.Cash, BuyingPower: raw.BuyingPower, TradingBlocked: *raw.TradingBlocked, AccountBlocked: *raw.AccountBlocked, TradeSuspendedByUser: *raw.TradeSuspendedByUser, RequestID: id}, nil
}

// Provider read models preserve upstream decimal strings exactly. Broker
// account buying power can legitimately carry more fractional precision than
// Finance permits for a user-authored order, so this validation is deliberately
// separate from the order-input contract.
var providerDecimal = regexp.MustCompile(`^-?(?:0|[1-9][0-9]{0,31})(?:\.[0-9]{1,18})?$`)

func (a *Alpaca) resolveAccount(ctx context.Context, owner string, resolver AccountResolver) (string, error) {
	if !a.cfg.ready() {
		return "", &Error{Code: "BROKER_NOT_CONFIGURED"}
	}
	if owner == "" || resolver == nil {
		return "", &Error{Code: "ACCOUNT_NOT_LINKED"}
	}
	account, err := resolver.ResolveBrokerAccount(ctx, owner, Provider, "sandbox")
	if err != nil || !uuid.MatchString(account) {
		return "", &Error{Code: "ACCOUNT_NOT_LINKED"}
	}
	return account, nil
}

type providerOrder struct {
	ID            string  `json:"id"`
	ClientOrderID string  `json:"client_order_id"`
	AssetID       string  `json:"asset_id"`
	Symbol        string  `json:"symbol"`
	Side          string  `json:"side"`
	Qty           string  `json:"qty"`
	FilledQty     string  `json:"filled_qty"`
	Type          string  `json:"type"`
	LimitPrice    *string `json:"limit_price"`
	TimeInForce   string  `json:"time_in_force"`
	ExtendedHours bool    `json:"extended_hours"`
	Status        string  `json:"status"`
	SubmittedAt   string  `json:"submitted_at"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

func normalizeProviderOrder(value providerOrder, requestID string) (Order, error) {
	limitPrice := ""
	if value.LimitPrice != nil {
		limitPrice = *value.LimitPrice
	}
	if !uuid.MatchString(value.ID) || value.ClientOrderID == "" || len(value.ClientOrderID) > 128 || !uuid.MatchString(value.AssetID) || value.Symbol == "" || (value.Side != "buy" && value.Side != "sell") || !providerDecimal.MatchString(value.Qty) || !providerDecimal.MatchString(value.FilledQty) || value.Type == "" || value.TimeInForce == "" || value.Status == "" || (limitPrice != "" && !providerDecimal.MatchString(limitPrice)) {
		return Order{}, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: requestID}
	}
	if _, err := time.Parse(time.RFC3339Nano, value.SubmittedAt); err != nil {
		return Order{}, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: requestID}
	}
	for _, optionalTimestamp := range []string{value.CreatedAt, value.UpdatedAt} {
		if optionalTimestamp != "" {
			if _, err := time.Parse(time.RFC3339Nano, optionalTimestamp); err != nil {
				return Order{}, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: requestID}
			}
		}
	}
	return Order{ID: value.ID, ClientOrderID: value.ClientOrderID, AssetID: value.AssetID, Symbol: value.Symbol, Side: value.Side, Qty: value.Qty, FilledQty: value.FilledQty, Type: value.Type, LimitPrice: limitPrice, TimeInForce: value.TimeInForce, ExtendedHours: value.ExtendedHours, Status: value.Status, SubmittedAt: value.SubmittedAt}, nil
}

func (a *Alpaca) Orders(ctx context.Context, owner string, resolver AccountResolver) ([]Order, string, error) {
	account, err := a.resolveAccount(ctx, owner, resolver)
	if err != nil {
		return nil, "", err
	}
	orders := make([]Order, 0, 500)
	seen := map[string]bool{}
	requestIDs := make([]string, 0, 4)
	after := ""
	for page := 0; page < 100; page++ {
		path := "/v1/trading/accounts/" + account + "/orders?status=all&limit=500&direction=asc"
		if after != "" {
			path += "&after=" + url.QueryEscape(after)
		}
		var raw []providerOrder
		id, getErr := a.get(ctx, path, &raw)
		if getErr != nil {
			return nil, strings.Join(requestIDs, ","), getErr
		}
		requestIDs = append(requestIDs, id)
		if raw == nil {
			return nil, strings.Join(requestIDs, ","), &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
		}
		for _, value := range raw {
			if seen[value.ID] {
				return nil, strings.Join(requestIDs, ","), &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
			}
			order, normalizeErr := normalizeProviderOrder(value, id)
			if normalizeErr != nil {
				return nil, strings.Join(requestIDs, ","), normalizeErr
			}
			seen[value.ID] = true
			orders = append(orders, order)
		}
		if len(raw) < 500 {
			return orders, strings.Join(requestIDs, ","), nil
		}
		next := raw[len(raw)-1].SubmittedAt
		if next == "" || next == after {
			return nil, strings.Join(requestIDs, ","), &Error{Code: "ORDER_PAGINATION_AMBIGUOUS", RequestID: id}
		}
		after = next
	}
	return nil, strings.Join(requestIDs, ","), &Error{Code: "ORDER_PAGINATION_LIMIT"}
}

func (a *Alpaca) Positions(ctx context.Context, owner string, resolver AccountResolver) ([]Position, string, error) {
	account, err := a.resolveAccount(ctx, owner, resolver)
	if err != nil {
		return nil, "", err
	}
	var raw []struct {
		AssetID      string `json:"asset_id"`
		Symbol       string `json:"symbol"`
		Qty          string `json:"qty"`
		AvailableQty string `json:"qty_available"`
		AveragePrice string `json:"avg_entry_price"`
		MarketValue  string `json:"market_value"`
	}
	id, err := a.get(ctx, "/v1/trading/accounts/"+account+"/positions", &raw)
	if err != nil {
		return nil, id, err
	}
	positions := make([]Position, 0, len(raw))
	seen := map[string]bool{}
	for _, value := range raw {
		if !uuid.MatchString(value.AssetID) || seen[value.AssetID] || value.Symbol == "" || !providerDecimal.MatchString(value.Qty) || !providerDecimal.MatchString(value.AvailableQty) || !providerDecimal.MatchString(value.AveragePrice) || !providerDecimal.MatchString(value.MarketValue) {
			return nil, id, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
		}
		seen[value.AssetID] = true
		positions = append(positions, Position{value.AssetID, value.Symbol, value.Qty, value.AvailableQty, value.AveragePrice, value.MarketValue})
	}
	return positions, id, nil
}

func (a *Alpaca) Reconcile(ctx context.Context, owner string, resolver AccountResolver) (AccountSnapshot, error) {
	account, err := a.Account(ctx, owner, resolver)
	if err != nil {
		return AccountSnapshot{}, err
	}
	orders, orderID, err := a.Orders(ctx, owner, resolver)
	if err != nil {
		return AccountSnapshot{}, err
	}
	positions, positionID, err := a.Positions(ctx, owner, resolver)
	if err != nil {
		return AccountSnapshot{}, err
	}
	return AccountSnapshot{Provider: Provider, Environment: "sandbox", RequestIDs: []string{account.RequestID, orderID, positionID}, Account: account, Orders: orders, Positions: positions}, nil
}

func (a *Alpaca) SubmitOrder(ctx context.Context, owner string, resolver AccountResolver, order SubmitOrderRequest) (Order, error) {
	if !a.cfg.writeReady() {
		return Order{}, &Error{Code: "ORDER_SUBMISSION_DISABLED"}
	}
	account, err := a.resolveAccount(ctx, owner, resolver)
	if err != nil {
		return Order{}, err
	}
	if !uuid.MatchString(order.ClientOrderID) || !uuid.MatchString(order.AssetID) || order.Symbol == "" || len(order.Symbol) > 32 || (order.Side != "buy" && order.Side != "sell") || !providerDecimal.MatchString(order.Qty) || order.Type != "limit" || !providerDecimal.MatchString(order.LimitPrice) || order.TimeInForce != "day" || order.ExtendedHours {
		return Order{}, &Error{Code: "ORDER_REQUEST_INVALID"}
	}
	payload, err := json.Marshal(order)
	if err != nil || len(payload) > 4096 {
		return Order{}, &Error{Code: "ORDER_REQUEST_INVALID"}
	}
	request, _ := http.NewRequest(http.MethodPost, BrokerOrigin+"/v1/trading/accounts/"+account+"/orders", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	if err := a.authorize(ctx, request); err != nil {
		return Order{}, err
	}
	var raw providerOrder
	requestID, err := a.exchangeStatus(ctx, request, &raw, http.StatusOK, http.StatusCreated)
	if err != nil {
		return Order{}, err
	}
	result, err := normalizeProviderOrder(raw, requestID)
	if err != nil || result.ClientOrderID != order.ClientOrderID || result.AssetID != order.AssetID || result.Symbol != order.Symbol || result.Side != order.Side || result.Qty != order.Qty || result.Type != order.Type || result.LimitPrice != order.LimitPrice || result.TimeInForce != order.TimeInForce || result.ExtendedHours != order.ExtendedHours {
		return Order{}, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: requestID}
	}
	return result, nil
}
func (a *Alpaca) CancelOrder(ctx context.Context, owner string, resolver AccountResolver, orderID string) error {
	if !a.cfg.writeReady() {
		return &Error{Code: "ORDER_CANCELLATION_DISABLED"}
	}
	account, err := a.resolveAccount(ctx, owner, resolver)
	if err != nil {
		return err
	}
	if !uuid.MatchString(orderID) {
		return &Error{Code: "ORDER_REQUEST_INVALID"}
	}
	request, _ := http.NewRequest(http.MethodDelete, BrokerOrigin+"/v1/trading/accounts/"+account+"/orders/"+orderID, nil)
	if err := a.authorize(ctx, request); err != nil {
		return err
	}
	request = request.WithContext(ctx)
	request.Header.Set("Accept", "application/json")
	response, err := a.client.Do(request)
	if err != nil {
		return &Error{Code: "PROVIDER_UNAVAILABLE"}
	}
	defer response.Body.Close()
	requestID := response.Header.Get("X-Request-ID")
	if !auditID.MatchString(requestID) {
		requestID = ""
	}
	if response.StatusCode != http.StatusNoContent {
		return &Error{Code: "PROVIDER_REJECTED", RequestID: requestID, HTTPStatus: response.StatusCode}
	}
	if data, readErr := io.ReadAll(io.LimitReader(response.Body, 2)); readErr != nil || len(data) != 0 {
		return &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: requestID}
	}
	return nil
}
func ErrorCode(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return "BROKER_CHECK_FAILED"
}
