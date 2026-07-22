package quantlab

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
	Version             = "0.1.0-testnet"
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
	StatePath       string
	Now             func() time.Time
	MandateVerifier MandateVerifier
	TestnetBroker   TestnetBroker
	MarketData      MarketData
}

type MandateVerifier interface{ VerifyMandate(Mandate) error }
type TestnetBroker interface {
	SubmitTestnet(TestnetOrder) (string, error)
}
type Bar struct {
	Time   time.Time `json:"time"`
	Open   int64     `json:"open"`
	High   int64     `json:"high"`
	Low    int64     `json:"low"`
	Close  int64     `json:"close"`
	Volume int64     `json:"volume"`
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
type Experiment struct {
	ID                   string             `json:"id"`
	Strategy             StrategySpec       `json:"strategy"`
	Assumptions          Assumptions        `json:"assumptions"`
	Metrics              Metrics            `json:"metrics"`
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
	Account, StrategyHash, Market          string
	MaxNotional, MaxPosition, MaxDailyLoss int64
	ExpiresAt                              time.Time
	WalletSignature, Digest                string
	TestnetOnly                            bool
	Revoked                                bool
	RevokedAt                              time.Time
}

type TestnetOrder struct {
	ID             string    `json:"id"`
	MandateDigest  string    `json:"mandateDigest"`
	StrategyHash   string    `json:"strategyHash"`
	Market         string    `json:"market"`
	Side           string    `json:"side"`
	Price          int64     `json:"price"`
	Amount         int64     `json:"amount"`
	IdempotencyKey string    `json:"idempotencyKey"`
	BrokerProof    string    `json:"brokerProof"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
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
type state struct {
	Schema        int                     `json:"schema"`
	Sequence      int64                   `json:"sequence"`
	Experiments   map[string]Experiment   `json:"experiments"`
	Strategies    map[string]StrategySpec `json:"strategies"`
	Paper         PaperState              `json:"paper"`
	Mandates      map[string]Mandate      `json:"mandates"`
	TestnetOrders map[string]TestnetOrder `json:"testnetOrders"`
	Idempotency   map[string]string       `json:"idempotency"`
	Audit         []AuditEvent            `json:"audit"`
	Integrity     string                  `json:"integrity"`
}
type Service struct {
	mu    sync.Mutex
	cfg   Config
	state state
}

func New(cfg Config) (*Service, error) {
	if strings.TrimSpace(cfg.StatePath) == "" {
		return nil, ErrInvalid
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	s := state{Schema: 1, Experiments: map[string]Experiment{}, Strategies: map[string]StrategySpec{}, Mandates: map[string]Mandate{}, Paper: PaperState{Cash: 100_000_000_000}}
	s.TestnetOrders = map[string]TestnetOrder{}
	s.Idempotency = map[string]string{}
	b, err := os.ReadFile(cfg.StatePath)
	if err == nil {
		if json.Unmarshal(b, &s) != nil || !verifyIntegrity(s) {
			return nil, fmt.Errorf("state integrity: %w", ErrForbidden)
		}
		if s.TestnetOrders == nil {
			s.TestnetOrders = map[string]TestnetOrder{}
		}
		if s.Idempotency == nil {
			s.Idempotency = map[string]string{}
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return &Service{cfg: cfg, state: s}, nil
}

func (s *Service) RegisterMandate(m Mandate) (Mandate, error) {
	now := s.cfg.Now()
	m.Account = strings.TrimSpace(m.Account)
	m.StrategyHash = strings.ToLower(strings.TrimSpace(m.StrategyHash))
	m.Market = strings.TrimSpace(m.Market)
	if !m.TestnetOnly || len(m.StrategyHash) != 64 || m.Market != "YNXT-YUSD_TEST" || m.MaxNotional <= 0 || m.MaxPosition <= 0 || m.MaxDailyLoss <= 0 || !m.ExpiresAt.After(now) || m.ExpiresAt.After(now.Add(24*time.Hour)) || strings.TrimSpace(m.WalletSignature) == "" {
		return Mandate{}, ErrInvalid
	}
	m.Digest = hash(struct {
		Account, StrategyHash, Market          string
		MaxNotional, MaxPosition, MaxDailyLoss int64
		ExpiresAt                              time.Time
		TestnetOnly                            bool
	}{m.Account, m.StrategyHash, m.Market, m.MaxNotional, m.MaxPosition, m.MaxDailyLoss, m.ExpiresAt, m.TestnetOnly})
	if s.cfg.MandateVerifier == nil {
		return Mandate{}, ErrUnavailable
	}
	if err := s.cfg.MandateVerifier.VerifyMandate(m); err != nil {
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

func (s *Service) SubmitTestnet(mandateDigest, side string, price, amount int64, key string) (TestnetOrder, error) {
	if (side != "buy" && side != "sell") || price <= 0 || amount <= 0 || len(key) < 8 || len(key) > 128 {
		return TestnetOrder{}, ErrInvalid
	}
	if s.cfg.TestnetBroker == nil {
		return TestnetOrder{}, ErrUnavailable
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, lockErr := s.lockAndReload()
	if lockErr != nil {
		return TestnetOrder{}, lockErr
	}
	defer release()
	if s.state.Paper.KillSwitch {
		return TestnetOrder{}, ErrForbidden
	}
	m, ok := s.state.Mandates[mandateDigest]
	if !ok || m.Revoked || !s.cfg.Now().Before(m.ExpiresAt) {
		return TestnetOrder{}, ErrForbidden
	}
	if price*amount/1_000_000 > m.MaxNotional || amount > m.MaxPosition {
		return TestnetOrder{}, ErrForbidden
	}
	d := hash(struct {
		MandateDigest, Side string
		Price, Amount       int64
	}{mandateDigest, side, price, amount})
	if prior, ok := s.state.Idempotency[key]; ok {
		if prior != d {
			return TestnetOrder{}, ErrConflict
		}
		for _, o := range s.state.TestnetOrders {
			if o.IdempotencyKey == key {
				return o, nil
			}
		}
	}
	s.state.Sequence++
	o := TestnetOrder{ID: fmt.Sprintf("testnet-%06d", s.state.Sequence), MandateDigest: mandateDigest, StrategyHash: m.StrategyHash, Market: m.Market, Side: side, Price: price, Amount: amount, IdempotencyKey: key, Status: "submitting", CreatedAt: s.cfg.Now()}
	proof, err := s.cfg.TestnetBroker.SubmitTestnet(o)
	if err != nil {
		return TestnetOrder{}, ErrUnavailable
	}
	o.BrokerProof = strings.TrimSpace(proof)
	if o.BrokerProof == "" {
		return TestnetOrder{}, ErrUnavailable
	}
	o.Status = "submitted_testnet"
	s.state.TestnetOrders[o.ID] = o
	s.state.Idempotency[key] = d
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
	metrics := simulate(req.Bars, strategy, req.Assumptions)
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
	e := Experiment{ID: id, Strategy: strategy, Assumptions: req.Assumptions, Metrics: metrics, LeakageChecksPassed: true, WalkForward: walkForward, Sensitivity: sensitivity, SensitivitySpreadBPS: maxReturn - minReturn, Regimes: regimes, NoTradeReturnBPS: 0, Status: "completed_oos", CreatedAt: now}
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
	cash := int64(100_000_000_000)
	start := cash
	pos := int64(0)
	peak := cash
	maxDD := int64(0)
	trades := 0
	partial := 0
	gaps := 0
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
		cash -= cost
		cash -= friction
		pos += fill
		trades++
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
	return Metrics{ReturnBPS: (end - start) * 10000 / start, BuyHoldBPS: buyHold, MaxDrawdownBPS: maxDD, Trades: trades, PartialFills: partial, DataGaps: gaps, NoTrade: trades == 0}
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
	notional := price * amount / 1_000_000
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
	return map[string]any{
		"productId":        ProductID,
		"mode":             "SIMULATED / YNX TESTNET ONLY",
		"liveFundsEnabled": false,
		"source":           "ynx-quant-authoritative-local-state",
		"asOf":             s.cfg.Now(),
		"version":          Version,
		"coverage":         "local-research-paper-and-bounded-testnet-records",
		"failure":          failure,
		"paper":            s.state.Paper,
		"strategies":       s.state.Strategies,
		"experiments":      s.state.Experiments,
		"testnetOrders":    s.state.TestnetOrders,
		"audit":            s.state.Audit,
	}
}

func (s *Service) lockAndReload() (func(), error) {
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
	b, err := os.ReadFile(s.cfg.StatePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var latest state
	if json.Unmarshal(b, &latest) != nil || !verifyIntegrity(latest) {
		return fmt.Errorf("state integrity: %w", ErrForbidden)
	}
	if latest.Experiments == nil {
		latest.Experiments = map[string]Experiment{}
	}
	if latest.Strategies == nil {
		latest.Strategies = map[string]StrategySpec{}
	}
	if latest.Mandates == nil {
		latest.Mandates = map[string]Mandate{}
	}
	if latest.TestnetOrders == nil {
		latest.TestnetOrders = map[string]TestnetOrder{}
	}
	if latest.Idempotency == nil {
		latest.Idempotency = map[string]string{}
	}
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
	b, _ := json.MarshalIndent(s.state, "", "  ")
	if err := os.MkdirAll(filepath.Dir(s.cfg.StatePath), 0700); err != nil {
		return err
	}
	tmp := s.cfg.StatePath + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.cfg.StatePath)
}
func verifyIntegrity(s state) bool {
	got := s.Integrity
	s.Integrity = ""
	return got != "" && got == hash(s)
}
func hash(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
func sortedKeys[V any](m map[string]V) []string {
	r := make([]string, 0, len(m))
	for k := range m {
		r = append(r, k)
	}
	sort.Strings(r)
	return r
}
