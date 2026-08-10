package exchangeproduct

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

func MarginTransferAuthorizationPayload(account string, req MarginTransferRequest) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-margin-transfer-v1\n%s\n%s\n%d\n%s", account, strings.ToLower(strings.TrimSpace(req.Direction)), req.AmountMicro, req.IdempotencyKey))
}

func PerpetualOrderAuthorizationPayload(account string, req PlacePerpetualOrderRequest) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-perpetual-order-v1\n%s\n%s\n%s\n%s\n%s\n%d\n%d\n%d\n%t\n%s", account, strings.ToUpper(strings.TrimSpace(req.Market)), strings.ToLower(strings.TrimSpace(req.Side)), strings.ToLower(strings.TrimSpace(req.Type)), strings.ToLower(strings.TrimSpace(req.TimeInForce)), req.PriceMicro, req.AmountMicro, req.Leverage, req.ReduceOnly, req.IdempotencyKey))
}

func PerpetualCancelAuthorizationPayload(account, orderID, key string) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-perpetual-cancel-v1\n%s\n%s\n%s", account, orderID, key))
}

func marginAccountKey(account string) string             { return account }
func perpetualPositionKey(account, market string) string { return account + "|" + market }

func (s *Service) marginAccountLocked(account string) MarginAccount {
	value, ok := s.state.MarginAccounts[marginAccountKey(account)]
	if !ok {
		value = MarginAccount{Account: account, Mode: "isolated", Status: "active"}
	}
	return value
}

func (s *Service) marginEquityLocked(account string) (equity, free int64) {
	margin := s.marginAccountLocked(account)
	// Collateral is the live settled balance. Realized PnL, funding and
	// liquidation fees are cumulative reporting fields and must not be counted
	// a second time after they have changed collateral.
	equity = margin.CollateralMicro
	for _, position := range s.state.PerpetualPositions {
		if position.Account == account && position.Status == "open" {
			equity += position.UnrealizedPnLMicro
		}
	}
	free = equity - margin.OrderMarginMicro - margin.PositionMarginMicro
	return equity, free
}

func (s *Service) TransferMarginCollateral(session WalletSession, req MarginTransferRequest) (MarginAccountSnapshot, error) {
	req.Direction = strings.ToLower(strings.TrimSpace(req.Direction))
	if (req.Direction != "deposit" && req.Direction != "withdraw") || req.AmountMicro <= 0 || req.AmountMicro > 1_000_000*AmountScale || !validKey(req.IdempotencyKey) {
		return MarginAccountSnapshot{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, MarginTransferAuthorizationPayload(session.Account, req), req.WalletSignature) {
		return MarginAccountSnapshot{}, ErrUnauthorized
	}
	d := digest(struct {
		Account   string
		Direction string
		Amount    int64
	}{session.Account, req.Direction, req.AmountMicro})
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "margin_"+req.Direction || previous.Digest != d || previous.ObjectID != session.Account {
			return MarginAccountSnapshot{}, ErrConflict
		}
		return s.marginSnapshotLocked(session.Account), nil
	}
	margin := s.marginAccountLocked(session.Account)
	balance := s.balanceLocked(session.Account, QuoteAsset)
	if req.Direction == "deposit" {
		if balance.AvailableMicro < req.AmountMicro {
			return MarginAccountSnapshot{}, ErrInsufficient
		}
		balance.AvailableMicro -= req.AmountMicro
		balance.ReservedMicro += req.AmountMicro
		margin.CollateralMicro += req.AmountMicro
	} else {
		_, free := s.marginEquityLocked(session.Account)
		if margin.CollateralMicro < req.AmountMicro || free < req.AmountMicro {
			return MarginAccountSnapshot{}, ErrInsufficient
		}
		balance.ReservedMicro -= req.AmountMicro
		balance.AvailableMicro += req.AmountMicro
		margin.CollateralMicro -= req.AmountMicro
	}
	if balance.ReservedMicro < 0 || margin.CollateralMicro < 0 {
		return MarginAccountSnapshot{}, ErrConflict
	}
	now := s.cfg.Now().UTC()
	margin.UpdatedAt = now
	before := cloneState(s.state)
	s.state.Balances[balanceKey(session.Account, QuoteAsset)] = balance
	s.state.MarginAccounts[marginAccountKey(session.Account)] = margin
	availableDelta, reservedDelta := -req.AmountMicro, req.AmountMicro
	if req.Direction == "withdraw" {
		availableDelta, reservedDelta = req.AmountMicro, -req.AmountMicro
	}
	s.ledgerLocked(session.Account, QuoteAsset, availableDelta, reservedDelta, "margin_"+req.Direction, session.Account, d)
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "margin_" + req.Direction, Digest: d, ObjectID: session.Account}
	s.auditLocked(session.Account, "margin_"+req.Direction, "margin_account", session.Account, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return MarginAccountSnapshot{}, err
	}
	return s.marginSnapshotLocked(session.Account), nil
}

func (s *Service) marginSnapshotLocked(account string) MarginAccountSnapshot {
	now := s.cfg.Now().UTC()
	margin := s.marginAccountLocked(account)
	snapshot := MarginAccountSnapshot{Account: margin, Positions: []PerpetualPosition{}, Orders: []PerpetualOrder{}, Trades: []PerpetualTrade{}, Funding: []FundingSettlement{}, Liquidations: []LiquidationEvent{}, OracleStatus: s.riskSnapshotLocked(now).Status, AsOf: margin.UpdatedAt}
	for _, position := range s.state.PerpetualPositions {
		if position.Account == account {
			snapshot.Positions = append(snapshot.Positions, position)
		}
	}
	for _, order := range s.state.PerpetualOrders {
		if order.Account == account {
			snapshot.Orders = append(snapshot.Orders, order)
		}
	}
	for _, trade := range s.state.PerpetualTrades {
		if trade.Buyer == account || trade.Seller == account {
			snapshot.Trades = append(snapshot.Trades, trade)
		}
	}
	for _, funding := range s.state.FundingSettlements {
		if funding.Account == account {
			snapshot.Funding = append(snapshot.Funding, funding)
		}
	}
	for _, liquidation := range s.state.Liquidations {
		if liquidation.Account == account {
			snapshot.Liquidations = append(snapshot.Liquidations, liquidation)
		}
	}
	sort.Slice(snapshot.Positions, func(i, j int) bool { return snapshot.Positions[i].Market < snapshot.Positions[j].Market })
	sort.Slice(snapshot.Orders, func(i, j int) bool {
		if snapshot.Orders[i].CreatedAt.Equal(snapshot.Orders[j].CreatedAt) {
			return snapshot.Orders[i].ID < snapshot.Orders[j].ID
		}
		return snapshot.Orders[i].CreatedAt.Before(snapshot.Orders[j].CreatedAt)
	})
	snapshot.EquityMicro, snapshot.FreeCollateralMicro = s.marginEquityLocked(account)
	return snapshot
}

func (s *Service) MarginSnapshot(account string) MarginAccountSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.marginSnapshotLocked(account)
}

func ceilDiv(value, divisor int64) int64 {
	if value <= 0 || divisor <= 0 {
		return 0
	}
	return 1 + (value-1)/divisor
}

func perpetualCrosses(taker, maker PerpetualOrder) bool {
	if taker.Side == "buy" {
		return taker.PriceMicro >= maker.PriceMicro
	}
	return taker.PriceMicro <= maker.PriceMicro
}

func perpetualInitialMargin(notional int64, leverage int64, tier RiskTier) int64 {
	byLeverage := ceilDiv(notional, leverage)
	byTier := ceilDiv(notional*tier.InitialMarginBPS, 10_000)
	if byTier > byLeverage {
		return byTier
	}
	return byLeverage
}

func (s *Service) validatePerpetualRiskLocked(account string, req PlacePerpetualOrderRequest) (RiskOracleSnapshot, RiskTier, int64, error) {
	policy := PerpetualPolicy()
	now := s.cfg.Now().UTC()
	risk := s.riskSnapshotLocked(now)
	oracle, ok := s.state.RiskOracle[req.Market]
	if !ok {
		return RiskOracleSnapshot{}, RiskTier{}, 0, ErrUnavailable
	}
	if !req.ReduceOnly && risk.Status != "active" {
		return RiskOracleSnapshot{}, RiskTier{}, 0, ErrUnavailable
	}
	if req.ReduceOnly {
		position := s.state.PerpetualPositions[perpetualPositionKey(account, req.Market)]
		if position.Status != "open" || position.SizeMicro == 0 || (position.SizeMicro > 0 && req.Side != "sell") || (position.SizeMicro < 0 && req.Side != "buy") || req.AmountMicro > absolute64(position.SizeMicro) {
			return RiskOracleSnapshot{}, RiskTier{}, 0, ErrForbidden
		}
	}
	lower := mulDiv(oracle.MarkPriceMicro, 10_000-policy.PriceBandBPS, 10_000)
	upper := mulDiv(oracle.MarkPriceMicro, 10_000+policy.PriceBandBPS, 10_000)
	if req.PriceMicro < lower || req.PriceMicro > upper {
		return RiskOracleSnapshot{}, RiskTier{}, 0, ErrForbidden
	}
	notional := mulDiv(req.AmountMicro, req.PriceMicro, AmountScale)
	tier, err := riskTierForNotional(notional, policy)
	if err != nil || req.Leverage < 1 || req.Leverage > tier.MaxLeverage {
		return RiskOracleSnapshot{}, RiskTier{}, 0, ErrForbidden
	}
	return oracle, tier, notional, nil
}

func (s *Service) PlacePerpetualOrder(session WalletSession, req PlacePerpetualOrderRequest) (PerpetualOrder, error) {
	req.Market = strings.ToUpper(strings.TrimSpace(req.Market))
	req.Side = strings.ToLower(strings.TrimSpace(req.Side))
	req.Type = strings.ToLower(strings.TrimSpace(req.Type))
	req.TimeInForce = strings.ToLower(strings.TrimSpace(req.TimeInForce))
	if req.TimeInForce == "" {
		req.TimeInForce = "gtc"
	}
	if req.Market != DefaultPerpetualMarket || (req.Side != "buy" && req.Side != "sell") || req.Type != "limit" || (req.TimeInForce != "gtc" && req.TimeInForce != "ioc" && req.TimeInForce != "fok") || req.PriceMicro <= 0 || req.AmountMicro <= 0 || req.PriceMicro > 1_000_000*AmountScale || req.AmountMicro > 1_000_000*AmountScale || !validKey(req.IdempotencyKey) {
		return PerpetualOrder{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, PerpetualOrderAuthorizationPayload(session.Account, req), req.WalletSignature) {
		return PerpetualOrder{}, ErrUnauthorized
	}
	d := digest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "perpetual_order_place" || previous.Digest != d {
			return PerpetualOrder{}, ErrConflict
		}
		return s.state.PerpetualOrders[previous.ObjectID], nil
	}
	oracle, tier, notional, err := s.validatePerpetualRiskLocked(session.Account, req)
	if err != nil {
		return PerpetualOrder{}, err
	}
	for _, other := range s.state.PerpetualOrders {
		if other.Account == session.Account && other.Market == req.Market && other.Side != req.Side && (other.Status == "open" || other.Status == "partially_filled") && perpetualCrosses(PerpetualOrder{Side: req.Side, PriceMicro: req.PriceMicro}, other) {
			return PerpetualOrder{}, ErrForbidden
		}
	}
	if req.TimeInForce == "fok" && s.perpetualExecutableDepthLocked(req, session.Account) < req.AmountMicro {
		return PerpetualOrder{}, ErrInsufficient
	}
	reserved := perpetualInitialMargin(notional, req.Leverage, tier)
	if req.ReduceOnly {
		reserved = 0
	}
	_, free := s.marginEquityLocked(session.Account)
	if free < reserved {
		return PerpetualOrder{}, ErrInsufficient
	}
	now := s.cfg.Now().UTC()
	id := s.nextIDLocked("perpetual_order")
	order := PerpetualOrder{ID: id, Account: session.Account, Market: req.Market, Side: req.Side, Type: req.Type, TimeInForce: req.TimeInForce, PriceMicro: req.PriceMicro, AmountMicro: req.AmountMicro, Leverage: req.Leverage, ReduceOnly: req.ReduceOnly, ReservedMarginMicro: reserved, Status: "open", PrioritySequence: s.state.Sequence, AuthorizationDigest: digest(PerpetualOrderAuthorizationPayload(session.Account, req)), CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	margin := s.marginAccountLocked(session.Account)
	margin.OrderMarginMicro += reserved
	margin.UpdatedAt = now
	s.state.MarginAccounts[session.Account] = margin
	s.state.PerpetualOrders[id] = order
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "perpetual_order_place", Digest: d, ObjectID: id}
	if err := s.matchPerpetualLocked(id, oracle); err != nil {
		s.state = before
		return PerpetualOrder{}, err
	}
	order = s.state.PerpetualOrders[id]
	if req.TimeInForce == "ioc" && (order.Status == "open" || order.Status == "partially_filled") {
		s.cancelPerpetualRemainderLocked(&order, "ioc_expired")
		s.state.PerpetualOrders[id] = order
	}
	s.auditLocked(session.Account, "perpetual_order_"+order.Status, "perpetual_order", id, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return PerpetualOrder{}, err
	}
	return s.state.PerpetualOrders[id], nil
}

func (s *Service) perpetualExecutableDepthLocked(req PlacePerpetualOrderRequest, account string) int64 {
	var total int64
	for _, maker := range s.perpetualMakersLocked(req.Side, req.PriceMicro) {
		if maker.Account != account {
			total += maker.AmountMicro - maker.FilledMicro
		}
	}
	return total
}

func (s *Service) perpetualMakersLocked(takerSide string, limit int64) []PerpetualOrder {
	makers := make([]PerpetualOrder, 0)
	for _, maker := range s.state.PerpetualOrders {
		if maker.Market != DefaultPerpetualMarket || maker.Side == takerSide || (maker.Status != "open" && maker.Status != "partially_filled") {
			continue
		}
		if perpetualCrosses(PerpetualOrder{Side: takerSide, PriceMicro: limit}, maker) {
			makers = append(makers, maker)
		}
	}
	sort.Slice(makers, func(i, j int) bool {
		if makers[i].PriceMicro == makers[j].PriceMicro {
			return makers[i].PrioritySequence < makers[j].PrioritySequence
		}
		if takerSide == "buy" {
			return makers[i].PriceMicro < makers[j].PriceMicro
		}
		return makers[i].PriceMicro > makers[j].PriceMicro
	})
	return makers
}

func (s *Service) matchPerpetualLocked(takerID string, oracle RiskOracleSnapshot) error {
	taker := s.state.PerpetualOrders[takerID]
	for _, candidate := range s.perpetualMakersLocked(taker.Side, taker.PriceMicro) {
		if taker.FilledMicro >= taker.AmountMicro {
			break
		}
		maker := s.state.PerpetualOrders[candidate.ID]
		if taker.Type == "liquidation" && !maker.ReduceOnly {
			continue
		}
		if maker.Account == taker.Account {
			continue
		}
		qty := min64(taker.AmountMicro-taker.FilledMicro, maker.AmountMicro-maker.FilledMicro)
		if err := s.settlePerpetualFillLocked(&taker, &maker, qty, maker.PriceMicro, oracle); err != nil {
			return err
		}
		s.state.PerpetualOrders[maker.ID] = maker
	}
	s.state.PerpetualOrders[taker.ID] = taker
	return nil
}

func proportionalRelease(reserved, quantity, remaining int64) int64 {
	if quantity >= remaining {
		return reserved
	}
	return mulDiv(reserved, quantity, remaining)
}

func (s *Service) settlePerpetualFillLocked(taker, maker *PerpetualOrder, qty, price int64, oracle RiskOracleSnapshot) error {
	if qty <= 0 {
		return ErrInvalid
	}
	tradeID := s.nextIDLocked("perpetual_trade")
	buyer, seller := taker, maker
	if taker.Side == "sell" {
		buyer, seller = maker, taker
	}
	buyerRealized := s.applyPerpetualPositionLocked(buyer, qty, price, oracle)
	sellerRealized := s.applyPerpetualPositionLocked(seller, -qty, price, oracle)
	if s.state.RiskMarkets[taker.Market].OpenInterestMicro > PerpetualPolicy().OpenInterestCapMicro {
		return ErrForbidden
	}
	if buyerRealized+sellerRealized != 0 {
		return fmt.Errorf("%w: realized perpetual PnL is not zero-sum", ErrConflict)
	}
	for _, item := range []struct {
		order    *PerpetualOrder
		realized int64
		maker    bool
	}{{buyer, buyerRealized, buyer.ID == maker.ID}, {seller, sellerRealized, seller.ID == maker.ID}} {
		remaining := item.order.AmountMicro - item.order.FilledMicro
		release := proportionalRelease(item.order.ReservedMarginMicro, qty, remaining)
		item.order.ReservedMarginMicro -= release
		item.order.FilledMicro += qty
		item.order.UpdatedAt = s.cfg.Now().UTC()
		if item.order.FilledMicro == item.order.AmountMicro {
			item.order.Status = "filled"
		} else {
			item.order.Status = "partially_filled"
		}
		margin := s.marginAccountLocked(item.order.Account)
		margin.OrderMarginMicro -= release
		margin.RealizedPnLMicro += item.realized
		margin.CollateralMicro += item.realized
		tradeNotional := mulDiv(qty, price, AmountScale)
		bps := s.cfg.TakerFeeBPS
		if item.maker {
			bps = s.cfg.MakerFeeBPS
		}
		charge := fee(tradeNotional, bps)
		margin.CollateralMicro -= charge
		margin.UpdatedAt = item.order.UpdatedAt
		balance := s.balanceLocked(item.order.Account, QuoteAsset)
		balance.ReservedMicro += item.realized - charge
		if margin.CollateralMicro < 0 || balance.ReservedMicro < 0 || margin.OrderMarginMicro < 0 {
			return ErrInsufficient
		}
		s.state.MarginAccounts[item.order.Account] = margin
		s.state.Balances[balanceKey(item.order.Account, QuoteAsset)] = balance
		s.ledgerLocked(item.order.Account, QuoteAsset, 0, item.realized-charge, "perpetual_trade_settlement", tradeID, oracle.SourceDigest)
		s.feeLocked(item.order.Account, QuoteAsset, charge, "perpetual_trade", tradeID)
		s.creditInsuranceLocked(charge, item.order.UpdatedAt)
	}
	trade := PerpetualTrade{ID: tradeID, Market: taker.Market, PriceMicro: price, AmountMicro: qty, BuyOrderID: buyer.ID, SellOrderID: seller.ID, Buyer: buyer.Account, Seller: seller.Account, BuyerFeeMicro: fee(mulDiv(qty, price, AmountScale), map[bool]int64{true: s.cfg.MakerFeeBPS, false: s.cfg.TakerFeeBPS}[buyer.ID == maker.ID]), SellerFeeMicro: fee(mulDiv(qty, price, AmountScale), map[bool]int64{true: s.cfg.MakerFeeBPS, false: s.cfg.TakerFeeBPS}[seller.ID == maker.ID]), OracleDigest: oracle.SourceDigest, CreatedAt: s.cfg.Now().UTC()}
	s.state.PerpetualTrades = append(s.state.PerpetualTrades, trade)
	s.auditLocked(buyer.Account, "perpetual_trade_filled", "perpetual_trade", tradeID, digest(trade))
	if seller.Account != buyer.Account {
		s.auditLocked(seller.Account, "perpetual_trade_filled", "perpetual_trade", tradeID, digest(trade))
	}
	return nil
}

func (s *Service) creditInsuranceLocked(charge int64, now time.Time) {
	share := mulDiv(charge, PerpetualPolicy().InsuranceFundShareBPS, 10_000)
	s.state.InsuranceFund.Asset = QuoteAsset
	s.state.InsuranceFund.BalanceMicro += share
	s.state.InsuranceFund.Status = "funded"
	s.state.InsuranceFund.UpdatedAt = now
}

func (s *Service) applyPerpetualPositionLocked(order *PerpetualOrder, delta, price int64, oracle RiskOracleSnapshot) int64 {
	key := perpetualPositionKey(order.Account, order.Market)
	position := s.state.PerpetualPositions[key]
	oldSize := position.SizeMicro
	realized := int64(0)
	newSize := oldSize + delta
	if oldSize == 0 || (oldSize > 0) == (delta > 0) {
		oldNotional := mulDiv(absolute64(oldSize), position.EntryPriceMicro, AmountScale)
		addNotional := mulDiv(absolute64(delta), price, AmountScale)
		position.EntryPriceMicro = mulDiv(oldNotional+addNotional, AmountScale, absolute64(newSize))
	} else {
		closed := min64(absolute64(oldSize), absolute64(delta))
		if oldSize > 0 {
			realized = mulDiv(closed, price-position.EntryPriceMicro, AmountScale)
		} else {
			realized = mulDiv(closed, position.EntryPriceMicro-price, AmountScale)
		}
		if newSize == 0 {
			position.EntryPriceMicro = 0
		} else if (newSize > 0) != (oldSize > 0) {
			position.EntryPriceMicro = price
		}
	}
	position.Account, position.Market, position.SizeMicro, position.MarkPriceMicro = order.Account, order.Market, newSize, oracle.MarkPriceMicro
	position.RealizedPnLMicro += realized
	position.Leverage = order.Leverage
	position.UpdatedAt = s.cfg.Now().UTC()
	s.revaluePerpetualPositionLocked(&position)
	s.state.PerpetualPositions[key] = position
	s.recomputeAccountPositionMarginLocked(order.Account)
	s.recomputeOpenInterestLocked(order.Market)
	return realized
}

func (s *Service) recomputeAccountPositionMarginLocked(account string) {
	margin := s.marginAccountLocked(account)
	margin.PositionMarginMicro = 0
	for _, position := range s.state.PerpetualPositions {
		if position.Account == account && position.Status == "open" {
			margin.PositionMarginMicro += position.InitialMarginMicro
		}
	}
	s.state.MarginAccounts[account] = margin
}

func (s *Service) recomputeOpenInterestLocked(market string) {
	var openInterest int64
	for _, position := range s.state.PerpetualPositions {
		if position.Market == market && position.Status == "open" && position.SizeMicro > 0 {
			openInterest += position.SizeMicro
		}
	}
	risk := s.state.RiskMarkets[market]
	risk.OpenInterestMicro = openInterest
	risk.UpdatedAt = s.cfg.Now().UTC()
	s.state.RiskMarkets[market] = risk
}

func (s *Service) revaluePerpetualPositionLocked(position *PerpetualPosition) {
	if position.SizeMicro == 0 {
		position.Status, position.NotionalMicro, position.UnrealizedPnLMicro, position.InitialMarginMicro, position.MaintenanceMarginMicro, position.LiquidationPriceMicro = "closed", 0, 0, 0, 0, 0
		return
	}
	position.Status = "open"
	position.NotionalMicro = mulDiv(absolute64(position.SizeMicro), position.MarkPriceMicro, AmountScale)
	if position.SizeMicro > 0 {
		position.UnrealizedPnLMicro = mulDiv(position.SizeMicro, position.MarkPriceMicro-position.EntryPriceMicro, AmountScale)
	} else {
		position.UnrealizedPnLMicro = mulDiv(absolute64(position.SizeMicro), position.EntryPriceMicro-position.MarkPriceMicro, AmountScale)
	}
	tier, _ := riskTierForNotional(position.NotionalMicro, PerpetualPolicy())
	position.InitialMarginMicro = perpetualInitialMargin(position.NotionalMicro, position.Leverage, tier)
	position.MaintenanceMarginMicro = ceilDiv(position.NotionalMicro*tier.MaintenanceMarginBPS, 10_000)
}

func (s *Service) cancelPerpetualRemainderLocked(order *PerpetualOrder, status string) {
	margin := s.marginAccountLocked(order.Account)
	margin.OrderMarginMicro -= order.ReservedMarginMicro
	margin.UpdatedAt = s.cfg.Now().UTC()
	order.ReservedMarginMicro = 0
	order.Status = status
	order.UpdatedAt = margin.UpdatedAt
	s.state.MarginAccounts[order.Account] = margin
}

func (s *Service) CancelPerpetualOrder(session WalletSession, orderID string, req CancelPerpetualOrderRequest) (PerpetualOrder, error) {
	if strings.TrimSpace(orderID) == "" || !validKey(req.IdempotencyKey) || !verifyWalletSignature(session.Account, session.WalletPublicKey, PerpetualCancelAuthorizationPayload(session.Account, orderID, req.IdempotencyKey), req.WalletSignature) {
		return PerpetualOrder{}, ErrUnauthorized
	}
	d := digest(struct{ Account, OrderID string }{session.Account, orderID})
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "perpetual_order_cancel" || previous.Digest != d || previous.ObjectID != orderID {
			return PerpetualOrder{}, ErrConflict
		}
		return s.state.PerpetualOrders[orderID], nil
	}
	order, ok := s.state.PerpetualOrders[orderID]
	if !ok {
		return PerpetualOrder{}, ErrNotFound
	}
	if order.Account != session.Account || (order.Status != "open" && order.Status != "partially_filled") {
		return PerpetualOrder{}, ErrForbidden
	}
	before := cloneState(s.state)
	s.cancelPerpetualRemainderLocked(&order, "cancelled")
	s.state.PerpetualOrders[orderID] = order
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "perpetual_order_cancel", Digest: d, ObjectID: orderID}
	s.auditLocked(session.Account, "perpetual_order_cancelled", "perpetual_order", orderID, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return PerpetualOrder{}, err
	}
	return order, nil
}

func (s *Service) PerpetualBook() PerpetualOrderBook {
	s.mu.Lock()
	defer s.mu.Unlock()
	book := PerpetualOrderBook{Market: DefaultPerpetualMarket, Bids: []PerpetualOrder{}, Asks: []PerpetualOrder{}, AsOf: s.cfg.Now().UTC()}
	for _, order := range s.state.PerpetualOrders {
		if order.Status != "open" && order.Status != "partially_filled" {
			continue
		}
		order.Account, order.AuthorizationDigest = "", ""
		if order.Side == "buy" {
			book.Bids = append(book.Bids, order)
		} else {
			book.Asks = append(book.Asks, order)
		}
	}
	sort.Slice(book.Bids, func(i, j int) bool {
		return book.Bids[i].PriceMicro > book.Bids[j].PriceMicro || (book.Bids[i].PriceMicro == book.Bids[j].PriceMicro && book.Bids[i].PrioritySequence < book.Bids[j].PrioritySequence)
	})
	sort.Slice(book.Asks, func(i, j int) bool {
		return book.Asks[i].PriceMicro < book.Asks[j].PriceMicro || (book.Asks[i].PriceMicro == book.Asks[j].PriceMicro && book.Asks[i].PrioritySequence < book.Asks[j].PrioritySequence)
	})
	return book
}

func (s *Service) revalueAllPerpetualPositionsLocked(market string, oracle RiskOracleSnapshot) {
	accounts := map[string]struct{}{}
	for key, position := range s.state.PerpetualPositions {
		if position.Market != market || position.Status != "open" {
			continue
		}
		position.MarkPriceMicro = oracle.MarkPriceMicro
		position.UpdatedAt = s.cfg.Now().UTC()
		s.revaluePerpetualPositionLocked(&position)
		s.state.PerpetualPositions[key] = position
		accounts[position.Account] = struct{}{}
	}
	for account := range accounts {
		s.recomputeAccountPositionMarginLocked(account)
	}
	s.recomputeOpenInterestLocked(market)
}

func (s *Service) SettlePerpetualFunding() ([]FundingSettlement, error) {
	policy := PerpetualPolicy()
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now().UTC()
	risk := s.riskSnapshotLocked(now)
	if risk.Status == "paused" || risk.Oracle == nil {
		return nil, ErrUnavailable
	}
	oracle := *risk.Oracle
	market := s.state.RiskMarkets[policy.Market]
	if !market.LastFundingAt.IsZero() && !oracle.ObservedAt.After(market.LastFundingAt) {
		return nil, ErrConflict
	}
	before := cloneState(s.state)
	settlements := make([]FundingSettlement, 0)
	var net int64
	for key, position := range s.state.PerpetualPositions {
		if position.Market != policy.Market || position.Status != "open" || position.SizeMicro == 0 {
			continue
		}
		payment := mulDiv(position.NotionalMicro, oracle.FundingRateBPS, 10_000)
		if position.SizeMicro < 0 {
			payment = -payment
		}
		margin := s.marginAccountLocked(position.Account)
		balance := s.balanceLocked(position.Account, QuoteAsset)
		if margin.CollateralMicro-payment < 0 || balance.ReservedMicro-payment < 0 {
			s.state = before
			return nil, ErrInsufficient
		}
		id := s.nextIDLocked("funding")
		settlement := FundingSettlement{ID: id, Account: position.Account, Market: position.Market, PositionSizeMicro: position.SizeMicro, RateBPS: oracle.FundingRateBPS, PaymentMicro: payment, OracleDigest: oracle.SourceDigest, SettledAt: now}
		margin.CollateralMicro -= payment
		margin.FundingPaidMicro += payment
		margin.UpdatedAt = now
		balance.ReservedMicro -= payment
		position.FundingAccruedMicro += payment
		position.UpdatedAt = now
		s.state.MarginAccounts[position.Account] = margin
		s.state.Balances[balanceKey(position.Account, QuoteAsset)] = balance
		s.state.PerpetualPositions[key] = position
		s.state.FundingSettlements = append(s.state.FundingSettlements, settlement)
		s.ledgerLocked(position.Account, QuoteAsset, 0, -payment, "perpetual_funding", id, oracle.SourceDigest)
		s.auditLocked(position.Account, "perpetual_funding_settled", "funding", id, digest(settlement))
		settlements = append(settlements, settlement)
		net += payment
	}
	if net != 0 {
		s.state = before
		return nil, fmt.Errorf("%w: funding settlement is not zero-sum", ErrConflict)
	}
	market.LastFundingAt = oracle.ObservedAt
	market.UpdatedAt = now
	s.state.RiskMarkets[policy.Market] = market
	if err := s.saveOrRollbackLocked(before); err != nil {
		return nil, err
	}
	return settlements, nil
}

func positionRealizedAt(position PerpetualPosition, signedDelta, price int64) int64 {
	closed := min64(absolute64(position.SizeMicro), absolute64(signedDelta))
	if position.SizeMicro > 0 {
		return mulDiv(closed, price-position.EntryPriceMicro, AmountScale)
	}
	return mulDiv(closed, position.EntryPriceMicro-price, AmountScale)
}

func (s *Service) maintenanceForAccountLocked(account string) int64 {
	var maintenance int64
	for _, position := range s.state.PerpetualPositions {
		if position.Account == account && position.Status == "open" {
			maintenance += position.MaintenanceMarginMicro
		}
	}
	return maintenance
}

func (s *Service) RunPerpetualLiquidations() ([]LiquidationEvent, error) {
	policy := PerpetualPolicy()
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now().UTC()
	risk := s.riskSnapshotLocked(now)
	if risk.Oracle == nil || risk.Status == "paused" {
		return nil, ErrUnavailable
	}
	oracle := *risk.Oracle
	before := cloneState(s.state)
	events := make([]LiquidationEvent, 0)
	positions := make([]PerpetualPosition, 0)
	for _, position := range s.state.PerpetualPositions {
		if position.Market == policy.Market && position.Status == "open" {
			positions = append(positions, position)
		}
	}
	sort.Slice(positions, func(i, j int) bool { return positions[i].Account < positions[j].Account })
	for _, stale := range positions {
		position := s.state.PerpetualPositions[perpetualPositionKey(stale.Account, stale.Market)]
		equity, _ := s.marginEquityLocked(position.Account)
		maintenance := s.maintenanceForAccountLocked(position.Account)
		if equity >= maintenance {
			continue
		}
		closeAmount := absolute64(position.SizeMicro)
		kind := "full"
		if equity > 0 && closeAmount > 1 {
			closeAmount = ceilDiv(closeAmount, 2)
			kind = "partial"
		}
		side, delta := "sell", -closeAmount
		if position.SizeMicro < 0 {
			side, delta = "buy", closeAmount
		}
		makers := s.perpetualMakersLocked(side, oracle.MarkPriceMicro)
		var maker PerpetualOrder
		for _, candidate := range makers {
			if candidate.ReduceOnly && candidate.Account != position.Account && candidate.AmountMicro-candidate.FilledMicro >= closeAmount {
				maker = candidate
				break
			}
		}
		if maker.ID == "" {
			s.state = before
			return nil, fmt.Errorf("%w: no wallet-authorized reduce-only liquidation liquidity", ErrUnavailable)
		}
		realized := positionRealizedAt(position, delta, oracle.MarkPriceMicro)
		closeNotional := mulDiv(closeAmount, oracle.MarkPriceMicro, AmountScale)
		liquidationFee := fee(closeNotional, policy.LiquidationFeeBPS)
		executionFee := fee(closeNotional, s.cfg.TakerFeeBPS)
		margin := s.marginAccountLocked(position.Account)
		needed := -(margin.CollateralMicro + realized - liquidationFee - executionFee)
		if needed < 0 {
			needed = 0
		}
		insuranceUse := min64(needed, s.state.InsuranceFund.BalanceMicro)
		adl := needed - insuranceUse
		if adl > 0 {
			makerMargin := s.marginAccountLocked(maker.Account)
			makerBalance := s.balanceLocked(maker.Account, QuoteAsset)
			if makerMargin.CollateralMicro < adl || makerBalance.ReservedMicro < adl {
				s.state = before
				return nil, ErrInsufficient
			}
			makerMargin.CollateralMicro -= adl
			makerMargin.UpdatedAt = now
			makerBalance.ReservedMicro -= adl
			s.state.MarginAccounts[maker.Account] = makerMargin
			s.state.Balances[balanceKey(maker.Account, QuoteAsset)] = makerBalance
			s.ledgerLocked(maker.Account, QuoteAsset, 0, -adl, "perpetual_adl", position.Account, oracle.SourceDigest)
		}
		if needed > 0 {
			margin.CollateralMicro += needed
			margin.UpdatedAt = now
			balance := s.balanceLocked(position.Account, QuoteAsset)
			balance.ReservedMicro += needed
			s.state.MarginAccounts[position.Account] = margin
			s.state.Balances[balanceKey(position.Account, QuoteAsset)] = balance
			s.ledgerLocked(position.Account, QuoteAsset, 0, needed, "perpetual_default_waterfall", position.Account, oracle.SourceDigest)
			s.state.InsuranceFund.BalanceMicro -= insuranceUse
			s.state.InsuranceFund.UpdatedAt = now
		}
		id := s.nextIDLocked("perpetual_order")
		forced := PerpetualOrder{ID: id, Account: position.Account, Market: position.Market, Side: side, Type: "liquidation", TimeInForce: "ioc", PriceMicro: oracle.MarkPriceMicro, AmountMicro: closeAmount, Leverage: position.Leverage, ReduceOnly: true, Status: "open", PrioritySequence: s.state.Sequence, AuthorizationDigest: oracle.SourceDigest, CreatedAt: now, UpdatedAt: now}
		s.state.PerpetualOrders[id] = forced
		if err := s.matchPerpetualLocked(id, oracle); err != nil {
			s.state = before
			return nil, err
		}
		forced = s.state.PerpetualOrders[id]
		if forced.FilledMicro != closeAmount {
			s.state = before
			return nil, ErrUnavailable
		}
		margin = s.marginAccountLocked(position.Account)
		balance := s.balanceLocked(position.Account, QuoteAsset)
		if margin.CollateralMicro < liquidationFee || balance.ReservedMicro < liquidationFee {
			s.state = before
			return nil, ErrInsufficient
		}
		margin.CollateralMicro -= liquidationFee
		margin.LiquidationFeesMicro += liquidationFee
		margin.UpdatedAt = now
		balance.ReservedMicro -= liquidationFee
		s.state.MarginAccounts[position.Account] = margin
		s.state.Balances[balanceKey(position.Account, QuoteAsset)] = balance
		s.state.InsuranceFund.BalanceMicro += liquidationFee
		s.state.InsuranceFund.Status = "funded"
		s.state.InsuranceFund.UpdatedAt = now
		stage := "customer_margin"
		if insuranceUse > 0 {
			stage = "insurance_fund"
		}
		if adl > 0 {
			stage = "adl_after_insurance"
		}
		event := LiquidationEvent{ID: s.nextIDLocked("liquidation"), Account: position.Account, Market: position.Market, Kind: kind, SizeBeforeMicro: absolute64(position.SizeMicro), SizeClosedMicro: closeAmount, ExecutionPriceMicro: oracle.MarkPriceMicro, EquityBeforeMicro: equity, MaintenanceMarginMicro: maintenance, LiquidationFeeMicro: liquidationFee, InsuranceDeltaMicro: liquidationFee - insuranceUse, DeficitMicro: needed, DefaultWaterfallStage: stage, OracleDigest: oracle.SourceDigest, CreatedAt: now}
		s.state.Liquidations = append(s.state.Liquidations, event)
		s.ledgerLocked(position.Account, QuoteAsset, 0, -liquidationFee, "perpetual_liquidation_fee", event.ID, oracle.SourceDigest)
		s.auditLocked(position.Account, "perpetual_"+kind+"_liquidation", "liquidation", event.ID, digest(event))
		events = append(events, event)
	}
	if len(events) == 0 {
		return []LiquidationEvent{}, nil
	}
	if err := s.saveOrRollbackLocked(before); err != nil {
		return nil, err
	}
	return events, nil
}
