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
	mu                 sync.Mutex
	cfg                Config
	state              persistentState
	processingTriggers bool
}

type CompleteSessionRequest struct {
	ChallengeID     string `json:"challengeId"`
	WalletPublicKey string `json:"walletPublicKey"`
	WalletSignature string `json:"walletSignature"`
}

type PlaceOrderRequest struct {
	Market            string `json:"market"`
	Side              string `json:"side"`
	Type              string `json:"type"`
	TimeInForce       string `json:"timeInForce,omitempty"`
	PostOnly          bool   `json:"postOnly,omitempty"`
	PriceMicro        int64  `json:"priceMicro"`
	AmountMicro       int64  `json:"amountMicro"`
	IdempotencyKey    string `json:"idempotencyKey"`
	WalletSignature   string `json:"walletSignature"`
	QuantNonceDomain  string `json:"-"`
	QuantCapitalMicro int64  `json:"-"`
}

type AmendOrderRequest struct {
	PriceMicro        int64  `json:"priceMicro"`
	AmountMicro       int64  `json:"amountMicro"`
	TimeInForce       string `json:"timeInForce,omitempty"`
	PostOnly          bool   `json:"postOnly,omitempty"`
	IdempotencyKey    string `json:"idempotencyKey"`
	WalletSignature   string `json:"walletSignature"`
	QuantNonceDomain  string `json:"-"`
	QuantCapitalMicro int64  `json:"-"`
}

type DeadManRequest struct {
	Action          string `json:"action"`
	TimeoutSeconds  int64  `json:"timeoutSeconds"`
	NonceDomain     string `json:"nonceDomain"`
	IdempotencyKey  string `json:"idempotencyKey"`
	WalletSignature string `json:"walletSignature"`
}

type ConditionalOrderRequest struct {
	Market            string `json:"market"`
	Side              string `json:"side"`
	Kind              string `json:"kind"`
	TriggerPriceMicro int64  `json:"triggerPriceMicro"`
	TrailOffsetMicro  int64  `json:"trailOffsetMicro,omitempty"`
	LimitPriceMicro   int64  `json:"limitPriceMicro"`
	AmountMicro       int64  `json:"amountMicro"`
	IdempotencyKey    string `json:"idempotencyKey"`
	WalletSignature   string `json:"walletSignature"`
	QuantNonceDomain  string `json:"-"`
	QuantCapitalMicro int64  `json:"-"`
}

type OCORequest struct {
	Market                 string `json:"market"`
	Side                   string `json:"side"`
	StopTriggerPriceMicro  int64  `json:"stopTriggerPriceMicro"`
	StopLimitPriceMicro    int64  `json:"stopLimitPriceMicro"`
	TakeProfitTriggerMicro int64  `json:"takeProfitTriggerPriceMicro"`
	TakeProfitLimitMicro   int64  `json:"takeProfitLimitPriceMicro"`
	AmountMicro            int64  `json:"amountMicro"`
	IdempotencyKey         string `json:"idempotencyKey"`
	WalletSignature        string `json:"walletSignature"`
	QuantNonceDomain       string `json:"-"`
	QuantCapitalMicro      int64  `json:"-"`
}

type TWAPRequest struct {
	Market            string `json:"market"`
	Side              string `json:"side"`
	LimitPriceMicro   int64  `json:"limitPriceMicro"`
	TotalAmountMicro  int64  `json:"totalAmountMicro"`
	Slices            int    `json:"slices"`
	IntervalSeconds   int64  `json:"intervalSeconds"`
	IdempotencyKey    string `json:"idempotencyKey"`
	WalletSignature   string `json:"walletSignature"`
	QuantNonceDomain  string `json:"-"`
	QuantCapitalMicro int64  `json:"-"`
}

type IcebergRequest struct {
	Market             string `json:"market"`
	Side               string `json:"side"`
	PriceMicro         int64  `json:"priceMicro"`
	TotalAmountMicro   int64  `json:"totalAmountMicro"`
	DisplayAmountMicro int64  `json:"displayAmountMicro"`
	PostOnly           bool   `json:"postOnly,omitempty"`
	IdempotencyKey     string `json:"idempotencyKey"`
	WalletSignature    string `json:"walletSignature"`
	QuantNonceDomain   string `json:"-"`
	QuantCapitalMicro  int64  `json:"-"`
}

type ScaleRequest struct {
	Market            string `json:"market"`
	Side              string `json:"side"`
	StartPriceMicro   int64  `json:"startPriceMicro"`
	EndPriceMicro     int64  `json:"endPriceMicro"`
	TotalAmountMicro  int64  `json:"totalAmountMicro"`
	Levels            int    `json:"levels"`
	PostOnly          bool   `json:"postOnly,omitempty"`
	IdempotencyKey    string `json:"idempotencyKey"`
	WalletSignature   string `json:"walletSignature"`
	QuantNonceDomain  string `json:"-"`
	QuantCapitalMicro int64  `json:"-"`
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
	if err := verifyExecutionChain(&s); err != nil {
		return nil, err
	}
	if s.SchemaVersion < currentStateSchemaVersion {
		s.SchemaVersion = currentStateSchemaVersion
		migrated = true
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
	tif := strings.ToLower(strings.TrimSpace(req.TimeInForce))
	if tif == "" {
		if strings.EqualFold(strings.TrimSpace(req.Type), "market") {
			tif = "ioc"
		} else {
			tif = "gtc"
		}
	}
	if tif != "gtc" || req.PostOnly {
		return []byte(fmt.Sprintf("ynx-exchange-order-v2\n%s\n%s\n%s\n%s\n%s\n%t\n%d\n%d\n%s", account, req.Market, req.Side, req.Type, tif, req.PostOnly, req.PriceMicro, req.AmountMicro, req.IdempotencyKey))
	}
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
	if _, err := s.SweepDeadMan(); err != nil {
		return Order{}, err
	}
	req.Market = strings.ToUpper(strings.TrimSpace(req.Market))
	req.Side = strings.ToLower(strings.TrimSpace(req.Side))
	req.Type = strings.ToLower(strings.TrimSpace(req.Type))
	req.TimeInForce = strings.ToLower(strings.TrimSpace(req.TimeInForce))
	if req.TimeInForce == "" {
		if req.Type == "market" {
			req.TimeInForce = "ioc"
		} else {
			req.TimeInForce = "gtc"
		}
	}
	if req.Market != DefaultMarket || (req.Side != "buy" && req.Side != "sell") || (req.Type != "limit" && req.Type != "market") || (req.TimeInForce != "gtc" && req.TimeInForce != "ioc" && req.TimeInForce != "fok") || (req.PostOnly && req.TimeInForce != "gtc") || (req.Type == "market" && (req.TimeInForce != "ioc" || req.PostOnly)) || req.PriceMicro <= 0 || req.AmountMicro <= 0 || req.PriceMicro > 1_000_000*AmountScale || req.AmountMicro > 1_000_000*AmountScale || !validKey(req.IdempotencyKey) {
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
	if dm, ok := s.state.DeadMan[session.Account]; ok && dm.Status == "expired" {
		return Order{}, ErrForbidden
	}
	if s.quantStrategyKilledLocked(session.Account, req.QuantNonceDomain) {
		return Order{}, ErrForbidden
	}
	if !s.quantCapitalAllowsLocked(session.Account, req.QuantNonceDomain, req.QuantCapitalMicro, mulDiv(req.PriceMicro, req.AmountMicro, AmountScale), "") {
		return Order{}, ErrForbidden
	}
	if prev, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if prev.Action != "order_place" || prev.Digest != d {
			return Order{}, ErrConflict
		}
		return s.state.Orders[prev.ObjectID], nil
	}
	now := s.cfg.Now().UTC()
	id := s.nextIDLocked("order")
	o := Order{ID: id, Account: session.Account, QuantNonceDomain: req.QuantNonceDomain, Market: req.Market, Side: req.Side, Type: req.Type, TimeInForce: req.TimeInForce, PostOnly: req.PostOnly, PriceMicro: req.PriceMicro, AmountMicro: req.AmountMicro, PrioritySequence: s.state.Sequence, Status: "open", WalletAuthorized: true, CreatedAt: now, UpdatedAt: now, AuthorizationDigest: digest(OrderAuthorizationPayload(session.Account, req))}
	for _, other := range s.state.Orders {
		if other.Account == session.Account && other.Market == o.Market && (other.Status == "open" || other.Status == "partially_filled") && other.Side != o.Side && crosses(o, other) {
			o.Status = "rejected"
			o.RejectReason = "self_trade_prevention"
			before := cloneState(s.state)
			s.state.Orders[id] = o
			s.emitExecutionLocked("user", "order_rejected", session.Account, "order", id, o)
			s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "order_place", Digest: d, ObjectID: id}
			s.auditLocked(session.Account, "order_rejected", "order", id, d)
			if err := s.saveOrRollbackLocked(before); err != nil {
				return Order{}, err
			}
			return o, nil
		}
	}
	fillable := s.fillableLocked(o)
	if req.PostOnly && fillable > 0 {
		o.Status = "rejected"
		o.RejectReason = "post_only_would_take"
		before := cloneState(s.state)
		s.state.Orders[id] = o
		s.emitExecutionLocked("user", "order_rejected", session.Account, "order", id, o)
		s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "order_place", Digest: d, ObjectID: id}
		s.auditLocked(session.Account, "order_rejected", "order", id, d)
		if err := s.saveOrRollbackLocked(before); err != nil {
			return Order{}, err
		}
		return o, nil
	}
	if req.TimeInForce == "fok" && fillable < req.AmountMicro {
		o.Status = "rejected"
		o.RejectReason = "fok_not_fillable"
		before := cloneState(s.state)
		s.state.Orders[id] = o
		s.emitExecutionLocked("user", "order_rejected", session.Account, "order", id, o)
		s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "order_place", Digest: d, ObjectID: id}
		s.auditLocked(session.Account, "order_rejected", "order", id, d)
		if err := s.saveOrRollbackLocked(before); err != nil {
			return Order{}, err
		}
		return o, nil
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
	s.emitExecutionLocked("market", "book_changed", "", "order", id, o)
	s.emitExecutionLocked("user", "order_opened", session.Account, "order", id, o)
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "order_place", Digest: d, ObjectID: id}
	s.auditLocked(session.Account, "order_opened", "order", id, d)
	s.matchLocked(id)
	o = s.state.Orders[id]
	if req.TimeInForce == "ioc" && (o.Status == "open" || o.Status == "partially_filled") {
		s.releaseOrderReserveLocked(&o)
		o.Status = "expired"
		o.RejectReason = "ioc_remainder_cancelled"
		o.UpdatedAt = s.cfg.Now().UTC()
		s.state.Orders[id] = o
		s.emitExecutionLocked("market", "book_changed", "", "order", id, o)
		s.emitExecutionLocked("user", "order_expired", session.Account, "order", id, o)
		s.auditLocked(session.Account, "order_ioc_expired", "order", id, d)
	}
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Order{}, err
	}
	return o, nil
}

func (s *Service) fillableLocked(incoming Order) int64 {
	var total int64
	needed := executableRemaining(incoming)
	for _, o := range s.state.Orders {
		if o.ID != incoming.ID && o.Account != incoming.Account && o.Market == incoming.Market && o.Side != incoming.Side && isOpenOrder(o) && crosses(incoming, o) {
			total += executableRemaining(o)
			if total >= needed {
				return needed
			}
		}
	}
	return total
}

func AmendOrderAuthorizationPayload(account, orderID string, req AmendOrderRequest) []byte {
	tif := strings.ToLower(strings.TrimSpace(req.TimeInForce))
	if tif == "" {
		tif = "gtc"
	}
	return []byte(fmt.Sprintf("ynx-exchange-amend-v1\n%s\n%s\n%d\n%d\n%s\n%t\n%s", account, orderID, req.PriceMicro, req.AmountMicro, tif, req.PostOnly, req.IdempotencyKey))
}

func (s *Service) AmendOrder(session WalletSession, orderID string, req AmendOrderRequest) (Order, error) {
	if _, err := s.SweepDeadMan(); err != nil {
		return Order{}, err
	}
	req.TimeInForce = strings.ToLower(strings.TrimSpace(req.TimeInForce))
	if req.TimeInForce == "" {
		req.TimeInForce = "gtc"
	}
	if strings.TrimSpace(orderID) == "" || req.PriceMicro <= 0 || req.AmountMicro <= 0 || req.PriceMicro > 1_000_000*AmountScale || req.AmountMicro > 1_000_000*AmountScale || (req.TimeInForce != "gtc" && req.TimeInForce != "ioc" && req.TimeInForce != "fok") || (req.PostOnly && req.TimeInForce != "gtc") || !validKey(req.IdempotencyKey) {
		return Order{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, AmendOrderAuthorizationPayload(session.Account, orderID, req), req.WalletSignature) {
		return Order{}, ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if dm, ok := s.state.DeadMan[session.Account]; ok && dm.Status == "expired" {
		return Order{}, ErrForbidden
	}
	if s.quantStrategyKilledLocked(session.Account, req.QuantNonceDomain) {
		return Order{}, ErrForbidden
	}
	d := digest(struct {
		OrderID string
		Request AmendOrderRequest
	}{orderID, req})
	if prev, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if prev.Action != "order_amend" || prev.Digest != d || prev.ObjectID != orderID {
			return Order{}, ErrConflict
		}
		return s.state.Orders[orderID], nil
	}
	original, ok := s.state.Orders[orderID]
	if !ok {
		return Order{}, ErrNotFound
	}
	if original.Account != session.Account {
		return Order{}, ErrForbidden
	}
	if req.QuantNonceDomain != "" && original.QuantNonceDomain != req.QuantNonceDomain {
		return Order{}, ErrForbidden
	}
	if original.Status != "open" && original.Status != "partially_filled" {
		return Order{}, ErrConflict
	}
	if original.Type != "limit" || req.AmountMicro <= original.FilledMicro {
		return Order{}, ErrInvalid
	}
	remaining := req.AmountMicro - original.FilledMicro
	proposedNotional := mulDiv(remaining, req.PriceMicro, AmountScale)
	if proposedNotional > s.cfg.MaxOrderNotionalMicro || !s.quantCapitalAllowsLocked(session.Account, req.QuantNonceDomain, req.QuantCapitalMicro, proposedNotional, orderID) {
		return Order{}, ErrForbidden
	}
	amended := original
	amended.PriceMicro = req.PriceMicro
	amended.AmountMicro = req.AmountMicro
	amended.TimeInForce = req.TimeInForce
	amended.PostOnly = req.PostOnly
	amended.Status = "open"
	if amended.FilledMicro > 0 {
		amended.Status = "partially_filled"
	}
	amended.RejectReason = ""
	now := s.cfg.Now().UTC()
	amended.CreatedAt = now
	amended.UpdatedAt = now
	amended.AuthorizationDigest = digest(AmendOrderAuthorizationPayload(session.Account, orderID, req))
	for _, other := range s.state.Orders {
		if other.ID != amended.ID && other.Account == session.Account && other.Market == amended.Market && (other.Status == "open" || other.Status == "partially_filled") && other.Side != amended.Side && crosses(amended, other) {
			return Order{}, ErrForbidden
		}
	}
	fillable := s.fillableLocked(amended)
	if req.PostOnly && fillable > 0 {
		return Order{}, ErrConflict
	}
	if req.TimeInForce == "fok" && fillable < remaining {
		return Order{}, ErrConflict
	}
	reserve := remaining
	asset := NativeAsset
	if amended.Side == "buy" {
		quote := mulDiv(remaining, req.PriceMicro, AmountScale)
		reserve = quote + fee(quote, s.cfg.TakerFeeBPS)
		asset = QuoteAsset
	}
	balance := s.balanceLocked(session.Account, asset)
	if balance.AvailableMicro+original.ReservedMicro < reserve {
		return Order{}, ErrInsufficient
	}
	before := cloneState(s.state)
	s.state.Sequence++
	amended.PrioritySequence = s.state.Sequence
	s.releaseOrderReserveLocked(&original)
	balance = s.balanceLocked(session.Account, asset)
	balance.AvailableMicro -= reserve
	balance.ReservedMicro += reserve
	s.state.Balances[balanceKey(session.Account, asset)] = balance
	s.ledgerLocked(session.Account, asset, -reserve, reserve, "order_amend_reserve", orderID, amended.AuthorizationDigest)
	amended.ReservedMicro = reserve
	s.state.Orders[orderID] = amended
	s.emitExecutionLocked("market", "book_changed", "", "order", orderID, amended)
	s.emitExecutionLocked("user", "order_amended", session.Account, "order", orderID, amended)
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "order_amend", Digest: d, ObjectID: orderID}
	s.auditLocked(session.Account, "order_amended", "order", orderID, d)
	s.matchLocked(orderID)
	amended = s.state.Orders[orderID]
	if req.TimeInForce == "ioc" && (amended.Status == "open" || amended.Status == "partially_filled") {
		s.releaseOrderReserveLocked(&amended)
		amended.Status = "expired"
		amended.RejectReason = "ioc_remainder_cancelled"
		amended.UpdatedAt = s.cfg.Now().UTC()
		s.state.Orders[orderID] = amended
		s.emitExecutionLocked("market", "book_changed", "", "order", orderID, amended)
		s.emitExecutionLocked("user", "order_expired", session.Account, "order", orderID, amended)
		s.auditLocked(session.Account, "order_ioc_expired", "order", orderID, d)
	}
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Order{}, err
	}
	return amended, nil
}

func ConditionalOrderAuthorizationPayload(account string, req ConditionalOrderRequest) []byte {
	if strings.EqualFold(strings.TrimSpace(req.Kind), "trailing") || req.TrailOffsetMicro != 0 {
		return []byte(fmt.Sprintf("ynx-exchange-conditional-v2\n%s\n%s\n%s\n%s\n%d\n%d\n%d\n%s", account, strings.ToUpper(strings.TrimSpace(req.Market)), strings.ToLower(strings.TrimSpace(req.Side)), strings.ToLower(strings.TrimSpace(req.Kind)), req.TrailOffsetMicro, req.LimitPriceMicro, req.AmountMicro, req.IdempotencyKey))
	}
	return []byte(fmt.Sprintf("ynx-exchange-conditional-v1\n%s\n%s\n%s\n%s\n%d\n%d\n%d\n%s", account, strings.ToUpper(strings.TrimSpace(req.Market)), strings.ToLower(strings.TrimSpace(req.Side)), strings.ToLower(strings.TrimSpace(req.Kind)), req.TriggerPriceMicro, req.LimitPriceMicro, req.AmountMicro, req.IdempotencyKey))
}

func OCOAuthorizationPayload(account string, req OCORequest) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-oco-v1\n%s\n%s\n%s\n%d\n%d\n%d\n%d\n%d\n%s", account, strings.ToUpper(strings.TrimSpace(req.Market)), strings.ToLower(strings.TrimSpace(req.Side)), req.StopTriggerPriceMicro, req.StopLimitPriceMicro, req.TakeProfitTriggerMicro, req.TakeProfitLimitMicro, req.AmountMicro, req.IdempotencyKey))
}

func (s *Service) CreateOCO(session WalletSession, req OCORequest) (OCOGroup, error) {
	if _, err := s.SweepDeadMan(); err != nil {
		return OCOGroup{}, err
	}
	req.Market = strings.ToUpper(strings.TrimSpace(req.Market))
	req.Side = strings.ToLower(strings.TrimSpace(req.Side))
	pricesValid := req.StopTriggerPriceMicro > 0 && req.StopLimitPriceMicro > 0 && req.TakeProfitTriggerMicro > 0 && req.TakeProfitLimitMicro > 0
	ordered := (req.Side == "sell" && req.StopTriggerPriceMicro < req.TakeProfitTriggerMicro) || (req.Side == "buy" && req.StopTriggerPriceMicro > req.TakeProfitTriggerMicro)
	if req.Market != DefaultMarket || (req.Side != "buy" && req.Side != "sell") || !pricesValid || !ordered || req.AmountMicro <= 0 || req.AmountMicro > 1_000_000*AmountScale || !validKey(req.IdempotencyKey) {
		return OCOGroup{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, OCOAuthorizationPayload(session.Account, req), req.WalletSignature) {
		return OCOGroup{}, ErrUnauthorized
	}
	maxLimit := req.StopLimitPriceMicro
	if req.TakeProfitLimitMicro > maxLimit {
		maxLimit = req.TakeProfitLimitMicro
	}
	if mulDiv(req.AmountMicro, maxLimit, AmountScale) > s.cfg.MaxOrderNotionalMicro {
		return OCOGroup{}, ErrForbidden
	}
	d := digest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if dm, ok := s.state.DeadMan[session.Account]; ok && dm.Status == "expired" {
		return OCOGroup{}, ErrForbidden
	}
	if s.quantStrategyKilledLocked(session.Account, req.QuantNonceDomain) {
		return OCOGroup{}, ErrForbidden
	}
	if !s.quantCapitalAllowsLocked(session.Account, req.QuantNonceDomain, req.QuantCapitalMicro, mulDiv(maxLimit, req.AmountMicro, AmountScale), "") {
		return OCOGroup{}, ErrForbidden
	}
	if prior, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if prior.Action != "oco_create" || prior.Digest != d {
			return OCOGroup{}, ErrConflict
		}
		return s.state.OCOGroups[prior.ObjectID], nil
	}
	reserve := req.AmountMicro
	asset := NativeAsset
	if req.Side == "buy" {
		quote := mulDiv(req.AmountMicro, maxLimit, AmountScale)
		reserve = quote + fee(quote, s.cfg.TakerFeeBPS)
		asset = QuoteAsset
	}
	balance := s.balanceLocked(session.Account, asset)
	if balance.AvailableMicro < reserve {
		return OCOGroup{}, ErrInsufficient
	}
	now := s.cfg.Now().UTC()
	groupID := s.nextIDLocked("oco")
	stopID := s.nextIDLocked("conditional")
	tpID := s.nextIDLocked("conditional")
	authorization := digest(OCOAuthorizationPayload(session.Account, req))
	group := OCOGroup{ID: groupID, Account: session.Account, QuantNonceDomain: req.QuantNonceDomain, Market: req.Market, Side: req.Side, AmountMicro: req.AmountMicro, ReservedMicro: reserve, StopConditionalID: stopID, TakeProfitConditionalID: tpID, Status: "pending_trigger", AuthorizationDigest: authorization, CreatedAt: now, UpdatedAt: now}
	stop := ConditionalOrder{ID: stopID, GroupID: groupID, Account: session.Account, QuantNonceDomain: req.QuantNonceDomain, Market: req.Market, Side: req.Side, Kind: "stop", TriggerPriceMicro: req.StopTriggerPriceMicro, LimitPriceMicro: req.StopLimitPriceMicro, AmountMicro: req.AmountMicro, Status: "pending_trigger", WalletAuthorized: true, AuthorizationDigest: authorization, CreatedAt: now, UpdatedAt: now}
	tp := ConditionalOrder{ID: tpID, GroupID: groupID, Account: session.Account, QuantNonceDomain: req.QuantNonceDomain, Market: req.Market, Side: req.Side, Kind: "take_profit", TriggerPriceMicro: req.TakeProfitTriggerMicro, LimitPriceMicro: req.TakeProfitLimitMicro, AmountMicro: req.AmountMicro, Status: "pending_trigger", WalletAuthorized: true, AuthorizationDigest: authorization, CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	balance.AvailableMicro -= reserve
	balance.ReservedMicro += reserve
	s.state.Balances[balanceKey(session.Account, asset)] = balance
	s.ledgerLocked(session.Account, asset, -reserve, reserve, "oco_reserve", groupID, authorization)
	s.state.OCOGroups[groupID] = group
	s.state.ConditionalOrders[stopID] = stop
	s.state.ConditionalOrders[tpID] = tp
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "oco_create", Digest: d, ObjectID: groupID}
	s.emitExecutionLocked("user", "oco_created", session.Account, "oco_group", groupID, group)
	s.auditLocked(session.Account, "oco_created", "oco_group", groupID, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return OCOGroup{}, err
	}
	return group, nil
}

func TWAPAuthorizationPayload(account string, req TWAPRequest) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-twap-v1\n%s\n%s\n%s\n%d\n%d\n%d\n%d\n%s", account, strings.ToUpper(strings.TrimSpace(req.Market)), strings.ToLower(strings.TrimSpace(req.Side)), req.LimitPriceMicro, req.TotalAmountMicro, req.Slices, req.IntervalSeconds, req.IdempotencyKey))
}

func IcebergAuthorizationPayload(account string, req IcebergRequest) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-iceberg-v1\n%s\n%s\n%s\n%d\n%d\n%d\n%t\n%s", account, strings.ToUpper(strings.TrimSpace(req.Market)), strings.ToLower(strings.TrimSpace(req.Side)), req.PriceMicro, req.TotalAmountMicro, req.DisplayAmountMicro, req.PostOnly, req.IdempotencyKey))
}

func ScaleAuthorizationPayload(account string, req ScaleRequest) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-scale-v1\n%s\n%s\n%s\n%d\n%d\n%d\n%d\n%t\n%s", account, strings.ToUpper(strings.TrimSpace(req.Market)), strings.ToLower(strings.TrimSpace(req.Side)), req.StartPriceMicro, req.EndPriceMicro, req.TotalAmountMicro, req.Levels, req.PostOnly, req.IdempotencyKey))
}

func (s *Service) CreateIceberg(session WalletSession, req IcebergRequest) (Order, error) {
	if _, err := s.SweepDeadMan(); err != nil {
		return Order{}, err
	}
	req.Market = strings.ToUpper(strings.TrimSpace(req.Market))
	req.Side = strings.ToLower(strings.TrimSpace(req.Side))
	if req.Market != DefaultMarket || (req.Side != "buy" && req.Side != "sell") || req.PriceMicro <= 0 || req.PriceMicro > 1_000_000*AmountScale || req.TotalAmountMicro <= 0 || req.TotalAmountMicro > 1_000_000*AmountScale || req.DisplayAmountMicro <= 0 || req.DisplayAmountMicro >= req.TotalAmountMicro || !validKey(req.IdempotencyKey) {
		return Order{}, ErrInvalid
	}
	payload := IcebergAuthorizationPayload(session.Account, req)
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, payload, req.WalletSignature) {
		return Order{}, ErrUnauthorized
	}
	if mulDiv(req.TotalAmountMicro, req.PriceMicro, AmountScale) > s.cfg.MaxOrderNotionalMicro {
		return Order{}, ErrForbidden
	}
	d := digest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if dm, ok := s.state.DeadMan[session.Account]; ok && dm.Status == "expired" {
		return Order{}, ErrForbidden
	}
	if s.quantStrategyKilledLocked(session.Account, req.QuantNonceDomain) {
		return Order{}, ErrForbidden
	}
	if !s.quantCapitalAllowsLocked(session.Account, req.QuantNonceDomain, req.QuantCapitalMicro, mulDiv(req.PriceMicro, req.TotalAmountMicro, AmountScale), "") {
		return Order{}, ErrForbidden
	}
	if prior, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if prior.Action != "iceberg_place" || prior.Digest != d {
			return Order{}, ErrConflict
		}
		return s.state.Orders[prior.ObjectID], nil
	}
	now := s.cfg.Now().UTC()
	id := s.nextIDLocked("order")
	order := Order{ID: id, Account: session.Account, QuantNonceDomain: req.QuantNonceDomain, Market: req.Market, Side: req.Side, Type: "iceberg", TimeInForce: "gtc", PostOnly: req.PostOnly, PriceMicro: req.PriceMicro, AmountMicro: req.TotalAmountMicro, DisplayAmountMicro: req.DisplayAmountMicro, VisibleUntilMicro: req.DisplayAmountMicro, PrioritySequence: s.state.Sequence, Status: "open", WalletAuthorized: true, CreatedAt: now, UpdatedAt: now, AuthorizationDigest: digest(payload)}
	for _, other := range s.state.Orders {
		if other.Account == order.Account && other.Market == order.Market && other.Side != order.Side && isOpenOrder(other) && crosses(order, other) {
			return Order{}, ErrForbidden
		}
	}
	if req.PostOnly && s.fillableLocked(order) > 0 {
		return Order{}, ErrConflict
	}
	reserve := req.TotalAmountMicro
	asset := NativeAsset
	if req.Side == "buy" {
		quote := mulDiv(req.TotalAmountMicro, req.PriceMicro, AmountScale)
		reserve = quote + fee(quote, s.cfg.TakerFeeBPS)
		asset = QuoteAsset
	}
	balance := s.balanceLocked(session.Account, asset)
	if balance.AvailableMicro < reserve {
		return Order{}, ErrInsufficient
	}
	before := cloneState(s.state)
	balance.AvailableMicro -= reserve
	balance.ReservedMicro += reserve
	s.state.Balances[balanceKey(session.Account, asset)] = balance
	s.ledgerLocked(session.Account, asset, -reserve, reserve, "iceberg_reserve", id, order.AuthorizationDigest)
	order.ReservedMicro = reserve
	s.state.Orders[id] = order
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "iceberg_place", Digest: d, ObjectID: id}
	s.emitExecutionLocked("market", "book_changed", "", "order", id, order)
	s.emitExecutionLocked("user", "iceberg_opened", session.Account, "order", id, order)
	s.auditLocked(session.Account, "iceberg_opened", "order", id, d)
	s.matchLocked(id)
	order = s.state.Orders[id]
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Order{}, err
	}
	return order, nil
}

func (s *Service) CreateScale(session WalletSession, req ScaleRequest) (ScaleOrder, error) {
	if _, err := s.SweepDeadMan(); err != nil {
		return ScaleOrder{}, err
	}
	req.Market = strings.ToUpper(strings.TrimSpace(req.Market))
	req.Side = strings.ToLower(strings.TrimSpace(req.Side))
	delta := req.EndPriceMicro - req.StartPriceMicro
	steps := int64(req.Levels - 1)
	if req.Market != DefaultMarket || (req.Side != "buy" && req.Side != "sell") || req.Levels < 2 || req.Levels > 100 || req.StartPriceMicro <= 0 || req.EndPriceMicro <= 0 || req.StartPriceMicro > 1_000_000*AmountScale || req.EndPriceMicro > 1_000_000*AmountScale || delta == 0 || steps <= 0 || delta%steps != 0 || req.TotalAmountMicro < int64(req.Levels) || req.TotalAmountMicro > 1_000_000*AmountScale || !validKey(req.IdempotencyKey) {
		return ScaleOrder{}, ErrInvalid
	}
	payload := ScaleAuthorizationPayload(session.Account, req)
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, payload, req.WalletSignature) {
		return ScaleOrder{}, ErrUnauthorized
	}
	d := digest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if dm, ok := s.state.DeadMan[session.Account]; ok && dm.Status == "expired" {
		return ScaleOrder{}, ErrForbidden
	}
	if s.quantStrategyKilledLocked(session.Account, req.QuantNonceDomain) {
		return ScaleOrder{}, ErrForbidden
	}
	if prior, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if prior.Action != "scale_create" || prior.Digest != d {
			return ScaleOrder{}, ErrConflict
		}
		return s.state.ScaleOrders[prior.ObjectID], nil
	}
	type levelSpec struct{ price, amount, reserve int64 }
	levels := make([]levelSpec, req.Levels)
	baseAmount := req.TotalAmountMicro / int64(req.Levels)
	var totalReserve, totalNotional int64
	for i := range levels {
		amount := baseAmount
		if i == len(levels)-1 {
			amount = req.TotalAmountMicro - baseAmount*int64(len(levels)-1)
		}
		price := req.StartPriceMicro + delta*int64(i)/steps
		notional := mulDiv(price, amount, AmountScale)
		reserve := amount
		if req.Side == "buy" {
			reserve = notional + fee(notional, s.cfg.TakerFeeBPS)
		}
		if reserve <= 0 || totalReserve > int64(^uint64(0)>>1)-reserve || totalNotional > int64(^uint64(0)>>1)-notional {
			return ScaleOrder{}, ErrInvalid
		}
		totalReserve += reserve
		totalNotional += notional
		levels[i] = levelSpec{price: price, amount: amount, reserve: reserve}
		tentative := Order{Account: session.Account, Market: req.Market, Side: req.Side, Type: "scale_child", TimeInForce: "gtc", PostOnly: req.PostOnly, PriceMicro: price, AmountMicro: amount, Status: "open"}
		for _, other := range s.state.Orders {
			if other.Account == session.Account && other.Market == req.Market && other.Side != req.Side && isOpenOrder(other) && crosses(tentative, other) {
				return ScaleOrder{}, ErrForbidden
			}
		}
		if req.PostOnly && s.fillableLocked(tentative) > 0 {
			return ScaleOrder{}, ErrConflict
		}
	}
	if totalNotional > s.cfg.MaxOrderNotionalMicro || !s.quantCapitalAllowsLocked(session.Account, req.QuantNonceDomain, req.QuantCapitalMicro, totalNotional, "") {
		return ScaleOrder{}, ErrForbidden
	}
	asset := NativeAsset
	if req.Side == "buy" {
		asset = QuoteAsset
	}
	balance := s.balanceLocked(session.Account, asset)
	if balance.AvailableMicro < totalReserve {
		return ScaleOrder{}, ErrInsufficient
	}
	before := cloneState(s.state)
	now := s.cfg.Now().UTC()
	parentID := s.nextIDLocked("scale")
	parent := ScaleOrder{ID: parentID, Account: session.Account, QuantNonceDomain: req.QuantNonceDomain, Market: req.Market, Side: req.Side, StartPriceMicro: req.StartPriceMicro, EndPriceMicro: req.EndPriceMicro, TotalAmountMicro: req.TotalAmountMicro, ReservedMicro: totalReserve, Levels: req.Levels, PostOnly: req.PostOnly, ChildOrderIDs: make([]string, 0, req.Levels), Status: "open", AuthorizationDigest: digest(payload), CreatedAt: now, UpdatedAt: now}
	balance.AvailableMicro -= totalReserve
	balance.ReservedMicro += totalReserve
	s.state.Balances[balanceKey(session.Account, asset)] = balance
	s.ledgerLocked(session.Account, asset, -totalReserve, totalReserve, "scale_reserve", parentID, parent.AuthorizationDigest)
	for _, spec := range levels {
		id := s.nextIDLocked("order")
		child := Order{ID: id, ParentOrderID: parentID, Account: session.Account, QuantNonceDomain: req.QuantNonceDomain, Market: req.Market, Side: req.Side, Type: "scale_child", TimeInForce: "gtc", PostOnly: req.PostOnly, PriceMicro: spec.price, AmountMicro: spec.amount, ReservedMicro: spec.reserve, PrioritySequence: s.state.Sequence, Status: "open", WalletAuthorized: true, CreatedAt: now, UpdatedAt: now, AuthorizationDigest: parent.AuthorizationDigest}
		s.state.Orders[id] = child
		parent.ChildOrderIDs = append(parent.ChildOrderIDs, id)
		s.emitExecutionLocked("market", "book_changed", "", "order", id, child)
		s.emitExecutionLocked("user", "scale_child_opened", session.Account, "order", id, child)
	}
	s.state.ScaleOrders[parentID] = parent
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "scale_create", Digest: d, ObjectID: parentID}
	s.emitExecutionLocked("user", "scale_opened", session.Account, "scale", parentID, parent)
	s.auditLocked(session.Account, "scale_opened", "scale", parentID, d)
	for _, id := range parent.ChildOrderIDs {
		s.matchLocked(id)
	}
	s.syncScaleLocked(parentID, "")
	parent = s.state.ScaleOrders[parentID]
	if err := s.saveOrRollbackLocked(before); err != nil {
		return ScaleOrder{}, err
	}
	return parent, nil
}

func (s *Service) syncScaleLocked(parentID, reason string) {
	parent, ok := s.state.ScaleOrders[parentID]
	if !ok {
		return
	}
	var filled, reserved int64
	open, filledChildren, cancelled := 0, 0, 0
	for _, id := range parent.ChildOrderIDs {
		child, exists := s.state.Orders[id]
		if !exists {
			continue
		}
		filled += child.FilledMicro
		reserved += child.ReservedMicro
		if isOpenOrder(child) {
			open++
		} else if child.Status == "filled" {
			filledChildren++
		} else if child.Status == "cancelled" {
			cancelled++
		}
	}
	parent.FilledMicro = filled
	parent.ReservedMicro = reserved
	parent.UpdatedAt = s.cfg.Now().UTC()
	switch {
	case open > 0 && filled > 0:
		parent.Status = "partially_filled"
	case open > 0:
		parent.Status = "open"
	case filledChildren == len(parent.ChildOrderIDs):
		parent.Status = "filled"
	case cancelled > 0 && filled > 0:
		parent.Status = "partially_cancelled"
	case cancelled > 0:
		parent.Status = "cancelled"
	default:
		parent.Status = "closed"
	}
	if reason != "" {
		parent.RejectReason = reason
	}
	s.state.ScaleOrders[parentID] = parent
	s.emitExecutionLocked("user", "scale_updated", parent.Account, "scale", parent.ID, parent)
}

func (s *Service) CreateTWAP(session WalletSession, req TWAPRequest) (TWAPOrder, error) {
	if _, err := s.SweepDeadMan(); err != nil {
		return TWAPOrder{}, err
	}
	req.Market = strings.ToUpper(strings.TrimSpace(req.Market))
	req.Side = strings.ToLower(strings.TrimSpace(req.Side))
	if req.Market != DefaultMarket || (req.Side != "buy" && req.Side != "sell") || req.LimitPriceMicro <= 0 || req.TotalAmountMicro <= 0 || req.TotalAmountMicro > 1_000_000*AmountScale || req.Slices < 2 || req.Slices > 100 || req.TotalAmountMicro < int64(req.Slices) || req.IntervalSeconds < 1 || req.IntervalSeconds > 3600 || !validKey(req.IdempotencyKey) {
		return TWAPOrder{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, TWAPAuthorizationPayload(session.Account, req), req.WalletSignature) {
		return TWAPOrder{}, ErrUnauthorized
	}
	if mulDiv(req.TotalAmountMicro, req.LimitPriceMicro, AmountScale) > s.cfg.MaxOrderNotionalMicro {
		return TWAPOrder{}, ErrForbidden
	}
	d := digest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if dm, ok := s.state.DeadMan[session.Account]; ok && dm.Status == "expired" {
		return TWAPOrder{}, ErrForbidden
	}
	if s.quantStrategyKilledLocked(session.Account, req.QuantNonceDomain) {
		return TWAPOrder{}, ErrForbidden
	}
	if !s.quantCapitalAllowsLocked(session.Account, req.QuantNonceDomain, req.QuantCapitalMicro, mulDiv(req.LimitPriceMicro, req.TotalAmountMicro, AmountScale), "") {
		return TWAPOrder{}, ErrForbidden
	}
	if prior, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if prior.Action != "twap_create" || prior.Digest != d {
			return TWAPOrder{}, ErrConflict
		}
		return s.state.TWAPOrders[prior.ObjectID], nil
	}
	reserve := req.TotalAmountMicro
	asset := NativeAsset
	if req.Side == "buy" {
		quote := mulDiv(req.TotalAmountMicro, req.LimitPriceMicro, AmountScale)
		reserve = quote + fee(quote, s.cfg.TakerFeeBPS)
		asset = QuoteAsset
	}
	balance := s.balanceLocked(session.Account, asset)
	if balance.AvailableMicro < reserve {
		return TWAPOrder{}, ErrInsufficient
	}
	now := s.cfg.Now().UTC()
	id := s.nextIDLocked("twap")
	twap := TWAPOrder{ID: id, Account: session.Account, QuantNonceDomain: req.QuantNonceDomain, Market: req.Market, Side: req.Side, LimitPriceMicro: req.LimitPriceMicro, TotalAmountMicro: req.TotalAmountMicro, ReservedMicro: reserve, Slices: req.Slices, IntervalSeconds: req.IntervalSeconds, NextRunAt: now, Status: "scheduled", ChildOrderIDs: []string{}, AuthorizationDigest: digest(TWAPAuthorizationPayload(session.Account, req)), CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	balance.AvailableMicro -= reserve
	balance.ReservedMicro += reserve
	s.state.Balances[balanceKey(session.Account, asset)] = balance
	s.ledgerLocked(session.Account, asset, -reserve, reserve, "twap_reserve", id, twap.AuthorizationDigest)
	s.state.TWAPOrders[id] = twap
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "twap_create", Digest: d, ObjectID: id}
	s.emitExecutionLocked("user", "twap_scheduled", session.Account, "twap", id, twap)
	s.auditLocked(session.Account, "twap_scheduled", "twap", id, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return TWAPOrder{}, err
	}
	return twap, nil
}

func (s *Service) TickTWAP() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now().UTC()
	due := make([]TWAPOrder, 0)
	for _, twap := range s.state.TWAPOrders {
		if twap.Status == "scheduled" && !now.Before(twap.NextRunAt) {
			due = append(due, twap)
		}
	}
	if len(due) == 0 {
		return 0, nil
	}
	sort.Slice(due, func(i, j int) bool {
		if due[i].NextRunAt.Equal(due[j].NextRunAt) {
			return due[i].ID < due[j].ID
		}
		return due[i].NextRunAt.Before(due[j].NextRunAt)
	})
	before := cloneState(s.state)
	executed := 0
	for _, item := range due {
		twap := s.state.TWAPOrders[item.ID]
		if twap.Status != "scheduled" {
			continue
		}
		if dm, ok := s.state.DeadMan[twap.Account]; ok && dm.Status == "expired" {
			s.releaseTWAPReserveLocked(&twap)
			twap.Status = "cancelled"
			twap.RejectReason = "dead_man_expired"
			twap.UpdatedAt = now
			s.state.TWAPOrders[twap.ID] = twap
			continue
		}
		remaining := twap.TotalAmountMicro - twap.ScheduledMicro
		sliceAmount := twap.TotalAmountMicro / int64(twap.Slices)
		if twap.SlicesExecuted == twap.Slices-1 {
			sliceAmount = remaining
		}
		reserve := sliceAmount
		if twap.Side == "buy" {
			quote := mulDiv(sliceAmount, twap.LimitPriceMicro, AmountScale)
			reserve = quote + fee(quote, s.cfg.TakerFeeBPS)
		}
		if sliceAmount <= 0 || reserve <= 0 || reserve > twap.ReservedMicro {
			s.releaseTWAPReserveLocked(&twap)
			twap.Status = "failed"
			twap.RejectReason = "invalid_remaining_reserve"
			twap.UpdatedAt = now
			s.state.TWAPOrders[twap.ID] = twap
			continue
		}
		child := Order{ID: s.nextIDLocked("order"), Account: twap.Account, QuantNonceDomain: twap.QuantNonceDomain, Market: twap.Market, Side: twap.Side, Type: "twap_child", TimeInForce: "ioc", PriceMicro: twap.LimitPriceMicro, AmountMicro: sliceAmount, ReservedMicro: reserve, PrioritySequence: s.state.Sequence, Status: "open", WalletAuthorized: true, CreatedAt: now, UpdatedAt: now, AuthorizationDigest: twap.AuthorizationDigest}
		twap.ReservedMicro -= reserve
		twap.ScheduledMicro += sliceAmount
		twap.SlicesExecuted++
		twap.ChildOrderIDs = append(twap.ChildOrderIDs, child.ID)
		twap.NextRunAt = twap.NextRunAt.Add(time.Duration(twap.IntervalSeconds) * time.Second)
		twap.UpdatedAt = now
		s.state.Orders[child.ID] = child
		s.emitExecutionLocked("market", "book_changed", "", "order", child.ID, child)
		s.emitExecutionLocked("user", "twap_child_opened", twap.Account, "order", child.ID, child)
		selfTrade := false
		for _, other := range s.state.Orders {
			if other.ID != child.ID && other.Account == child.Account && other.Market == child.Market && other.Side != child.Side && (other.Status == "open" || other.Status == "partially_filled") && crosses(child, other) {
				selfTrade = true
				break
			}
		}
		if selfTrade {
			s.releaseOrderReserveLocked(&child)
			child.Status = "rejected"
			child.RejectReason = "self_trade_prevention"
			s.state.Orders[child.ID] = child
		} else {
			s.matchLocked(child.ID)
			child = s.state.Orders[child.ID]
			if child.Status == "open" || child.Status == "partially_filled" {
				s.releaseOrderReserveLocked(&child)
				child.Status = "expired"
				child.RejectReason = "ioc_remainder_cancelled"
				child.UpdatedAt = now
				s.state.Orders[child.ID] = child
			}
		}
		if twap.SlicesExecuted == twap.Slices {
			s.releaseTWAPReserveLocked(&twap)
			twap.Status = "completed"
		}
		s.state.TWAPOrders[twap.ID] = twap
		s.emitExecutionLocked("user", "twap_slice_executed", twap.Account, "twap", twap.ID, twap)
		executed++
	}
	if err := s.saveOrRollbackLocked(before); err != nil {
		return 0, err
	}
	return executed, nil
}

func (s *Service) releaseTWAPReserveLocked(twap *TWAPOrder) {
	if twap.ReservedMicro <= 0 {
		return
	}
	asset := NativeAsset
	if twap.Side == "buy" {
		asset = QuoteAsset
	}
	balance := s.balanceLocked(twap.Account, asset)
	release := min64(balance.ReservedMicro, twap.ReservedMicro)
	balance.ReservedMicro -= release
	balance.AvailableMicro += release
	twap.ReservedMicro = 0
	s.state.Balances[balanceKey(twap.Account, asset)] = balance
	s.ledgerLocked(twap.Account, asset, release, -release, "twap_reserve_release", twap.ID, twap.AuthorizationDigest)
}

func TWAPCancelAuthorizationPayload(account, twapID, key string) []byte {
	return []byte(strings.Join([]string{"ynx-exchange-twap-cancel-v1", account, twapID, key}, "\n"))
}

func (s *Service) CancelTWAP(session WalletSession, twapID, key, walletSignature string) (TWAPOrder, error) {
	if strings.TrimSpace(twapID) == "" || !validKey(key) {
		return TWAPOrder{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, TWAPCancelAuthorizationPayload(session.Account, twapID, key), walletSignature) {
		return TWAPOrder{}, ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := digest(struct{ ID, Key string }{twapID, key})
	if prior, ok := s.state.Idempotency[key]; ok {
		if prior.Action != "twap_cancel" || prior.Digest != d || prior.ObjectID != twapID {
			return TWAPOrder{}, ErrConflict
		}
		return s.state.TWAPOrders[twapID], nil
	}
	twap, ok := s.state.TWAPOrders[twapID]
	if !ok {
		return TWAPOrder{}, ErrNotFound
	}
	if twap.Account != session.Account {
		return TWAPOrder{}, ErrForbidden
	}
	if twap.Status != "scheduled" {
		return TWAPOrder{}, ErrConflict
	}
	before := cloneState(s.state)
	s.releaseTWAPReserveLocked(&twap)
	twap.Status = "cancelled"
	twap.RejectReason = "user_cancelled"
	twap.UpdatedAt = s.cfg.Now().UTC()
	s.state.TWAPOrders[twapID] = twap
	s.state.Idempotency[key] = idempotencyRecord{Action: "twap_cancel", Digest: d, ObjectID: twapID}
	s.emitExecutionLocked("user", "twap_cancelled", session.Account, "twap", twapID, twap)
	s.auditLocked(session.Account, "twap_cancelled", "twap", twapID, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return TWAPOrder{}, err
	}
	return twap, nil
}

func (s *Service) CreateConditionalOrder(session WalletSession, req ConditionalOrderRequest) (ConditionalOrder, error) {
	if _, err := s.SweepDeadMan(); err != nil {
		return ConditionalOrder{}, err
	}
	req.Market = strings.ToUpper(strings.TrimSpace(req.Market))
	req.Side = strings.ToLower(strings.TrimSpace(req.Side))
	req.Kind = strings.ToLower(strings.TrimSpace(req.Kind))
	trailing := req.Kind == "trailing"
	if req.Market != DefaultMarket || (req.Side != "buy" && req.Side != "sell") || (req.Kind != "stop" && req.Kind != "take_profit" && !trailing) || (!trailing && (req.TriggerPriceMicro <= 0 || req.TrailOffsetMicro != 0)) || (trailing && (req.TriggerPriceMicro != 0 || req.TrailOffsetMicro <= 0 || req.TrailOffsetMicro > 1_000_000*AmountScale)) || req.LimitPriceMicro <= 0 || req.AmountMicro <= 0 || req.TriggerPriceMicro > 1_000_000*AmountScale || req.LimitPriceMicro > 1_000_000*AmountScale || req.AmountMicro > 1_000_000*AmountScale || !validKey(req.IdempotencyKey) {
		return ConditionalOrder{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, ConditionalOrderAuthorizationPayload(session.Account, req), req.WalletSignature) {
		return ConditionalOrder{}, ErrUnauthorized
	}
	if mulDiv(req.AmountMicro, req.LimitPriceMicro, AmountScale) > s.cfg.MaxOrderNotionalMicro {
		return ConditionalOrder{}, ErrForbidden
	}
	d := digest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if dm, ok := s.state.DeadMan[session.Account]; ok && dm.Status == "expired" {
		return ConditionalOrder{}, ErrForbidden
	}
	if s.quantStrategyKilledLocked(session.Account, req.QuantNonceDomain) {
		return ConditionalOrder{}, ErrForbidden
	}
	if !s.quantCapitalAllowsLocked(session.Account, req.QuantNonceDomain, req.QuantCapitalMicro, mulDiv(req.LimitPriceMicro, req.AmountMicro, AmountScale), "") {
		return ConditionalOrder{}, ErrForbidden
	}
	if prior, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if prior.Action != "conditional_create" || prior.Digest != d {
			return ConditionalOrder{}, ErrConflict
		}
		return s.state.ConditionalOrders[prior.ObjectID], nil
	}
	watermark := int64(0)
	triggerPrice := req.TriggerPriceMicro
	if trailing {
		if len(s.state.Trades) == 0 {
			return ConditionalOrder{}, ErrUnavailable
		}
		watermark = s.state.Trades[len(s.state.Trades)-1].PriceMicro
		if req.Side == "sell" {
			if watermark <= req.TrailOffsetMicro {
				return ConditionalOrder{}, ErrInvalid
			}
			triggerPrice = watermark - req.TrailOffsetMicro
		} else {
			triggerPrice = watermark + req.TrailOffsetMicro
		}
	}
	reserve := req.AmountMicro
	asset := NativeAsset
	if req.Side == "buy" {
		quote := mulDiv(req.AmountMicro, req.LimitPriceMicro, AmountScale)
		reserve = quote + fee(quote, s.cfg.TakerFeeBPS)
		asset = QuoteAsset
	}
	balance := s.balanceLocked(session.Account, asset)
	if balance.AvailableMicro < reserve {
		return ConditionalOrder{}, ErrInsufficient
	}
	now := s.cfg.Now().UTC()
	id := s.nextIDLocked("conditional")
	conditional := ConditionalOrder{ID: id, Account: session.Account, QuantNonceDomain: req.QuantNonceDomain, Market: req.Market, Side: req.Side, Kind: req.Kind, TriggerPriceMicro: triggerPrice, TrailOffsetMicro: req.TrailOffsetMicro, WatermarkMicro: watermark, LimitPriceMicro: req.LimitPriceMicro, AmountMicro: req.AmountMicro, ReservedMicro: reserve, Status: "pending_trigger", WalletAuthorized: true, AuthorizationDigest: digest(ConditionalOrderAuthorizationPayload(session.Account, req)), CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	balance.AvailableMicro -= reserve
	balance.ReservedMicro += reserve
	s.state.Balances[balanceKey(session.Account, asset)] = balance
	s.ledgerLocked(session.Account, asset, -reserve, reserve, "conditional_reserve", id, conditional.AuthorizationDigest)
	s.state.ConditionalOrders[id] = conditional
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "conditional_create", Digest: d, ObjectID: id}
	s.emitExecutionLocked("user", "conditional_created", session.Account, "conditional_order", id, conditional)
	s.auditLocked(session.Account, "conditional_created", "conditional_order", id, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return ConditionalOrder{}, err
	}
	return conditional, nil
}

func ConditionalCancelAuthorizationPayload(account, conditionalID, key string) []byte {
	return []byte(strings.Join([]string{"ynx-exchange-conditional-cancel-v1", account, conditionalID, key}, "\n"))
}

func (s *Service) CancelConditionalOrder(session WalletSession, conditionalID, key, walletSignature string) (ConditionalOrder, error) {
	if !validKey(key) || strings.TrimSpace(conditionalID) == "" {
		return ConditionalOrder{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, ConditionalCancelAuthorizationPayload(session.Account, conditionalID, key), walletSignature) {
		return ConditionalOrder{}, ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := digest(struct{ ID, Key string }{conditionalID, key})
	if prior, ok := s.state.Idempotency[key]; ok {
		if prior.Action != "conditional_cancel" || prior.Digest != d || prior.ObjectID != conditionalID {
			return ConditionalOrder{}, ErrConflict
		}
		return s.state.ConditionalOrders[conditionalID], nil
	}
	conditional, ok := s.state.ConditionalOrders[conditionalID]
	if !ok {
		return ConditionalOrder{}, ErrNotFound
	}
	if conditional.Account != session.Account {
		return ConditionalOrder{}, ErrForbidden
	}
	if conditional.Status != "pending_trigger" {
		return ConditionalOrder{}, ErrConflict
	}
	before := cloneState(s.state)
	if conditional.GroupID != "" {
		group, ok := s.state.OCOGroups[conditional.GroupID]
		if !ok || group.Status != "pending_trigger" {
			return ConditionalOrder{}, ErrConflict
		}
		s.cancelOCOGroupLocked(&group, "cancelled", "user_cancelled")
		conditional = s.state.ConditionalOrders[conditionalID]
	} else {
		s.releaseConditionalReserveLocked(&conditional)
		conditional.Status = "cancelled"
		conditional.UpdatedAt = s.cfg.Now().UTC()
		s.state.ConditionalOrders[conditionalID] = conditional
	}
	s.state.Idempotency[key] = idempotencyRecord{Action: "conditional_cancel", Digest: d, ObjectID: conditionalID}
	s.emitExecutionLocked("user", "conditional_cancelled", session.Account, "conditional_order", conditionalID, conditional)
	s.auditLocked(session.Account, "conditional_cancelled", "conditional_order", conditionalID, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return ConditionalOrder{}, err
	}
	return conditional, nil
}

func (s *Service) releaseConditionalReserveLocked(conditional *ConditionalOrder) {
	if conditional.ReservedMicro <= 0 {
		return
	}
	asset := NativeAsset
	if conditional.Side == "buy" {
		asset = QuoteAsset
	}
	balance := s.balanceLocked(conditional.Account, asset)
	release := min64(balance.ReservedMicro, conditional.ReservedMicro)
	balance.ReservedMicro -= release
	balance.AvailableMicro += release
	conditional.ReservedMicro = 0
	s.state.Balances[balanceKey(conditional.Account, asset)] = balance
	s.ledgerLocked(conditional.Account, asset, release, -release, "conditional_reserve_release", conditional.ID, conditional.AuthorizationDigest)
}

func (s *Service) releaseOCOReserveLocked(group *OCOGroup) {
	if group.ReservedMicro <= 0 {
		return
	}
	asset := NativeAsset
	if group.Side == "buy" {
		asset = QuoteAsset
	}
	balance := s.balanceLocked(group.Account, asset)
	release := min64(balance.ReservedMicro, group.ReservedMicro)
	balance.ReservedMicro -= release
	balance.AvailableMicro += release
	group.ReservedMicro = 0
	s.state.Balances[balanceKey(group.Account, asset)] = balance
	s.ledgerLocked(group.Account, asset, release, -release, "oco_reserve_release", group.ID, group.AuthorizationDigest)
}

func (s *Service) cancelOCOGroupLocked(group *OCOGroup, status, reason string) {
	s.releaseOCOReserveLocked(group)
	group.Status = status
	group.RejectReason = reason
	group.UpdatedAt = s.cfg.Now().UTC()
	for _, id := range []string{group.StopConditionalID, group.TakeProfitConditionalID} {
		leg := s.state.ConditionalOrders[id]
		if leg.Status == "pending_trigger" {
			leg.Status = "cancelled"
			leg.RejectReason = reason
			leg.UpdatedAt = group.UpdatedAt
			s.state.ConditionalOrders[id] = leg
			s.emitExecutionLocked("user", "conditional_cancelled", group.Account, "conditional_order", id, leg)
		}
	}
	s.state.OCOGroups[group.ID] = *group
	s.emitExecutionLocked("user", "oco_"+status, group.Account, "oco_group", group.ID, *group)
}

func OrderCancelAuthorizationPayload(account, id, key string) []byte {
	return []byte(strings.Join([]string{"ynx-exchange-cancel-v1", account, id, key}, "\n"))
}

func (s *Service) CancelOrder(session WalletSession, id, key, walletSignature string) (Order, error) {
	if !validKey(key) {
		return Order{}, ErrInvalid
	}
	payload := OrderCancelAuthorizationPayload(session.Account, id, key)
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
	if o.ParentOrderID != "" {
		s.syncScaleLocked(o.ParentOrderID, "child_cancelled")
	}
	s.emitExecutionLocked("market", "book_changed", "", "order", id, o)
	s.emitExecutionLocked("user", "order_cancelled", session.Account, "order", id, o)
	s.state.Idempotency[key] = idempotencyRecord{Action: "order_cancel", Digest: d, ObjectID: id}
	s.auditLocked(session.Account, "order_cancelled", "order", id, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Order{}, err
	}
	return o, nil
}

func ScaleCancelAuthorizationPayload(account, scaleID, key string) []byte {
	return []byte(strings.Join([]string{"ynx-exchange-scale-cancel-v1", account, scaleID, key}, "\n"))
}

func (s *Service) CancelScale(session WalletSession, scaleID, key, walletSignature string) (ScaleOrder, error) {
	if strings.TrimSpace(scaleID) == "" || !validKey(key) {
		return ScaleOrder{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, ScaleCancelAuthorizationPayload(session.Account, scaleID, key), walletSignature) {
		return ScaleOrder{}, ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := digest(struct{ ID, Key string }{scaleID, key})
	if prior, ok := s.state.Idempotency[key]; ok {
		if prior.Action != "scale_cancel" || prior.Digest != d || prior.ObjectID != scaleID {
			return ScaleOrder{}, ErrConflict
		}
		return s.state.ScaleOrders[scaleID], nil
	}
	parent, ok := s.state.ScaleOrders[scaleID]
	if !ok {
		return ScaleOrder{}, ErrNotFound
	}
	if parent.Account != session.Account {
		return ScaleOrder{}, ErrForbidden
	}
	if parent.Status != "open" && parent.Status != "partially_filled" {
		return ScaleOrder{}, ErrConflict
	}
	before := cloneState(s.state)
	now := s.cfg.Now().UTC()
	for _, id := range parent.ChildOrderIDs {
		child := s.state.Orders[id]
		if !isOpenOrder(child) {
			continue
		}
		s.releaseOrderReserveLocked(&child)
		child.Status = "cancelled"
		child.RejectReason = "scale_cancelled"
		child.UpdatedAt = now
		s.state.Orders[id] = child
		s.emitExecutionLocked("market", "book_changed", "", "order", id, child)
		s.emitExecutionLocked("user", "scale_child_cancelled", session.Account, "order", id, child)
	}
	s.syncScaleLocked(scaleID, "user_cancelled")
	parent = s.state.ScaleOrders[scaleID]
	s.state.Idempotency[key] = idempotencyRecord{Action: "scale_cancel", Digest: d, ObjectID: scaleID}
	s.auditLocked(session.Account, "scale_cancelled", "scale", scaleID, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return ScaleOrder{}, err
	}
	return parent, nil
}

func MassCancelAuthorizationPayload(account, market, key string) []byte {
	return []byte(strings.Join([]string{"ynx-exchange-mass-cancel-v1", account, market, key}, "\n"))
}

func DeadManAuthorizationPayload(account string, req DeadManRequest) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-dead-man-v1\n%s\n%s\n%d\n%s\n%s", account, strings.ToLower(strings.TrimSpace(req.Action)), req.TimeoutSeconds, strings.TrimSpace(req.NonceDomain), req.IdempotencyKey))
}

func (s *Service) ConfigureDeadMan(session WalletSession, req DeadManRequest) (DeadManSwitch, error) {
	req.Action = strings.ToLower(strings.TrimSpace(req.Action))
	req.NonceDomain = strings.TrimSpace(req.NonceDomain)
	if (req.Action != "arm" && req.Action != "heartbeat" && req.Action != "disarm") || !validKey(req.IdempotencyKey) || !strings.HasPrefix(req.NonceDomain, "deadman:") || len(req.NonceDomain) > 128 || ((req.Action == "arm" || req.Action == "heartbeat") && (req.TimeoutSeconds < 5 || req.TimeoutSeconds > 3600)) {
		return DeadManSwitch{}, ErrInvalid
	}
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, DeadManAuthorizationPayload(session.Account, req), req.WalletSignature) {
		return DeadManSwitch{}, ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := digest(struct {
		Account string
		Request DeadManRequest
	}{session.Account, req})
	if prev, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if prev.Action != "dead_man_"+req.Action || prev.Digest != d || prev.ObjectID != session.Account {
			return DeadManSwitch{}, ErrConflict
		}
		return s.state.DeadMan[session.Account], nil
	}
	current, exists := s.state.DeadMan[session.Account]
	if req.Action == "heartbeat" && (!exists || current.Status != "active" || current.NonceDomain != req.NonceDomain) {
		return DeadManSwitch{}, ErrConflict
	}
	if req.Action == "disarm" && (!exists || current.Status != "active" || current.NonceDomain != req.NonceDomain) {
		return DeadManSwitch{}, ErrConflict
	}
	now := s.cfg.Now().UTC()
	next := current
	next.Account = session.Account
	next.Market = DefaultMarket
	next.NonceDomain = req.NonceDomain
	next.UpdatedAt = now
	if req.Action == "disarm" {
		next.Status = "disarmed"
		next.ExpiresAt = time.Time{}
	} else {
		next.Status = "active"
		next.TimeoutSeconds = req.TimeoutSeconds
		next.LastHeartbeat = now
		next.ExpiresAt = now.Add(time.Duration(req.TimeoutSeconds) * time.Second)
		next.Cancelled = 0
	}
	before := cloneState(s.state)
	s.state.DeadMan[session.Account] = next
	s.emitExecutionLocked("user", "dead_man_"+req.Action, session.Account, "dead_man", DefaultMarket, next)
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "dead_man_" + req.Action, Digest: d, ObjectID: session.Account}
	s.auditLocked(session.Account, "dead_man_"+req.Action, "dead_man", DefaultMarket, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return DeadManSwitch{}, err
	}
	return next, nil
}

func (s *Service) SweepDeadMan() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now().UTC()
	accounts := make([]string, 0)
	for account, dm := range s.state.DeadMan {
		if dm.Status == "active" && !now.Before(dm.ExpiresAt) {
			accounts = append(accounts, account)
		}
	}
	if len(accounts) == 0 {
		return 0, nil
	}
	sort.Strings(accounts)
	before := cloneState(s.state)
	cancelled := 0
	for _, account := range accounts {
		orders := make([]Order, 0)
		for _, order := range s.state.Orders {
			if order.Account == account && order.Market == DefaultMarket && (order.Status == "open" || order.Status == "partially_filled") {
				orders = append(orders, order)
			}
		}
		sort.Slice(orders, func(i, j int) bool {
			if orders[i].CreatedAt.Equal(orders[j].CreatedAt) {
				return orders[i].ID < orders[j].ID
			}
			return orders[i].CreatedAt.Before(orders[j].CreatedAt)
		})
		for i := range orders {
			s.releaseOrderReserveLocked(&orders[i])
			orders[i].Status = "cancelled"
			orders[i].RejectReason = "dead_man_expired"
			orders[i].UpdatedAt = now
			s.state.Orders[orders[i].ID] = orders[i]
			s.emitExecutionLocked("market", "book_changed", "", "order", orders[i].ID, orders[i])
			s.emitExecutionLocked("user", "order_dead_man_cancelled", account, "order", orders[i].ID, orders[i])
			cancelled++
		}
		scaleParents := map[string]bool{}
		for _, order := range orders {
			if order.ParentOrderID != "" {
				scaleParents[order.ParentOrderID] = true
			}
		}
		for parentID := range scaleParents {
			s.syncScaleLocked(parentID, "dead_man_expired")
		}
		for _, order := range orders {
			if order.ParentOrderID != "" {
				cancelled--
			}
		}
		cancelled += len(scaleParents)
		groups := make([]OCOGroup, 0)
		for _, group := range s.state.OCOGroups {
			if group.Account == account && group.Market == DefaultMarket && group.Status == "pending_trigger" {
				groups = append(groups, group)
			}
		}
		sort.Slice(groups, func(i, j int) bool { return groups[i].ID < groups[j].ID })
		for i := range groups {
			s.cancelOCOGroupLocked(&groups[i], "cancelled", "dead_man_expired")
			cancelled++
		}
		conditional := make([]ConditionalOrder, 0)
		for _, order := range s.state.ConditionalOrders {
			if order.GroupID == "" && order.Account == account && order.Market == DefaultMarket && order.Status == "pending_trigger" {
				conditional = append(conditional, order)
			}
		}
		sort.Slice(conditional, func(i, j int) bool {
			if conditional[i].CreatedAt.Equal(conditional[j].CreatedAt) {
				return conditional[i].ID < conditional[j].ID
			}
			return conditional[i].CreatedAt.Before(conditional[j].CreatedAt)
		})
		for i := range conditional {
			s.releaseConditionalReserveLocked(&conditional[i])
			conditional[i].Status = "cancelled"
			conditional[i].RejectReason = "dead_man_expired"
			conditional[i].UpdatedAt = now
			s.state.ConditionalOrders[conditional[i].ID] = conditional[i]
			s.emitExecutionLocked("user", "conditional_dead_man_cancelled", account, "conditional_order", conditional[i].ID, conditional[i])
			cancelled++
		}
		twaps := make([]TWAPOrder, 0)
		for _, twap := range s.state.TWAPOrders {
			if twap.Account == account && twap.Market == DefaultMarket && twap.Status == "scheduled" {
				twaps = append(twaps, twap)
			}
		}
		sort.Slice(twaps, func(i, j int) bool { return twaps[i].ID < twaps[j].ID })
		for i := range twaps {
			s.releaseTWAPReserveLocked(&twaps[i])
			twaps[i].Status = "cancelled"
			twaps[i].RejectReason = "dead_man_expired"
			twaps[i].UpdatedAt = now
			s.state.TWAPOrders[twaps[i].ID] = twaps[i]
			s.emitExecutionLocked("user", "twap_cancelled", account, "twap", twaps[i].ID, twaps[i])
			cancelled++
		}
		dm := s.state.DeadMan[account]
		dm.Status = "expired"
		dm.UpdatedAt = now
		nonScaleOrders := 0
		for _, order := range orders {
			if order.ParentOrderID == "" {
				nonScaleOrders++
			}
		}
		dm.Cancelled = nonScaleOrders + len(scaleParents) + len(groups) + len(conditional) + len(twaps)
		s.state.DeadMan[account] = dm
		s.emitExecutionLocked("user", "dead_man_expired", account, "dead_man", DefaultMarket, dm)
		s.auditLocked(account, "dead_man_expired", "dead_man", DefaultMarket, digest(dm))
	}
	if err := s.saveOrRollbackLocked(before); err != nil {
		return 0, err
	}
	return cancelled, nil
}

func (s *Service) MassCancel(session WalletSession, market, key, walletSignature string) (CancelResult, error) {
	market = strings.ToUpper(strings.TrimSpace(market))
	if market != DefaultMarket || !validKey(key) {
		return CancelResult{}, ErrInvalid
	}
	payload := MassCancelAuthorizationPayload(session.Account, market, key)
	if !verifyWalletSignature(session.Account, session.WalletPublicKey, payload, walletSignature) {
		return CancelResult{}, ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := digest(struct{ Account, Market, Key string }{session.Account, market, key})
	return s.massCancelLocked(session, market, key, "order_mass_cancel", d, nil)
}

func (s *Service) massCancelLocked(session WalletSession, market, key, action, d string, postMutation func()) (CancelResult, error) {
	if prev, ok := s.state.Idempotency[key]; ok {
		if prev.Action != action || prev.Digest != d {
			return CancelResult{}, ErrConflict
		}
		var ids struct {
			Orders, Conditional, OCO, TWAP, Scale []string
		}
		if json.Unmarshal([]byte(prev.ObjectID), &ids) != nil {
			return CancelResult{}, ErrConflict
		}
		orders := s.ordersByIDsLocked(ids.Orders)
		conditional := s.conditionalByIDsLocked(ids.Conditional)
		groups := s.ocoByIDsLocked(ids.OCO)
		twaps := s.twapByIDsLocked(ids.TWAP)
		scales := s.scaleByIDsLocked(ids.Scale)
		nonScaleOrders := 0
		for _, order := range orders {
			if order.ParentOrderID == "" {
				nonScaleOrders++
			}
		}
		return CancelResult{Orders: orders, ConditionalOrders: conditional, OCOGroups: groups, TWAPOrders: twaps, ScaleOrders: scales, Count: nonScaleOrders + len(scales) + len(conditional) + len(groups) + len(twaps)}, nil
	}
	orders := make([]Order, 0)
	for _, o := range s.state.Orders {
		if o.Account == session.Account && o.Market == market && (o.Status == "open" || o.Status == "partially_filled") {
			orders = append(orders, o)
		}
	}
	conditional := make([]ConditionalOrder, 0)
	for _, order := range s.state.ConditionalOrders {
		if order.GroupID == "" && order.Account == session.Account && order.Market == market && order.Status == "pending_trigger" {
			conditional = append(conditional, order)
		}
	}
	groups := make([]OCOGroup, 0)
	for _, group := range s.state.OCOGroups {
		if group.Account == session.Account && group.Market == market && group.Status == "pending_trigger" {
			groups = append(groups, group)
		}
	}
	twaps := make([]TWAPOrder, 0)
	for _, twap := range s.state.TWAPOrders {
		if twap.Account == session.Account && twap.Market == market && twap.Status == "scheduled" {
			twaps = append(twaps, twap)
		}
	}
	sort.Slice(orders, func(i, j int) bool {
		if orders[i].CreatedAt.Equal(orders[j].CreatedAt) {
			return orders[i].ID < orders[j].ID
		}
		return orders[i].CreatedAt.Before(orders[j].CreatedAt)
	})
	sort.Slice(conditional, func(i, j int) bool {
		if conditional[i].CreatedAt.Equal(conditional[j].CreatedAt) {
			return conditional[i].ID < conditional[j].ID
		}
		return conditional[i].CreatedAt.Before(conditional[j].CreatedAt)
	})
	sort.Slice(groups, func(i, j int) bool { return groups[i].ID < groups[j].ID })
	sort.Slice(twaps, func(i, j int) bool { return twaps[i].ID < twaps[j].ID })
	before := cloneState(s.state)
	ids := make([]string, 0, len(orders))
	for i := range orders {
		s.releaseOrderReserveLocked(&orders[i])
		orders[i].Status = "cancelled"
		orders[i].UpdatedAt = s.cfg.Now().UTC()
		s.state.Orders[orders[i].ID] = orders[i]
		s.emitExecutionLocked("market", "book_changed", "", "order", orders[i].ID, orders[i])
		s.emitExecutionLocked("user", "order_cancelled", session.Account, "order", orders[i].ID, orders[i])
		ids = append(ids, orders[i].ID)
	}
	scaleParents := map[string]bool{}
	for _, order := range orders {
		if order.ParentOrderID != "" {
			scaleParents[order.ParentOrderID] = true
		}
	}
	for parentID := range scaleParents {
		s.syncScaleLocked(parentID, "mass_cancelled")
	}
	scales := make([]ScaleOrder, 0, len(scaleParents))
	for parentID := range scaleParents {
		scales = append(scales, s.state.ScaleOrders[parentID])
	}
	sort.Slice(scales, func(i, j int) bool { return scales[i].ID < scales[j].ID })
	conditionalIDs := make([]string, 0, len(conditional))
	for i := range conditional {
		s.releaseConditionalReserveLocked(&conditional[i])
		conditional[i].Status = "cancelled"
		conditional[i].RejectReason = "mass_cancelled"
		conditional[i].UpdatedAt = s.cfg.Now().UTC()
		s.state.ConditionalOrders[conditional[i].ID] = conditional[i]
		conditionalIDs = append(conditionalIDs, conditional[i].ID)
		s.emitExecutionLocked("user", "conditional_cancelled", session.Account, "conditional_order", conditional[i].ID, conditional[i])
	}
	groupIDs := make([]string, 0, len(groups))
	for i := range groups {
		s.cancelOCOGroupLocked(&groups[i], "cancelled", "mass_cancelled")
		groupIDs = append(groupIDs, groups[i].ID)
	}
	twapIDs := make([]string, 0, len(twaps))
	for i := range twaps {
		s.releaseTWAPReserveLocked(&twaps[i])
		twaps[i].Status = "cancelled"
		twaps[i].RejectReason = "mass_cancelled"
		twaps[i].UpdatedAt = s.cfg.Now().UTC()
		s.state.TWAPOrders[twaps[i].ID] = twaps[i]
		twapIDs = append(twapIDs, twaps[i].ID)
		s.emitExecutionLocked("user", "twap_cancelled", session.Account, "twap", twaps[i].ID, twaps[i])
	}
	scaleIDs := make([]string, 0, len(scales))
	for _, scale := range scales {
		scaleIDs = append(scaleIDs, scale.ID)
	}
	batchJSON, err := json.Marshal(struct {
		Orders, Conditional, OCO, TWAP, Scale []string
	}{ids, conditionalIDs, groupIDs, twapIDs, scaleIDs})
	if err != nil {
		return CancelResult{}, err
	}
	if postMutation != nil {
		postMutation()
	}
	s.state.Idempotency[key] = idempotencyRecord{Action: action, Digest: d, ObjectID: string(batchJSON)}
	s.auditLocked(session.Account, "orders_mass_cancelled", "market", market, d)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return CancelResult{}, err
	}
	nonScaleOrders := 0
	for _, order := range orders {
		if order.ParentOrderID == "" {
			nonScaleOrders++
		}
	}
	return CancelResult{Orders: orders, ConditionalOrders: conditional, OCOGroups: groups, TWAPOrders: twaps, ScaleOrders: scales, Count: nonScaleOrders + len(scales) + len(conditional) + len(groups) + len(twaps)}, nil
}

func (s *Service) ordersByIDsLocked(ids []string) []Order {
	orders := make([]Order, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		if o, ok := s.state.Orders[id]; ok {
			orders = append(orders, o)
		}
	}
	return orders
}

func (s *Service) conditionalByIDsLocked(ids []string) []ConditionalOrder {
	orders := make([]ConditionalOrder, 0, len(ids))
	for _, id := range ids {
		if order, ok := s.state.ConditionalOrders[id]; ok {
			orders = append(orders, order)
		}
	}
	return orders
}

func (s *Service) ocoByIDsLocked(ids []string) []OCOGroup {
	groups := make([]OCOGroup, 0, len(ids))
	for _, id := range ids {
		if group, ok := s.state.OCOGroups[id]; ok {
			groups = append(groups, group)
		}
	}
	return groups
}

func (s *Service) twapByIDsLocked(ids []string) []TWAPOrder {
	twaps := make([]TWAPOrder, 0, len(ids))
	for _, id := range ids {
		if twap, ok := s.state.TWAPOrders[id]; ok {
			twaps = append(twaps, twap)
		}
	}
	return twaps
}

func (s *Service) scaleByIDsLocked(ids []string) []ScaleOrder {
	scales := make([]ScaleOrder, 0, len(ids))
	for _, id := range ids {
		if scale, ok := s.state.ScaleOrders[id]; ok {
			scales = append(scales, scale)
		}
	}
	return scales
}

func (s *Service) matchLocked(incomingID string) {
	for {
		incoming := s.state.Orders[incomingID]
		if !isOpenOrder(incoming) {
			return
		}
		candidates := []Order{}
		for _, o := range s.state.Orders {
			if o.ID != incoming.ID && o.Market == incoming.Market && o.Side != incoming.Side && isOpenOrder(o) && executableRemaining(o) > 0 && crosses(incoming, o) {
				candidates = append(candidates, o)
			}
		}
		if len(candidates) == 0 {
			return
		}
		sort.Slice(candidates, func(i, j int) bool {
			if candidates[i].PriceMicro == candidates[j].PriceMicro {
				return orderTimePriority(candidates[i], candidates[j])
			}
			if incoming.Side == "buy" {
				return candidates[i].PriceMicro < candidates[j].PriceMicro
			}
			return candidates[i].PriceMicro > candidates[j].PriceMicro
		})
		maker := candidates[0]
		qty := min64(executableRemaining(incoming), executableRemaining(maker))
		s.executeTradeLocked(&incoming, &maker, qty, maker.PriceMicro)
		s.replenishIcebergLocked(&incoming)
		s.replenishIcebergLocked(&maker)
		s.state.Orders[incoming.ID] = incoming
		s.state.Orders[maker.ID] = maker
		if incoming.ParentOrderID != "" {
			s.syncScaleLocked(incoming.ParentOrderID, "")
		}
		if maker.ParentOrderID != "" && maker.ParentOrderID != incoming.ParentOrderID {
			s.syncScaleLocked(maker.ParentOrderID, "")
		}
		if !s.processingTriggers {
			s.processingTriggers = true
			s.processConditionalLocked(maker.PriceMicro, s.state.Trades[len(s.state.Trades)-1].ID)
			s.processingTriggers = false
		}
	}
}

func isOpenOrder(order Order) bool {
	return order.Status == "open" || order.Status == "partially_filled"
}

func executableRemaining(order Order) int64 {
	end := order.AmountMicro
	if order.Type == "iceberg" && order.VisibleUntilMicro > 0 && order.VisibleUntilMicro < end {
		end = order.VisibleUntilMicro
	}
	if end <= order.FilledMicro {
		return 0
	}
	return end - order.FilledMicro
}

func orderTimePriority(left, right Order) bool {
	if !left.CreatedAt.Equal(right.CreatedAt) {
		return left.CreatedAt.Before(right.CreatedAt)
	}
	if left.PrioritySequence != right.PrioritySequence && left.PrioritySequence > 0 && right.PrioritySequence > 0 {
		return left.PrioritySequence < right.PrioritySequence
	}
	return left.ID < right.ID
}

func (s *Service) replenishIcebergLocked(order *Order) {
	if order.Type != "iceberg" || !isOpenOrder(*order) || order.FilledMicro >= order.AmountMicro || order.FilledMicro < order.VisibleUntilMicro {
		return
	}
	visibleEnd := order.FilledMicro + order.DisplayAmountMicro
	if visibleEnd > order.AmountMicro {
		visibleEnd = order.AmountMicro
	}
	s.state.Sequence++
	order.VisibleUntilMicro = visibleEnd
	order.PrioritySequence = s.state.Sequence
	order.CreatedAt = s.cfg.Now().UTC()
	order.UpdatedAt = order.CreatedAt
	s.emitExecutionLocked("market", "iceberg_replenished", "", "order", order.ID, *order)
	s.emitExecutionLocked("user", "iceberg_replenished", order.Account, "order", order.ID, *order)
	s.auditLocked(order.Account, "iceberg_replenished", "order", order.ID, digest(*order))
}

func (s *Service) processConditionalLocked(lastPrice int64, tradeID string) {
	pending := make([]ConditionalOrder, 0)
	for _, conditional := range s.state.ConditionalOrders {
		if conditional.Status == "pending_trigger" {
			pending = append(pending, conditional)
		}
	}
	sort.Slice(pending, func(i, j int) bool {
		if pending[i].CreatedAt.Equal(pending[j].CreatedAt) {
			return pending[i].ID < pending[j].ID
		}
		return pending[i].CreatedAt.Before(pending[j].CreatedAt)
	})
	for _, conditional := range pending {
		current := s.state.ConditionalOrders[conditional.ID]
		if current.Status != "pending_trigger" {
			continue
		}
		if current.Kind == "trailing" {
			previousWatermark := current.WatermarkMicro
			if current.Side == "sell" && lastPrice > current.WatermarkMicro {
				current.WatermarkMicro = lastPrice
				current.TriggerPriceMicro = lastPrice - current.TrailOffsetMicro
			}
			if current.Side == "buy" && (current.WatermarkMicro == 0 || lastPrice < current.WatermarkMicro) {
				current.WatermarkMicro = lastPrice
				current.TriggerPriceMicro = lastPrice + current.TrailOffsetMicro
			}
			if current.WatermarkMicro != previousWatermark {
				current.UpdatedAt = s.cfg.Now().UTC()
				s.state.ConditionalOrders[current.ID] = current
				s.emitExecutionLocked("user", "trailing_watermark_updated", current.Account, "conditional_order", current.ID, current)
			}
		}
		if !conditionalTriggered(current, lastPrice) {
			continue
		}
		reserve := current.ReservedMicro
		var group OCOGroup
		if current.GroupID != "" {
			var ok bool
			group, ok = s.state.OCOGroups[current.GroupID]
			if !ok || group.Status != "pending_trigger" {
				continue
			}
			reserve = group.ReservedMicro
		}
		order := Order{ID: s.nextIDLocked("order"), Account: current.Account, QuantNonceDomain: current.QuantNonceDomain, Market: current.Market, Side: current.Side, Type: "limit", TimeInForce: "gtc", PriceMicro: current.LimitPriceMicro, AmountMicro: current.AmountMicro, ReservedMicro: reserve, PrioritySequence: s.state.Sequence, Status: "open", WalletAuthorized: true, CreatedAt: s.cfg.Now().UTC(), UpdatedAt: s.cfg.Now().UTC(), AuthorizationDigest: current.AuthorizationDigest}
		selfTrade := false
		for _, other := range s.state.Orders {
			if other.Account == order.Account && other.Market == order.Market && other.Side != order.Side && (other.Status == "open" || other.Status == "partially_filled") && crosses(order, other) {
				selfTrade = true
				break
			}
		}
		current.TriggeredByTradeID = tradeID
		current.UpdatedAt = s.cfg.Now().UTC()
		if selfTrade {
			if current.GroupID != "" {
				s.cancelOCOGroupLocked(&group, "rejected", "self_trade_prevention")
			} else {
				s.releaseConditionalReserveLocked(&current)
			}
			current.Status = "rejected"
			current.RejectReason = "self_trade_prevention"
			s.state.ConditionalOrders[current.ID] = current
			s.emitExecutionLocked("user", "conditional_rejected", current.Account, "conditional_order", current.ID, current)
			s.auditLocked(current.Account, "conditional_rejected", "conditional_order", current.ID, digest(current))
			continue
		}
		current.Status = "triggered"
		current.ActivatedOrderID = order.ID
		current.ReservedMicro = 0
		if current.GroupID != "" {
			group.Status = "triggered"
			group.TriggeredConditionalID = current.ID
			group.ActivatedOrderID = order.ID
			group.ReservedMicro = 0
			group.UpdatedAt = current.UpdatedAt
			siblingID := group.StopConditionalID
			if siblingID == current.ID {
				siblingID = group.TakeProfitConditionalID
			}
			sibling := s.state.ConditionalOrders[siblingID]
			if sibling.Status == "pending_trigger" {
				sibling.Status = "cancelled"
				sibling.RejectReason = "oco_peer_triggered"
				sibling.UpdatedAt = current.UpdatedAt
				s.state.ConditionalOrders[siblingID] = sibling
				s.emitExecutionLocked("user", "conditional_cancelled", current.Account, "conditional_order", siblingID, sibling)
			}
			s.state.OCOGroups[group.ID] = group
			s.emitExecutionLocked("user", "oco_triggered", current.Account, "oco_group", group.ID, group)
		}
		s.state.ConditionalOrders[current.ID] = current
		s.state.Orders[order.ID] = order
		s.emitExecutionLocked("user", "conditional_triggered", current.Account, "conditional_order", current.ID, current)
		s.emitExecutionLocked("market", "book_changed", "", "order", order.ID, order)
		s.emitExecutionLocked("user", "order_opened", order.Account, "order", order.ID, order)
		s.auditLocked(current.Account, "conditional_triggered", "conditional_order", current.ID, digest(current))
		s.matchLocked(order.ID)
	}
}

func conditionalTriggered(conditional ConditionalOrder, lastPrice int64) bool {
	if conditional.Kind == "trailing" {
		if conditional.Side == "sell" {
			return lastPrice <= conditional.TriggerPriceMicro
		}
		return lastPrice >= conditional.TriggerPriceMicro
	}
	if conditional.Kind == "stop" {
		if conditional.Side == "buy" {
			return lastPrice >= conditional.TriggerPriceMicro
		}
		return lastPrice <= conditional.TriggerPriceMicro
	}
	if conditional.Side == "buy" {
		return lastPrice <= conditional.TriggerPriceMicro
	}
	return lastPrice >= conditional.TriggerPriceMicro
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
	s.emitExecutionLocked("market", "book_changed", "", "order", buyer.ID, *buyer)
	s.emitExecutionLocked("market", "book_changed", "", "order", seller.ID, *seller)
	s.emitExecutionLocked("user", "order_updated", buyer.Account, "order", buyer.ID, *buyer)
	if seller.Account != buyer.Account {
		s.emitExecutionLocked("user", "order_updated", seller.Account, "order", seller.ID, *seller)
	}
	trade := Trade{ID: id, Market: buyer.Market, PriceMicro: price, AmountMicro: qty, BuyOrderID: buyer.ID, SellOrderID: seller.ID, Buyer: buyer.Account, Seller: seller.Account, BuyerFeeMicro: buyerFee, SellerFeeMicro: sellerFee, CreatedAt: now, SourceType: "deterministic_price_time_match"}
	trade.SourceDigest = sourceDigest
	s.state.Trades = append(s.state.Trades, trade)
	s.emitExecutionLocked("market", "trade", "", "trade", id, trade)
	s.emitExecutionLocked("user", "fill", buyer.Account, "trade", id, trade)
	if seller.Account != buyer.Account {
		s.emitExecutionLocked("user", "fill", seller.Account, "trade", id, trade)
	}
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
	return s.bookLocked()
}

func (s *Service) bookLocked() OrderBook {
	book := OrderBook{Market: DefaultMarket, Bids: []Order{}, Asks: []Order{}}
	for _, o := range s.state.Orders {
		if o.Market == DefaultMarket && isOpenOrder(o) && executableRemaining(o) > 0 {
			o = publicBookOrder(o)
			if o.Side == "buy" {
				book.Bids = append(book.Bids, o)
			} else {
				book.Asks = append(book.Asks, o)
			}
		}
	}
	sort.Slice(book.Bids, func(i, j int) bool { return bookPriority(book.Bids[i], book.Bids[j], true) })
	sort.Slice(book.Asks, func(i, j int) bool { return bookPriority(book.Asks[i], book.Asks[j], false) })
	return book
}

func (s *Service) StreamSnapshot(stream, account string) (StreamSnapshot, error) {
	if stream != "market" && stream != "user" {
		return StreamSnapshot{}, ErrInvalid
	}
	if stream == "user" && strings.TrimSpace(account) == "" {
		return StreamSnapshot{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	events := make([]ExecutionEvent, 0)
	for _, event := range s.state.ExecutionEvents {
		if event.Stream == stream && (stream != "user" || event.Account == account) {
			events = append(events, event)
		}
	}
	if len(events) > 100 {
		events = append([]ExecutionEvent(nil), events[len(events)-100:]...)
	}
	return StreamSnapshot{Sequence: s.state.EventSequence, Market: DefaultMarket, Book: s.bookLocked(), Events: events, Source: QuantSource{Source: ProductID, AsOf: s.cfg.Now().UTC(), Version: "execution-stream-v1", Coverage: stream + " snapshot plus last 100 retained events", Status: "available"}}, nil
}

func publicBookOrder(order Order) Order {
	visible := executableRemaining(order)
	order.Account = ""
	order.AmountMicro = visible
	order.FilledMicro = 0
	order.VisibleUntilMicro = 0
	order.ReservedMicro = 0
	order.WalletAuthorized = false
	order.AuthorizationDigest = ""
	return order
}

func bookPriority(left, right Order, bid bool) bool {
	if left.PriceMicro != right.PriceMicro {
		if bid {
			return left.PriceMicro > right.PriceMicro
		}
		return left.PriceMicro < right.PriceMicro
	}
	return orderTimePriority(left, right)
}

type AccountSnapshot struct {
	Balances          []Balance          `json:"balances"`
	Ledger            []LedgerEntry      `json:"ledger"`
	DepositIntents    []DepositIntent    `json:"depositIntents"`
	Orders            []Order            `json:"orders"`
	ConditionalOrders []ConditionalOrder `json:"conditionalOrders"`
	OCOGroups         []OCOGroup         `json:"ocoGroups"`
	TWAPOrders        []TWAPOrder        `json:"twapOrders"`
	ScaleOrders       []ScaleOrder       `json:"scaleOrders"`
	Trades            []Trade            `json:"trades"`
	Fees              []FeeRecord        `json:"fees"`
	Deposits          []Deposit          `json:"deposits"`
	Withdrawals       []Withdrawal       `json:"withdrawals"`
	Security          SecuritySettings   `json:"security"`
	Support           []SupportCase      `json:"support"`
	AI                []AIRecord         `json:"ai"`
	Audit             []AuditEvent       `json:"audit"`
	DeadMan           DeadManSwitch      `json:"deadMan"`
}

func (s *Service) Snapshot(account string) AccountSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := AccountSnapshot{Balances: []Balance{s.balanceLocked(account, NativeAsset), s.balanceLocked(account, QuoteAsset)}, Ledger: []LedgerEntry{}, DepositIntents: []DepositIntent{}, Orders: []Order{}, ConditionalOrders: []ConditionalOrder{}, OCOGroups: []OCOGroup{}, TWAPOrders: []TWAPOrder{}, ScaleOrders: []ScaleOrder{}, Trades: []Trade{}, Fees: []FeeRecord{}, Deposits: []Deposit{}, Withdrawals: []Withdrawal{}, Security: s.securityLocked(account), Support: []SupportCase{}, AI: []AIRecord{}, Audit: []AuditEvent{}, DeadMan: s.state.DeadMan[account]}
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
	for _, v := range s.state.ConditionalOrders {
		if v.Account == account {
			r.ConditionalOrders = append(r.ConditionalOrders, v)
		}
	}
	for _, v := range s.state.OCOGroups {
		if v.Account == account {
			r.OCOGroups = append(r.OCOGroups, v)
		}
	}
	for _, v := range s.state.TWAPOrders {
		if v.Account == account {
			r.TWAPOrders = append(r.TWAPOrders, v)
		}
	}
	for _, v := range s.state.ScaleOrders {
		if v.Account == account {
			r.ScaleOrders = append(r.ScaleOrders, v)
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
func (s *Service) emitExecutionLocked(stream, eventType, account, objectType, objectID string, payload any) {
	if stream == "market" {
		switch value := payload.(type) {
		case Order:
			value = publicBookOrder(value)
			payload = struct {
				ID, Market, Side, Type, TimeInForce, Status string
				PostOnly                                    bool
				PriceMicro, AmountMicro, FilledMicro        int64
				UpdatedAt                                   time.Time
			}{value.ID, value.Market, value.Side, value.Type, value.TimeInForce, value.Status, value.PostOnly, value.PriceMicro, value.AmountMicro, value.FilledMicro, value.UpdatedAt}
		case Trade:
			payload = struct {
				ID, Market, BuyOrderID, SellOrderID string
				PriceMicro, AmountMicro             int64
				CreatedAt                           time.Time
			}{value.ID, value.Market, value.BuyOrderID, value.SellOrderID, value.PriceMicro, value.AmountMicro, value.CreatedAt}
		}
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		panic("execution event payload is not JSON serializable")
	}
	s.state.EventSequence++
	previous := ""
	if n := len(s.state.ExecutionEvents); n > 0 {
		previous = s.state.ExecutionEvents[n-1].Hash
	}
	event := ExecutionEvent{Sequence: s.state.EventSequence, Stream: stream, Type: eventType, Account: account, Market: DefaultMarket, ObjectType: objectType, ObjectID: objectID, PayloadDigest: digest(payload), Payload: payloadJSON, AsOf: s.cfg.Now().UTC(), Source: ProductID, Version: "execution-stream-v1", PreviousHash: previous}
	event.Hash = digest(event)
	s.state.ExecutionEvents = append(s.state.ExecutionEvents, event)
}

func (s *Service) ExecutionEvents(after int64, stream, account string, limit int) ([]ExecutionEvent, int64, error) {
	if after < 0 || (stream != "market" && stream != "user") || (stream == "user" && strings.TrimSpace(account) == "") {
		return nil, 0, ErrInvalid
	}
	if limit < 1 || limit > 1000 {
		limit = 1000
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.state.ExecutionEvents) > 0 && after > 0 && after < s.state.ExecutionEvents[0].Sequence-1 {
		return nil, s.state.EventSequence, ErrConflict
	}
	events := make([]ExecutionEvent, 0)
	for _, event := range s.state.ExecutionEvents {
		if event.Sequence <= after || event.Stream != stream || (stream == "user" && event.Account != account) {
			continue
		}
		events = append(events, event)
		if len(events) == limit {
			break
		}
	}
	return events, s.state.EventSequence, nil
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
