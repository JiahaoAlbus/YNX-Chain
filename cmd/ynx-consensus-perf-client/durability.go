package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmttypes "github.com/cometbft/cometbft/types"
)

var errDurableNotReady = errors.New("local durable state has not reached transaction height")

func validateLocalPaths(m consensus.EphemeralNetworkManifest, manifestPath string) error {
	root, err := filepath.Abs(filepath.Dir(manifestPath))
	if err != nil {
		return err
	}
	inside := func(p string) bool {
		return filepath.IsAbs(p) && strings.HasPrefix(filepath.Clean(p), root+string(os.PathSeparator))
	}
	if !inside(m.MigrationPath) {
		return errors.New("migration must be inside the isolated manifest directory")
	}
	for _, node := range m.Nodes {
		if !inside(node.Home) || !inside(node.ABCIStatePath) || !strings.HasPrefix(filepath.Clean(node.ABCIStatePath), filepath.Clean(node.Home)+string(os.PathSeparator)) {
			return errors.New("node home/state must be inside the isolated network directory")
		}
	}
	return nil
}

func readMigration(m consensus.EphemeralNetworkManifest) (chain.ConsensusMigrationState, error) {
	var migration chain.ConsensusMigrationState
	data, err := readBounded(m.MigrationPath, 16*1024*1024)
	if err != nil {
		return migration, err
	}
	if err := strictJSON(data, &migration); err != nil {
		return migration, err
	}
	if err := migration.Validate(); err != nil {
		return migration, err
	}
	if migration.StateHash != m.MigrationStateHash || fmt.Sprintf("ynx_%d-1", migration.Network.ChainID) != m.ChainID {
		return migration, errors.New("local migration identity differs from manifest")
	}
	return migration, nil
}

// This is local disk readback in addition to the signed consensus evidence.
// The state at the transaction height is not authenticated by that same
// height's Header.AppHash (which commits the preceding application state).
func verifyDurableExecution(statePath string, migration chain.ConsensusMigrationState, raw cmttypes.Tx, height int64) (*consensus.CommittedState, error) {
	data, err := readBounded(statePath, 16*1024*1024)
	if errors.Is(err, os.ErrNotExist) {
		return nil, errDurableNotReady
	}
	if err != nil {
		return nil, err
	}
	var state consensus.CommittedState
	if err := strictJSON(data, &state); err != nil {
		return nil, err
	}
	if err := state.Validate(migration); err != nil {
		return nil, fmt.Errorf("durable state validation: %w", err)
	}
	if !state.Initialized || state.Height < height {
		return nil, errDurableNotReady
	}
	tx, err := consensus.DecodeSignedTransaction(raw)
	if err != nil {
		return nil, fmt.Errorf("bounded fixture must use native signed transfers: %w", err)
	}
	if err := tx.Verify(migration.Network.ChainID); err != nil {
		return nil, err
	}
	for _, fee := range state.FeeEvents {
		if fee.TxHash == consensus.SignedTransactionHash(raw) && fee.BlockHeight == height && fee.Payer == tx.From && fee.TransactionType == consensus.SignedTransactionType && fee.GrossFeeYNXT == tx.Fee {
			for _, account := range state.Accounts {
				if account.Address == tx.From && account.Nonce >= tx.Nonce {
					return &state, nil
				}
			}
		}
	}
	return nil, errors.New("transaction fee/nonce absent from validated local durable state")
}
