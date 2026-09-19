package chain

import (
	"errors"
	"fmt"
)

const MaxFaucetBatchSize = 64

type FaucetRequestInput struct {
	Address   string
	Amount    int64
	RequestID string
}
type FaucetRequestResult struct {
	Transaction Transaction
	Replayed    bool
	Err         error
}

// FaucetRequestsBatch shares one full-state checkpoint across a bounded group.
// Each result is acknowledged only after that checkpoint; the existing request
// hash remains the idempotency and status-query identity across restarts.
func (d *Devnet) FaucetRequestsBatch(inputs []FaucetRequestInput) []FaucetRequestResult {
	results := make([]FaucetRequestResult, len(inputs))
	if len(inputs) == 0 {
		return results
	}
	if len(inputs) > MaxFaucetBatchSize {
		for i := range results {
			results[i].Err = errors.New("faucet batch exceeds maximum size")
		}
		return results
	}
	hashes := make([]string, len(inputs))
	for i, input := range inputs {
		hashes[i], results[i].Err = FaucetRequestHash(d.cfg.ChainID, input.RequestID)
		if input.Amount <= 0 {
			results[i].Err = errors.New("amount must be positive")
		}
		if input.Address == "" || input.Address == FaucetAddress {
			results[i].Err = errors.New("a recipient different from the faucet is required")
		}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	undos := []transferUndo{}
	needsCheckpoint := make([]bool, len(inputs))
	needsWrite := false
	for i, input := range inputs {
		if results[i].Err != nil {
			continue
		}
		if tx, ok := d.transactionLocked(hashes[i]); ok {
			if tx.Type != "faucet" || tx.From != FaucetAddress || tx.To != input.Address || tx.Amount != input.Amount || tx.Fee != 0 {
				results[i].Err = ErrFaucetRequestConflict
				continue
			}
			results[i].Transaction = tx
			results[i].Replayed = true
			_, uncertain := d.uncertainTransactions[tx.Hash]
			needsCheckpoint[i] = uncertain || (d.dataDir != "" && !d.transactionCheckpointCovers(tx))
			needsWrite = needsWrite || needsCheckpoint[i]
			continue
		}
		tx, undo, err := d.stageFaucetLocked(input.Address, input.Amount, hashes[i])
		results[i].Err = err
		if err != nil {
			continue
		}
		results[i].Transaction = tx
		undos = append(undos, undo)
		needsCheckpoint[i] = true
		needsWrite = true
	}
	if !needsWrite {
		return results
	}
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	if err == nil {
		d.uncertainTransactions = nil
		return results
	}
	renamed := errors.Is(err, ErrSnapshotDurabilityUncertain)
	if !renamed {
		for i := len(undos) - 1; i >= 0; i-- {
			d.rollbackTransferLocked(undos[i])
		}
	}
	for i := range results {
		if !needsCheckpoint[i] || results[i].Err != nil {
			continue
		}
		if renamed {
			if d.uncertainTransactions == nil {
				d.uncertainTransactions = map[string]struct{}{}
			}
			d.uncertainTransactions[results[i].Transaction.Hash] = struct{}{}
			results[i].Err = err
		} else if results[i].Replayed {
			// A retry of earlier state may survive a failed new checkpoint. It cannot
			// be declared rolled back merely because this batch's new writes were.
			if _, exists := d.transactionLocked(results[i].Transaction.Hash); exists {
				results[i].Err = fmt.Errorf("%w: retry checkpoint: %w", ErrSnapshotDurabilityUncertain, err)
			} else {
				results[i].Transaction = Transaction{}
				results[i].Err = err
			}
		} else {
			results[i].Transaction = Transaction{}
			results[i].Err = err
		}
	}
	return results
}
