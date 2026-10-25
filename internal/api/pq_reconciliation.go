package api

import (
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// The legacy transaction fields stay at the top level. Exact decimal strings
// and checkpoint evidence are an additive read-only projection, read together
// from one ledger lock. No GET confirms or retries an uncertain disk write.
type transactionReadDTO struct {
	chain.Transaction
	TransactionHash   string            `json:"transactionHash"`
	WireHash          string            `json:"wireHash,omitempty"`
	DecimalFields     map[string]string `json:"decimalFields"`
	Source            string            `json:"source"`
	ConsensusFinality bool              `json:"consensusFinality"`
	YNXDurability     map[string]any    `json:"ynxDurability"`
}

func transactionReadResponse(tx chain.Transaction, durability chain.TransactionDurability) transactionReadDTO {
	fields := map[string]string{
		"amount": strconv.FormatInt(tx.Amount, 10), "fee": strconv.FormatInt(tx.Fee, 10),
		"nonce": strconv.FormatUint(tx.Nonce, 10), "executionHeight": strconv.FormatUint(durability.ExecutionHeight, 10),
		"blockNumber": strconv.FormatUint(tx.BlockNum, 10),
	}
	out := transactionReadDTO{Transaction: tx, TransactionHash: tx.Hash, DecimalFields: fields,
		Source: "authoritative_producer", ConsensusFinality: false, YNXDurability: transactionDurabilityRPC(tx.Hash, tx, durability)}
	// Whole-batch member transaction hashes differ from the original WholeWire
	// hash. Do not falsely describe every native transaction hash as a wire hash.
	if strings.HasPrefix(tx.Memo, "ynx-pq-transfer-v1:") || strings.HasPrefix(tx.Memo, "ynx-pq-action-v1:") {
		out.WireHash = tx.Hash
	}
	if strings.HasPrefix(tx.Memo, "ynx-pq-migration-v1:") {
		out.WireHash = tx.Hash
		wire, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, "ynx-pq-migration-v1:"))
		if err == nil {
			if migration, err := ynxauth.DecodeMigration(wire); err == nil {
				fields["revision"] = strconv.FormatUint(migration.Intent.NewRevision, 10)
				fields["activationHeight"] = strconv.FormatUint(migration.Intent.ActivateAt, 10)
			}
		}
	}
	if strings.HasPrefix(tx.Memo, "ynx-pq-revocation-v1:") {
		out.WireHash = tx.Hash
		wire, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, "ynx-pq-revocation-v1:"))
		if err == nil {
			if revoked, err := ynxauth.DecodeRevocation(wire); err == nil {
				for name, value := range revocationDecimalFields(revoked.Intent) {
					fields[name] = value
				}
			}
		}
	}
	return out
}
