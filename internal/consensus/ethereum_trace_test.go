package consensus

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

// Exercise the original signed RLP routes through the same business executor
// used by PQ Ethereum. The mover changes map entries, so a shallow prestate
// account copy cannot establish which source lots actually moved.
func TestEthereumClassicMovedLotProvenanceSurvivesColdRestart(t *testing.T) {
	for _, kind := range []string{EthereumLegacyTransferType, EthereumAccessListTransferType, EthereumDynamicFeeTransferType} {
		t.Run(kind, func(t *testing.T) {
			key := deterministicPrivateKey(31)
			sender := mustNativeAddress(t, key)
			recipient := mustNativeAddress(t, deterministicPrivateKey(32))
			devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
			if _, err := devnet.Faucet(sender, 200_000); err != nil {
				t.Fatal(err)
			}
			devnet.ProduceBlock()
			migration, err := devnet.ExportConsensusMigrationState()
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "committed.json")
			app, err := NewPersistentApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			var raw []byte
			switch kind {
			case EthereumLegacyTransferType:
				raw, _, err = NewEthereumLegacyTransfer(key, migration.Network.ChainID, 0, 2, recipient, 125)
			case EthereumAccessListTransferType:
				raw, _, err = NewEthereumAccessListTransfer(key, migration.Network.ChainID, 0, 2, recipient, 125)
			case EthereumDynamicFeeTransferType:
				raw, _, err = NewEthereumDynamicFeeTransfer(key, migration.Network.ChainID, 0, 2, 5, recipient, 125)
			}
			if err != nil {
				t.Fatal(err)
			}
			tx, err := DecodeEthereumValueTransfer(raw)
			if err != nil {
				t.Fatal(err)
			}
			before := queryConsensusAccount(t, app, sender)
			before.Lots = cloneInt64Map(before.Lots)
			committedBefore, err := encodeCommittedStateJSON(app.committed)
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			check, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: raw})
			if err != nil || check.Code != 0 {
				t.Fatalf("CheckTx failed: %+v %v", check, err)
			}
			checked, err := encodeCommittedStateJSON(app.committed)
			if err != nil || !bytes.Equal(checked, committedBefore) {
				t.Fatal("speculative classic Ethereum verification changed original committed state")
			}
			height := int64(migration.Height) + 1
			blockTime := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
			result, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: [][]byte{raw}})
			if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
				t.Fatalf("classic Ethereum execution failed: %+v %v", result, err)
			}
			if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			cold, err := NewPersistentApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			for _, current := range []*Application{app, cold} {
				after := queryConsensusAccount(t, current, sender)
				if after.Balance != before.Balance-tx.Value-tx.Fee || after.Nonce != 1 {
					t.Fatal("classic Ethereum value, actual gas fee or nonce changed")
				}
				moved := 0
				for id, amount := range before.Lots {
					if after.Lots[id] < amount {
						moved++
						lot, ok := current.committed.TraceLots[id]
						if !ok || lot.LastInbound != tx.Hash {
							t.Fatal("Ethereum moved lot retained its stale LastInbound provenance")
						}
					}
				}
				if moved == 0 || len(current.committed.FeeEvents) != 1 || len(current.committed.EVMReceipts) != 1 {
					t.Fatal("classic Ethereum source lots, fee or receipt were not actually executed")
				}
			}
		})
	}
}
