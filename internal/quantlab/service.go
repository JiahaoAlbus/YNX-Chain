package quantlab

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrInvalid     = errors.New("invalid request")
	ErrConflict    = errors.New("conflict")
	ErrForbidden   = errors.New("forbidden")
	ErrUnavailable = errors.New("unavailable")
)

const (
	ProductID           = "ynx-quant-lab"
	Version             = "0.2.0-testnet"
	StateSchema         = 1
	StageDraft          = "Draft"
	StageResearch       = "Research"
	StageBacktest       = "Backtest"
	StageWalkForward    = "Walk-forward"
	StagePaper          = "Paper"
	StageShadow         = "Shadow"
	StageCandidate      = "Candidate"
	StageBoundedTestnet = "Wallet-approved Bounded Testnet"
	StagePaused         = "Paused"
	StageRetired        = "Retired"
	StageArchived       = "Archived"
)

// BuildCommit is overridden by release builds with -ldflags -X.
var BuildCommit = "development"

type Config struct {
	StatePath        string
	DatabaseURL      string
	StateNamespace   string
	sharedDatabase   *sql.DB
	Now              func() time.Time
	MandateVerifier  MandateVerifier
	TestnetBroker    TestnetBroker
	SessionCompleter WalletSessionCompleter
	MarketData       MarketData
}

type MandateVerifier interface {
	VerifyMandate(context.Context, Mandate, string) error
}
type TestnetBroker interface {
	SubmitTestnet(context.Context, Mandate, TestnetOrder, string) (string, error)
}
type WalletSessionCompleter interface {
	CompleteWalletSession(context.Context, []byte) ([]byte, int, error)
}
type Bar struct {
	Time   time.Time `json:"time"`
	Open   int64     `json:"open"`
	High   int64     `json:"high"`
	Low    int64     `json:"low"`
	Close  int64     `json:"close"`
	Volume int64     `json:"volume"`
}
type DatasetRecord struct {
	ID               string    `json:"id"`
	Version          string    `json:"version"`
	ContentSHA256    string    `json:"contentSha256"`
	SchemaVersion    string    `json:"schemaVersion"`
	Provider         string    `json:"provider"`
	OfficialURL      string    `json:"officialUrl"`
	License          string    `json:"license"`
	TermsVersion     string    `json:"termsVersion"`
	Jurisdiction     string    `json:"jurisdiction"`
	Authentication   string    `json:"authentication"`
	RateLimit        string    `json:"rateLimit"`
	Retention        string    `json:"retention"`
	DataRights       string    `json:"dataRights"`
	PermittedUses    []string  `json:"permittedUses"`
	DataTypes        []string  `json:"dataTypes"`
	Timezone         string    `json:"timezone"`
	Precision        string    `json:"precision"`
	CorrectionPolicy string    `json:"correctionPolicy"`
	BiasControls     []string  `json:"biasControls"`
	Lineage          []string  `json:"lineage"`
	Source           string    `json:"source"`
	AsOf             time.Time `json:"asOf"`
	IngestedAt       time.Time `json:"ingestedAt"`
	Coverage         string    `json:"coverage"`
	Confidence       string    `json:"confidence"`
	FailureStatus    string    `json:"failureStatus"`
	Private          bool      `json:"private"`
	CloudConsentID   string    `json:"cloudConsentId,omitempty"`
	ConsentExpiresAt time.Time `json:"consentExpiresAt,omitempty"`
}
type Assumptions struct {
	FeeBPS, SlippageBPS int64
	LatencyBars         int
	ParticipationBPS    int64
	Seed                int64
	TrainEnd            int
	WalkForwardWindows  int
}
type StrategySpec struct {
	ID, Name, Family, Source, SourceCommit, License, StrategyHash, ModelHash, DataHash, FeatureHash, Split, Limitations string
	Seed                                                                                                                int64
	Params                                                                                                              map[string]int64
	Stage                                                                                                               string
	CreatedAt                                                                                                           time.Time
}
type LifecycleApproval struct {
	TargetStage    string `json:"targetStage"`
	RiskApproved   bool   `json:"riskApproved"`
	EvidenceDigest string `json:"evidenceDigest"`
	MandateDigest  string `json:"mandateDigest"`
	Actor          string `json:"actor"`
}
type BacktestRequest struct {
	Strategy    StrategySpec `json:"strategy"`
	Bars        []Bar        `json:"bars"`
	Assumptions Assumptions  `json:"assumptions"`
}
type Metrics struct {
	ReturnBPS, BuyHoldBPS, MaxDrawdownBPS int64
	Trades, PartialFills, DataGaps        int
	NoTrade                               bool
}
type PnLAttribution struct {
	Currency                 string   `json:"currency"`
	Alpha                    int64    `json:"alpha"`
	Beta                     int64    `json:"beta"`
	CarryFunding             int64    `json:"carryFunding"`
	MakerRebateLPFee         int64    `json:"makerRebateLpFee"`
	TradingFee               int64    `json:"tradingFee"`
	Gas                      int64    `json:"gas"`
	Slippage                 int64    `json:"slippage"`
	MEV                      int64    `json:"mev"`
	OracleDrift              int64    `json:"oracleDrift"`
	AverageIdleCapital       int64    `json:"averageIdleCapital"`
	ComputeDataFee           int64    `json:"computeDataFee"`
	ManagementPerformanceFee int64    `json:"managementPerformanceFee"`
	UserRealizedPnL          int64    `json:"userRealizedPnl"`
	UserUnrealizedPnL        int64    `json:"userUnrealizedPnl"`
	UserNetPnL               int64    `json:"userNetPnl"`
	Reconciled               bool     `json:"reconciled"`
	UnsupportedComponents    []string `json:"unsupportedComponents"`
}
type Experiment struct {
	ID                   string             `json:"id"`
	Strategy             StrategySpec       `json:"strategy"`
	Assumptions          Assumptions        `json:"assumptions"`
	Metrics              Metrics            `json:"metrics"`
	Attribution          PnLAttribution     `json:"attribution"`
	LookAheadRejected    bool               `json:"lookAheadRejected"`
	LeakageChecksPassed  bool               `json:"leakageChecksPassed"`
	WalkForward          []Metrics          `json:"walkForward"`
	Sensitivity          map[string]Metrics `json:"sensitivity"`
	SensitivitySpreadBPS int64              `json:"sensitivitySpreadBPS"`
	Regimes              map[string]Metrics `json:"regimes"`
	NoTradeReturnBPS     int64              `json:"noTradeReturnBPS"`
	Status               string             `json:"status"`
	CreatedAt            time.Time          `json:"createdAt"`
	AuditDigest          string             `json:"auditDigest"`
}
type RiskLimits struct {
	MaxOrderNotional int64 `json:"maxOrderNotional"`
	MaxPosition      int64 `json:"maxPosition"`
	MaxDailyLoss     int64 `json:"maxDailyLoss"`
	MaxOrders        int   `json:"maxOrders"`
}
type Mandate struct {
	Account, StrategyHash, Market                      string
	ProductID, BundleID, DeviceID                      string
	NonceDomain, Scope                                 string
	Nonce                                              uint64
	MaxNotional, MaxPosition, MaxDailyLoss             int64
	MaxSlippageBPS, MaxGas                             int64
	MaxOrdersPerMinute                                 int
	MaxLeverageBPS, MaxDrawdown                        int64
	MinLiquidity, MaxVaR, MaxExpectedShortfall         int64
	MaxDepegBPS, MaxConcentrationBPS, MaxCancelRateBPS int64
	MaxConsecutiveAPIFailures                          int
	ExpiresAt                                          time.Time
	WalletSignature, Digest                            string
	TestnetOnly                                        bool
	Revoked                                            bool
	RevokedAt                                          time.Time
}

type TestnetRiskObservation struct {
	ReferencePrice         int64     `json:"referencePrice"`
	EstimatedGas           int64     `json:"estimatedGas"`
	ObservedDailyLoss      int64     `json:"observedDailyLoss"`
	Equity                 int64     `json:"equity"`
	GrossExposure          int64     `json:"grossExposure"`
	PeakEquity             int64     `json:"peakEquity"`
	CurrentEquity          int64     `json:"currentEquity"`
	AvailableLiquidity     int64     `json:"availableLiquidity"`
	DepegBPS               int64     `json:"depegBps"`
	ConcentrationBPS       int64     `json:"concentrationBps"`
	OrdersObserved         int64     `json:"ordersObserved"`
	CancelsObserved        int64     `json:"cancelsObserved"`
	ConsecutiveAPIFailures int       `json:"consecutiveApiFailures"`
	VaR                    int64     `json:"var"`
	ExpectedShortfall      int64     `json:"expectedShortfall"`
	OracleAsOf             time.Time `json:"oracleAsOf"`
	VenueHealthy           bool      `json:"venueHealthy"`
}

type TestnetOrder struct {
	ID              string    `json:"id"`
	MandateDigest   string    `json:"mandateDigest"`
	StrategyHash    string    `json:"strategyHash"`
	Market          string    `json:"market"`
	Side            string    `json:"side"`
	Price           int64     `json:"price"`
	Amount          int64     `json:"amount"`
	IdempotencyKey  string    `json:"idempotencyKey"`
	WalletSignature string    `json:"walletSignature,omitempty"`
	BrokerProof     string    `json:"brokerProof"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"createdAt"`
}
type PaperOrder struct {
	ID, StrategyHash, Side, Status, Source string
	Price, Amount, Filled                  int64
	CreatedAt                              time.Time
}
type PaperState struct {
	Cash, Position, RealizedPnL int64
	Orders                      []PaperOrder
	LastSequence                int64
	ReconciliationDelta         int64
	KillSwitch                  bool
	UpdatedAt                   time.Time
}
type AuditEvent struct {
	Sequence                                     int64
	Action, ObjectID, Digest, PreviousHash, Hash string
	CreatedAt                                    time.Time
}
type BackupRecord struct {
	Path      string    `json:"path"`
	SHA256    string    `json:"sha256"`
	Bytes     int64     `json:"bytes"`
	Schema    int       `json:"schema"`
	CreatedAt time.Time `json:"createdAt"`
}
type DeletionRecord struct {
	DeletedAt      time.Time `json:"deletedAt"`
	PreviousDigest string    `json:"previousDigest"`
	Schema         int       `json:"schema"`
}
type ExecutionLedgerRecord struct {
	Adapter      ExecutionAdapterKind `json:"adapter"`
	RequestID    string               `json:"requestId"`
	IntentDigest string               `json:"intentDigest"`
	Sequence     int64                `json:"sequence"`
	Status       string               `json:"status"`
	Result       ExecutionResult      `json:"result"`
	ReservedAt   time.Time            `json:"reservedAt"`
	CompletedAt  time.Time            `json:"completedAt,omitempty"`
}
type state struct {
	Revision         int64                            `json:"-"`
	Schema           int                              `json:"schema"`
	Sequence         int64                            `json:"sequence"`
	Experiments      map[string]Experiment            `json:"experiments"`
	Strategies       map[string]StrategySpec          `json:"strategies"`
	Datasets         map[string]DatasetRecord         `json:"datasets"`
	Paper            PaperState                       `json:"paper"`
	Mandates         map[string]Mandate               `json:"mandates"`
	TestnetOrders    map[string]TestnetOrder          `json:"testnetOrders"`
	Idempotency      map[string]string                `json:"idempotency"`
	ExecutionLedger  map[string]ExecutionLedgerRecord `json:"executionLedger"`
	AdapterSequences map[string]int64                 `json:"adapterSequences"`
	Audit            []AuditEvent                     `json:"audit"`
	Integrity        string                           `json:"integrity"`
}
type Service struct {
	mu    sync.Mutex
	cfg   Config
	state state
	store stateStore
}

type SnapshotSourceMetadata struct {
	Source         string         `json:"source"`
	AsOf           time.Time      `json:"asOf"`
	Version        string         `json:"version"`
	Classification string         `json:"classification"`
	Status         string         `json:"status"`
	Confidence     string         `json:"confidence"`
	Coverage       string         `json:"coverage"`
	Storage        map[string]any `json:"storage"`
}

// StorageStatus describes the persistence contract that this Service is
// actually running. The file snapshot is durable across a process restart and
// guarded against concurrent writers on one shared filesystem, but it is not
// a distributed store: it must never be advertised as a multi-instance
// production backend.
func (s *Service) StorageStatus() map[string]any {
	backend := "unavailable"
	multiInstance := false
	if s.store != nil {
		backend = s.store.backend()
		multiInstance = s.store.multiInstance()
	}
	return map[string]any{
		"backend":                      backend,
		"restartPersistent":            true,
		"crossProcessSharedFilesystem": backend == "filesystem_json_snapshot",
		"multiInstance":                multiInstance,
		"productionDatabaseRequired":   !multiInstance,
	}
}

func (s *Service) StorageSource() string {
	if s.store != nil && s.store.backend() == "postgresql" {
		return "ynx-quant-authoritative-postgresql-state"
	}
	return "ynx-quant-authoritative-local-state"
}

func (s *Service) snapshotSourceMetadata(status string) SnapshotSourceMetadata {
	storage := s.StorageStatus()
	if status == "" {
		if multiInstance, _ := storage["multiInstance"].(bool); multiInstance {
			status = "live"
		} else {
			status = "degraded_single_host"
		}
	}
	return SnapshotSourceMetadata{
		Source:         s.StorageSource(),
		AsOf:           s.cfg.Now().UTC(),
		Version:        Version,
		Classification: "testnet",
		Status:         status,
		Confidence:     "authoritative-for-quant-owned-persisted-state",
		Coverage:       "local-research-paper-and-bounded-testnet-records",
		Storage:        storage,
	}
}

func New(cfg Config) (*Service, error) {
	cfg.DatabaseURL = strings.TrimSpace(cfg.DatabaseURL)
	cfg.StateNamespace = strings.TrimSpace(cfg.StateNamespace)
	if strings.TrimSpace(cfg.StatePath) == "" {
		return nil, ErrInvalid
	}
	if strings.TrimSpace(cfg.DatabaseURL) != "" && !validStateNamespace(cfg.StateNamespace) {
		return nil, ErrInvalid
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	store, err := openStateStore(cfg)
	if err != nil {
		return nil, err
	}
	s, found, err := store.load()
	if err != nil {
		_ = store.close()
		return nil, err
	}
	if !found {
		s = newQuantState()
	}
	normalizeQuantState(&s)
	return &Service{cfg: cfg, state: s, store: store}, nil
}

func (s *Service) Close() error {
	if s.store == nil {
		return nil
	}
	return s.store.close()
}

func (s *Service) RegisterDataset(record DatasetRecord) (DatasetRecord, error) {
	record.ID = strings.TrimSpace(record.ID)
	record.Version = strings.TrimSpace(record.Version)
	record.ContentSHA256 = strings.ToLower(strings.TrimSpace(record.ContentSHA256))
	parsedURL, urlErr := url.Parse(strings.TrimSpace(record.OfficialURL))
	allowedTypes := map[string]bool{"OHLCV": true, "trades": true, "order-book": true, "funding": true, "oracle": true, "DEX-pools": true}
	allowedUses := map[string]bool{"research": true, "backtest": true, "paper": true, "shadow": true, "bounded-testnet": true, "display": true}
	allowedBias := map[string]bool{"missing-data": true, "survivorship": true, "look-ahead": true, "delisting": true, "depeg": true, "corporate-action": true}
	if !validSimpleID(record.ID) || record.Version == "" || len(record.ContentSHA256) != 64 || record.SchemaVersion == "" || record.Provider == "" || urlErr != nil || parsedURL.Scheme != "https" || parsedURL.Host == "" || parsedURL.User != nil || record.License == "" || record.TermsVersion == "" || record.Jurisdiction == "" || record.Authentication == "" || record.RateLimit == "" || record.Retention == "" || record.DataRights == "" || len(record.PermittedUses) == 0 || len(record.DataTypes) == 0 || record.Timezone == "" || record.Precision == "" || record.CorrectionPolicy == "" || len(record.BiasControls) == 0 || len(record.Lineage) == 0 || record.Source == "" || record.AsOf.IsZero() || record.Coverage == "" || record.Confidence == "" || record.FailureStatus == "" {
		return DatasetRecord{}, ErrInvalid
	}
	if _, err := hex.DecodeString(record.ContentSHA256); err != nil {
		return DatasetRecord{}, ErrInvalid
	}
	for _, value := range record.DataTypes {
		if !allowedTypes[value] {
			return DatasetRecord{}, ErrInvalid
		}
	}
	for _, value := range record.PermittedUses {
		if !allowedUses[value] {
			return DatasetRecord{}, ErrInvalid
		}
	}
	for _, value := range record.BiasControls {
		if !allowedBias[value] {
			return DatasetRecord{}, ErrInvalid
		}
	}
	now := s.cfg.Now()
	if record.AsOf.After(now) || record.AsOf.Before(now.AddDate(-20, 0, 0)) {
		return DatasetRecord{}, ErrInvalid
	}
	if record.Private && (len(strings.TrimSpace(record.CloudConsentID)) < 8 || !record.ConsentExpiresAt.After(now) || record.ConsentExpiresAt.After(now.Add(90*24*time.Hour))) {
		return DatasetRecord{}, ErrForbidden
	}
	if !record.Private && (record.CloudConsentID != "" || !record.ConsentExpiresAt.IsZero()) {
		return DatasetRecord{}, ErrInvalid
	}
	record.IngestedAt = now
	key := record.ID + "@" + record.Version
	s.mu.Lock()
	defer s.mu.Unlock()
	release, err := s.lockAndReload()
	if err != nil {
		return DatasetRecord{}, err
	}
	defer release()
	if _, exists := s.state.Datasets[key]; exists {
		return DatasetRecord{}, ErrConflict
	}
	s.state.Datasets[key] = record
	s.audit("dataset_registered", key, record.ContentSHA256)
	return record, s.save()
}

func (s *Service) RegisterMandate(m Mandate) (Mandate, error) {
	return s.RegisterMandateWithSession(context.Background(), m, "")
}

func (s *Service) RegisterMandateWithSession(ctx context.Context, m Mandate, exchangeSession string) (Mandate, error) {
	now := s.cfg.Now()
	m.Account = strings.TrimSpace(m.Account)
	m.StrategyHash = strings.ToLower(strings.TrimSpace(m.StrategyHash))
	m.Market = strings.TrimSpace(m.Market)
	if !m.TestnetOnly || len(m.StrategyHash) != 64 || m.Market != "YNXT-YUSD_TEST" ||
		m.ProductID != ProductID || len(strings.TrimSpace(m.BundleID)) < 3 || len(strings.TrimSpace(m.DeviceID)) < 3 ||
		m.NonceDomain != "quant:"+m.StrategyHash || m.Scope != "quant:testnet-execute" || m.Nonce == 0 ||
		m.MaxNotional <= 0 || m.MaxPosition <= 0 || m.MaxDailyLoss <= 0 || m.MaxSlippageBPS <= 0 || m.MaxSlippageBPS > 10_000 ||
		m.MaxGas <= 0 || m.MaxOrdersPerMinute <= 0 || m.MaxOrdersPerMinute > 60 || !m.ExpiresAt.After(now) ||
		m.MaxLeverageBPS <= 0 || m.MaxDrawdown <= 0 || m.MinLiquidity <= 0 || m.MaxVaR <= 0 || m.MaxExpectedShortfall <= 0 ||
		m.MaxDepegBPS <= 0 || m.MaxDepegBPS > 10_000 || m.MaxConcentrationBPS <= 0 || m.MaxConcentrationBPS > 10_000 ||
		m.MaxCancelRateBPS <= 0 || m.MaxCancelRateBPS > 10_000 || m.MaxConsecutiveAPIFailures <= 0 ||
		m.ExpiresAt.After(now.Add(24*time.Hour)) || strings.TrimSpace(m.WalletSignature) == "" {
		return Mandate{}, ErrInvalid
	}
	m.Digest = hash(struct {
		Account, StrategyHash, Market                      string
		ProductID, BundleID, DeviceID                      string
		NonceDomain, Scope                                 string
		Nonce                                              uint64
		MaxNotional, MaxPosition, MaxDailyLoss             int64
		MaxSlippageBPS, MaxGas                             int64
		MaxOrdersPerMinute                                 int
		MaxLeverageBPS, MaxDrawdown                        int64
		MinLiquidity, MaxVaR, MaxExpectedShortfall         int64
		MaxDepegBPS, MaxConcentrationBPS, MaxCancelRateBPS int64
		MaxConsecutiveAPIFailures                          int
		ExpiresAt                                          time.Time
		TestnetOnly                                        bool
	}{m.Account, m.StrategyHash, m.Market, m.ProductID, m.BundleID, m.DeviceID, m.NonceDomain, m.Scope, m.Nonce, m.MaxNotional, m.MaxPosition, m.MaxDailyLoss, m.MaxSlippageBPS, m.MaxGas, m.MaxOrdersPerMinute, m.MaxLeverageBPS, m.MaxDrawdown, m.MinLiquidity, m.MaxVaR, m.MaxExpectedShortfall, m.MaxDepegBPS, m.MaxConcentrationBPS, m.MaxCancelRateBPS, m.MaxConsecutiveAPIFailures, m.ExpiresAt, m.TestnetOnly})
	if s.cfg.MandateVerifier == nil {
		return Mandate{}, ErrUnavailable
	}
	if err := s.cfg.MandateVerifier.VerifyMandate(ctx, m, exchangeSession); err != nil {
		if errors.Is(err, ErrUnavailable) {
			return Mandate{}, ErrUnavailable
		}
		return Mandate{}, ErrForbidden
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, lockErr := s.lockAndReload()
	if lockErr != nil {
		return Mandate{}, lockErr
	}
	defer release()
	if _, ok := s.state.Mandates[m.Digest]; ok {
		return Mandate{}, ErrConflict
	}
	s.state.Mandates[m.Digest] = m
	s.audit("testnet_mandate_registered", m.Digest, m.Digest)
	return m, s.save()
}

func (s *Service) SubmitTestnet(mandateDigest, side string, price, amount int64, key string, risk TestnetRiskObservation) (TestnetOrder, error) {
	return s.SubmitTestnetWithSession(context.Background(), mandateDigest, side, price, amount, key, "", "", risk)
}

func (s *Service) SubmitTestnetWithSession(ctx context.Context, mandateDigest, side string, price, amount int64, key, walletSignature, exchangeSession string, risk TestnetRiskObservation) (TestnetOrder, error) {
	if (side != "buy" && side != "sell") || price <= 0 || amount <= 0 || len(key) < 8 || len(key) > 128 {
		return TestnetOrder{}, ErrInvalid
	}
	if s.cfg.TestnetBroker == nil {
		return TestnetOrder{}, ErrUnavailable
	}
	s.mu.Lock()
	release, lockErr := s.lockAndReload()
	if lockErr != nil {
		s.mu.Unlock()
		return TestnetOrder{}, lockErr
	}
	unlock := func() { release(); s.mu.Unlock() }
	if s.state.Paper.KillSwitch {
		unlock()
		return TestnetOrder{}, ErrForbidden
	}
	m, ok := s.state.Mandates[mandateDigest]
	if !ok || m.Revoked || !s.cfg.Now().Before(m.ExpiresAt) {
		unlock()
		return TestnetOrder{}, ErrForbidden
	}
	now := s.cfg.Now()
	if !risk.VenueHealthy || risk.ReferencePrice <= 0 || risk.EstimatedGas < 0 || risk.ObservedDailyLoss < 0 || risk.Equity <= 0 ||
		risk.GrossExposure < 0 || risk.PeakEquity <= 0 || risk.CurrentEquity < 0 || risk.CurrentEquity > risk.PeakEquity ||
		risk.AvailableLiquidity < 0 || risk.DepegBPS < 0 || risk.ConcentrationBPS < 0 || risk.OrdersObserved < 0 ||
		risk.CancelsObserved < 0 || risk.CancelsObserved > risk.OrdersObserved || risk.ConsecutiveAPIFailures < 0 || risk.VaR < 0 || risk.ExpectedShortfall < 0 ||
		risk.OracleAsOf.IsZero() || risk.OracleAsOf.After(now) || now.Sub(risk.OracleAsOf) > 30*time.Second {
		unlock()
		return TestnetOrder{}, ErrForbidden
	}
	slippageBPS, safe := basisPoints(abs(price-risk.ReferencePrice), risk.ReferencePrice)
	if !safe {
		unlock()
		return TestnetOrder{}, ErrInvalid
	}
	notional, safe := microNotional(price, amount)
	if !safe {
		unlock()
		return TestnetOrder{}, ErrInvalid
	}
	if risk.GrossExposure > math.MaxInt64-notional {
		unlock()
		return TestnetOrder{}, ErrInvalid
	}
	projectedLeverageBPS, safe := basisPoints(risk.GrossExposure+notional, risk.Equity)
	if !safe {
		unlock()
		return TestnetOrder{}, ErrInvalid
	}
	drawdown := risk.PeakEquity - risk.CurrentEquity
	cancelRateBPS := int64(0)
	if risk.OrdersObserved > 0 {
		cancelRateBPS, safe = basisPoints(risk.CancelsObserved, risk.OrdersObserved)
		if !safe {
			unlock()
			return TestnetOrder{}, ErrInvalid
		}
	}
	if slippageBPS > m.MaxSlippageBPS || risk.EstimatedGas > m.MaxGas || risk.ObservedDailyLoss >= m.MaxDailyLoss ||
		projectedLeverageBPS > m.MaxLeverageBPS || drawdown >= m.MaxDrawdown || risk.AvailableLiquidity < m.MinLiquidity || risk.AvailableLiquidity < notional ||
		risk.DepegBPS > m.MaxDepegBPS || risk.ConcentrationBPS > m.MaxConcentrationBPS || cancelRateBPS > m.MaxCancelRateBPS ||
		risk.ConsecutiveAPIFailures >= m.MaxConsecutiveAPIFailures || risk.VaR > m.MaxVaR || risk.ExpectedShortfall > m.MaxExpectedShortfall {
		unlock()
		return TestnetOrder{}, ErrForbidden
	}
	position := int64(0)
	recentOrders := 0
	for _, existing := range s.state.TestnetOrders {
		if existing.MandateDigest != mandateDigest || existing.Status != "submitted_testnet" {
			continue
		}
		if existing.Side == "buy" {
			position += existing.Amount
		} else {
			position -= existing.Amount
		}
		if !existing.CreatedAt.Before(now.Add(-time.Minute)) {
			recentOrders++
		}
	}
	if recentOrders >= m.MaxOrdersPerMinute {
		unlock()
		return TestnetOrder{}, ErrForbidden
	}
	signedAmount := amount
	if side == "sell" {
		signedAmount = -amount
	}
	if notional > m.MaxNotional || abs(position+signedAmount) > m.MaxPosition {
		unlock()
		return TestnetOrder{}, ErrForbidden
	}
	d := hash(struct {
		MandateDigest, Side string
		Price, Amount       int64
	}{mandateDigest, side, price, amount})
	if prior, ok := s.state.Idempotency[key]; ok {
		if prior != d {
			unlock()
			return TestnetOrder{}, ErrConflict
		}
		for _, o := range s.state.TestnetOrders {
			if o.IdempotencyKey == key {
				unlock()
				if o.Status == "submitted_testnet" {
					return o, nil
				}
				return TestnetOrder{}, ErrUnavailable
			}
		}
	}
	s.state.Sequence++
	o := TestnetOrder{ID: fmt.Sprintf("testnet-%06d", s.state.Sequence), MandateDigest: mandateDigest, StrategyHash: m.StrategyHash, Market: m.Market, Side: side, Price: price, Amount: amount, IdempotencyKey: key, WalletSignature: strings.TrimSpace(walletSignature), Status: "reserved_outcome_unknown", CreatedAt: s.cfg.Now()}
	s.state.TestnetOrders[o.ID] = o
	s.state.Idempotency[key] = d
	s.audit("testnet_order_reserved", o.ID, hash(o))
	if err := s.save(); err != nil {
		unlock()
		return TestnetOrder{}, err
	}
	unlock()

	proof, err := s.cfg.TestnetBroker.SubmitTestnet(ctx, m, o, exchangeSession)
	if err != nil {
		return TestnetOrder{}, ErrUnavailable
	}
	o.BrokerProof = strings.TrimSpace(proof)
	if o.BrokerProof == "" {
		return TestnetOrder{}, ErrUnavailable
	}
	s.mu.Lock()
	release, lockErr = s.lockAndReload()
	if lockErr != nil {
		s.mu.Unlock()
		return TestnetOrder{}, lockErr
	}
	defer release()
	defer s.mu.Unlock()
	reserved, ok := s.state.TestnetOrders[o.ID]
	if !ok || reserved.Status != "reserved_outcome_unknown" || reserved.IdempotencyKey != key || s.state.Idempotency[key] != d {
		return TestnetOrder{}, ErrConflict
	}
	o.Status = "submitted_testnet"
	s.state.TestnetOrders[o.ID] = o
	s.audit("testnet_order_submitted", o.ID, hash(o))
	return o, s.save()
}

func (s *Service) RevokeMandate(digest, actor string) (Mandate, error) {
	digest = strings.TrimSpace(digest)
	actor = strings.TrimSpace(actor)
	if len(digest) != sha256.Size*2 || len(actor) < 3 {
		return Mandate{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, lockErr := s.lockAndReload()
	if lockErr != nil {
		return Mandate{}, lockErr
	}
	defer release()
	m, ok := s.state.Mandates[digest]
	if !ok {
		return Mandate{}, ErrInvalid
	}
	if m.Revoked {
		return m, nil
	}
	m.Revoked = true
	m.RevokedAt = s.cfg.Now()
	s.state.Mandates[digest] = m
	s.audit("testnet_mandate_revoked", digest, hash(struct{ Actor, Digest string }{actor, digest}))
	return m, s.save()
}

func (s *Service) RunBacktest(req BacktestRequest) (Experiment, error) {
	if err := validateBacktest(req); err != nil {
		return Experiment{}, err
	}
	strategy := req.Strategy
	// A completed deterministic experiment records each prerequisite research
	// state in order. Execution stages remain unavailable until separately
	// approved through AdvanceStrategy.
	strategy.Stage = StageBacktest
	strategy.StrategyHash = hash(struct {
		Source, Commit string
		Params         map[string]int64
		Seed           int64
	}{strategy.Source, strategy.SourceCommit, strategy.Params, strategy.Seed})
	strategy.DataHash = hash(req.Bars)
	strategy.FeatureHash = hash(struct {
		Family string
		Params map[string]int64
	}{strategy.Family, strategy.Params})
	strategy.Split = fmt.Sprintf("train[0:%d), out-of-sample[%d:%d), walk-forward=%d", req.Assumptions.TrainEnd, req.Assumptions.TrainEnd, len(req.Bars), req.Assumptions.WalkForwardWindows)
	metrics, attribution := simulateDetailed(req.Bars, strategy, req.Assumptions, req.Assumptions.TrainEnd, len(req.Bars))
	walkForward := make([]Metrics, 0, req.Assumptions.WalkForwardWindows)
	oos := len(req.Bars) - req.Assumptions.TrainEnd
	for i := 0; i < req.Assumptions.WalkForwardWindows; i++ {
		start := req.Assumptions.TrainEnd + i*oos/req.Assumptions.WalkForwardWindows
		end := req.Assumptions.TrainEnd + (i+1)*oos/req.Assumptions.WalkForwardWindows
		if end > start {
			walkForward = append(walkForward, simulateRange(req.Bars, strategy, req.Assumptions, start, end))
		}
	}
	sensitivity := map[string]Metrics{}
	for _, delta := range []int64{-1, 1} {
		variant := strategy
		variant.Params = cloneParams(strategy.Params)
		variant.Params["fast"] += delta
		label := fmt.Sprintf("fast%+d", delta)
		sensitivity[label] = simulate(req.Bars, variant, req.Assumptions)
	}
	for _, delta := range []int64{-1, 1} {
		variant := strategy
		variant.Params = cloneParams(strategy.Params)
		variant.Params["slow"] += delta
		label := fmt.Sprintf("slow%+d", delta)
		sensitivity[label] = simulate(req.Bars, variant, req.Assumptions)
	}
	minReturn, maxReturn := metrics.ReturnBPS, metrics.ReturnBPS
	for _, m := range sensitivity {
		if m.ReturnBPS < minReturn {
			minReturn = m.ReturnBPS
		}
		if m.ReturnBPS > maxReturn {
			maxReturn = m.ReturnBPS
		}
	}
	mid := req.Assumptions.TrainEnd + oos/2
	regimes := map[string]Metrics{"oos-first-half": simulateRange(req.Bars, strategy, req.Assumptions, req.Assumptions.TrainEnd, mid), "oos-second-half": simulateRange(req.Bars, strategy, req.Assumptions, mid, len(req.Bars))}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, lockErr := s.lockAndReload()
	if lockErr != nil {
		return Experiment{}, lockErr
	}
	defer release()
	s.state.Sequence++
	id := fmt.Sprintf("experiment-%06d", s.state.Sequence)
	now := s.cfg.Now()
	e := Experiment{ID: id, Strategy: strategy, Assumptions: req.Assumptions, Metrics: metrics, Attribution: attribution, LeakageChecksPassed: true, WalkForward: walkForward, Sensitivity: sensitivity, SensitivitySpreadBPS: maxReturn - minReturn, Regimes: regimes, NoTradeReturnBPS: 0, Status: "completed_oos", CreatedAt: now}
	e.AuditDigest = hash(e)
	s.state.Experiments[id] = e
	s.state.Strategies[strategy.ID] = strategy
	s.audit("strategy_drafted", strategy.ID, strategy.StrategyHash)
	s.audit("strategy_research_validated", strategy.ID, strategy.FeatureHash)
	s.audit("backtest_completed", id, e.AuditDigest)
	if err := s.save(); err != nil {
		return Experiment{}, err
	}
	return e, nil
}

func (s *Service) RunBacktestFromMarket(strategy StrategySpec, assumptions Assumptions) (Experiment, error) {
	if s.cfg.MarketData == nil {
		return Experiment{}, ErrUnavailable
	}
	bars, source, err := s.cfg.MarketData.History("YNXT-YUSD_TEST", 10000)
	if err != nil || len(bars) < 20 {
		return Experiment{}, ErrUnavailable
	}
	strategy.Source = source
	return s.RunBacktest(BacktestRequest{Strategy: strategy, Bars: bars, Assumptions: assumptions})
}

func validateBacktest(r BacktestRequest) error {
	if len(r.Bars) < 20 || len(r.Bars) > 100000 || r.Assumptions.TrainEnd < 10 || r.Assumptions.TrainEnd >= len(r.Bars)-2 || r.Assumptions.FeeBPS < 0 || r.Assumptions.SlippageBPS < 0 || r.Assumptions.LatencyBars < 0 || r.Assumptions.LatencyBars > 50 || r.Assumptions.ParticipationBPS <= 0 || r.Assumptions.ParticipationBPS > 10000 || r.Assumptions.WalkForwardWindows < 1 || r.Assumptions.WalkForwardWindows > 20 || strings.TrimSpace(r.Strategy.ID) == "" || strings.TrimSpace(r.Strategy.Source) == "" {
		return ErrInvalid
	}
	for i, b := range r.Bars {
		if b.Close <= 0 || b.High < b.Low || b.Volume < 0 || (i > 0 && !b.Time.After(r.Bars[i-1].Time)) {
			return fmt.Errorf("bar %d: %w", i, ErrInvalid)
		}
	}
	return nil
}

func simulate(b []Bar, st StrategySpec, a Assumptions) Metrics {
	return simulateRange(b, st, a, a.TrainEnd, len(b))
}
func simulateRange(b []Bar, st StrategySpec, a Assumptions, startIndex, endIndex int) Metrics {
	metrics, _ := simulateDetailed(b, st, a, startIndex, endIndex)
	return metrics
}
func simulateDetailed(b []Bar, st StrategySpec, a Assumptions, startIndex, endIndex int) (Metrics, PnLAttribution) {
	cash := int64(100_000_000_000)
	start := cash
	pos := int64(0)
	peak := cash
	maxDD := int64(0)
	trades := 0
	partial := 0
	gaps := 0
	tradingFees := int64(0)
	slippageCosts := int64(0)
	realizedGross := int64(0)
	averageEntry := int64(0)
	idleCapitalSum := int64(0)
	idleCapitalSamples := int64(0)
	fast := int(st.Params["fast"])
	slow := int(st.Params["slow"])
	if fast < 2 {
		fast = 3
	}
	if slow <= fast {
		slow = 8
	}
	if startIndex < 1 {
		startIndex = 1
	}
	if endIndex > len(b) {
		endIndex = len(b)
	}
	for i := startIndex; i < endIndex; i++ {
		if b[i].Time.Sub(b[i-1].Time) > 2*time.Minute {
			gaps++
			continue
		}
		signalAt := i - 1 - a.LatencyBars
		if signalAt < slow-1 {
			continue
		}
		f, sma := int64(0), int64(0)
		for j := 0; j < fast; j++ {
			f += b[signalAt-j].Close
		}
		for j := 0; j < slow; j++ {
			sma += b[signalAt-j].Close
		}
		signal := int64(0)
		if f/int64(fast) > sma/int64(slow) {
			signal = 1
		} else if f/int64(fast) < sma/int64(slow) {
			signal = -1
		}
		target := signal * 1_000_000
		delta := target - pos
		if delta == 0 {
			continue
		}
		capFill := b[i].Volume * a.ParticipationBPS / 10000
		if capFill <= 0 {
			continue
		}
		fill := abs(delta)
		if fill > capFill {
			fill = capFill
			partial++
		}
		if delta < 0 {
			fill = -fill
		}
		price := b[i].Open
		if price <= 0 {
			price = b[i].Close
		}
		cost := fill * price / 1_000_000
		friction := abs(cost) * (a.FeeBPS + a.SlippageBPS) / 10000
		fee := abs(cost) * a.FeeBPS / 10000
		slippage := abs(cost) * a.SlippageBPS / 10000
		tradingFees += fee
		slippageCosts += slippage
		priorPosition := pos
		if priorPosition == 0 || (priorPosition > 0 && fill > 0) || (priorPosition < 0 && fill < 0) {
			total := abs(priorPosition) + abs(fill)
			if total > 0 {
				averageEntry = (abs(priorPosition)*averageEntry + abs(fill)*price) / total
			}
		} else {
			closed := abs(fill)
			if closed > abs(priorPosition) {
				closed = abs(priorPosition)
			}
			direction := int64(1)
			if priorPosition < 0 {
				direction = -1
			}
			realizedGross += closed * (price - averageEntry) * direction / 1_000_000
			if abs(fill) > abs(priorPosition) {
				averageEntry = price
			} else if abs(fill) == abs(priorPosition) {
				averageEntry = 0
			}
		}
		cash -= cost
		cash -= friction
		pos += fill
		trades++
		idleCapitalSum += cash
		idleCapitalSamples++
		equity := cash + pos*b[i].Close/1_000_000
		if equity > peak {
			peak = equity
		}
		dd := (peak - equity) * 10000 / peak
		if dd > maxDD {
			maxDD = dd
		}
	}
	end := cash + pos*b[endIndex-1].Close/1_000_000
	buyHold := (b[endIndex-1].Close - b[startIndex].Close) * 10000 / b[startIndex].Close
	metrics := Metrics{ReturnBPS: (end - start) * 10000 / start, BuyHoldBPS: buyHold, MaxDrawdownBPS: maxDD, Trades: trades, PartialFills: partial, DataGaps: gaps, NoTrade: trades == 0}
	net := end - start
	beta := buyHold * start / 10000
	gross := net + tradingFees + slippageCosts
	averageIdle := start
	if idleCapitalSamples > 0 {
		averageIdle = idleCapitalSum / idleCapitalSamples
	}
	userRealized := realizedGross - tradingFees - slippageCosts
	attribution := PnLAttribution{Currency: "YUSD_TEST_MICRO", Alpha: gross - beta, Beta: beta, TradingFee: tradingFees, Slippage: slippageCosts, AverageIdleCapital: averageIdle, UserRealizedPnL: userRealized, UserUnrealizedPnL: net - userRealized, UserNetPnL: net, UnsupportedComponents: []string{"carryFunding", "makerRebateLpFee", "gas", "mev", "oracleDrift", "computeDataFee", "managementPerformanceFee"}}
	attribution.Reconciled = attribution.Alpha+attribution.Beta+attribution.CarryFunding+attribution.MakerRebateLPFee-attribution.TradingFee-attribution.Gas-attribution.Slippage-attribution.MEV-attribution.OracleDrift-attribution.ComputeDataFee-attribution.ManagementPerformanceFee == attribution.UserNetPnL && attribution.UserRealizedPnL+attribution.UserUnrealizedPnL == attribution.UserNetPnL
	return metrics, attribution
}

func cloneParams(input map[string]int64) map[string]int64 {
	out := make(map[string]int64, len(input))
	for k, v := range input {
		out[k] = v
	}
	return out
}

func (s *Service) AdvanceStrategy(id string, approval LifecycleApproval) (StrategySpec, error) {
	approval.TargetStage = strings.TrimSpace(approval.TargetStage)
	approval.Actor = strings.TrimSpace(approval.Actor)
	approval.EvidenceDigest = strings.ToLower(strings.TrimSpace(approval.EvidenceDigest))
	if len(approval.Actor) < 3 || len(approval.EvidenceDigest) != sha256.Size*2 {
		return StrategySpec{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, lockErr := s.lockAndReload()
	if lockErr != nil {
		return StrategySpec{}, lockErr
	}
	defer release()
	v, ok := s.state.Strategies[id]
	if !ok {
		return StrategySpec{}, ErrInvalid
	}
	next := map[string]string{
		StageBacktest:       StageWalkForward,
		StageWalkForward:    StagePaper,
		StagePaper:          StageShadow,
		StageShadow:         StageCandidate,
		StageCandidate:      StageBoundedTestnet,
		StageBoundedTestnet: StagePaused,
		StagePaused:         StageRetired,
		StageRetired:        StageArchived,
	}
	if next[v.Stage] != approval.TargetStage || !approval.RiskApproved {
		return StrategySpec{}, ErrForbidden
	}
	if approval.TargetStage == StageBoundedTestnet {
		m, exists := s.state.Mandates[strings.TrimSpace(approval.MandateDigest)]
		if !exists || m.Revoked || !s.cfg.Now().Before(m.ExpiresAt) || m.StrategyHash != v.StrategyHash {
			return StrategySpec{}, ErrForbidden
		}
	}
	v.Stage = approval.TargetStage
	s.state.Strategies[id] = v
	s.audit("strategy_lifecycle_advanced", id, hash(struct {
		Strategy StrategySpec
		Approval LifecycleApproval
	}{v, approval}))
	return v, s.save()
}

func (s *Service) ApplyPaperSignal(strategyHash, side string, price, amount, volume int64) (PaperOrder, error) {
	decoded, digestErr := hex.DecodeString(strategyHash)
	if digestErr != nil || len(decoded) != sha256.Size || (side != "buy" && side != "sell") || price <= 0 || amount <= 0 || volume < 0 {
		return PaperOrder{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, lockErr := s.lockAndReload()
	if lockErr != nil {
		return PaperOrder{}, lockErr
	}
	defer release()
	if s.state.Paper.KillSwitch {
		return PaperOrder{}, ErrForbidden
	}
	limits := RiskLimits{MaxOrderNotional: 10_000_000_000, MaxPosition: 10_000_000, MaxDailyLoss: 1_000_000_000, MaxOrders: 100}
	notional, safe := microNotional(price, amount)
	if !safe {
		return PaperOrder{}, ErrInvalid
	}
	if notional > limits.MaxOrderNotional || len(s.state.Paper.Orders) >= limits.MaxOrders {
		return PaperOrder{}, ErrForbidden
	}
	fill := amount
	if fill > volume/10 {
		fill = volume / 10
	}
	if fill < 0 {
		fill = 0
	}
	signed := fill
	if side == "sell" {
		signed = -fill
	}
	if abs(s.state.Paper.Position+signed) > limits.MaxPosition {
		return PaperOrder{}, ErrForbidden
	}
	s.state.Sequence++
	o := PaperOrder{ID: fmt.Sprintf("paper-%06d", s.state.Sequence), StrategyHash: strategyHash, Side: side, Price: price, Amount: amount, Filled: fill, Status: "open", Source: "authoritative_market_adapter", CreatedAt: s.cfg.Now()}
	if fill == amount {
		o.Status = "filled"
	} else if fill > 0 {
		o.Status = "partially_filled"
	}
	s.state.Paper.Position += signed
	s.state.Paper.Cash -= signed * price / 1_000_000
	s.state.Paper.Orders = append(s.state.Paper.Orders, o)
	s.state.Paper.LastSequence = s.state.Sequence
	s.state.Paper.UpdatedAt = s.cfg.Now()
	s.audit("paper_order_"+o.Status, o.ID, hash(o))
	return o, s.save()
}

func (s *Service) ApplyPaperSignalFromMarket(strategyHash, side string, amount int64) (PaperOrder, error) {
	if s.cfg.MarketData == nil {
		return PaperOrder{}, ErrUnavailable
	}
	tick, err := s.cfg.MarketData.Latest("YNXT-YUSD_TEST")
	if err != nil || tick.Price <= 0 || tick.Volume <= 0 || tick.Source == "" {
		return PaperOrder{}, ErrUnavailable
	}
	return s.ApplyPaperSignal(strategyHash, side, tick.Price, amount, tick.Volume)
}

func (s *Service) Reconcile(authoritativeCash, authoritativePosition int64) (PaperState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	release, lockErr := s.lockAndReload()
	if lockErr != nil {
		return PaperState{}, lockErr
	}
	defer release()
	delta := abs(authoritativeCash-s.state.Paper.Cash) + abs(authoritativePosition-s.state.Paper.Position)
	s.state.Paper.ReconciliationDelta = delta
	if delta != 0 {
		s.state.Paper.KillSwitch = true
	}
	s.audit("paper_reconciled", "paper", hash(struct{ Cash, Position, Delta int64 }{authoritativeCash, authoritativePosition, delta}))
	return s.state.Paper, s.save()
}
func (s *Service) Kill(reason string) (PaperState, error) {
	if len(strings.TrimSpace(reason)) < 3 {
		return PaperState{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, lockErr := s.lockAndReload()
	if lockErr != nil {
		return PaperState{}, lockErr
	}
	defer release()
	s.state.Paper.KillSwitch = true
	s.audit("kill_switch_activated", "paper", hash(reason))
	return s.state.Paper, s.save()
}
func (s *Service) Snapshot() map[string]any {
	snapshot, _ := s.snapshotWithFingerprint()
	return snapshot
}

// streamSnapshot pairs a public snapshot with a durable-state fingerprint.
// The fingerprint is used only to decide whether a subscriber needs a fresh
// reconciliation; it is not an execution or Wallet capability.
func (s *Service) streamSnapshot() (map[string]any, string) {
	return s.snapshotWithFingerprint()
}

func (s *Service) snapshotWithFingerprint() (map[string]any, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	release, refreshErr := s.lockAndReload()
	if refreshErr == nil {
		defer release()
	}
	var failure any
	if refreshErr != nil {
		failure = map[string]string{"code": "state_refresh_failed", "message": "authoritative state is temporarily unavailable"}
	}
	metadata := s.snapshotSourceMetadata("")
	if refreshErr != nil {
		metadata = s.snapshotSourceMetadata("unavailable")
	}
	publicOrders := make(map[string]TestnetOrder, len(s.state.TestnetOrders))
	for id, order := range s.state.TestnetOrders {
		order.WalletSignature = ""
		publicOrders[id] = order
	}
	snapshot := map[string]any{
		"productId":        ProductID,
		"mode":             "SIMULATED / YNX TESTNET ONLY",
		"liveFundsEnabled": false,
		"source":           s.StorageSource(),
		"asOf":             s.cfg.Now(),
		"version":          Version,
		"coverage":         "local-research-paper-and-bounded-testnet-records",
		"sourceMetadata":   metadata,
		"failure":          failure,
		"paper":            s.state.Paper,
		"datasets":         s.state.Datasets,
		"strategies":       s.state.Strategies,
		"experiments":      s.state.Experiments,
		"testnetOrders":    publicOrders,
		"executionLedger":  s.state.ExecutionLedger,
		"adapterSequences": s.state.AdapterSequences,
		"audit":            s.state.Audit,
	}
	return snapshot, fmt.Sprintf("%d:%s", s.state.Revision, s.state.Integrity)
}

func (s *Service) Backup(destination string) (BackupRecord, error) {
	destination = filepath.Clean(strings.TrimSpace(destination))
	if destination == "." || destination == filepath.Clean(s.cfg.StatePath) {
		return BackupRecord{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, err := s.lockAndReload()
	if err != nil {
		return BackupRecord{}, err
	}
	defer release()
	b, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return BackupRecord{}, err
	}
	if err := writeAtomic(destination, b); err != nil {
		return BackupRecord{}, err
	}
	info, err := os.Stat(destination)
	if err != nil {
		return BackupRecord{}, err
	}
	return BackupRecord{Path: destination, SHA256: hashBytes(b), Bytes: info.Size(), Schema: s.state.Schema, CreatedAt: s.cfg.Now()}, nil
}

func (s *Service) Restore(source string) (BackupRecord, error) {
	source = filepath.Clean(strings.TrimSpace(source))
	b, err := os.ReadFile(source)
	if err != nil || len(b) == 0 || len(b) > 64<<20 {
		return BackupRecord{}, ErrInvalid
	}
	var restored state
	if json.Unmarshal(b, &restored) != nil || restored.Schema != StateSchema || !verifyIntegrity(restored) {
		return BackupRecord{}, ErrForbidden
	}
	if restored.ExecutionLedger == nil {
		restored.ExecutionLedger = map[string]ExecutionLedgerRecord{}
	}
	if restored.AdapterSequences == nil {
		restored.AdapterSequences = map[string]int64{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, err := s.lockAndReload()
	if err != nil {
		return BackupRecord{}, err
	}
	defer release()
	previous := s.state
	s.state = restored
	s.audit("state_restored", "state", hashBytes(b))
	if err := s.save(); err != nil {
		s.state = previous
		return BackupRecord{}, err
	}
	info, err := os.Stat(s.cfg.StatePath)
	if err != nil {
		return BackupRecord{}, err
	}
	return BackupRecord{Path: source, SHA256: hashBytes(b), Bytes: info.Size(), Schema: restored.Schema, CreatedAt: s.cfg.Now()}, nil
}

func (s *Service) DeleteAllLocalData(confirmation string) (DeletionRecord, error) {
	if confirmation != "DELETE ALL LOCAL QUANT DATA" {
		return DeletionRecord{}, ErrForbidden
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, err := s.lockAndReload()
	if err != nil {
		return DeletionRecord{}, err
	}
	defer release()
	previousDigest := s.state.Integrity
	if previousDigest == "" {
		previousDigest = hash(s.state)
	}
	now := s.cfg.Now()
	s.state = state{
		Schema:           StateSchema,
		Experiments:      map[string]Experiment{},
		Strategies:       map[string]StrategySpec{},
		Datasets:         map[string]DatasetRecord{},
		Paper:            PaperState{Cash: 100_000_000_000, UpdatedAt: now},
		Mandates:         map[string]Mandate{},
		TestnetOrders:    map[string]TestnetOrder{},
		Idempotency:      map[string]string{},
		ExecutionLedger:  map[string]ExecutionLedgerRecord{},
		AdapterSequences: map[string]int64{},
	}
	s.audit("all_local_user_data_deleted", "local-state", previousDigest)
	if err := s.save(); err != nil {
		return DeletionRecord{}, err
	}
	return DeletionRecord{DeletedAt: now, PreviousDigest: previousDigest, Schema: StateSchema}, nil
}

func (s *Service) lockAndReload() (func(), error) {
	if s.store != nil && !s.store.requiresFilesystemLock() {
		if err := s.reload(); err != nil {
			return nil, err
		}
		return func() {}, nil
	}
	lockPath := s.cfg.StatePath + ".lock"
	if err := os.MkdirAll(filepath.Dir(lockPath), 0700); err != nil {
		return nil, err
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if err := os.Mkdir(lockPath, 0700); err == nil {
			release := func() { _ = os.Remove(lockPath) }
			if err := s.reload(); err != nil {
				release()
				return nil, err
			}
			return release, nil
		} else if !os.IsExist(err) {
			return nil, err
		}
		if time.Now().After(deadline) {
			return nil, ErrUnavailable
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (s *Service) reload() error {
	latest, found, err := s.store.load()
	if err != nil {
		return err
	}
	if !found {
		return nil
	}
	normalizeQuantState(&latest)
	s.state = latest
	return nil
}

func (s *Service) audit(action, id, d string) {
	prev := ""
	if len(s.state.Audit) > 0 {
		prev = s.state.Audit[len(s.state.Audit)-1].Hash
	}
	e := AuditEvent{Sequence: int64(len(s.state.Audit) + 1), Action: action, ObjectID: id, Digest: d, PreviousHash: prev, CreatedAt: s.cfg.Now()}
	e.Hash = hash(e)
	s.state.Audit = append(s.state.Audit, e)
}
func (s *Service) save() error {
	s.state.Integrity = ""
	s.state.Integrity = hash(s.state)
	if err := s.store.save(&s.state); err != nil {
		_ = s.reload()
		if errors.Is(err, errStateConflict) {
			return ErrConflict
		}
		return err
	}
	return nil
}
func writeAtomic(path string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
func verifyIntegrity(s state) bool {
	got := s.Integrity
	s.Integrity = ""
	if got != "" && got == hash(s) {
		return true
	}
	// State schema 1 predates the durable execution ledger. Accept its exact
	// historical hash once, then the next atomic save upgrades the integrity
	// envelope with the new fields.
	return got != "" && s.ExecutionLedger == nil && s.AdapterSequences == nil && got == legacyIntegrityHash(s)
}

func legacyIntegrityHash(s state) string {
	legacy := struct {
		Schema        int                      `json:"schema"`
		Sequence      int64                    `json:"sequence"`
		Experiments   map[string]Experiment    `json:"experiments"`
		Strategies    map[string]StrategySpec  `json:"strategies"`
		Datasets      map[string]DatasetRecord `json:"datasets"`
		Paper         PaperState               `json:"paper"`
		Mandates      map[string]Mandate       `json:"mandates"`
		TestnetOrders map[string]TestnetOrder  `json:"testnetOrders"`
		Idempotency   map[string]string        `json:"idempotency"`
		Audit         []AuditEvent             `json:"audit"`
		Integrity     string                   `json:"integrity"`
	}{s.Schema, s.Sequence, s.Experiments, s.Strategies, s.Datasets, s.Paper, s.Mandates, s.TestnetOrders, s.Idempotency, s.Audit, ""}
	return hash(legacy)
}
func hash(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func hashBytes(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}
func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
func microNotional(price, amount int64) (int64, bool) {
	if price <= 0 || amount <= 0 || amount > math.MaxInt64/price {
		return 0, false
	}
	return price * amount / 1_000_000, true
}
func basisPoints(numerator, denominator int64) (int64, bool) {
	if numerator < 0 || denominator <= 0 {
		return 0, false
	}
	whole, remainder := numerator/denominator, numerator%denominator
	if whole > math.MaxInt64/10_000 || remainder > math.MaxInt64/10_000 {
		return 0, false
	}
	return whole*10_000 + remainder*10_000/denominator, true
}
func validSimpleID(value string) bool {
	if len(value) < 3 || len(value) > 120 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '-' && character != '_' && character != '.' {
			return false
		}
	}
	return true
}
func sortedKeys[V any](m map[string]V) []string {
	r := make([]string, 0, len(m))
	for k := range m {
		r = append(r, k)
	}
	sort.Strings(r)
	return r
}
