package quantlab

import (
	"context"
	"math"
	"strings"
	"sync"
	"time"
)

// VenueExecutionTransport is the narrow integration boundary implemented by
// the Exchange and DEX owner threads. It exposes no withdrawal, owner-change,
// credential export, or arbitrary transfer capability to strategy code.
type VenueExecutionTransport interface {
	Execute(context.Context, ExecutionAdapterKind, OrderIntent) (ExecutionResult, error)
	Reconcile(context.Context, ExecutionAdapterKind, ReconciliationRequest) (ReconciliationResult, error)
}

// VenueExecutionAdapter turns an owner-supplied Exchange or DEX transport into
// the canonical Quant execution interface. Remote responses are treated as
// untrusted until every binding and freshness field is validated.
type VenueExecutionAdapter struct {
	Service       *Service
	Adapter       ExecutionAdapterKind
	Transport     VenueExecutionTransport
	Now           func() time.Time
	MaxReceiptAge time.Duration
	executeMu     sync.Mutex
}

func NewExchangeExecutionAdapter(service *Service, transport VenueExecutionTransport, now func() time.Time) *VenueExecutionAdapter {
	return &VenueExecutionAdapter{Service: service, Adapter: AdapterExchange, Transport: transport, Now: now}
}

func NewDEXExecutionAdapter(service *Service, transport VenueExecutionTransport, now func() time.Time) *VenueExecutionAdapter {
	return &VenueExecutionAdapter{Service: service, Adapter: AdapterDEX, Transport: transport, Now: now}
}

func (a *VenueExecutionAdapter) Kind() ExecutionAdapterKind { return a.Adapter }

func (a *VenueExecutionAdapter) Execute(ctx context.Context, intent OrderIntent) (ExecutionResult, error) {
	a.executeMu.Lock()
	defer a.executeMu.Unlock()
	if err := ctx.Err(); err != nil || a.Service == nil || a.Transport == nil || !isRemoteVenue(a.Adapter) {
		return ExecutionResult{}, ErrUnavailable
	}
	prior, replay, sequence, err := a.Service.reserveExecution(a.Adapter, intent)
	if err != nil || replay {
		return prior, err
	}
	receipt, err := a.Transport.Execute(ctx, a.Adapter, intent)
	if err != nil || validateVenueReceipt(a.Adapter, intent, sequence, receipt, adapterNow(a.Now), a.receiptAge()) != nil {
		// The reservation intentionally remains outcome-unknown. A retry cannot
		// create a second venue action until an operator reconciliation resolves it.
		return ExecutionResult{}, ErrUnavailable
	}
	return a.Service.completeExecution(a.Adapter, intent, sequence, receipt)
}

func (a *VenueExecutionAdapter) Reconcile(ctx context.Context, request ReconciliationRequest) (ReconciliationResult, error) {
	if err := ctx.Err(); err != nil || a.Service == nil || a.Transport == nil || !isRemoteVenue(a.Adapter) {
		return ReconciliationResult{}, ErrUnavailable
	}
	result, err := a.Transport.Reconcile(ctx, a.Adapter, request)
	if err != nil || validateVenueReconciliation(a.Adapter, request, result, adapterNow(a.Now), a.receiptAge()) != nil {
		return ReconciliationResult{}, ErrUnavailable
	}
	if result.Delta != 0 {
		if _, err := a.Service.Kill("authoritative venue reconciliation mismatch"); err != nil {
			return ReconciliationResult{}, err
		}
	}
	return result, nil
}

func (a *VenueExecutionAdapter) receiptAge() time.Duration {
	if a.MaxReceiptAge <= 0 {
		return 30 * time.Second
	}
	return a.MaxReceiptAge
}

func isRemoteVenue(kind ExecutionAdapterKind) bool {
	return kind == AdapterExchange || kind == AdapterDEX
}

func validateVenueReceipt(kind ExecutionAdapterKind, intent OrderIntent, sequence int64, result ExecutionResult, now time.Time, maxAge time.Duration) error {
	if result.SchemaVersion != ExecutionSchemaVersion || result.Adapter != kind || result.RequestID != intent.RequestID || result.Sequence != sequence ||
		result.Requested != intent.Amount || strings.TrimSpace(result.Source) == "" || strings.TrimSpace(result.Version) == "" ||
		strings.TrimSpace(result.Coverage) == "" || strings.TrimSpace(result.Confidence) == "" || strings.TrimSpace(result.AuditID) == "" ||
		!freshAuthoritativeTime(result.AsOf, now, maxAge) {
		return ErrInvalid
	}
	switch result.Status {
	case "filled":
		if strings.TrimSpace(result.OrderID) == "" || result.Price <= 0 || result.Filled != result.Requested || result.FailureCode != "" {
			return ErrInvalid
		}
	case "rejected", "cancelled":
		if result.Filled != 0 || strings.TrimSpace(result.FailureCode) == "" {
			return ErrInvalid
		}
	default:
		// Accepted/open/partial states are deliberately not terminal enough to
		// complete the durable Quant execution ledger.
		return ErrInvalid
	}
	if result.Status == "filled" && ((intent.Side == "buy" && result.Price > intent.LimitPrice) || (intent.Side == "sell" && result.Price < intent.LimitPrice)) {
		return ErrForbidden
	}
	return nil
}

func validateVenueReconciliation(kind ExecutionAdapterKind, request ReconciliationRequest, result ReconciliationResult, now time.Time, maxAge time.Duration) error {
	if result.SchemaVersion != ExecutionSchemaVersion || result.Adapter != kind || strings.TrimSpace(result.Source) == "" ||
		strings.TrimSpace(result.Version) == "" || result.FailureCode != "" || !freshAuthoritativeTime(result.AsOf, now, maxAge) {
		return ErrInvalid
	}
	cashDelta, ok := checkedAbsDiff(result.AuthoritativeCash, request.ExpectedCash)
	if !ok {
		return ErrInvalid
	}
	positionDelta, ok := checkedAbsDiff(result.AuthoritativePosition, request.ExpectedPosition)
	if !ok || cashDelta > math.MaxInt64-positionDelta {
		return ErrInvalid
	}
	delta := cashDelta + positionDelta
	if result.Delta != delta || (delta != 0 && !result.KillSwitch) {
		return ErrInvalid
	}
	return nil
}

func freshAuthoritativeTime(asOf, now time.Time, maxAge time.Duration) bool {
	if asOf.IsZero() || now.IsZero() || maxAge <= 0 || asOf.After(now.Add(2*time.Second)) {
		return false
	}
	return now.Sub(asOf) <= maxAge
}

func checkedAbsDiff(left, right int64) (int64, bool) {
	if left >= right {
		if right < 0 && left > math.MaxInt64+right {
			return 0, false
		}
		return left - right, true
	}
	if left < 0 && right > math.MaxInt64+left {
		return 0, false
	}
	return right - left, true
}

var _ ExchangeExecutionAdapter = (*VenueExecutionAdapter)(nil)
var _ DEXExecutionAdapter = (*VenueExecutionAdapter)(nil)
