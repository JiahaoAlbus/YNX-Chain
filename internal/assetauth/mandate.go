package assetauth

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	MandateSchemaVersion = 1
	MandateChainID       = "ynx_6423-1"
	MethodPlaceOrder     = "place_order"
	MethodCancelOrder    = "cancel_order"
	MethodReducePosition = "reduce_position"
	MethodRebalance      = "rebalance"
	MethodSettle         = "settle"
)

var allowedMethods = map[string]struct{}{
	MethodPlaceOrder: {}, MethodCancelOrder: {}, MethodReducePosition: {}, MethodRebalance: {}, MethodSettle: {},
}

type StrategyMandate struct {
	SchemaVersion      int        `json:"schemaVersion"`
	ChainID            string     `json:"chainId"`
	ID                 string     `json:"id"`
	Owner              string     `json:"owner"`
	EngineIdentity     string     `json:"engineIdentity"`
	StrategyHash       string     `json:"strategyHash"`
	StrategyVersion    uint64     `json:"strategyVersion"`
	Venues             []string   `json:"venues"`
	Assets             []string   `json:"assets"`
	Markets            []string   `json:"markets"`
	Methods            []string   `json:"methods"`
	CapitalLimitYNXT   uint64     `json:"capitalLimitYnxt"`
	PositionLimitYNXT  uint64     `json:"positionLimitYnxt"`
	MaxLeverageBPS     uint64     `json:"maxLeverageBps"`
	MaxSlippageBPS     uint64     `json:"maxSlippageBps"`
	DailyLossLimitYNXT uint64     `json:"dailyLossLimitYnxt"`
	DrawdownLimitBPS   uint64     `json:"drawdownLimitBps"`
	ValidAfter         time.Time  `json:"validAfter"`
	ExpiresAt          time.Time  `json:"expiresAt"`
	NonceDomain        string     `json:"nonceDomain"`
	NextNonce          uint64     `json:"nextNonce"`
	RevokedAt          *time.Time `json:"revokedAt,omitempty"`
	KillSwitchAt       *time.Time `json:"killSwitchAt,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
	AuditHash          string     `json:"auditHash"`
}

func NewStrategyMandate(mandate StrategyMandate) (StrategyMandate, error) {
	mandate.SchemaVersion = MandateSchemaVersion
	mandate.ChainID = MandateChainID
	mandate.Venues = normalizedSet(mandate.Venues)
	mandate.Assets = normalizedSet(mandate.Assets)
	mandate.Markets = normalizedSet(mandate.Markets)
	mandate.Methods = normalizedSet(mandate.Methods)
	mandate.AuditHash = ""
	if err := mandate.validate(false); err != nil {
		return StrategyMandate{}, err
	}
	mandate.AuditHash = mandate.auditHash()
	return mandate, nil
}

func (mandate StrategyMandate) Validate() error {
	if err := mandate.validate(true); err != nil {
		return err
	}
	if mandate.AuditHash != mandate.auditHash() {
		return errors.New("strategy mandate audit hash mismatch")
	}
	return nil
}

func (mandate StrategyMandate) validate(requireAudit bool) error {
	if mandate.SchemaVersion != MandateSchemaVersion || mandate.ChainID != MandateChainID {
		return errors.New("strategy mandate schema or chain ID is invalid")
	}
	for name, value := range map[string]string{"id": mandate.ID, "owner": mandate.Owner, "engineIdentity": mandate.EngineIdentity, "nonceDomain": mandate.NonceDomain} {
		if strings.TrimSpace(value) == "" || len(value) > 256 {
			return fmt.Errorf("strategy mandate %s is invalid", name)
		}
	}
	if len(mandate.StrategyHash) != sha256.Size*2 {
		return errors.New("strategy hash must be lowercase SHA-256 hex")
	}
	if _, err := hex.DecodeString(mandate.StrategyHash); err != nil || strings.ToLower(mandate.StrategyHash) != mandate.StrategyHash {
		return errors.New("strategy hash must be lowercase SHA-256 hex")
	}
	if mandate.StrategyVersion == 0 || mandate.CapitalLimitYNXT == 0 || mandate.PositionLimitYNXT == 0 || mandate.DailyLossLimitYNXT == 0 {
		return errors.New("strategy mandate versions and financial limits must be positive")
	}
	if mandate.MaxLeverageBPS < 10_000 || mandate.MaxLeverageBPS > 1_000_000 || mandate.MaxSlippageBPS > 10_000 || mandate.DrawdownLimitBPS > 10_000 {
		return errors.New("strategy mandate basis-point limits are invalid")
	}
	if mandate.ValidAfter.IsZero() || mandate.ExpiresAt.IsZero() || mandate.CreatedAt.IsZero() || !mandate.ExpiresAt.After(mandate.ValidAfter) || mandate.ValidAfter.Before(mandate.CreatedAt) {
		return errors.New("strategy mandate validity window is invalid")
	}
	for name, values := range map[string][]string{"venues": mandate.Venues, "assets": mandate.Assets, "markets": mandate.Markets, "methods": mandate.Methods} {
		if len(values) == 0 || !isNormalizedSet(values) {
			return fmt.Errorf("strategy mandate %s must be a non-empty normalized set", name)
		}
	}
	for _, method := range mandate.Methods {
		if _, ok := allowedMethods[method]; !ok {
			return fmt.Errorf("strategy mandate method %q is not permitted", method)
		}
	}
	if mandate.RevokedAt != nil && mandate.RevokedAt.Before(mandate.CreatedAt) {
		return errors.New("strategy mandate revocation predates creation")
	}
	if mandate.KillSwitchAt != nil && mandate.KillSwitchAt.Before(mandate.CreatedAt) {
		return errors.New("strategy mandate kill switch predates creation")
	}
	if requireAudit && len(mandate.AuditHash) != sha256.Size*2 {
		return errors.New("strategy mandate audit hash is invalid")
	}
	return nil
}

func (mandate StrategyMandate) auditHash() string {
	clone := mandate
	clone.AuditHash = ""
	payload, _ := json.Marshal(clone)
	sum := sha256.Sum256(append([]byte("YNX_STRATEGY_MANDATE_V1\x00"), payload...))
	return hex.EncodeToString(sum[:])
}

type StrategyAction struct {
	Actor             string `json:"actor"`
	NonceDomain       string `json:"nonceDomain"`
	Nonce             uint64 `json:"nonce"`
	Method            string `json:"method"`
	Venue             string `json:"venue"`
	Asset             string `json:"asset"`
	Market            string `json:"market"`
	CapitalAfterYNXT  uint64 `json:"capitalAfterYnxt"`
	PositionAfterYNXT uint64 `json:"positionAfterYnxt"`
	LeverageBPS       uint64 `json:"leverageBps"`
	SlippageBPS       uint64 `json:"slippageBps"`
	DailyRealizedLoss uint64 `json:"dailyRealizedLossYnxt"`
	DrawdownBPS       uint64 `json:"drawdownBps"`
	RequestedNewOwner string `json:"requestedNewOwner,omitempty"`
	WithdrawalYNXT    uint64 `json:"withdrawalYnxt"`
}

func (mandate StrategyMandate) Authorize(action StrategyAction, at time.Time) (StrategyMandate, error) {
	if err := mandate.Validate(); err != nil {
		return mandate, err
	}
	if at.Before(mandate.ValidAfter) || !at.Before(mandate.ExpiresAt) {
		return mandate, errors.New("strategy mandate is not active at execution time")
	}
	if mandate.RevokedAt != nil || mandate.KillSwitchAt != nil {
		return mandate, errors.New("strategy mandate is revoked or killed")
	}
	if action.Actor != mandate.EngineIdentity {
		return mandate, errors.New("strategy action engine identity mismatch")
	}
	if action.NonceDomain != mandate.NonceDomain || action.Nonce != mandate.NextNonce {
		return mandate, errors.New("strategy action nonce domain or nonce mismatch")
	}
	if action.RequestedNewOwner != "" || action.WithdrawalYNXT != 0 {
		return mandate, errors.New("strategy engine cannot change owner or withdraw")
	}
	for _, entry := range []struct {
		name    string
		value   string
		allowed []string
	}{{"method", action.Method, mandate.Methods}, {"venue", action.Venue, mandate.Venues}, {"asset", action.Asset, mandate.Assets}, {"market", action.Market, mandate.Markets}} {
		if !containsString(entry.allowed, entry.value) {
			return mandate, fmt.Errorf("strategy action %s is outside mandate", entry.name)
		}
	}
	if action.CapitalAfterYNXT > mandate.CapitalLimitYNXT || action.PositionAfterYNXT > mandate.PositionLimitYNXT ||
		action.LeverageBPS > mandate.MaxLeverageBPS || action.SlippageBPS > mandate.MaxSlippageBPS ||
		action.DailyRealizedLoss > mandate.DailyLossLimitYNXT || action.DrawdownBPS > mandate.DrawdownLimitBPS {
		return mandate, errors.New("strategy action exceeds a financial or risk limit")
	}
	mandate.NextNonce++
	mandate.AuditHash = mandate.auditHash()
	return mandate, nil
}

func (mandate StrategyMandate) Revoke(owner string, at time.Time) (StrategyMandate, error) {
	if err := mandate.Validate(); err != nil {
		return mandate, err
	}
	if owner != mandate.Owner || at.Before(mandate.CreatedAt) {
		return mandate, errors.New("only the owner can revoke a strategy mandate")
	}
	if mandate.RevokedAt == nil {
		value := at.UTC()
		mandate.RevokedAt = &value
		mandate.AuditHash = mandate.auditHash()
	}
	return mandate, nil
}

func (mandate StrategyMandate) Kill(owner string, at time.Time) (StrategyMandate, error) {
	if err := mandate.Validate(); err != nil {
		return mandate, err
	}
	if owner != mandate.Owner || at.Before(mandate.CreatedAt) {
		return mandate, errors.New("only the owner can activate the kill switch")
	}
	if mandate.KillSwitchAt == nil {
		value := at.UTC()
		mandate.KillSwitchAt = &value
		mandate.AuditHash = mandate.auditHash()
	}
	return mandate, nil
}

func normalizedSet(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value != "" {
			result = append(result, value)
		}
	}
	sort.Strings(result)
	write := 0
	for _, value := range result {
		if write == 0 || value != result[write-1] {
			result[write] = value
			write++
		}
	}
	return result[:write]
}

func isNormalizedSet(values []string) bool {
	normalized := normalizedSet(values)
	if len(values) != len(normalized) {
		return false
	}
	for index := range values {
		if values[index] != normalized[index] {
			return false
		}
	}
	return true
}

func containsString(values []string, wanted string) bool {
	wanted = strings.ToLower(strings.TrimSpace(wanted))
	index := sort.SearchStrings(values, wanted)
	return index < len(values) && values[index] == wanted
}
