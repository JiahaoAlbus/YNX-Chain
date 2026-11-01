package participation

import (
	"context"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Withdrawal uses only the original typed ID payload. Amount and availability
// are read from the signer-owned original unbonding, never caller amount or
// the local wall clock. This is still configured-RPC DATA, not funds finality.
func (r *HTTPReader) withdrawalCurrent(ctx context.Context, req Request, c Conditions, height int64) (Conditions, error) {
	if c.UnbondingSeconds != strconv.FormatInt(consensus.StakingUnbondingSeconds, 10) || c.CommissionBPS != strconv.FormatInt(consensus.StakingCommissionBPS, 10) {
		return c, ErrInvalid
	}
	var envelope struct {
		Source  string                      `json:"source"`
		Failure bool                        `json:"failure"`
		Version int                         `json:"version"`
		Entry   consensus.BFTUnbondingEntry `json:"unbonding"`
	}
	if _, e := r.get(ctx, r.chain, "/staking/unbondings/"+req.UnbondingID, &envelope); e != nil {
		return c, e
	}
	v := envelope.Entry
	if envelope.Failure || envelope.Source != "ynx-consensus-abci" || envelope.Version != consensus.StakingPolicyVersion || v.ID != req.UnbondingID || v.Delegator != req.Owner || !recordID(v.DelegationID) || !reference(v.Validator) || v.AmountYNXT <= 0 || v.RequestedAt.IsZero() || !v.AvailableAt.Equal(v.RequestedAt.Add(time.Duration(consensus.StakingUnbondingSeconds)*time.Second)) || v.BlockHeight < 1 || v.BlockHeight > height || !transactionHash(v.TxHash) || (v.Status != "queued" && v.Status != "withdrawn") {
		return c, ErrInvalid
	}
	if v.Status == "queued" && v.WithdrawnAt != nil || v.Status == "withdrawn" && (v.WithdrawnAt == nil || v.WithdrawnAt.Before(v.AvailableAt)) {
		return c, ErrInvalid
	}
	c.Validator = v.Validator
	c.AvailableYNXT = strconv.FormatInt(v.AmountYNXT, 10)
	c.WithdrawAvailableAt = v.AvailableAt.UTC().Format(time.RFC3339Nano)
	var delegation struct {
		Source  string                       `json:"source"`
		Failure bool                         `json:"failure"`
		Version int                          `json:"version"`
		Entry   consensus.BFTStakeDelegation `json:"delegation"`
	}
	if _, e := r.get(ctx, r.chain, "/staking/delegations/"+v.DelegationID, &delegation); e != nil {
		return c, e
	}
	d := delegation.Entry
	if delegation.Failure || delegation.Source != "ynx-consensus-abci" || delegation.Version != consensus.StakingPolicyVersion || d.ID != v.DelegationID || d.Delegator != req.Owner || d.Validator != v.Validator || d.AmountYNXT < 0 || !transactionHash(d.TxHash) {
		return c, ErrInvalid
	}
	// Bind both original records, including the parent authorization lineage.
	// A same-hash RPC projection that changes this target must not reuse review.
	c.ObjectVersion = bind(encoded(struct {
		Unbonding consensus.BFTUnbondingEntry
		Parent    consensus.BFTStakeDelegation
	}{v, d})).SHA512
	if d.AuthorizationHistory == "" {
		c.Reason = "Original unbonding parent authorization lineage is opaque; protected staking originals are required"
		return c, nil
	}
	var status struct {
		Time time.Time `json:"latestBlockTime"`
	}
	if _, e := r.get(ctx, r.chain, "/status", &status); e != nil {
		return c, e
	}
	if status.Time.IsZero() {
		return c, ErrInvalid
	}
	if v.Status != "queued" {
		c.Reason = "Original unbonding has already been withdrawn"
		return c, nil
	}
	if status.Time.Before(v.AvailableAt) {
		c.Reason = "Original seven-day unbonding window is still locked at reported chain time"
		return c, nil
	}
	c.NativeAvailable = true
	return c, nil
}
