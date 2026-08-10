package exchangeproduct

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

const QuantAdapterVersion = "ynx-quant-execution-adapter-v1"

type QuantCapability struct {
	Name    string `json:"name"`
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason"`
}

type QuantMandate struct {
	Subaccount      string    `json:"subaccount"`
	Market          string    `json:"market"`
	Methods         []string  `json:"methods"`
	CapitalMicro    int64     `json:"capitalMicro"`
	Leverage        int64     `json:"leverage"`
	ExpiresAt       time.Time `json:"expiresAt"`
	NonceDomain     string    `json:"nonceDomain"`
	WalletSignature string    `json:"walletSignature"`
}

type QuantSource struct {
	Source   string    `json:"source"`
	AsOf     time.Time `json:"asOf"`
	Version  string    `json:"version"`
	Coverage string    `json:"coverage"`
	Status   string    `json:"status"`
}

type QuantAccountState struct {
	Balances  []Balance   `json:"balances"`
	Positions []any       `json:"positions"`
	Orders    []Order     `json:"openOrders"`
	Fills     []Trade     `json:"fills"`
	Fees      []FeeRecord `json:"fees"`
	Source    QuantSource `json:"source"`
}

type QuantReconciliation struct {
	Subaccount     string      `json:"subaccount"`
	NonceDomain    string      `json:"nonceDomain"`
	StrategyStatus string      `json:"strategyStatus"`
	CapitalMicro   int64       `json:"capitalMicro"`
	ExposureMicro  int64       `json:"exposureMicro"`
	Sequence       int64       `json:"sequence"`
	SnapshotHash   string      `json:"snapshotHash"`
	OpenOrderIDs   []string    `json:"openOrderIds"`
	LastTradeID    string      `json:"lastTradeId,omitempty"`
	Source         QuantSource `json:"source"`
}

type QuantStrategyKill struct {
	Subaccount          string    `json:"subaccount"`
	Market              string    `json:"market"`
	NonceDomain         string    `json:"nonceDomain"`
	Status              string    `json:"status"`
	AuthorizationDigest string    `json:"authorizationDigest"`
	KilledAt            time.Time `json:"killedAt"`
}

type QuantControlResult struct {
	Subaccount  string       `json:"subaccount"`
	Market      string       `json:"market"`
	NonceDomain string       `json:"nonceDomain"`
	Status      string       `json:"status"`
	Cancelled   CancelResult `json:"cancelled"`
	Source      QuantSource  `json:"source"`
}

type QuantExecutionAdapter struct {
	service *Service
}

func NewQuantExecutionAdapter(service *Service) *QuantExecutionAdapter {
	return &QuantExecutionAdapter{service: service}
}

func QuantCapabilities() []QuantCapability {
	return []QuantCapability{
		{Name: "markets", Allowed: true, Reason: "authoritative Exchange market registry"},
		{Name: "balances", Allowed: true, Reason: "mandated subaccount only"},
		{Name: "positions", Allowed: true, Reason: "Spot returns an explicit empty position set"},
		{Name: "open_orders", Allowed: true, Reason: "mandated subaccount only"},
		{Name: "order_book", Allowed: true, Reason: "native deterministic CLOB"},
		{Name: "trades_and_fills", Allowed: true, Reason: "persisted actual matches only"},
		{Name: "market_stream", Allowed: true, Reason: "persisted hash-chained sequence with WebSocket snapshot/replay"},
		{Name: "user_stream", Allowed: true, Reason: "Gateway-authenticated account-filtered WebSocket"},
		{Name: "drop_copy", Allowed: true, Reason: "Gateway-authenticated account execution stream"},
		{Name: "submit", Allowed: true, Reason: "separate Wallet action signature and mandate limits required"},
		{Name: "cancel", Allowed: true, Reason: "separate Wallet action signature required"},
		{Name: "mass_cancel", Allowed: true, Reason: "separate Wallet action signature required"},
		{Name: "pause_strategy", Allowed: true, Reason: "wallet-signed persistent pause atomically cancels open execution and blocks new exposure"},
		{Name: "resume_strategy", Allowed: true, Reason: "separate wallet-signed resume; killed nonce domains remain permanently revoked"},
		{Name: "kill_strategy", Allowed: true, Reason: "wallet-signed persistent nonce-domain revocation plus atomic subaccount mass cancel"},
		{Name: "reconcile", Allowed: true, Reason: "sequenced authoritative snapshot"},
		{Name: "amend", Allowed: true, Reason: "atomic repricing/resizing with lost time priority and a separate Wallet signature"},
		{Name: "set_leverage", Allowed: false, Reason: "Spot market is fixed at 1x"},
		{Name: "tp_sl", Allowed: true, Reason: "native actual-trade-triggered Stop/Take-Profit with separate Wallet signature"},
		{Name: "twap", Allowed: true, Reason: "persisted IOC slice schedule with fixed signed price protection and separate Wallet signatures"},
		{Name: "iceberg", Allowed: true, Reason: "native hidden remainder with deterministic display replenishment and separate Wallet signature"},
		{Name: "scale", Allowed: true, Reason: "atomic deterministic price levels with aggregate mandate-capital enforcement"},
		{Name: "withdraw", Allowed: false, Reason: "forbidden to Quant adapters"},
		{Name: "owner_change", Allowed: false, Reason: "forbidden to Quant adapters"},
		{Name: "withdrawal_address", Allowed: false, Reason: "forbidden to Quant adapters"},
		{Name: "unapproved_transfer", Allowed: false, Reason: "forbidden to Quant adapters"},
		{Name: "risk_override", Allowed: false, Reason: "forbidden to Quant adapters"},
		{Name: "api_key_export", Allowed: false, Reason: "forbidden to Quant adapters"},
	}
}

func QuantMandatePayload(m QuantMandate) []byte {
	methods := append([]string(nil), m.Methods...)
	for i := range methods {
		methods[i] = strings.ToLower(strings.TrimSpace(methods[i]))
	}
	sort.Strings(methods)
	return []byte(fmt.Sprintf("%s\n%s\n%s\n%s\n%d\n%d\n%s\n%s", QuantAdapterVersion, m.Subaccount, m.Market, strings.Join(methods, ","), m.CapitalMicro, m.Leverage, m.ExpiresAt.UTC().Format(time.RFC3339), m.NonceDomain))
}

func QuantKillAuthorizationPayload(account, market, nonceDomain, key string) []byte {
	return []byte(fmt.Sprintf("ynx-quant-strategy-kill-v1\n%s\n%s\n%s\n%s", account, strings.ToUpper(strings.TrimSpace(market)), strings.TrimSpace(nonceDomain), key))
}

func QuantControlAuthorizationPayload(account, market, nonceDomain, action, key string) []byte {
	return []byte(fmt.Sprintf("ynx-quant-strategy-control-v1\n%s\n%s\n%s\n%s\n%s", account, strings.ToUpper(strings.TrimSpace(market)), strings.TrimSpace(nonceDomain), strings.ToLower(strings.TrimSpace(action)), key))
}

func quantStrategyKey(account, nonceDomain string) string {
	return account + "\x00" + strings.TrimSpace(nonceDomain)
}

func (s *Service) quantStrategyKilledLocked(account, nonceDomain string) bool {
	return s.quantStrategyStatusLocked(account, nonceDomain) == "killed"
}

func (s *Service) quantStrategyStatusLocked(account, nonceDomain string) string {
	if strings.TrimSpace(nonceDomain) == "" {
		return "active"
	}
	state, ok := s.state.QuantStrategyKills[quantStrategyKey(account, nonceDomain)]
	if !ok || (state.Status != "paused" && state.Status != "killed") {
		return "active"
	}
	return state.Status
}

func (s *Service) quantCapitalAllowsLocked(account, nonceDomain string, capitalMicro, proposedMicro int64, excludeOrderID string) bool {
	if strings.TrimSpace(nonceDomain) == "" {
		return true
	}
	if capitalMicro <= 0 || proposedMicro <= 0 || proposedMicro > capitalMicro {
		return false
	}
	current := s.quantExposureMicroLocked(account, nonceDomain, excludeOrderID)
	return current <= capitalMicro-proposedMicro
}

func (s *Service) quantExposureMicroLocked(account, nonceDomain, excludeOrderID string) int64 {
	if strings.TrimSpace(nonceDomain) == "" {
		return 0
	}
	const maxInt64 = int64(^uint64(0) >> 1)
	total := int64(0)
	add := func(value int64) {
		if value <= 0 || total == maxInt64 {
			return
		}
		if value > maxInt64-total {
			total = maxInt64
			return
		}
		total += value
	}
	orderExposure := func(order Order) int64 {
		remaining := order.AmountMicro - order.FilledMicro
		if remaining <= 0 {
			return 0
		}
		return mulDiv(order.PriceMicro, remaining, AmountScale)
	}
	for _, order := range s.state.Orders {
		if order.ID == excludeOrderID || order.Account != account || order.QuantNonceDomain != nonceDomain || order.ParentOrderID != "" || !isOpenOrder(order) {
			continue
		}
		add(orderExposure(order))
	}
	for _, order := range s.state.ConditionalOrders {
		if order.Account != account || order.QuantNonceDomain != nonceDomain || order.GroupID != "" || order.Status != "pending_trigger" {
			continue
		}
		add(mulDiv(order.LimitPriceMicro, order.AmountMicro, AmountScale))
	}
	for _, group := range s.state.OCOGroups {
		if group.Account != account || group.QuantNonceDomain != nonceDomain || group.Status != "pending_trigger" {
			continue
		}
		maxPrice := int64(0)
		if child, ok := s.state.ConditionalOrders[group.StopConditionalID]; ok && child.LimitPriceMicro > maxPrice {
			maxPrice = child.LimitPriceMicro
		}
		if child, ok := s.state.ConditionalOrders[group.TakeProfitConditionalID]; ok && child.LimitPriceMicro > maxPrice {
			maxPrice = child.LimitPriceMicro
		}
		add(mulDiv(maxPrice, group.AmountMicro, AmountScale))
	}
	for _, twap := range s.state.TWAPOrders {
		if twap.Account != account || twap.QuantNonceDomain != nonceDomain || twap.Status != "scheduled" {
			continue
		}
		remaining := twap.TotalAmountMicro - twap.ScheduledMicro
		add(mulDiv(twap.LimitPriceMicro, remaining, AmountScale))
	}
	for _, scale := range s.state.ScaleOrders {
		if scale.Account != account || scale.QuantNonceDomain != nonceDomain || (scale.Status != "open" && scale.Status != "partially_filled") {
			continue
		}
		for _, childID := range scale.ChildOrderIDs {
			child, ok := s.state.Orders[childID]
			if !ok || child.ID == excludeOrderID || !isOpenOrder(child) {
				continue
			}
			add(orderExposure(child))
		}
	}
	return total
}

func (a *QuantExecutionAdapter) validate(session WalletSession, mandate QuantMandate, method string) error {
	if a == nil || a.service == nil {
		return ErrUnavailable
	}
	mandate.Subaccount = strings.TrimSpace(mandate.Subaccount)
	mandate.Market = strings.ToUpper(strings.TrimSpace(mandate.Market))
	mandate.NonceDomain = strings.TrimSpace(mandate.NonceDomain)
	if mandate.Subaccount != session.Account || mandate.Market != DefaultMarket || mandate.CapitalMicro <= 0 || mandate.Leverage != 1 || !a.service.cfg.Now().Before(mandate.ExpiresAt) || mandate.ExpiresAt.After(a.service.cfg.Now().Add(24*time.Hour)) || !strings.HasPrefix(mandate.NonceDomain, "quant:") || len(mandate.NonceDomain) > 128 {
		return ErrForbidden
	}
	allowed := false
	seen := map[string]bool{}
	for _, item := range mandate.Methods {
		item = strings.ToLower(strings.TrimSpace(item))
		if seen[item] || !quantMethodAllowed(item) {
			return ErrForbidden
		}
		seen[item] = true
		if item == method {
			allowed = true
		}
	}
	if !allowed || !verifyWalletSignature(session.Account, session.WalletPublicKey, QuantMandatePayload(mandate), mandate.WalletSignature) {
		return ErrForbidden
	}
	if quantMethodCreatesExposure(method) {
		a.service.mu.Lock()
		status := a.service.quantStrategyStatusLocked(session.Account, mandate.NonceDomain)
		a.service.mu.Unlock()
		if status != "active" {
			return ErrForbidden
		}
	}
	return nil
}

func quantMethodCreatesExposure(method string) bool {
	return method == "submit" || method == "amend" || method == "tp_sl" || method == "twap" || method == "iceberg" || method == "scale"
}

func quantMethodAllowed(method string) bool {
	switch method {
	case "read", "submit", "amend", "tp_sl", "twap", "iceberg", "scale", "cancel", "mass_cancel", "control", "kill", "reconcile":
		return true
	default:
		return false
	}
}

func (a *QuantExecutionAdapter) Markets() ([]Market, QuantSource) {
	return Markets(), a.source("complete", "available")
}

func (a *QuantExecutionAdapter) Account(session WalletSession, mandate QuantMandate) (QuantAccountState, error) {
	if err := a.validate(session, mandate, "read"); err != nil {
		return QuantAccountState{}, err
	}
	snapshot := a.service.Snapshot(session.Account)
	open := make([]Order, 0)
	for _, order := range snapshot.Orders {
		if order.Status == "open" || order.Status == "partially_filled" {
			open = append(open, order)
		}
	}
	return QuantAccountState{Balances: snapshot.Balances, Positions: []any{}, Orders: open, Fills: snapshot.Trades, Fees: snapshot.Fees, Source: a.source("spot balances/orders/fills; positions not applicable", "available")}, nil
}

func (a *QuantExecutionAdapter) OrderBook(session WalletSession, mandate QuantMandate) (OrderBook, QuantSource, error) {
	if err := a.validate(session, mandate, "read"); err != nil {
		return OrderBook{}, QuantSource{}, err
	}
	return a.service.Book(), a.source("complete native open-order state", "available"), nil
}

func (a *QuantExecutionAdapter) Submit(session WalletSession, mandate QuantMandate, req PlaceOrderRequest) (Order, error) {
	if err := a.validate(session, mandate, "submit"); err != nil {
		return Order{}, err
	}
	if strings.ToUpper(strings.TrimSpace(req.Market)) != strings.ToUpper(strings.TrimSpace(mandate.Market)) || mulDiv(req.PriceMicro, req.AmountMicro, AmountScale) > mandate.CapitalMicro {
		return Order{}, ErrForbidden
	}
	req.QuantNonceDomain = mandate.NonceDomain
	req.QuantCapitalMicro = mandate.CapitalMicro
	return a.service.PlaceOrder(session, req)
}

func (a *QuantExecutionAdapter) Cancel(session WalletSession, mandate QuantMandate, orderID, key, walletSignature string) (Order, error) {
	if err := a.validate(session, mandate, "cancel"); err != nil {
		return Order{}, err
	}
	return a.service.CancelOrder(session, orderID, key, walletSignature)
}

func (a *QuantExecutionAdapter) Amend(session WalletSession, mandate QuantMandate, orderID string, req AmendOrderRequest) (Order, error) {
	if err := a.validate(session, mandate, "amend"); err != nil {
		return Order{}, err
	}
	if mulDiv(req.PriceMicro, req.AmountMicro, AmountScale) > mandate.CapitalMicro {
		return Order{}, ErrForbidden
	}
	req.QuantNonceDomain = mandate.NonceDomain
	req.QuantCapitalMicro = mandate.CapitalMicro
	return a.service.AmendOrder(session, orderID, req)
}

func (a *QuantExecutionAdapter) SubmitConditional(session WalletSession, mandate QuantMandate, req ConditionalOrderRequest) (ConditionalOrder, error) {
	if err := a.validate(session, mandate, "tp_sl"); err != nil {
		return ConditionalOrder{}, err
	}
	if strings.ToUpper(strings.TrimSpace(req.Market)) != strings.ToUpper(strings.TrimSpace(mandate.Market)) || mulDiv(req.LimitPriceMicro, req.AmountMicro, AmountScale) > mandate.CapitalMicro {
		return ConditionalOrder{}, ErrForbidden
	}
	req.QuantNonceDomain = mandate.NonceDomain
	req.QuantCapitalMicro = mandate.CapitalMicro
	return a.service.CreateConditionalOrder(session, req)
}

func (a *QuantExecutionAdapter) CancelConditional(session WalletSession, mandate QuantMandate, conditionalID, key, walletSignature string) (ConditionalOrder, error) {
	if err := a.validate(session, mandate, "cancel"); err != nil {
		return ConditionalOrder{}, err
	}
	return a.service.CancelConditionalOrder(session, conditionalID, key, walletSignature)
}

func (a *QuantExecutionAdapter) SubmitOCO(session WalletSession, mandate QuantMandate, req OCORequest) (OCOGroup, error) {
	if err := a.validate(session, mandate, "tp_sl"); err != nil {
		return OCOGroup{}, err
	}
	maxLimit := req.StopLimitPriceMicro
	if req.TakeProfitLimitMicro > maxLimit {
		maxLimit = req.TakeProfitLimitMicro
	}
	if strings.ToUpper(strings.TrimSpace(req.Market)) != strings.ToUpper(strings.TrimSpace(mandate.Market)) || mulDiv(maxLimit, req.AmountMicro, AmountScale) > mandate.CapitalMicro {
		return OCOGroup{}, ErrForbidden
	}
	req.QuantNonceDomain = mandate.NonceDomain
	req.QuantCapitalMicro = mandate.CapitalMicro
	return a.service.CreateOCO(session, req)
}

func (a *QuantExecutionAdapter) SubmitTWAP(session WalletSession, mandate QuantMandate, req TWAPRequest) (TWAPOrder, error) {
	if err := a.validate(session, mandate, "twap"); err != nil {
		return TWAPOrder{}, err
	}
	if strings.ToUpper(strings.TrimSpace(req.Market)) != strings.ToUpper(strings.TrimSpace(mandate.Market)) || mulDiv(req.LimitPriceMicro, req.TotalAmountMicro, AmountScale) > mandate.CapitalMicro {
		return TWAPOrder{}, ErrForbidden
	}
	req.QuantNonceDomain = mandate.NonceDomain
	req.QuantCapitalMicro = mandate.CapitalMicro
	return a.service.CreateTWAP(session, req)
}

func (a *QuantExecutionAdapter) CancelTWAP(session WalletSession, mandate QuantMandate, twapID, key, walletSignature string) (TWAPOrder, error) {
	if err := a.validate(session, mandate, "cancel"); err != nil {
		return TWAPOrder{}, err
	}
	return a.service.CancelTWAP(session, twapID, key, walletSignature)
}

func (a *QuantExecutionAdapter) SubmitIceberg(session WalletSession, mandate QuantMandate, req IcebergRequest) (Order, error) {
	if err := a.validate(session, mandate, "iceberg"); err != nil {
		return Order{}, err
	}
	if strings.ToUpper(strings.TrimSpace(req.Market)) != strings.ToUpper(strings.TrimSpace(mandate.Market)) || mulDiv(req.PriceMicro, req.TotalAmountMicro, AmountScale) > mandate.CapitalMicro {
		return Order{}, ErrForbidden
	}
	req.QuantNonceDomain = mandate.NonceDomain
	req.QuantCapitalMicro = mandate.CapitalMicro
	return a.service.CreateIceberg(session, req)
}

func (a *QuantExecutionAdapter) SubmitScale(session WalletSession, mandate QuantMandate, req ScaleRequest) (ScaleOrder, error) {
	if err := a.validate(session, mandate, "scale"); err != nil {
		return ScaleOrder{}, err
	}
	if strings.ToUpper(strings.TrimSpace(req.Market)) != strings.ToUpper(strings.TrimSpace(mandate.Market)) || req.Levels < 2 {
		return ScaleOrder{}, ErrForbidden
	}
	base := req.TotalAmountMicro / int64(req.Levels)
	var notional int64
	for i := 0; i < req.Levels; i++ {
		amount := base
		if i == req.Levels-1 {
			amount = req.TotalAmountMicro - base*int64(req.Levels-1)
		}
		price := req.StartPriceMicro + (req.EndPriceMicro-req.StartPriceMicro)*int64(i)/int64(req.Levels-1)
		notional += mulDiv(price, amount, AmountScale)
	}
	if notional <= 0 || notional > mandate.CapitalMicro {
		return ScaleOrder{}, ErrForbidden
	}
	req.QuantNonceDomain = mandate.NonceDomain
	req.QuantCapitalMicro = mandate.CapitalMicro
	return a.service.CreateScale(session, req)
}

func (a *QuantExecutionAdapter) CancelScale(session WalletSession, mandate QuantMandate, scaleID, key, walletSignature string) (ScaleOrder, error) {
	if err := a.validate(session, mandate, "cancel"); err != nil {
		return ScaleOrder{}, err
	}
	return a.service.CancelScale(session, scaleID, key, walletSignature)
}

func (a *QuantExecutionAdapter) MassCancel(session WalletSession, mandate QuantMandate, key, walletSignature string) (CancelResult, error) {
	if err := a.validate(session, mandate, "mass_cancel"); err != nil {
		return CancelResult{}, err
	}
	return a.service.MassCancel(session, mandate.Market, key, walletSignature)
}

func (a *QuantExecutionAdapter) Kill(session WalletSession, mandate QuantMandate, key, walletSignature string) (CancelResult, error) {
	if err := a.validate(session, mandate, "kill"); err != nil {
		return CancelResult{}, err
	}
	market := strings.ToUpper(strings.TrimSpace(mandate.Market))
	if market != DefaultMarket || !validKey(key) {
		return CancelResult{}, ErrInvalid
	}
	payload := QuantKillAuthorizationPayload(session.Account, market, mandate.NonceDomain, key)
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, payload, walletSignature) {
		return CancelResult{}, ErrUnauthorized
	}
	a.service.mu.Lock()
	defer a.service.mu.Unlock()
	d := digest(payload)
	postMutation := func() {
		killed := QuantStrategyKill{Subaccount: session.Account, Market: market, NonceDomain: mandate.NonceDomain, Status: "killed", AuthorizationDigest: d, KilledAt: a.service.cfg.Now().UTC()}
		a.service.state.QuantStrategyKills[quantStrategyKey(session.Account, mandate.NonceDomain)] = killed
		a.service.emitExecutionLocked("user", "quant_strategy_killed", session.Account, "quant_strategy", mandate.NonceDomain, killed)
		a.service.auditLocked(session.Account, "quant_strategy_killed", "quant_strategy", mandate.NonceDomain, d)
	}
	return a.service.massCancelLocked(session, market, key, "quant_strategy_kill", d, postMutation)
}

func (a *QuantExecutionAdapter) Control(session WalletSession, mandate QuantMandate, action, key, walletSignature string) (QuantControlResult, error) {
	if err := a.validate(session, mandate, "control"); err != nil {
		return QuantControlResult{}, err
	}
	action = strings.ToLower(strings.TrimSpace(action))
	market := strings.ToUpper(strings.TrimSpace(mandate.Market))
	if (action != "pause" && action != "resume") || market != DefaultMarket || !validKey(key) {
		return QuantControlResult{}, ErrInvalid
	}
	payload := QuantControlAuthorizationPayload(session.Account, market, mandate.NonceDomain, action, key)
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, payload, walletSignature) {
		return QuantControlResult{}, ErrUnauthorized
	}
	d := digest(payload)
	if action == "pause" {
		a.service.mu.Lock()
		defer a.service.mu.Unlock()
		if prior, ok := a.service.state.Idempotency[key]; ok {
			if prior.Action != "quant_strategy_pause" || prior.Digest != d {
				return QuantControlResult{}, ErrConflict
			}
			cancelled, err := a.service.massCancelLocked(session, market, key, "quant_strategy_pause", d, nil)
			if err != nil {
				return QuantControlResult{}, err
			}
			return QuantControlResult{Subaccount: session.Account, Market: market, NonceDomain: mandate.NonceDomain, Status: "paused", Cancelled: cancelled, Source: a.source("authoritative persisted strategy control", "available")}, nil
		}
		if a.service.quantStrategyStatusLocked(session.Account, mandate.NonceDomain) != "active" {
			return QuantControlResult{}, ErrConflict
		}
		cancelled, err := a.service.massCancelLocked(session, market, key, "quant_strategy_pause", d, func() {
			state := QuantStrategyKill{Subaccount: session.Account, Market: market, NonceDomain: mandate.NonceDomain, Status: "paused", AuthorizationDigest: d, KilledAt: a.service.cfg.Now().UTC()}
			a.service.state.QuantStrategyKills[quantStrategyKey(session.Account, mandate.NonceDomain)] = state
			a.service.emitExecutionLocked("user", "quant_strategy_paused", session.Account, "quant_strategy", mandate.NonceDomain, state)
			a.service.auditLocked(session.Account, "quant_strategy_paused", "quant_strategy", mandate.NonceDomain, d)
		})
		if err != nil {
			return QuantControlResult{}, err
		}
		return QuantControlResult{Subaccount: session.Account, Market: market, NonceDomain: mandate.NonceDomain, Status: "paused", Cancelled: cancelled, Source: a.source("authoritative persisted strategy control", "available")}, nil
	}

	a.service.mu.Lock()
	defer a.service.mu.Unlock()
	if prior, ok := a.service.state.Idempotency[key]; ok {
		if prior.Action != "quant_strategy_resume" || prior.Digest != d || prior.ObjectID != mandate.NonceDomain {
			return QuantControlResult{}, ErrConflict
		}
		return QuantControlResult{Subaccount: session.Account, Market: market, NonceDomain: mandate.NonceDomain, Status: "active", Source: a.source("authoritative persisted strategy control", "available")}, nil
	}
	current, ok := a.service.state.QuantStrategyKills[quantStrategyKey(session.Account, mandate.NonceDomain)]
	if !ok || current.Status != "paused" {
		return QuantControlResult{}, ErrConflict
	}
	before := cloneState(a.service.state)
	current.Status = "active"
	current.AuthorizationDigest = d
	current.KilledAt = a.service.cfg.Now().UTC()
	a.service.state.QuantStrategyKills[quantStrategyKey(session.Account, mandate.NonceDomain)] = current
	a.service.state.Idempotency[key] = idempotencyRecord{Action: "quant_strategy_resume", Digest: d, ObjectID: mandate.NonceDomain}
	a.service.emitExecutionLocked("user", "quant_strategy_resumed", session.Account, "quant_strategy", mandate.NonceDomain, current)
	a.service.auditLocked(session.Account, "quant_strategy_resumed", "quant_strategy", mandate.NonceDomain, d)
	if err := a.service.saveOrRollbackLocked(before); err != nil {
		return QuantControlResult{}, err
	}
	return QuantControlResult{Subaccount: session.Account, Market: market, NonceDomain: mandate.NonceDomain, Status: "active", Source: a.source("authoritative persisted strategy control", "available")}, nil
}

func (a *QuantExecutionAdapter) Reconcile(session WalletSession, mandate QuantMandate) (QuantReconciliation, error) {
	if err := a.validate(session, mandate, "reconcile"); err != nil {
		return QuantReconciliation{}, err
	}
	a.service.mu.Lock()
	defer a.service.mu.Unlock()
	open := make([]string, 0)
	lastTrade := ""
	for _, order := range a.service.state.Orders {
		if order.Account == session.Account && order.QuantNonceDomain == mandate.NonceDomain && (order.Status == "open" || order.Status == "partially_filled") {
			open = append(open, order.ID)
		}
	}
	sort.Strings(open)
	for _, trade := range a.service.state.Trades {
		if trade.Buyer == session.Account || trade.Seller == session.Account {
			lastTrade = trade.ID
		}
	}
	strategyStatus := a.service.quantStrategyStatusLocked(session.Account, mandate.NonceDomain)
	exposure := a.service.quantExposureMicroLocked(session.Account, mandate.NonceDomain, "")
	payload := struct {
		Subaccount     string
		NonceDomain    string
		StrategyStatus string
		CapitalMicro   int64
		ExposureMicro  int64
		Sequence       int64
		Open           []string
		LastTrade      string
	}{session.Account, mandate.NonceDomain, strategyStatus, mandate.CapitalMicro, exposure, a.service.state.EventSequence, open, lastTrade}
	return QuantReconciliation{Subaccount: session.Account, NonceDomain: mandate.NonceDomain, StrategyStatus: strategyStatus, CapitalMicro: mandate.CapitalMicro, ExposureMicro: exposure, Sequence: a.service.state.EventSequence, SnapshotHash: digest(payload), OpenOrderIDs: open, LastTradeID: lastTrade, Source: a.source("authoritative persisted strategy state, exposure, open-order IDs, subaccount trade cursor and execution sequence", "available")}, nil
}

func (a *QuantExecutionAdapter) source(coverage, status string) QuantSource {
	now := time.Now().UTC()
	if a != nil && a.service != nil && a.service.cfg.Now != nil {
		now = a.service.cfg.Now().UTC()
	}
	return QuantSource{Source: ProductID, AsOf: now, Version: QuantAdapterVersion, Coverage: coverage, Status: status}
}
