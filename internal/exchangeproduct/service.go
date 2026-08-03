package exchangeproduct

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

var allowedScopes = map[string]bool{"exchange:read": true, "exchange:trade": true, "exchange:deposit": true, "exchange:withdraw": true, "exchange:withdrawal-review": true, "exchange:ai": true}

type Service struct {
	mu    sync.Mutex
	cfg   Config
	state persistentState
}

type CompleteSessionRequest struct {
	ChallengeID     string `json:"challengeId"`
	WalletPublicKey string `json:"walletPublicKey"`
	WalletSignature string `json:"walletSignature"`
}

type PlaceOrderRequest struct {
	Market          string `json:"market"`
	Side            string `json:"side"`
	Type            string `json:"type"`
	PriceMicro      int64  `json:"priceMicro"`
	AmountMicro     int64  `json:"amountMicro"`
	IdempotencyKey  string `json:"idempotencyKey"`
	WalletSignature string `json:"walletSignature"`
}

type WithdrawalReviewRequest struct {
	Asset           string `json:"asset"`
	Network         string `json:"network"`
	Destination     string `json:"destination"`
	AmountMicro     int64  `json:"amountMicro"`
	IdempotencyKey  string `json:"idempotencyKey"`
	WalletSignature string `json:"walletSignature"`
}

func New(cfg Config) (*Service, error) {
	cfg.StatePath = strings.TrimSpace(cfg.StatePath)
	cfg.APIKey = strings.TrimSpace(cfg.APIKey)
	cfg.WalletCallback = strings.TrimSpace(cfg.WalletCallback)
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	if cfg.RequiredConfirmations == 0 {
		cfg.RequiredConfirmations = 12
	}
	if cfg.MakerFeeBPS == 0 {
		cfg.MakerFeeBPS = 10
	}
	if cfg.TakerFeeBPS == 0 {
		cfg.TakerFeeBPS = 20
	}
	if cfg.WithdrawalFeeMicroYNXT == 0 {
		cfg.WithdrawalFeeMicroYNXT = 10_000
	}
	if cfg.MaxOrderNotionalMicro == 0 {
		cfg.MaxOrderNotionalMicro = 100_000 * AmountScale
	}
	if cfg.MaxWithdrawalMicro == 0 {
		cfg.MaxWithdrawalMicro = 25_000 * AmountScale
	}
	cfg.GatewayURL = strings.TrimRight(strings.TrimSpace(cfg.GatewayURL), "/")
	cfg.GatewayClientID = strings.TrimSpace(cfg.GatewayClientID)
	cfg.IndexerURL = strings.TrimRight(strings.TrimSpace(cfg.IndexerURL), "/")
	if cfg.StatePath == "" || len(cfg.APIKey) < 16 || cfg.WalletCallback == "" || cfg.RequiredConfirmations < 1 || cfg.MakerFeeBPS < 0 || cfg.TakerFeeBPS < cfg.MakerFeeBPS || cfg.TakerFeeBPS > 1000 || cfg.WithdrawalFeeMicroYNXT < 0 {
		return nil, fmt.Errorf("%w: exchange configuration", ErrInvalid)
	}
	if cfg.CustodyAddress != "" {
		address, err := nativewallet.NormalizeNativeAddress(cfg.CustodyAddress)
		if err != nil {
			return nil, fmt.Errorf("%w: custody address", ErrInvalid)
		}
		cfg.CustodyAddress = address
	}
	s, existed, err := loadState(cfg.StatePath)
	if err != nil {
		return nil, err
	}
	if cfg.CustodyAddress != "" {
		s.CustodyAddress = cfg.CustodyAddress
	}
	migrated, err := normalizeAuditChain(&s)
	if err != nil {
		return nil, err
	}
	service := &Service{cfg: cfg, state: s}
	if !existed || migrated {
		if err := saveState(cfg.StatePath, &service.state); err != nil {
			return nil, err
		}
	}
	return service, nil
}

func (s *Service) Integrations() IntegrationStatus {
	status := IntegrationStatus{Gateway: "unavailable", GatewayReason: "Central Gateway route and Exchange scope registration are not configured", WalletRegistry: "pending_registration", Custody: "unavailable", Indexer: "unavailable", CrossChain: "unavailable"}
	if s.cfg.GatewayURL != "" && s.cfg.GatewayClientID != "" {
		status.Gateway = "configured_not_attested"
		status.GatewayReason = "Configuration is not evidence of central route acceptance"
	}
	if s.state.CustodyAddress != "" {
		status.Custody = "review_only"
	}
	if s.cfg.Chain != nil && s.cfg.IndexerURL != "" {
		status.Indexer = "configured"
	}
	return status
}

func (s *Service) Authorized(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	return len(value) == len(s.cfg.APIKey) && subtle.ConstantTimeCompare([]byte(value), []byte(s.cfg.APIKey)) == 1
}

func Markets() []Market {
	return []Market{{Symbol: DefaultMarket, BaseAsset: NativeAsset, QuoteAsset: QuoteAsset, Venue: "YNX-owned testnet venue", Engine: "deterministic persistent price-time matching", ExternalPrice: false, PublicVolume: false, PriceScale: AmountScale, AmountScale: AmountScale, Status: "testnet_only"}}
}

func (s *Service) Networks() []AssetNetwork {
	return []AssetNetwork{
		{Asset: NativeAsset, Network: "YNX Testnet", ChainID: ChainID, EVMChainID: EVMChainID, DepositEnabled: s.cfg.Chain != nil && s.state.CustodyAddress != "", WithdrawalEnabled: false, WithdrawalReviewEnabled: s.state.CustodyAddress != "", WithdrawalBroadcastEnabled: false, UnavailableReason: "Review is available when custody is configured; operator broadcast adapter and proof are not integrated", Confirmations: s.cfg.RequiredConfirmations, WithdrawalFeeMicro: s.cfg.WithdrawalFeeMicroYNXT},
		{Asset: QuoteAsset, Network: "YNX venue ledger", ChainID: ChainID, EVMChainID: EVMChainID, DepositEnabled: false, WithdrawalEnabled: false, UnavailableReason: "Venue-only deterministic test credits; not a token or stablecoin", Confirmations: 0},
		{Asset: NativeAsset, Network: "External / cross-chain", ChainID: "", CrossChain: true, DepositEnabled: false, WithdrawalEnabled: false, UnavailableReason: "Disabled until bridge adapter, relayer custody, asset route and external proof exist"},
	}
}

func (s *Service) PublicTrades(limit int) []Trade {
	if limit < 1 || limit > 1000 {
		limit = 1000
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]Trade, 0, len(s.state.Trades))
	for _, trade := range s.state.Trades {
		items = append(items, trade)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.Before(items[j].CreatedAt)
	})
	if len(items) > limit {
		items = items[len(items)-limit:]
	}
	return items
}

func WalletChallengePayload(c WalletChallenge) []byte {
	return []byte(strings.Join([]string{"ynx-sign-in-v1", c.ID, c.Nonce, c.Account, c.DeviceID, c.ClientID, c.Callback, strings.Join(c.Scopes, ","), c.ChainID, c.Purpose, c.IssuedAt.Format(time.RFC3339), c.ExpiresAt.Format(time.RFC3339)}, "\n"))
}

func (s *Service) CreateChallenge(account, deviceID string, scopes []string) (WalletChallenge, error) {
	account, err := nativewallet.NormalizeNativeAddress(account)
	if err != nil || strings.TrimSpace(deviceID) == "" || len(deviceID) > 128 || len(scopes) == 0 || len(scopes) > 8 {
		return WalletChallenge{}, ErrInvalid
	}
	clean := append([]string(nil), scopes...)
	sort.Strings(clean)
	for i, scope := range clean {
		if !allowedScopes[scope] || (i > 0 && clean[i-1] == scope) {
			return WalletChallenge{}, ErrForbidden
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now().UTC().Truncate(time.Second)
	id := s.nextIDLocked("challenge")
	c := WalletChallenge{ID: id, Nonce: randomToken(24), Account: account, DeviceID: deviceID, ClientID: "ynx.exchange", Callback: s.cfg.WalletCallback, Scopes: clean, ChainID: ChainID, Purpose: "Sign in to the YNX-owned testnet exchange; no recovery key is shared", IssuedAt: now, ExpiresAt: now.Add(5 * time.Minute)}
	before := cloneState(s.state)
	s.state.Challenges[id] = c
	s.auditLocked(account, "wallet_challenge_created", "challenge", id, digest(c))
	if err := s.saveOrRollbackLocked(before); err != nil {
		return WalletChallenge{}, err
	}
	return c, nil
}

func (s *Service) CompleteSession(req CompleteSessionRequest) (WalletSession, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.state.Challenges[req.ChallengeID]
	if !ok || !c.UsedAt.IsZero() || !s.cfg.Now().Before(c.ExpiresAt) || !verifyWalletSignature(c.Account, req.WalletPublicKey, WalletChallengePayload(c), req.WalletSignature) {
		return WalletSession{}, "", ErrUnauthorized
	}
	token := randomToken(32)
	tokenHash := hashText(token)
	now := s.cfg.Now().UTC()
	ttl := 480
	if settings, ok := s.state.Security[c.Account]; ok && settings.SessionTTLMinutes >= 15 && settings.SessionTTLMinutes <= 480 {
		ttl = settings.SessionTTLMinutes
	}
	session := WalletSession{TokenHash: tokenHash, Account: c.Account, DeviceID: c.DeviceID, WalletPublicKey: req.WalletPublicKey, Scopes: append([]string(nil), c.Scopes...), CreatedAt: now, ExpiresAt: now.Add(time.Duration(ttl) * time.Minute)}
	before := cloneState(s.state)
	c.UsedAt = now
	s.state.Challenges[c.ID] = c
	s.state.Sessions[tokenHash] = session
	if _, ok := s.state.Security[c.Account]; !ok {
		s.state.Security[c.Account] = SecuritySettings{Account: c.Account, WithdrawalLock: false, OrderConfirmation: true, SessionTTLMinutes: 480, UpdatedAt: now}
	}
	s.auditLocked(c.Account, "wallet_session_created", "session", tokenHash[:16], digest(session))
	if err := s.saveOrRollbackLocked(before); err != nil {
		return WalletSession{}, "", err
	}
	return session, token, nil
}

func (s *Service) Authenticate(token, scope string) (WalletSession, error) {
	raw := strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	if raw == "" || s.cfg.Gateway == nil || s.cfg.GatewayClientID == "" {
		return WalletSession{}, ErrUnauthorized
	}
	return s.cfg.Gateway.Authorize(raw, scope, s.cfg.GatewayClientID)
}

func OrderAuthorizationPayload(account string, req PlaceOrderRequest) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-order-v1\n%s\n%s\n%s\n%s\n%d\n%d\n%s", account, req.Market, req.Side, req.Type, req.PriceMicro, req.AmountMicro, req.IdempotencyKey))
}
func WithdrawalAuthorizationPayload(account string, req WithdrawalReviewRequest, exactFeeMicro int64) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-withdrawal-review-v1\n%s\n%s\n%s\n%s\n%d\n%d\n%s", account, req.Asset, req.Network, req.Destination, req.AmountMicro, exactFeeMicro, req.IdempotencyKey))
}

func (s *Service) CreditTestQuote(apiKey, account string, amount int64, key string) (Balance, error) {
	if !s.Authorized(apiKey) {
		return Balance{}, ErrUnauthorized
	}
	account, err := nativewallet.NormalizeNativeAddress(account)
	if err != nil || amount <= 0 || amount > 1_000_000*AmountScale || !validKey(key) {
		return Balance{}, ErrInvalid
	}
	d := digest(struct {
		Account string
		Amount  int64
	}{account, amount})
	s.mu.Lock()
	defer s.mu.Unlock()
	if prev, ok := s.state.Idempotency[key]; ok {
		if prev.Action != "test_quote_credit" || prev.Digest != d {
			return Balance{}, ErrConflict
		}
		return s.balanceLocked(account, QuoteAsset), nil
	}
	before := cloneState(s.state)
	b := s.balanceLocked(account, QuoteAsset)
	b.AvailableMicro += amount
	s.state.Balances[balanceKey(account, QuoteAsset)] = b
	s.ledgerLocked(account, QuoteAsset, amount, 0, "test_credit", key, d)
	s.state.Idempotency[key] = idempotencyRecord{Action: "test_quote_credit", Digest: d, ObjectID: account}
	s.auditLocked(account, "test_quote_credit_allocated", "balance", QuoteAsset, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Balance{}, err
	}
	return b, nil
}

func (s *Service) CreateDepositIntent(session WalletSession, key string) (DepositIntent, error) {
	if s.cfg.Chain == nil || s.state.CustodyAddress == "" || s.cfg.IndexerURL == "" {
		return DepositIntent{}, ErrUnavailable
	}
	if !validKey(key) {
		return DepositIntent{}, ErrInvalid
	}
	d := digest(struct{ Account, Asset, Network string }{session.Account, NativeAsset, "YNX Testnet"})
	s.mu.Lock()
	defer s.mu.Unlock()
	if prev, ok := s.state.Idempotency[key]; ok {
		if prev.Action != "deposit_intent" || prev.Digest != d {
			return DepositIntent{}, ErrConflict
		}
		return s.state.DepositIntents[prev.ObjectID], nil
	}
	now := s.cfg.Now().UTC()
	id := s.nextIDLocked("deposit_intent")
	v := DepositIntent{ID: id, Account: session.Account, Asset: NativeAsset, Network: "YNX Testnet", Address: s.state.CustodyAddress, Status: "awaiting_chain_transfer", IndexerSource: s.cfg.IndexerURL, CreatedAt: now, ExpiresAt: now.Add(30 * time.Minute)}
	before := cloneState(s.state)
	s.state.DepositIntents[id] = v
	s.state.Idempotency[key] = idempotencyRecord{Action: "deposit_intent", Digest: d, ObjectID: id}
	s.auditLocked(session.Account, "deposit_intent_created", "deposit_intent", id, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return DepositIntent{}, err
	}
	return v, nil
}

func (s *Service) ObserveDeposit(session WalletSession, intentID, txHash, key string) (Deposit, error) {
	if s.cfg.Chain == nil || s.state.CustodyAddress == "" {
		return Deposit{}, ErrUnavailable
	}
	if !validHash(txHash) || !validKey(key) {
		return Deposit{}, ErrInvalid
	}
	transfer, err := s.cfg.Chain.Transfer(txHash)
	if err != nil {
		return Deposit{}, fmt.Errorf("%w: chain read failed", ErrUnavailable)
	}
	if !transfer.Committed || transfer.To != s.state.CustodyAddress || transfer.AmountMicro <= 0 {
		return Deposit{}, ErrInvalid
	}
	d := digest(struct{ Account, Tx string }{session.Account, txHash})
	s.mu.Lock()
	defer s.mu.Unlock()
	if prev, ok := s.state.Idempotency[key]; ok {
		if prev.Action != "deposit_observe" || prev.Digest != d {
			return Deposit{}, ErrConflict
		}
		return s.state.Deposits[prev.ObjectID], nil
	}
	intent, ok := s.state.DepositIntents[intentID]
	if !ok {
		return Deposit{}, ErrNotFound
	}
	if intent.Account != session.Account || intent.Status != "awaiting_chain_transfer" || !s.cfg.Now().Before(intent.ExpiresAt) {
		return Deposit{}, ErrForbidden
	}
	for _, existing := range s.state.Deposits {
		if existing.TxHash == txHash {
			return Deposit{}, ErrConflict
		}
	}
	now := s.cfg.Now().UTC()
	status := "confirming"
	if transfer.Confirmations >= s.cfg.RequiredConfirmations {
		status = "confirmed"
	}
	id := s.nextIDLocked("deposit")
	dep := Deposit{ID: id, Account: session.Account, Asset: NativeAsset, Network: "YNX Testnet", TxHash: txHash, AmountMicro: transfer.AmountMicro, Confirmations: transfer.Confirmations, Required: s.cfg.RequiredConfirmations, Status: status, CreatedAt: now, UpdatedAt: now, IntentID: intentID, SourceType: "ynx_indexer_transfer", SourceDigest: digest(transfer)}
	before := cloneState(s.state)
	s.state.Deposits[id] = dep
	intent.Status = "transfer_observed"
	s.state.DepositIntents[intentID] = intent
	s.state.Idempotency[key] = idempotencyRecord{Action: "deposit_observe", Digest: d, ObjectID: id}
	if status == "confirmed" {
		b := s.balanceLocked(session.Account, NativeAsset)
		b.AvailableMicro += dep.AmountMicro
		s.state.Balances[balanceKey(session.Account, NativeAsset)] = b
		s.ledgerLocked(session.Account, NativeAsset, dep.AmountMicro, 0, "confirmed_deposit", id, dep.SourceDigest)
	}
	s.auditLocked(session.Account, "deposit_"+status, "deposit", id, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Deposit{}, err
	}
	return dep, nil
}

func (s *Service) RefreshDeposit(session WalletSession, id string) (Deposit, error) {
	if s.cfg.Chain == nil {
		return Deposit{}, ErrUnavailable
	}
	s.mu.Lock()
	dep, ok := s.state.Deposits[id]
	s.mu.Unlock()
	if !ok {
		return Deposit{}, ErrNotFound
	}
	if dep.Account != session.Account {
		return Deposit{}, ErrForbidden
	}
	if dep.Status == "confirmed" {
		return dep, nil
	}
	t, err := s.cfg.Chain.Transfer(dep.TxHash)
	if err != nil {
		return Deposit{}, ErrUnavailable
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	dep = s.state.Deposits[id]
	before := cloneState(s.state)
	dep.Confirmations = t.Confirmations
	dep.UpdatedAt = s.cfg.Now().UTC()
	if t.Committed && t.To == s.state.CustodyAddress && t.AmountMicro == dep.AmountMicro && t.Confirmations >= dep.Required {
		dep.Status = "confirmed"
		b := s.balanceLocked(dep.Account, dep.Asset)
		b.AvailableMicro += dep.AmountMicro
		s.state.Balances[balanceKey(dep.Account, dep.Asset)] = b
		s.ledgerLocked(dep.Account, dep.Asset, dep.AmountMicro, 0, "confirmed_deposit", id, dep.SourceDigest)
		s.auditLocked(dep.Account, "deposit_confirmed", "deposit", id, digest(t))
	}
	s.state.Deposits[id] = dep
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Deposit{}, err
	}
	return dep, nil
}

func (s *Service) ReviewWithdrawal(session WalletSession, req WithdrawalReviewRequest) (Withdrawal, error) {
	if s.state.CustodyAddress == "" {
		return Withdrawal{}, ErrUnavailable
	}
	if req.Asset != NativeAsset || req.Network != "YNX Testnet" || req.AmountMicro <= s.cfg.WithdrawalFeeMicroYNXT || !validKey(req.IdempotencyKey) {
		return Withdrawal{}, ErrInvalid
	}
	dest, err := nativewallet.NormalizeNativeAddress(req.Destination)
	if err != nil {
		return Withdrawal{}, ErrInvalid
	}
	req.Destination = dest
	payload := WithdrawalAuthorizationPayload(session.Account, req, s.cfg.WithdrawalFeeMicroYNXT)
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, payload, req.WalletSignature) {
		return Withdrawal{}, ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	settings := s.securityLocked(session.Account)
	if settings.WithdrawalLock {
		return Withdrawal{}, ErrForbidden
	}
	if req.AmountMicro > s.cfg.MaxWithdrawalMicro {
		return Withdrawal{}, ErrForbidden
	}
	d := digest(req)
	if prev, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if prev.Action != "withdrawal_review" || prev.Digest != d {
			return Withdrawal{}, ErrConflict
		}
		return s.state.Withdrawals[prev.ObjectID], nil
	}
	b := s.balanceLocked(session.Account, NativeAsset)
	if b.AvailableMicro < req.AmountMicro {
		return Withdrawal{}, ErrInsufficient
	}
	now := s.cfg.Now().UTC()
	id := s.nextIDLocked("withdrawal")
	w := Withdrawal{ID: id, Account: session.Account, Asset: NativeAsset, Network: "YNX Testnet", Destination: dest, AmountMicro: req.AmountMicro, FeeMicro: s.cfg.WithdrawalFeeMicroYNXT, ReceiveMicro: req.AmountMicro - s.cfg.WithdrawalFeeMicroYNXT, Status: "reviewed_pending_operator_broadcast", WalletAuthorized: true, CreatedAt: now, UpdatedAt: now, SourceType: "wallet_authorized_review", SourceDigest: digest(payload)}
	before := cloneState(s.state)
	b.AvailableMicro -= req.AmountMicro
	b.ReservedMicro += req.AmountMicro
	s.state.Balances[balanceKey(session.Account, NativeAsset)] = b
	s.ledgerLocked(session.Account, NativeAsset, -req.AmountMicro, req.AmountMicro, "withdrawal_review", id, w.SourceDigest)
	s.state.Withdrawals[id] = w
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "withdrawal_review", Digest: d, ObjectID: id}
	s.feeLocked(session.Account, NativeAsset, w.FeeMicro, "withdrawal_review", id)
	s.auditLocked(session.Account, "withdrawal_reviewed", "withdrawal", id, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Withdrawal{}, err
	}
	return w, nil
}

func (s *Service) PlaceOrder(session WalletSession, req PlaceOrderRequest) (Order, error) {
	req.Market = strings.ToUpper(strings.TrimSpace(req.Market))
	req.Side = strings.ToLower(strings.TrimSpace(req.Side))
	req.Type = strings.ToLower(strings.TrimSpace(req.Type))
	if req.Market != DefaultMarket || (req.Side != "buy" && req.Side != "sell") || req.Type != "limit" || req.PriceMicro <= 0 || req.AmountMicro <= 0 || req.PriceMicro > 1_000_000*AmountScale || req.AmountMicro > 1_000_000*AmountScale || !validKey(req.IdempotencyKey) {
		return Order{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, OrderAuthorizationPayload(session.Account, req), req.WalletSignature) {
		return Order{}, ErrUnauthorized
	}
	if mulDiv(req.AmountMicro, req.PriceMicro, AmountScale) > s.cfg.MaxOrderNotionalMicro {
		return Order{}, ErrForbidden
	}
	d := digest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if prev, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if prev.Action != "order_place" || prev.Digest != d {
			return Order{}, ErrConflict
		}
		return s.state.Orders[prev.ObjectID], nil
	}
	now := s.cfg.Now().UTC()
	id := s.nextIDLocked("order")
	o := Order{ID: id, Account: session.Account, Market: req.Market, Side: req.Side, Type: "limit", PriceMicro: req.PriceMicro, AmountMicro: req.AmountMicro, Status: "open", WalletAuthorized: true, CreatedAt: now, UpdatedAt: now, AuthorizationDigest: digest(OrderAuthorizationPayload(session.Account, req))}
	for _, other := range s.state.Orders {
		if other.Account == session.Account && other.Market == o.Market && (other.Status == "open" || other.Status == "partially_filled") && other.Side != o.Side && crosses(o, other) {
			o.Status = "rejected"
			o.RejectReason = "self_trade_prevention"
			before := cloneState(s.state)
			s.state.Orders[id] = o
			s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "order_place", Digest: d, ObjectID: id}
			s.auditLocked(session.Account, "order_rejected", "order", id, d)
			if err := s.saveOrRollbackLocked(before); err != nil {
				return Order{}, err
			}
			return o, nil
		}
	}
	reserve := req.AmountMicro
	if req.Side == "buy" {
		quote := mulDiv(req.AmountMicro, req.PriceMicro, AmountScale)
		reserve = quote + fee(quote, s.cfg.TakerFeeBPS)
	}
	asset := NativeAsset
	if req.Side == "buy" {
		asset = QuoteAsset
	}
	b := s.balanceLocked(session.Account, asset)
	if b.AvailableMicro < reserve {
		return Order{}, ErrInsufficient
	}
	before := cloneState(s.state)
	b.AvailableMicro -= reserve
	b.ReservedMicro += reserve
	s.state.Balances[balanceKey(session.Account, asset)] = b
	s.ledgerLocked(session.Account, asset, -reserve, reserve, "order_reserve", id, o.AuthorizationDigest)
	o.ReservedMicro = reserve
	s.state.Orders[id] = o
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "order_place", Digest: d, ObjectID: id}
	s.auditLocked(session.Account, "order_opened", "order", id, d)
	s.matchLocked(id)
	o = s.state.Orders[id]
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Order{}, err
	}
	return o, nil
}

func (s *Service) CancelOrder(session WalletSession, id, key, walletSignature string) (Order, error) {
	if !validKey(key) {
		return Order{}, ErrInvalid
	}
	payload := []byte(strings.Join([]string{"ynx-exchange-cancel-v1", session.Account, id, key}, "\n"))
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, payload, walletSignature) {
		return Order{}, ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := digest(struct{ ID, Key string }{id, key})
	if prev, ok := s.state.Idempotency[key]; ok {
		if prev.Action != "order_cancel" || prev.Digest != d {
			return Order{}, ErrConflict
		}
		return s.state.Orders[id], nil
	}
	o, ok := s.state.Orders[id]
	if !ok {
		return Order{}, ErrNotFound
	}
	if o.Account != session.Account {
		return Order{}, ErrForbidden
	}
	if o.Status != "open" && o.Status != "partially_filled" {
		return Order{}, ErrConflict
	}
	before := cloneState(s.state)
	s.releaseOrderReserveLocked(&o)
	o.Status = "cancelled"
	o.UpdatedAt = s.cfg.Now().UTC()
	s.state.Orders[id] = o
	s.state.Idempotency[key] = idempotencyRecord{Action: "order_cancel", Digest: d, ObjectID: id}
	s.auditLocked(session.Account, "order_cancelled", "order", id, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Order{}, err
	}
	return o, nil
}

func (s *Service) matchLocked(incomingID string) {
	for {
		incoming := s.state.Orders[incomingID]
		if incoming.Status != "open" && incoming.Status != "partially_filled" {
			return
		}
		candidates := []Order{}
		for _, o := range s.state.Orders {
			if o.ID != incoming.ID && o.Market == incoming.Market && o.Side != incoming.Side && (o.Status == "open" || o.Status == "partially_filled") && crosses(incoming, o) {
				candidates = append(candidates, o)
			}
		}
		if len(candidates) == 0 {
			return
		}
		sort.Slice(candidates, func(i, j int) bool {
			if candidates[i].PriceMicro == candidates[j].PriceMicro {
				if candidates[i].CreatedAt.Equal(candidates[j].CreatedAt) {
					return candidates[i].ID < candidates[j].ID
				}
				return candidates[i].CreatedAt.Before(candidates[j].CreatedAt)
			}
			if incoming.Side == "buy" {
				return candidates[i].PriceMicro < candidates[j].PriceMicro
			}
			return candidates[i].PriceMicro > candidates[j].PriceMicro
		})
		maker := candidates[0]
		qty := min64(incoming.AmountMicro-incoming.FilledMicro, maker.AmountMicro-maker.FilledMicro)
		s.executeTradeLocked(&incoming, &maker, qty, maker.PriceMicro)
		s.state.Orders[incoming.ID] = incoming
		s.state.Orders[maker.ID] = maker
	}
}

func (s *Service) executeTradeLocked(incoming, maker *Order, qty, price int64) {
	id := s.nextIDLocked("trade")
	sourceDigest := digest(struct {
		Incoming, Maker string
		Qty, Price      int64
	}{incoming.ID, maker.ID, qty, price})
	buyer, seller := incoming, maker
	if incoming.Side == "sell" {
		buyer, seller = maker, incoming
	}
	quote := mulDiv(qty, price, AmountScale)
	buyerBPS, sellerBPS := s.cfg.MakerFeeBPS, s.cfg.MakerFeeBPS
	if buyer.ID == incoming.ID {
		buyerBPS = s.cfg.TakerFeeBPS
	} else {
		sellerBPS = s.cfg.TakerFeeBPS
	}
	buyerFee := fee(quote, buyerBPS)
	sellerFee := fee(quote, sellerBPS)
	bb := s.balanceLocked(buyer.Account, QuoteAsset)
	spend := quote + buyerFee
	buyerReservedDebit := min64(bb.ReservedMicro, spend)
	bb.ReservedMicro -= buyerReservedDebit
	buyer.ReservedMicro -= min64(buyer.ReservedMicro, spend)
	s.state.Balances[balanceKey(buyer.Account, QuoteAsset)] = bb
	s.ledgerLocked(buyer.Account, QuoteAsset, 0, -buyerReservedDebit, "trade_settlement", id, sourceDigest)
	baseBuyer := s.balanceLocked(buyer.Account, NativeAsset)
	baseBuyer.AvailableMicro += qty
	s.state.Balances[balanceKey(buyer.Account, NativeAsset)] = baseBuyer
	s.ledgerLocked(buyer.Account, NativeAsset, qty, 0, "trade_settlement", id, sourceDigest)
	baseSeller := s.balanceLocked(seller.Account, NativeAsset)
	sellerReservedDebit := min64(baseSeller.ReservedMicro, qty)
	baseSeller.ReservedMicro -= sellerReservedDebit
	seller.ReservedMicro -= min64(seller.ReservedMicro, qty)
	s.state.Balances[balanceKey(seller.Account, NativeAsset)] = baseSeller
	s.ledgerLocked(seller.Account, NativeAsset, 0, -sellerReservedDebit, "trade_settlement", id, sourceDigest)
	quoteSeller := s.balanceLocked(seller.Account, QuoteAsset)
	quoteSeller.AvailableMicro += quote - sellerFee
	s.state.Balances[balanceKey(seller.Account, QuoteAsset)] = quoteSeller
	s.ledgerLocked(seller.Account, QuoteAsset, quote-sellerFee, 0, "trade_settlement", id, sourceDigest)
	buyer.FilledMicro += qty
	seller.FilledMicro += qty
	now := s.cfg.Now().UTC()
	updateStatus := func(o *Order) {
		o.UpdatedAt = now
		if o.FilledMicro == o.AmountMicro {
			o.Status = "filled"
			s.releaseOrderReserveLocked(o)
		} else {
			o.Status = "partially_filled"
		}
	}
	updateStatus(buyer)
	updateStatus(seller)
	trade := Trade{ID: id, Market: buyer.Market, PriceMicro: price, AmountMicro: qty, BuyOrderID: buyer.ID, SellOrderID: seller.ID, Buyer: buyer.Account, Seller: seller.Account, BuyerFeeMicro: buyerFee, SellerFeeMicro: sellerFee, CreatedAt: now, SourceType: "deterministic_price_time_match"}
	trade.SourceDigest = sourceDigest
	s.state.Trades = append(s.state.Trades, trade)
	s.feeLocked(buyer.Account, QuoteAsset, buyerFee, "trade", id)
	s.feeLocked(seller.Account, QuoteAsset, sellerFee, "trade", id)
	s.auditLocked(buyer.Account, "trade_filled", "trade", id, digest(trade))
	if seller.Account != buyer.Account {
		s.auditLocked(seller.Account, "trade_filled", "trade", id, digest(trade))
	}
}

func (s *Service) releaseOrderReserveLocked(o *Order) {
	if o.ReservedMicro <= 0 {
		return
	}
	asset := NativeAsset
	if o.Side == "buy" {
		asset = QuoteAsset
	}
	b := s.balanceLocked(o.Account, asset)
	release := min64(b.ReservedMicro, o.ReservedMicro)
	b.ReservedMicro -= release
	b.AvailableMicro += release
	o.ReservedMicro = 0
	s.state.Balances[balanceKey(o.Account, asset)] = b
	s.ledgerLocked(o.Account, asset, release, -release, "order_reserve_release", o.ID, o.AuthorizationDigest)
}

func (s *Service) Book() OrderBook {
	s.mu.Lock()
	defer s.mu.Unlock()
	book := OrderBook{Market: DefaultMarket, Bids: []Order{}, Asks: []Order{}}
	for _, o := range s.state.Orders {
		if o.Market == DefaultMarket && (o.Status == "open" || o.Status == "partially_filled") {
			if o.Side == "buy" {
				book.Bids = append(book.Bids, o)
			} else {
				book.Asks = append(book.Asks, o)
			}
		}
	}
	sort.Slice(book.Bids, func(i, j int) bool { return book.Bids[i].PriceMicro > book.Bids[j].PriceMicro })
	sort.Slice(book.Asks, func(i, j int) bool { return book.Asks[i].PriceMicro < book.Asks[j].PriceMicro })
	return book
}

type AccountSnapshot struct {
	Balances       []Balance        `json:"balances"`
	Ledger         []LedgerEntry    `json:"ledger"`
	DepositIntents []DepositIntent  `json:"depositIntents"`
	Orders         []Order          `json:"orders"`
	Trades         []Trade          `json:"trades"`
	Fees           []FeeRecord      `json:"fees"`
	Deposits       []Deposit        `json:"deposits"`
	Withdrawals    []Withdrawal     `json:"withdrawals"`
	Security       SecuritySettings `json:"security"`
	Support        []SupportCase    `json:"support"`
	AI             []AIRecord       `json:"ai"`
	Audit          []AuditEvent     `json:"audit"`
}

func (s *Service) Snapshot(account string) AccountSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := AccountSnapshot{Balances: []Balance{s.balanceLocked(account, NativeAsset), s.balanceLocked(account, QuoteAsset)}, Ledger: []LedgerEntry{}, DepositIntents: []DepositIntent{}, Orders: []Order{}, Trades: []Trade{}, Fees: []FeeRecord{}, Deposits: []Deposit{}, Withdrawals: []Withdrawal{}, Security: s.securityLocked(account), Support: []SupportCase{}, AI: []AIRecord{}, Audit: []AuditEvent{}}
	for _, v := range s.state.Ledger {
		if v.Account == account {
			r.Ledger = append(r.Ledger, v)
		}
	}
	for _, v := range s.state.DepositIntents {
		if v.Account == account {
			r.DepositIntents = append(r.DepositIntents, v)
		}
	}
	for _, v := range s.state.Orders {
		if v.Account == account {
			r.Orders = append(r.Orders, v)
		}
	}
	for _, v := range s.state.Trades {
		if v.Buyer == account || v.Seller == account {
			r.Trades = append(r.Trades, v)
		}
	}
	for _, v := range s.state.Fees {
		if v.Account == account {
			r.Fees = append(r.Fees, v)
		}
	}
	for _, v := range s.state.Deposits {
		if v.Account == account {
			r.Deposits = append(r.Deposits, v)
		}
	}
	for _, v := range s.state.Withdrawals {
		if v.Account == account {
			r.Withdrawals = append(r.Withdrawals, v)
		}
	}
	for _, v := range s.state.Support {
		if v.Account == account {
			r.Support = append(r.Support, v)
		}
	}
	for _, v := range s.state.AI {
		if v.Account == account {
			r.AI = append(r.AI, v)
		}
	}
	for _, v := range s.state.Audit {
		if v.Account == account {
			r.Audit = append(r.Audit, v)
		}
	}
	return r
}

func (s *Service) UpdateSecurity(session WalletSession, settings SecuritySettings) (SecuritySettings, error) {
	if settings.SessionTTLMinutes < 15 || settings.SessionTTLMinutes > 480 {
		return SecuritySettings{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	settings.Account = session.Account
	settings.UpdatedAt = s.cfg.Now().UTC()
	before := cloneState(s.state)
	s.state.Security[session.Account] = settings
	s.auditLocked(session.Account, "security_settings_updated", "security", session.Account, digest(settings))
	if err := s.saveOrRollbackLocked(before); err != nil {
		return SecuritySettings{}, err
	}
	return settings, nil
}
func (s *Service) CreateSupport(session WalletSession, category, message, key string) (SupportCase, error) {
	category = strings.TrimSpace(category)
	message = strings.TrimSpace(message)
	if len(category) < 2 || len(category) > 40 || len(message) < 10 || len(message) > 2000 || !validKey(key) {
		return SupportCase{}, ErrInvalid
	}
	d := digest(struct{ C, M string }{category, message})
	s.mu.Lock()
	defer s.mu.Unlock()
	if prev, ok := s.state.Idempotency[key]; ok {
		if prev.Action != "support_create" || prev.Digest != d {
			return SupportCase{}, ErrConflict
		}
		return s.state.Support[prev.ObjectID], nil
	}
	id := s.nextIDLocked("case")
	c := SupportCase{ID: id, Account: session.Account, Category: category, Message: message, Status: "open", CreatedAt: s.cfg.Now().UTC()}
	before := cloneState(s.state)
	s.state.Support[id] = c
	s.state.Idempotency[key] = idempotencyRecord{Action: "support_create", Digest: d, ObjectID: id}
	s.auditLocked(session.Account, "support_case_opened", "support", id, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return SupportCase{}, err
	}
	return c, nil
}

func (s *Service) DraftAI(session WalletSession, kind, prompt string, contexts []string, permission bool) (AIRecord, error) {
	kind = strings.TrimSpace(kind)
	prompt = strings.TrimSpace(prompt)
	allowed := map[string]bool{"market_explanation": true, "owned_trade_summary": true, "risk_explanation": true, "order_draft": true}
	if !allowed[kind] || len(prompt) < 3 || len(prompt) > 2000 || len(contexts) > 4 {
		return AIRecord{}, ErrInvalid
	}
	for _, c := range contexts {
		if c != "public_market_rules" && c != "owned_orders" && c != "owned_trades" && c != "owned_balances" {
			return AIRecord{}, ErrForbidden
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := s.nextIDLocked("ai")
	status := "permission_required"
	if permission {
		status = "provider_unavailable"
	}
	now := s.cfg.Now().UTC()
	r := AIRecord{ID: id, Account: session.Account, Kind: kind, ContextClasses: append([]string(nil), contexts...), Permission: permission, ProviderStatus: "not_configured", Provider: "YNX AI Gateway", Model: "unavailable", EstimateCredits: 1, Prompt: prompt, Status: status, CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.AI[id] = r
	s.auditLocked(session.Account, "ai_request_recorded", "ai", id, digest(r))
	if err := s.saveOrRollbackLocked(before); err != nil {
		return AIRecord{}, err
	}
	return r, nil
}

func (s *Service) ReviewAI(session WalletSession, id, action string) (AIRecord, error) {
	action = strings.ToLower(strings.TrimSpace(action))
	if action != "approve" && action != "retry" && action != "cancel" && action != "reject" && action != "delete" {
		return AIRecord{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.state.AI[id]
	if !ok {
		return AIRecord{}, ErrNotFound
	}
	if r.Account != session.Account {
		return AIRecord{}, ErrForbidden
	}
	before := cloneState(s.state)
	now := s.cfg.Now().UTC()
	switch action {
	case "approve":
		if r.Kind != "order_draft" || !r.Permission || r.Status != "result_ready" || strings.TrimSpace(r.Result) == "" || r.ApprovalDigest != "" {
			return AIRecord{}, ErrConflict
		}
		// Approval covers the exact immutable AI output and selected context only.
		// It intentionally does not create an order: PlaceOrder still requires a
		// fresh Wallet signature over the canonical order payload.
		r.ApprovalDigest = digest(struct {
			ID       string
			Kind     string
			Contexts []string
			Result   string
		}{r.ID, r.Kind, r.ContextClasses, r.Result})
		r.Status = "approved_for_wallet_review"
		r.ReviewedAction = "approve"
	case "retry":
		r.ProviderStatus = "not_configured"
		r.Status = "provider_unavailable"
		r.ReviewedAction = "retry"
	case "cancel":
		r.Status = "cancelled"
		r.ReviewedAction = "cancel"
	case "reject":
		r.Status = "rejected_by_user"
		r.ReviewedAction = "reject"
	case "delete":
		delete(s.state.AI, id)
		s.auditLocked(session.Account, "ai_context_deleted", "ai", id, digest(r))
		if err := s.saveOrRollbackLocked(before); err != nil {
			return AIRecord{}, err
		}
		r.Status = "deleted"
		r.ContextClasses = nil
		r.Prompt = ""
		return r, nil
	}
	r.UpdatedAt = now
	s.state.AI[id] = r
	s.auditLocked(session.Account, "ai_"+action, "ai", id, digest(r))
	if err := s.saveOrRollbackLocked(before); err != nil {
		return AIRecord{}, err
	}
	return r, nil
}

func (s *Service) balanceLocked(account, asset string) Balance {
	k := balanceKey(account, asset)
	b, ok := s.state.Balances[k]
	if !ok {
		b = Balance{Account: account, Asset: asset}
	}
	return b
}
func (s *Service) securityLocked(account string) SecuritySettings {
	v, ok := s.state.Security[account]
	if !ok {
		v = SecuritySettings{Account: account, OrderConfirmation: true, SessionTTLMinutes: 480}
	}
	return v
}
func (s *Service) nextIDLocked(prefix string) string {
	s.state.Sequence++
	return fmt.Sprintf("%s_%012d", prefix, s.state.Sequence)
}
func (s *Service) auditLocked(account, action, objectType, objectID, d string) {
	previous := ""
	if len(s.state.Audit) > 0 {
		previous = s.state.Audit[len(s.state.Audit)-1].Hash
	}
	e := AuditEvent{ID: s.nextIDLocked("audit"), Account: account, Action: action, ObjectType: objectType, ObjectID: objectID, Digest: d, CreatedAt: s.cfg.Now().UTC(), PreviousHash: previous}
	e.Hash = digest(e)
	s.state.Audit = append(s.state.Audit, e)
}
func (s *Service) ledgerLocked(account, asset string, available, reserved int64, sourceType, sourceID, sourceDigest string) {
	s.state.Ledger = append(s.state.Ledger, LedgerEntry{ID: s.nextIDLocked("ledger"), Account: account, Asset: asset, AvailableDelta: available, ReservedDelta: reserved, SourceType: sourceType, SourceID: sourceID, SourceDigest: sourceDigest, CreatedAt: s.cfg.Now().UTC()})
}
func (s *Service) feeLocked(account, asset string, amount int64, kind, ref string) {
	if amount <= 0 {
		return
	}
	s.state.Fees = append(s.state.Fees, FeeRecord{ID: s.nextIDLocked("fee"), Account: account, Asset: asset, AmountMicro: amount, Kind: kind, Reference: ref, CreatedAt: s.cfg.Now().UTC()})
}
func (s *Service) saveOrRollbackLocked(before persistentState) error {
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return err
	}
	return nil
}
func cloneState(v persistentState) persistentState {
	b, _ := json.Marshal(v)
	var out persistentState
	_ = json.Unmarshal(b, &out)
	return out
}
func digest(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func verifyWalletSignature(account, publicKeyHex string, payload []byte, signatureHex string) bool {
	derived, err := walletAccount(strings.TrimPrefix(strings.TrimSpace(publicKeyHex), "0x"))
	if err != nil || derived != account {
		return false
	}
	publicKeyBytes, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(publicKeyHex), "0x"))
	if err != nil {
		return false
	}
	publicKey, err := secp256k1.ParsePubKey(publicKeyBytes)
	if err != nil {
		return false
	}
	signatureBytes, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(signatureHex), "0x"))
	if err != nil || len(signatureBytes) != 64 {
		return false
	}
	var r, scalarS secp256k1.ModNScalar
	if r.SetByteSlice(signatureBytes[:32]) || scalarS.SetByteSlice(signatureBytes[32:]) || r.IsZero() || scalarS.IsZero() || scalarS.IsOverHalfOrder() {
		return false
	}
	signature := ecdsa.NewSignature(&r, &scalarS)
	h := sha256.Sum256(payload)
	return signature.Verify(h[:], publicKey)
}
func hashText(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func balanceKey(a, b string) string { return a + "|" + b }
func validKey(v string) bool        { v = strings.TrimSpace(v); return len(v) >= 8 && len(v) <= 128 }
func validHash(v string) bool {
	v = strings.TrimSpace(v)
	if len(v) < 16 || len(v) > 128 {
		return false
	}
	for _, r := range v {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F' || r == 'x') {
			return false
		}
	}
	return true
}
func mulDiv(a, b, c int64) int64 { return (a/c)*b + (a%c)*b/c }
func fee(amount, bps int64) int64 {
	if amount <= 0 || bps <= 0 {
		return 0
	}
	return (amount*bps + 9999) / 10000
}
func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
func crosses(a, b Order) bool {
	if a.Side == b.Side {
		return false
	}
	if a.Side == "buy" {
		return a.PriceMicro >= b.PriceMicro
	}
	return a.PriceMicro <= b.PriceMicro
}
