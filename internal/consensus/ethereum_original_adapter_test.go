package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

type originalEthereumVector struct {
	Name, Raw, Hash, Sender string
	Valid                   bool
}

func originalEthereumVectors(t *testing.T) []originalEthereumVector {
	t.Helper()
	data, err := os.ReadFile("../../testdata/ethereum-native/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Vectors []originalEthereumVector }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.Vectors
}

// The fixture contains already-signed public old-chain vectors; it does not
// create keys, sign, broadcast, or use a real account.
func TestOriginalEthereumAdapterPublicWireCompatibility(t *testing.T) {
	for _, v := range originalEthereumVectors(t) {
		t.Run(v.Name, func(t *testing.T) {
			raw, err := hex.DecodeString(strings.TrimPrefix(v.Raw, "0x"))
			if err != nil {
				t.Fatal(err)
			}
			old, err := ethnative.Verify(raw, 6423)
			if !v.Valid {
				if err == nil {
					t.Fatal("invalid vector unexpectedly passes the original verifier")
				}
				candidate, candidateErr := decodeOriginalEthereumAdapter(raw)
				if candidateErr == nil && candidate.Verify(6423) == nil {
					t.Fatal("original adapter accepted an original rejection")
				}
				return
			}
			if err != nil || old.Hash != v.Hash || old.From != v.Sender {
				t.Fatal("original public vector differs from original verifier", err)
			}
			got, err := DecodeEthereumValueTransfer(raw)
			if err != nil || got.Verify(6423) != nil || got.Hash != old.Hash || got.From != old.From || got.To != old.To || got.Nonce != old.Nonce || got.Value != old.Amount || got.Fee != 1 || got.GasLimit != old.Gas {
				t.Fatalf("old signed wire lost its original account/amount/fee/gas: %+v %v", got, err)
			}
			maximum, err := got.MaximumGasFee()
			if err != nil || maximum != int64((old.Gas+ethnative.TransferGas-1)/ethnative.TransferGas) || got.EthereumExecutionGas() != ethnative.TransferGas {
				t.Fatal("original signed gas budget or charged gas changed", maximum, err)
			}
		})
	}
}

func TestOriginalEthereumAdapterExecutionAndColdRestart(t *testing.T) {
	v := originalEthereumVectors(t)[0]
	raw, err := hex.DecodeString(strings.TrimPrefix(v.Raw, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	original, err := ethnative.Verify(raw, 6423)
	if err != nil {
		t.Fatal(err)
	}
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(original.From, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	if err := devnet.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "original-adapter-state.json")
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	height := int64(migration.Height) + 1
	at := time.Date(2026, 7, 27, 11, 10, 0, 0, time.UTC)
	// These synthetic state views exercise the existing account-policy gate;
	// no policy is installed, migrated or persisted by this check.
	missing := app.cloneExecutionState()
	missing.accountPolicy = nil
	if _, _, err := app.applyEthereumValueTransfer(missing, raw, height, at); err == nil {
		t.Fatal("original classic adapter accepted missing account policy")
	}
	active := app.cloneExecutionState()
	policy := active.accountPolicy.Clone()
	policy.Records = []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: original.From, PKA: bytes.Repeat([]byte{1}, ynxbatch.PublicKeyASize), PKB: bytes.Repeat([]byte{2}, ynxbatch.PublicKeyBSize), Revision: 1, RegisteredAt: policy.EnableAt, ActiveFrom: policy.EnableAt + 1, LedgerNonce: 1}}
	active.accountPolicy = &policy
	if err := policy.Validate(policy.NetworkID); err != nil {
		t.Fatal("synthetic account policy invalid", err)
	}
	if _, _, err := app.applyEthereumValueTransfer(active, raw, int64(policy.EnableAt+1), at); err == nil {
		t.Fatal("original classic adapter bypassed active PQ account policy")
	}
	check, err := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: raw})
	if err != nil || check.Code != abcitypes.CodeTypeOK || string(check.Data) != original.Hash || check.GasUsed != int64(ethnative.TransferGas) {
		t.Fatalf("original signed adapter failed CheckTx: %+v %v", check, err)
	}
	prepared, err := app.PrepareProposal(ctx, &abcitypes.RequestPrepareProposal{Height: height, Time: at, MaxTxBytes: 1 << 20, Txs: [][]byte{raw}})
	if err != nil || len(prepared.Txs) != 1 || !bytes.Equal(prepared.Txs[0], raw) {
		t.Fatal("original signed adapter failed proposal preparation", err)
	}
	proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: at, Txs: prepared.Txs})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatal("original signed adapter failed proposal validation", err)
	}
	committed, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: at, Txs: [][]byte{raw}})
	if err != nil || len(committed.TxResults) != 1 || committed.TxResults[0].Code != 0 || string(committed.TxResults[0].Data) != original.Hash || committed.TxResults[0].GasUsed != int64(ethnative.TransferGas) {
		t.Fatalf("original signed adapter failed execution: %+v %v", committed, err)
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	assertConsensusAccount(t, app, original.From, 97, 1)
	assertConsensusAccount(t, app, original.To, 2, 0)
	if len(app.committed.FeeEvents) != 1 || app.committed.FeeEvents[0].GrossFeeYNXT != 1 || app.committed.FeeEvents[0].TxHash != original.Hash {
		t.Fatal("original fixed fee or hash was not preserved")
	}
	cold, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	assertConsensusAccount(t, cold, original.From, 97, 1)
	assertConsensusAccount(t, cold, original.To, 2, 0)
	if response, err := cold.Query(ctx, &abcitypes.RequestQuery{Path: "/evm/receipts/" + original.Hash}); err != nil || response.Code != 0 {
		t.Fatal("original receipt not restored after restart", response, err)
	}
}

func TestOriginalEthereumAdapterPaddedGasBudget(t *testing.T) {
	var padded originalEthereumVector
	for _, v := range originalEthereumVectors(t) {
		if v.Name == "padded_gas" {
			padded = v
		}
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(padded.Raw, "0x"))
	if err != nil || len(raw) == 0 {
		t.Fatal("missing original padded-gas vector", err)
	}
	original, err := ethnative.Verify(raw, 6423)
	if err != nil || original.Gas != 30_000 || original.Amount != 2 {
		t.Fatal("unexpected original padded-gas fixture", original, err)
	}
	for _, item := range []struct {
		balance int64
		ok      bool
	}{{3, false}, {4, true}} {
		devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
		if _, err := devnet.Faucet(original.From, item.balance); err != nil {
			t.Fatal(err)
		}
		devnet.ProduceBlock()
		if err := devnet.EnableAccountPQ(2); err != nil {
			t.Fatal(err)
		}
		migration, err := devnet.ExportConsensusMigrationState()
		if err != nil {
			t.Fatal(err)
		}
		app, err := NewApplication(migration)
		if err != nil {
			t.Fatal(err)
		}
		result, err := app.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
		if err != nil || (result.Code == 0) != item.ok {
			t.Fatalf("signed 30000 gas budget: balance=%d code=%d err=%v", item.balance, result.Code, err)
		}
		assertConsensusAccount(t, app, original.From, item.balance, 0)
	}
}
