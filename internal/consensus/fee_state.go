package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"time"
)

const (
	FeePolicyVersion               = 1
	FixedFeeSource                 = "ynx-consensus-fixed-fee-v1"
	EthereumLegacyGasFeeSource     = "ethereum-legacy-gas-v1"
	EthereumAccessListGasFeeSource = "ethereum-access-list-gas-v1"
	EthereumDynamicFeeGasFeeSource = "ethereum-dynamic-fee-zero-base-v1"
	PQEthereumGasFeeSource         = "ynx-pq-ethereum-abci-integer-gas-v1"
)

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
	return newFeeEvent(txHash, txType, payer, recipient, fee, FixedFeeSource, height, blockTime)
}

func newEthereumGasFeeEvent(txHash, txType, payer, recipient string, fee, height int64, blockTime time.Time) BFTFeeEvent {
	source := EthereumLegacyGasFeeSource
	if txType == EthereumAccessListTransferType {
		source = EthereumAccessListGasFeeSource
	} else if txType == EthereumDynamicFeeTransferType {
		source = EthereumDynamicFeeGasFeeSource
	} else if txType == PQEthereumValueType {
		source = PQEthereumGasFeeSource
	}
	return newFeeEvent(txHash, txType, payer, recipient, fee, source, height, blockTime)
}

func newFeeEvent(txHash, txType, payer, recipient string, fee int64, source string, height int64, blockTime time.Time) BFTFeeEvent {
	if height < 1 {
		height = 1
	}
	if blockTime.IsZero() {
		blockTime = time.Unix(height, 0).UTC()
	}
	sum := sha256.Sum256([]byte("YNX_FEE_EVENT_V1\x00" + txHash))
	event := BFTFeeEvent{ID: "fee_" + hex.EncodeToString(sum[:12]), PolicyVersion: FeePolicyVersion, TxHash: txHash, TransactionType: txType, Payer: payer, Recipient: recipient, GrossFeeYNXT: fee, ValidatorYNXT: fee, Source: source, BlockHeight: height, RecordedAt: blockTime.UTC()}
	event.AuditHash = feeEventAuditHash(event)
	return event
}

func feeEventAuditHash(event BFTFeeEvent) string {
	// Keep the V1 byte contract while avoiding variadic formatting and a
	// formatted string allocation for every historical event on validation.
	// Larger fields still grow normally; this is not a record-size restriction.
	var buffer [768]byte
	payload := append(buffer[:0], "YNX_FEE_EVENT_AUDIT_V1\x00"...)
	text := func(value string) { payload = append(payload, value...); payload = append(payload, 0) }
	number := func(value int64) { payload = strconv.AppendInt(payload, value, 10); payload = append(payload, 0) }
	text(event.ID)
	number(int64(event.PolicyVersion))
	text(event.TxHash)
	text(event.TransactionType)
	text(event.Payer)
	text(event.Recipient)
	number(event.GrossFeeYNXT)
	number(event.BurnYNXT)
	number(event.ValidatorYNXT)
	number(event.ProviderYNXT)
	number(event.ProtocolYNXT)
	number(event.TreasuryYNXT)
	payload = strconv.AppendBool(payload, event.Sponsored)
	payload = append(payload, 0)
	text(event.Source)
	number(event.BlockHeight)
	payload = event.RecordedAt.UTC().AppendFormat(payload, time.RFC3339Nano)
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
