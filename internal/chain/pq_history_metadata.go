package chain

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
)

func isPQSourceHistory(tx Transaction) bool {
	return strings.HasPrefix(tx.Memo, pqTransferMemo) || strings.HasPrefix(tx.Memo, pqMigrationMemo) ||
		strings.HasPrefix(tx.Memo, pqRevocationMemo) || strings.HasPrefix(tx.Memo, pqBatchMemo)
}

// Neither the transfer nor account-policy wire authorizes resource sponsorship.
// This check is shared with native ABCI history, whose own executor separately
// validates its flow and inclusion representation. Devnet logs are source-only.
func validatePQUnsignedExecutionMetadata(tx Transaction) error {
	if tx.Sponsor != "" || tx.SponsorPoolID != "" || tx.ResourceSource != "" || tx.ResourceType != "" || tx.ResourceConsumed != 0 || tx.ActionReference != "" {
		return errors.New("PQ history contains unsigned resource execution metadata")
	}
	return nil
}

type pqSourceLotOrigin struct {
	amount  int64
	ordinal uint64
	valid   bool
}

// validatePQSourceHistoryMetadata checks the actual Devnet representation after
// original signature/record/batch coverage validation. Every complete snapshot,
// cold load, final replication candidate and source-runtime migration uses it.
// Partial replication documents defer this check until history is attached.
func validatePQSourceHistoryMetadata(s devnetSnapshot) error {
	if len(s.Blocks) == 0 {
		return nil
	}
	// Faucet is the only creator of Devnet TrustTraceLot records. Other mutators
	// transfer existing lot IDs; LastInbound is mutable and names a recipient,
	// despite its old JSON field name. Preserve that field rather than compare a
	// later recipient with an earlier flow. Bind only lots used by PQ receipts to
	// their unique earlier issuance and the complete source catalog.
	origins := map[string]pqSourceLotOrigin{}
	var ordinal uint64
	rememberOrigin := func(tx Transaction) {
		ordinal++
		if tx.Type != "faucet" {
			return
		}
		for _, flow := range tx.LotFlows {
			_, duplicate := origins[flow.LotID]
			valid := !duplicate && len(tx.LotFlows) == 1 && tx.From == FaucetAddress && tx.Amount > 0 && tx.Fee == 0 &&
				flow.LotID != "" && flow.From == FaucetAddress && flow.To == tx.To && flow.To != "" && flow.Amount == tx.Amount
			origins[flow.LotID] = pqSourceLotOrigin{amount: tx.Amount, ordinal: ordinal, valid: valid}
		}
	}
	for _, block := range s.Blocks {
		for _, tx := range block.Transactions {
			rememberOrigin(tx)
		}
	}
	for _, tx := range s.Pending {
		rememberOrigin(tx)
	}
	ordinal = 0
	check := func(tx Transaction, txIndex, firstLogIndex uint64, block *Block) error {
		ordinal++
		if !isPQSourceHistory(tx) {
			return nil
		}
		if err := validatePQUnsignedExecutionMetadata(tx); err != nil {
			return err
		}
		if block == nil {
			if tx.BlockNum != 0 || tx.BlockHash != "" || len(tx.Logs) != 0 {
				return errors.New("pending PQ source receipt claims block inclusion or logs")
			}
		} else {
			if tx.BlockNum != block.Height || tx.BlockHash != block.Hash || tx.BlockNum == 0 {
				return errors.New("PQ source receipt differs from its containing block")
			}
			projection := Devnet{}
			expected := projection.evmLogsForTransactionLocked(tx, txIndex, firstLogIndex)
			if len(expected) != 1 || !reflect.DeepEqual(tx.Logs, expected) {
				return errors.New("PQ source system logs differ from their execution and actual block positions")
			}
		}
		return validatePQSourceLotFlows(tx, s, origins, ordinal)
	}
	for _, block := range s.Blocks {
		var firstLogIndex uint64
		for txIndex, tx := range block.Transactions {
			if err := check(tx, uint64(txIndex), firstLogIndex, &block); err != nil {
				return fmt.Errorf("validate PQ source metadata at height %d: %w", block.Height, err)
			}
			firstLogIndex += uint64(len(tx.Logs))
		}
	}
	for _, tx := range s.Pending {
		if err := check(tx, 0, 0, nil); err != nil {
			return fmt.Errorf("validate pending PQ source metadata: %w", err)
		}
	}
	return nil
}

func validatePQSourceLotFlows(tx Transaction, s devnetSnapshot, origins map[string]pqSourceLotOrigin, ordinal uint64) error {
	want, recipient := tx.Amount, tx.To
	switch tx.Type {
	case "transfer":
		// Existing transfer execution traces Amount; its separate fixed balance
		// fee is not represented by an additional LotFlow. Preserve that model.
	case "account_migration", "account_revocation":
		want = tx.Fee
		if len(tx.LotFlows) > 0 {
			recipient = tx.LotFlows[0].To
		}
		// The old account-policy wire did not sign a fee recipient. Admission
		// selected it before block production, so later validator configuration
		// can differ. Require one real recipient, without fabricating evidence
		// that the eventual block.Validator was the original fee recipient.
	default:
		return errors.New("unsupported PQ source receipt type")
	}
	account := s.Accounts[recipient]
	if want <= 0 || recipient == "" || account == nil || account.Address != recipient {
		return errors.New("PQ source flow has no valid recipient or positive amount")
	}
	var total int64
	var previousLot string
	for _, flow := range tx.LotFlows {
		if flow.LotID == "" || flow.LotID <= previousLot || flow.From != tx.From || flow.To != recipient || flow.Amount <= 0 || flow.Amount > want-total {
			return errors.New("PQ source flow differs from owner, recipient, ordering or amount")
		}
		lot, exists := s.Lots[flow.LotID]
		origin, issued := origins[flow.LotID]
		if !exists || lot.LotID != flow.LotID || lot.Amount <= 0 || lot.Origin != "devnet faucet mint" ||
			!issued || !origin.valid || origin.ordinal >= ordinal || origin.amount != lot.Amount || flow.Amount > lot.Amount {
			return errors.New("PQ source flow lacks its complete earlier lot issuance")
		}
		total += flow.Amount
		previousLot = flow.LotID
	}
	if total != want {
		return errors.New("PQ source flows do not cover the exact executed amount")
	}
	// This binds receipt shape and issued lineage, not a replay of all historical
	// balances, intermediaries or current holdings. Mere catalog membership never
	// establishes historical ownership or authorizes a transaction.
	return nil
}
