package ynxauth

import (
	"bytes"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	ActionStakeDelegate = "stake_delegate"
	ActionStakeUnbond   = "stake_unbond"
	ActionStakeWithdraw = "stake_withdraw"
	// StakingActionFee applies only to these three typed lifecycle actions.
	// The original ActionStake encoding and fee rules remain unchanged.
	StakingActionFee = uint64(1)
)

// Validator is the original migration's opaque active validator identifier.
// Syntax does not convert it to an account address, trim it, prove that it is
// active or grant delegation authority. The actual executor owns those checks.
type StakeDelegatePayload struct {
	Validator  string
	AmountYNXT uint64
}

type StakeUnbondPayload struct {
	DelegationID string
	AmountYNXT   uint64
}

type StakeWithdrawPayload struct{ UnbondingID string }

func encodeStakingActionPayload(kind string, payload any) ([]byte, error) {
	var fields [][]byte
	switch p := payload.(type) {
	case StakeDelegatePayload:
		if kind != ActionStakeDelegate || !actionText(p.Validator, 1, 128) || !actionPositive(p.AmountYNXT) {
			return nil, ErrAction
		}
		fields = append([][]byte{[]byte(p.Validator)}, pair(p.AmountYNXT)...)
	case StakeUnbondPayload:
		if kind != ActionStakeUnbond || !actionHex(p.DelegationID, 24) || !actionPositive(p.AmountYNXT) {
			return nil, ErrAction
		}
		fields = append([][]byte{[]byte(p.DelegationID)}, pair(p.AmountYNXT)...)
	case StakeWithdrawPayload:
		if kind != ActionStakeWithdraw || !actionHex(p.UnbondingID, 24) {
			return nil, ErrAction
		}
		fields = [][]byte{[]byte(p.UnbondingID)}
	default:
		return nil, ErrAction
	}
	return ynxbatch.EncodeFields(fields...)
}

func decodeStakingActionPayload(kind string, wire []byte) (any, error) {
	count := 3
	if kind == ActionStakeWithdraw {
		count = 1
	} else if kind != ActionStakeDelegate && kind != ActionStakeUnbond {
		return nil, ErrAction
	}
	fields, err := frame(wire, count, MaxActionPayloadBytes)
	if err != nil {
		return nil, ErrAction
	}
	r := actionReader{fields: fields}
	var payload any
	switch kind {
	case ActionStakeDelegate:
		payload = StakeDelegatePayload{Validator: r.text(), AmountYNXT: r.u64()}
	case ActionStakeUnbond:
		payload = StakeUnbondPayload{DelegationID: r.text(), AmountYNXT: r.u64()}
	case ActionStakeWithdraw:
		payload = StakeWithdrawPayload{UnbondingID: r.text()}
	}
	if r.err != nil || r.index != count {
		return nil, ErrAction
	}
	canonical, err := EncodeActionPayload(kind, payload)
	if err != nil || !bytes.Equal(canonical, wire) {
		return nil, ErrAction
	}
	return payload, nil
}
