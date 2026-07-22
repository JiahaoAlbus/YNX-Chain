package assetauth

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/bits"
	"strings"
	"time"
)

type StrategyVault struct {
	SchemaVersion int        `json:"schemaVersion"`
	ID            string     `json:"id"`
	Owner         string     `json:"owner"`
	MandateID     string     `json:"mandateId"`
	BalanceYNXT   uint64     `json:"balanceYnxt"`
	CreatedAt     time.Time  `json:"createdAt"`
	ClosedAt      *time.Time `json:"closedAt,omitempty"`
}

type VaultEvent struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	VaultID     string    `json:"vaultId"`
	Actor       string    `json:"actor"`
	AmountYNXT  uint64    `json:"amountYnxt"`
	BalanceYNXT uint64    `json:"balanceYnxt"`
	MandateID   string    `json:"mandateId"`
	OccurredAt  time.Time `json:"occurredAt"`
	AuditHash   string    `json:"auditHash"`
}

func NewStrategyVault(id, owner, mandateID string, at time.Time) (StrategyVault, error) {
	vault := StrategyVault{SchemaVersion: 1, ID: strings.TrimSpace(id), Owner: strings.TrimSpace(owner), MandateID: strings.TrimSpace(mandateID), CreatedAt: at.UTC()}
	if err := vault.Validate(); err != nil {
		return StrategyVault{}, err
	}
	return vault, nil
}

func (vault StrategyVault) Validate() error {
	if vault.SchemaVersion != 1 || vault.ID == "" || vault.Owner == "" || vault.MandateID == "" || vault.CreatedAt.IsZero() {
		return errors.New("strategy vault identity is invalid")
	}
	if vault.ClosedAt != nil && vault.ClosedAt.Before(vault.CreatedAt) {
		return errors.New("strategy vault close time predates creation")
	}
	return nil
}

func (vault StrategyVault) Deposit(actor string, amount uint64, at time.Time) (StrategyVault, VaultEvent, error) {
	if err := vault.Validate(); err != nil {
		return vault, VaultEvent{}, err
	}
	if amount == 0 || vault.ClosedAt != nil || at.Before(vault.CreatedAt) || ^uint64(0)-vault.BalanceYNXT < amount {
		return vault, VaultEvent{}, errors.New("strategy vault deposit is invalid")
	}
	vault.BalanceYNXT += amount
	return vault, newVaultEvent("deposit", vault, actor, amount, at), nil
}

func (vault StrategyVault) Withdraw(actor string, amount uint64, at time.Time) (StrategyVault, VaultEvent, error) {
	if err := vault.Validate(); err != nil {
		return vault, VaultEvent{}, err
	}
	if actor != vault.Owner {
		return vault, VaultEvent{}, errors.New("only the vault owner can withdraw")
	}
	if amount == 0 || amount > vault.BalanceYNXT || vault.ClosedAt != nil || at.Before(vault.CreatedAt) {
		return vault, VaultEvent{}, errors.New("strategy vault withdrawal is invalid")
	}
	vault.BalanceYNXT -= amount
	return vault, newVaultEvent("withdrawal", vault, actor, amount, at), nil
}

func (vault StrategyVault) EmergencyExit(actor string, at time.Time) (StrategyVault, VaultEvent, error) {
	if err := vault.Validate(); err != nil {
		return vault, VaultEvent{}, err
	}
	if actor != vault.Owner {
		return vault, VaultEvent{}, errors.New("only the vault owner can execute emergency exit")
	}
	if vault.ClosedAt != nil {
		return vault, VaultEvent{}, errors.New("strategy vault is already closed")
	}
	if at.Before(vault.CreatedAt) {
		return vault, VaultEvent{}, errors.New("strategy vault emergency exit predates creation")
	}
	amount := vault.BalanceYNXT
	vault.BalanceYNXT = 0
	closed := at.UTC()
	vault.ClosedAt = &closed
	return vault, newVaultEvent("emergency_exit", vault, actor, amount, at), nil
}

func newVaultEvent(kind string, vault StrategyVault, actor string, amount uint64, at time.Time) VaultEvent {
	domain := fmt.Sprintf("YNX_VAULT_EVENT_V1\x00%s\x00%s\x00%s\x00%d\x00%d\x00%s", kind, vault.ID, actor, amount, vault.BalanceYNXT, at.UTC().Format(time.RFC3339Nano))
	sum := sha256.Sum256([]byte(domain))
	event := VaultEvent{ID: "vault_" + hex.EncodeToString(sum[:12]), Type: kind, VaultID: vault.ID, Actor: actor, AmountYNXT: amount, BalanceYNXT: vault.BalanceYNXT, MandateID: vault.MandateID, OccurredAt: at.UTC()}
	audit := sha256.Sum256(append([]byte("YNX_VAULT_AUDIT_V1\x00"), sum[:]...))
	event.AuditHash = hex.EncodeToString(audit[:])
	return event
}

type FeePolicy struct {
	ManagementFeeBPSAnnual uint64 `json:"managementFeeBpsAnnual"`
	PerformanceFeeBPS      uint64 `json:"performanceFeeBps"`
}

type FeePeriod struct {
	AverageNAVYNXT             uint64 `json:"averageNavYnxt"`
	DurationSeconds            uint64 `json:"durationSeconds"`
	RealizedGrossPnLYNXT       int64  `json:"realizedGrossPnlYnxt"`
	TradingCostsYNXT           uint64 `json:"tradingCostsYnxt"`
	FundingCostsYNXT           uint64 `json:"fundingCostsYnxt"`
	ProviderCostsYNXT          uint64 `json:"providerCostsYnxt"`
	PriorCumulativeRealizedNet int64  `json:"priorCumulativeRealizedNetYnxt"`
	PriorHighWaterMarkYNXT     int64  `json:"priorHighWaterMarkYnxt"`
}

type FeeAssessment struct {
	RealizedNetPnLYNXT        int64  `json:"realizedNetPnlYnxt"`
	CumulativeRealizedNetYNXT int64  `json:"cumulativeRealizedNetYnxt"`
	EligiblePerformanceBase   uint64 `json:"eligiblePerformanceBaseYnxt"`
	ManagementFeeYNXT         uint64 `json:"managementFeeYnxt"`
	PerformanceFeeYNXT        uint64 `json:"performanceFeeYnxt"`
	NewHighWaterMarkYNXT      int64  `json:"newHighWaterMarkYnxt"`
}

func AssessFees(policy FeePolicy, period FeePeriod) (FeeAssessment, error) {
	if policy.ManagementFeeBPSAnnual > 10_000 || policy.PerformanceFeeBPS > 10_000 || period.DurationSeconds > 366*24*60*60 {
		return FeeAssessment{}, errors.New("fee policy or period is outside bounds")
	}
	costs, overflow := addMany(period.TradingCostsYNXT, period.FundingCostsYNXT, period.ProviderCostsYNXT)
	if overflow || costs > math.MaxInt64 || period.PriorHighWaterMarkYNXT < 0 {
		return FeeAssessment{}, errors.New("fee cost sum overflow")
	}
	if period.RealizedGrossPnLYNXT < math.MinInt64+int64(costs) {
		return FeeAssessment{}, errors.New("realized net PnL underflow")
	}
	realizedNet := period.RealizedGrossPnLYNXT - int64(costs)
	if (realizedNet > 0 && period.PriorCumulativeRealizedNet > math.MaxInt64-realizedNet) ||
		(realizedNet < 0 && period.PriorCumulativeRealizedNet < math.MinInt64-realizedNet) {
		return FeeAssessment{}, errors.New("cumulative realized profit overflow")
	}
	cumulative := period.PriorCumulativeRealizedNet + realizedNet
	base := uint64(0)
	if cumulative > period.PriorHighWaterMarkYNXT {
		base = uint64(cumulative - period.PriorHighWaterMarkYNXT)
	}
	performance, err := ratioFee(base, policy.PerformanceFeeBPS, 10_000)
	if err != nil {
		return FeeAssessment{}, err
	}
	managementNumeratorHigh, managementNumeratorLow := bits.Mul64(period.AverageNAVYNXT, policy.ManagementFeeBPSAnnual)
	if managementNumeratorHigh != 0 {
		return FeeAssessment{}, errors.New("management fee overflow")
	}
	managementNumeratorHigh, managementNumeratorLow = bits.Mul64(managementNumeratorLow, period.DurationSeconds)
	if managementNumeratorHigh != 0 {
		return FeeAssessment{}, errors.New("management fee overflow")
	}
	management := managementNumeratorLow / 10_000 / (365 * 24 * 60 * 60)
	newHighWaterMark := period.PriorHighWaterMarkYNXT
	if cumulative > newHighWaterMark {
		newHighWaterMark = cumulative
	}
	return FeeAssessment{RealizedNetPnLYNXT: realizedNet, CumulativeRealizedNetYNXT: cumulative, EligiblePerformanceBase: base, ManagementFeeYNXT: management, PerformanceFeeYNXT: performance, NewHighWaterMarkYNXT: newHighWaterMark}, nil
}

func ratioFee(base, rate, denominator uint64) (uint64, error) {
	high, low := bits.Mul64(base, rate)
	if high != 0 || denominator == 0 {
		return 0, errors.New("fee multiplication overflow")
	}
	return low / denominator, nil
}

func addMany(values ...uint64) (uint64, bool) {
	var total uint64
	for _, value := range values {
		if ^uint64(0)-total < value {
			return 0, true
		}
		total += value
	}
	return total, false
}
