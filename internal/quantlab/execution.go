package quantlab

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

const ExecutionSchemaVersion = "ynx.quant.execution.v1"

type ExecutionAdapterKind string

const (
	AdapterPaper    ExecutionAdapterKind = "paper"
	AdapterShadow   ExecutionAdapterKind = "shadow"
	AdapterExchange ExecutionAdapterKind = "exchange"
	AdapterDEX      ExecutionAdapterKind = "dex"
)

type OrderIntent struct {
	SchemaVersion    string    `json:"schemaVersion"`
	RequestID        string    `json:"requestId"`
	StrategyHash     string    `json:"strategyHash"`
	Market           string    `json:"market"`
	Side             string    `json:"side"`
	Amount           int64     `json:"amount"`
	LimitPrice       int64     `json:"limitPrice"`
	ExpectedSequence int64     `json:"expectedSequence"`
	CreatedAt        time.Time `json:"createdAt"`
}

type ExecutionResult struct {
	SchemaVersion string               `json:"schemaVersion"`
	Adapter       ExecutionAdapterKind `json:"adapter"`
	RequestID     string               `json:"requestId"`
	Sequence      int64                `json:"sequence"`
	Status        string               `json:"status"`
	OrderID       string               `json:"orderId,omitempty"`
	Price         int64                `json:"price"`
	Requested     int64                `json:"requested"`
	Filled        int64                `json:"filled"`
	Source        string               `json:"source"`
	AsOf          time.Time            `json:"asOf"`
	Version       string               `json:"version"`
	Coverage      string               `json:"coverage"`
	Confidence    string               `json:"confidence"`
	AuditID       string               `json:"auditId"`
	FailureCode   string               `json:"failureCode,omitempty"`
}

type ReconciliationRequest struct {
	ExpectedCash, ExpectedPosition int64
}

type ReconciliationResult struct {
	SchemaVersion         string               `json:"schemaVersion"`
	Adapter               ExecutionAdapterKind `json:"adapter"`
	AuthoritativeCash     int64                `json:"authoritativeCash"`
	AuthoritativePosition int64                `json:"authoritativePosition"`
	Delta                 int64                `json:"delta"`
	KillSwitch            bool                 `json:"killSwitch"`
	Source                string               `json:"source"`
	AsOf                  time.Time            `json:"asOf"`
	Version               string               `json:"version"`
	FailureCode           string               `json:"failureCode,omitempty"`
}

// ExecutionAdapter is the only execution contract strategy orchestration may
// target. Implementations own venue translation; strategies never receive a
// venue client, credential, Wallet key, or withdrawal capability.
type ExecutionAdapter interface {
	Kind() ExecutionAdapterKind
	Execute(context.Context, OrderIntent) (ExecutionResult, error)
	Reconcile(context.Context, ReconciliationRequest) (ReconciliationResult, error)
}

// ExchangeExecutionAdapter and DEXExecutionAdapter deliberately add no wider
// capability than ExecutionAdapter. Canonical integrations must satisfy these
// interfaces without exposing venue clients to strategy code.
type ExchangeExecutionAdapter interface{ ExecutionAdapter }
type DEXExecutionAdapter interface{ ExecutionAdapter }

type adapterLedger struct {
	mu       sync.Mutex
	sequence int64
	results  map[string]ledgerResult
}

type ledgerResult struct {
	intentDigest string
	result       ExecutionResult
}

func (l *adapterLedger) begin(intent OrderIntent) (ExecutionResult, bool, error) {
	if intent.SchemaVersion != ExecutionSchemaVersion || len(strings.TrimSpace(intent.RequestID)) < 8 || len(intent.RequestID) > 128 ||
		len(intent.StrategyHash) != sha256.Size*2 || intent.Market != "YNXT-YUSD_TEST" || (intent.Side != "buy" && intent.Side != "sell") ||
		intent.Amount <= 0 || intent.LimitPrice <= 0 || intent.CreatedAt.IsZero() || intent.ExpectedSequence <= 0 {
		return ExecutionResult{}, false, ErrInvalid
	}
	if _, err := hex.DecodeString(intent.StrategyHash); err != nil {
		return ExecutionResult{}, false, ErrInvalid
	}
	digest := hash(intent)
	l.mu.Lock()
	defer l.mu.Unlock()
	if previous, ok := l.results[intent.RequestID]; ok {
		if previous.intentDigest != digest {
			return ExecutionResult{}, false, ErrConflict
		}
		return previous.result, true, nil
	}
	if intent.ExpectedSequence != l.sequence+1 {
		return ExecutionResult{}, false, ErrConflict
	}
	return ExecutionResult{}, false, nil
}

func (l *adapterLedger) commit(intent OrderIntent, result ExecutionResult) ExecutionResult {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sequence++
	result.Sequence = l.sequence
	if l.results == nil {
		l.results = map[string]ledgerResult{}
	}
	l.results[intent.RequestID] = ledgerResult{intentDigest: hash(intent), result: result}
	return result
}

type PaperExecutionAdapter struct {
	Service   *Service
	Market    MarketData
	Now       func() time.Time
	executeMu sync.Mutex
	ledger    adapterLedger
}

func (p *PaperExecutionAdapter) Kind() ExecutionAdapterKind { return AdapterPaper }

func (p *PaperExecutionAdapter) Execute(ctx context.Context, intent OrderIntent) (ExecutionResult, error) {
	p.executeMu.Lock()
	defer p.executeMu.Unlock()
	if err := ctx.Err(); err != nil {
		return ExecutionResult{}, ErrUnavailable
	}
	if p.Service == nil || p.Market == nil {
		return ExecutionResult{}, ErrUnavailable
	}
	if prior, ok, err := p.ledger.begin(intent); err != nil || ok {
		return prior, err
	}
	now := adapterNow(p.Now)
	tick, err := p.Market.Latest(intent.Market)
	if err != nil || tick.Price <= 0 || tick.Volume <= 0 || strings.TrimSpace(tick.Source) == "" || tick.At.IsZero() || tick.At.After(now) || now.Sub(tick.At) > 30*time.Second {
		return ExecutionResult{}, ErrUnavailable
	}
	if (intent.Side == "buy" && tick.Price > intent.LimitPrice) || (intent.Side == "sell" && tick.Price < intent.LimitPrice) {
		return ExecutionResult{}, ErrForbidden
	}
	order, err := p.Service.ApplyPaperSignal(intent.StrategyHash, intent.Side, tick.Price, intent.Amount, tick.Volume)
	if err != nil {
		return ExecutionResult{}, err
	}
	result := ExecutionResult{SchemaVersion: ExecutionSchemaVersion, Adapter: AdapterPaper, RequestID: intent.RequestID, Status: order.Status + "_simulated", OrderID: order.ID, Price: order.Price, Requested: order.Amount, Filled: order.Filled, Source: tick.Source, AsOf: tick.At, Version: Version, Coverage: "simulated paper fill from authoritative matched-trade tick and volume", Confidence: "simulation-assumption", AuditID: hash(order)}
	return p.ledger.commit(intent, result), nil
}

func (p *PaperExecutionAdapter) Reconcile(ctx context.Context, request ReconciliationRequest) (ReconciliationResult, error) {
	if err := ctx.Err(); err != nil || p.Service == nil {
		return ReconciliationResult{}, ErrUnavailable
	}
	state, err := p.Service.Reconcile(request.ExpectedCash, request.ExpectedPosition)
	if err != nil {
		return ReconciliationResult{}, err
	}
	return ReconciliationResult{SchemaVersion: ExecutionSchemaVersion, Adapter: AdapterPaper, AuthoritativeCash: state.Cash, AuthoritativePosition: state.Position, Delta: state.ReconciliationDelta, KillSwitch: state.KillSwitch, Source: "ynx-quant-authoritative-local-paper-state", AsOf: state.UpdatedAt, Version: Version}, nil
}

type ShadowExecutionAdapter struct {
	Market    MarketData
	Now       func() time.Time
	executeMu sync.Mutex
	ledger    adapterLedger
}

func (s *ShadowExecutionAdapter) Kind() ExecutionAdapterKind { return AdapterShadow }

func (s *ShadowExecutionAdapter) Execute(ctx context.Context, intent OrderIntent) (ExecutionResult, error) {
	s.executeMu.Lock()
	defer s.executeMu.Unlock()
	if err := ctx.Err(); err != nil || s.Market == nil {
		return ExecutionResult{}, ErrUnavailable
	}
	if prior, ok, err := s.ledger.begin(intent); err != nil || ok {
		return prior, err
	}
	now := adapterNow(s.Now)
	tick, err := s.Market.Latest(intent.Market)
	if err != nil || tick.Price <= 0 || tick.Volume <= 0 || strings.TrimSpace(tick.Source) == "" || tick.At.IsZero() || tick.At.After(now) || now.Sub(tick.At) > 30*time.Second {
		return ExecutionResult{}, ErrUnavailable
	}
	result := ExecutionResult{SchemaVersion: ExecutionSchemaVersion, Adapter: AdapterShadow, RequestID: intent.RequestID, Status: "observed_no_submit", Price: tick.Price, Requested: intent.Amount, Filled: 0, Source: tick.Source, AsOf: tick.At, Version: Version, Coverage: "market observation only; no order submitted", Confidence: "authoritative-market-observation", AuditID: hash(struct {
		Intent OrderIntent
		Tick   MarketTick
	}{intent, tick})}
	return s.ledger.commit(intent, result), nil
}

func (s *ShadowExecutionAdapter) Reconcile(context.Context, ReconciliationRequest) (ReconciliationResult, error) {
	return ReconciliationResult{SchemaVersion: ExecutionSchemaVersion, Adapter: AdapterShadow, Source: "shadow-observation-only", AsOf: adapterNow(s.Now), Version: Version, FailureCode: "no_custody_or_position"}, nil
}

func adapterNow(now func() time.Time) time.Time {
	if now == nil {
		return time.Now().UTC()
	}
	return now().UTC()
}
