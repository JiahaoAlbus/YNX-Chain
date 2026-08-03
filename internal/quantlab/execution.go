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

func validateIntent(intent OrderIntent) error {
	if intent.SchemaVersion != ExecutionSchemaVersion || len(strings.TrimSpace(intent.RequestID)) < 8 || len(intent.RequestID) > 128 ||
		len(intent.StrategyHash) != sha256.Size*2 || intent.Market != "YNXT-YUSD_TEST" || (intent.Side != "buy" && intent.Side != "sell") ||
		intent.Amount <= 0 || intent.LimitPrice <= 0 || intent.CreatedAt.IsZero() || intent.ExpectedSequence <= 0 {
		return ErrInvalid
	}
	if _, err := hex.DecodeString(intent.StrategyHash); err != nil {
		return ErrInvalid
	}
	return nil
}

func (s *Service) reserveExecution(kind ExecutionAdapterKind, intent OrderIntent) (ExecutionResult, bool, int64, error) {
	if err := validateIntent(intent); err != nil || (kind != AdapterPaper && kind != AdapterShadow && kind != AdapterExchange && kind != AdapterDEX) {
		return ExecutionResult{}, false, 0, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, err := s.lockAndReload()
	if err != nil {
		return ExecutionResult{}, false, 0, err
	}
	defer release()
	key := string(kind) + "/" + intent.RequestID
	digest := hash(intent)
	if previous, ok := s.state.ExecutionLedger[key]; ok {
		if previous.IntentDigest != digest {
			return ExecutionResult{}, false, 0, ErrConflict
		}
		if previous.Status != "completed" {
			return ExecutionResult{}, false, previous.Sequence, ErrUnavailable
		}
		return previous.Result, true, previous.Sequence, nil
	}
	next := s.state.AdapterSequences[string(kind)] + 1
	if intent.ExpectedSequence != next {
		return ExecutionResult{}, false, 0, ErrConflict
	}
	record := ExecutionLedgerRecord{Adapter: kind, RequestID: intent.RequestID, IntentDigest: digest, Sequence: next, Status: "reserved_outcome_unknown", ReservedAt: s.cfg.Now()}
	s.state.ExecutionLedger[key] = record
	s.state.AdapterSequences[string(kind)] = next
	s.audit("execution_reserved", key, digest)
	if err := s.save(); err != nil {
		return ExecutionResult{}, false, 0, err
	}
	return ExecutionResult{}, false, next, nil
}

func (s *Service) completeExecution(kind ExecutionAdapterKind, intent OrderIntent, sequence int64, result ExecutionResult) (ExecutionResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	release, err := s.lockAndReload()
	if err != nil {
		return ExecutionResult{}, err
	}
	defer release()
	key := string(kind) + "/" + intent.RequestID
	record, ok := s.state.ExecutionLedger[key]
	if !ok || record.Status != "reserved_outcome_unknown" || record.IntentDigest != hash(intent) || record.Sequence != sequence {
		return ExecutionResult{}, ErrConflict
	}
	result.Sequence = sequence
	record.Status = "completed"
	record.Result = result
	record.CompletedAt = s.cfg.Now()
	s.state.ExecutionLedger[key] = record
	s.audit("execution_completed", key, hash(result))
	if err := s.save(); err != nil {
		return ExecutionResult{}, err
	}
	return result, nil
}

type PaperExecutionAdapter struct {
	Service   *Service
	Market    MarketData
	Now       func() time.Time
	executeMu sync.Mutex
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
	if prior, ok, sequence, err := p.Service.reserveExecution(AdapterPaper, intent); err != nil || ok {
		return prior, err
	} else {
		return p.executeReserved(ctx, intent, sequence)
	}
}

func (p *PaperExecutionAdapter) executeReserved(ctx context.Context, intent OrderIntent, sequence int64) (ExecutionResult, error) {
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
	return p.Service.completeExecution(AdapterPaper, intent, sequence, result)
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
	Service   *Service
	Market    MarketData
	Now       func() time.Time
	executeMu sync.Mutex
}

func (s *ShadowExecutionAdapter) Kind() ExecutionAdapterKind { return AdapterShadow }

func (s *ShadowExecutionAdapter) Execute(ctx context.Context, intent OrderIntent) (ExecutionResult, error) {
	s.executeMu.Lock()
	defer s.executeMu.Unlock()
	if err := ctx.Err(); err != nil || s.Market == nil || s.Service == nil {
		return ExecutionResult{}, ErrUnavailable
	}
	if prior, ok, sequence, err := s.Service.reserveExecution(AdapterShadow, intent); err != nil || ok {
		return prior, err
	} else {
		return s.executeReserved(intent, sequence)
	}
}

func (s *ShadowExecutionAdapter) executeReserved(intent OrderIntent, sequence int64) (ExecutionResult, error) {
	now := adapterNow(s.Now)
	tick, err := s.Market.Latest(intent.Market)
	if err != nil || tick.Price <= 0 || tick.Volume <= 0 || strings.TrimSpace(tick.Source) == "" || tick.At.IsZero() || tick.At.After(now) || now.Sub(tick.At) > 30*time.Second {
		return ExecutionResult{}, ErrUnavailable
	}
	result := ExecutionResult{SchemaVersion: ExecutionSchemaVersion, Adapter: AdapterShadow, RequestID: intent.RequestID, Status: "observed_no_submit", Price: tick.Price, Requested: intent.Amount, Filled: 0, Source: tick.Source, AsOf: tick.At, Version: Version, Coverage: "market observation only; no order submitted", Confidence: "authoritative-market-observation", AuditID: hash(struct {
		Intent OrderIntent
		Tick   MarketTick
	}{intent, tick})}
	return s.Service.completeExecution(AdapterShadow, intent, sequence, result)
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
