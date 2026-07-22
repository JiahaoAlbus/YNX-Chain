package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

const FeePolicyVersion = 1

// BFTFeeEvent makes the current fixed-fee behavior explicit. BurnYNXT is zero
// until a governance-approved policy migration activates a burn mechanism.
type BFTFeeEvent struct {
	ID              string    `json:"id"`
	PolicyVersion   int       `json:"policyVersion"`
	TxHash          string    `json:"txHash"`
	TransactionType string    `json:"transactionType"`
	Payer           string    `json:"payer"`
	Recipient       string    `json:"recipient"`
	GrossFeeYNXT    int64     `json:"grossFeeYnxt"`
	BurnYNXT        int64     `json:"burnYnxt"`
	ValidatorYNXT   int64     `json:"validatorYnxt"`
	ProviderYNXT    int64     `json:"providerYnxt"`
	ProtocolYNXT    int64     `json:"protocolYnxt"`
	TreasuryYNXT    int64     `json:"treasuryYnxt"`
	Sponsored       bool      `json:"sponsored"`
	Source          string    `json:"source"`
	BlockHeight     int64     `json:"blockHeight"`
	RecordedAt      time.Time `json:"recordedAt"`
	AuditHash       string    `json:"auditHash"`
}

func newCurrentFeeEvent(txHash, txType, payer, recipient string, fee, height int64, blockTime time.Time) BFTFeeEvent {
	if height < 1 {
		height = 1
	}
	if blockTime.IsZero() {
		blockTime = time.Unix(height, 0).UTC()
	}
	sum := sha256.Sum256([]byte("YNX_FEE_EVENT_V1\x00" + txHash))
	event := BFTFeeEvent{ID: "fee_" + hex.EncodeToString(sum[:12]), PolicyVersion: FeePolicyVersion, TxHash: txHash, TransactionType: txType, Payer: payer, Recipient: recipient, GrossFeeYNXT: fee, ValidatorYNXT: fee, Source: "ynx-consensus-fixed-fee-v1", BlockHeight: height, RecordedAt: blockTime.UTC()}
	event.AuditHash = feeEventAuditHash(event)
	return event
}

func feeEventAuditHash(event BFTFeeEvent) string {
	payload := fmt.Sprintf("YNX_FEE_EVENT_AUDIT_V1\x00%s\x00%d\x00%s\x00%s\x00%s\x00%s\x00%d\x00%d\x00%d\x00%d\x00%d\x00%d\x00%t\x00%s\x00%d\x00%s", event.ID, event.PolicyVersion, event.TxHash, event.TransactionType, event.Payer, event.Recipient, event.GrossFeeYNXT, event.BurnYNXT, event.ValidatorYNXT, event.ProviderYNXT, event.ProtocolYNXT, event.TreasuryYNXT, event.Sponsored, event.Source, event.BlockHeight, event.RecordedAt.UTC().Format(time.RFC3339Nano))
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}
