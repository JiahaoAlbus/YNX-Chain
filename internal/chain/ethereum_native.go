package chain

import (
	"errors"
	"fmt"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
)

// SetEthereumNativeTransfers is an explicit rollout switch. Persisted envelopes
// are always verified during load/replication, even when new admission is off.
func (d *Devnet) SetEthereumNativeTransfers(enabled bool) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if enabled && (d.cfg.Decimals != 18 || d.cfg.Slug == "mainnet") {
		return errors.New("Ethereum native adapter is limited to 18-decimal testnet/devnet")
	}
	d.ethereumNativeTransfers = enabled
	return nil
}

func (d *Devnet) EthereumNativeTransfersEnabled() bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.ethereumNativeTransfers
}

func validateEthereumTransaction(tx Transaction, chainID int64) error {
	eth, present, err := ethnative.FromMemo(tx.Memo, chainID)
	if err != nil {
		return fmt.Errorf("invalid persisted Ethereum envelope: %w", err)
	}
	if present && (tx.Type != "transfer" || !ethnative.Matches(eth, tx.Hash, tx.From, tx.To, tx.Amount, tx.Fee, tx.Nonce)) {
		return errors.New("persisted Ethereum envelope differs from native transaction")
	}
	return nil
}

func validateEthereumPending(txs []Transaction, chainID int64) error {
	for _, tx := range txs {
		if err := validateEthereumTransaction(tx, chainID); err != nil {
			return err
		}
	}
	return nil
}
