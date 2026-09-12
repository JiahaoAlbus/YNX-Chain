package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	StakingPolicyVersion    = 1
	StakingCommissionBPS    = int64(1_000)
	StakingUnbondingSeconds = int64(7 * 24 * 60 * 60)
)

type StakeDelegatePayload struct {
	Validator  string `json:"validator"`
	AmountYNXT int64  `json:"amountYnxt"`
}
type StakeUnbondPayload struct {
	DelegationID string `json:"delegationId"`
	AmountYNXT   int64  `json:"amountYnxt"`
}
type StakeWithdrawPayload struct {
	UnbondingID string `json:"unbondingId"`
}

type BFTStakeDelegation struct {
	ID            string    `json:"id"`
	Delegator     string    `json:"delegator"`
	Validator     string    `json:"validator"`
	AmountYNXT    int64     `json:"amountYnxt"`
	CommissionBPS int64     `json:"commissionBps"`
	RewardSource  string    `json:"rewardSource"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	BlockHeight   int64     `json:"blockHeight"`
	TxHash        string    `json:"txHash"`
	AuditHash     string    `json:"auditHash"`
}

type BFTUnbondingEntry struct {
	ID           string     `json:"id"`
	DelegationID string     `json:"delegationId"`
	Delegator    string     `json:"delegator"`
	Validator    string     `json:"validator"`
	AmountYNXT   int64      `json:"amountYnxt"`
	Status       string     `json:"status"`
	RequestedAt  time.Time  `json:"requestedAt"`
	AvailableAt  time.Time  `json:"availableAt"`
	WithdrawnAt  *time.Time `json:"withdrawnAt,omitempty"`
	BlockHeight  int64      `json:"blockHeight"`
	TxHash       string     `json:"txHash"`
	AuditHash    string     `json:"auditHash"`
}

func isStakingAction(action string) bool {
	return action == ActionStakeDelegate || action == ActionStakeUnbond || action == ActionStakeWithdraw
}

func canonicalStakingActionPayload(action string, raw []byte) ([]byte, error) {
	switch action {
	case ActionStakeDelegate:
		var p StakeDelegatePayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Validator = strings.TrimSpace(p.Validator)
		if p.Validator == "" || len(p.Validator) > 128 || p.AmountYNXT <= 0 {
			return nil, errors.New("stake delegation requires bounded validator and positive amount")
		}
		return json.Marshal(p)
	case ActionStakeUnbond:
		var p StakeUnbondPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.DelegationID = strings.TrimSpace(p.DelegationID)
		if !trustRecordIDPattern.MatchString(p.DelegationID) || p.AmountYNXT <= 0 {
			return nil, errors.New("stake unbond requires canonical delegation and positive amount")
		}
		return json.Marshal(p)
	case ActionStakeWithdraw:
		var p StakeWithdrawPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.UnbondingID = strings.TrimSpace(p.UnbondingID)
		if !trustRecordIDPattern.MatchString(p.UnbondingID) {
			return nil, errors.New("stake withdrawal requires canonical unbonding entry")
		}
		return json.Marshal(p)
	default:
		return nil, fmt.Errorf("unsupported staking action %q", action)
	}
}

func stakingDelegationID(delegator, validator string) string {
	sum := sha256.Sum256([]byte("YNX_STAKE_DELEGATION_V1\x00" + delegator + "\x00" + validator))
	return hex.EncodeToString(sum[:12])
}

func StakingDelegationID(delegator, validator string) string {
	return stakingDelegationID(delegator, validator)
}
func stakingAuditHash(value any) string {
	switch typed := value.(type) {
	case BFTStakeDelegation:
		typed.AuditHash = ""
		value = typed
	case BFTUnbondingEntry:
		typed.AuditHash = ""
		value = typed
	}
	payload, _ := json.Marshal(value)
	sum := sha256.Sum256(append([]byte("YNX_STAKING_AUDIT_V1\x00"), payload...))
	return hex.EncodeToString(sum[:])
}
