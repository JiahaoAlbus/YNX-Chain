package exchangeproduct

import (
	"fmt"
	"sort"
	"strings"
)

func MarginTransferAuthorizationPayload(account string, req MarginTransferRequest) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-margin-transfer-v1\n%s\n%s\n%d\n%s", account, strings.ToLower(strings.TrimSpace(req.Direction)), req.AmountMicro, req.IdempotencyKey))
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
	equity = margin.CollateralMicro + margin.RealizedPnLMicro - margin.FundingPaidMicro - margin.LiquidationFeesMicro
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
	sort.Slice(snapshot.Orders, func(i, j int) bool { return snapshot.Orders[i].CreatedAt.Before(snapshot.Orders[j].CreatedAt) })
	snapshot.EquityMicro, snapshot.FreeCollateralMicro = s.marginEquityLocked(account)
	return snapshot
}

func (s *Service) MarginSnapshot(account string) MarginAccountSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.marginSnapshotLocked(account)
}
