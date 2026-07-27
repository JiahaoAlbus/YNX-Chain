package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestEthereumLegacyTransferCanonicalEIP155RoundTrip(t *testing.T) {
	senderKey := deterministicPrivateKey(1)
	recipient := mustNativeAddress(t, deterministicPrivateKey(2))
	payload, tx, err := NewEthereumLegacyTransfer(senderKey, 6423, 0, 2, recipient, 125)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := NewEthereumLegacyTransfer(senderKey, math.MaxInt64, 0, 1, recipient, 1); err == nil {
		t.Fatal("EIP-155 chain ID overflow boundary was accepted")
	}
	if tx.From != "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf" || tx.To != recipient {
		t.Fatalf("unexpected recovered Ethereum identity: %+v", tx)
	}
	if tx.Nonce != 0 || tx.GasPrice != 2 || tx.GasLimit != EthereumTransferGasLimit || tx.Value != 125 || tx.Fee != 42_000 {
		t.Fatalf("unexpected bounded Ethereum transfer economics: %+v", tx)
	}
	if tx.Hash != EthereumTransactionHash(payload) || !strings.HasPrefix(tx.Hash, "0x") || len(tx.Hash) != 66 {
		t.Fatalf("unexpected Ethereum transaction hash: %+v", tx)
	}
	kind, err := TransactionEnvelopeType(payload)
	if err != nil || kind != EthereumLegacyTransferType {
		t.Fatalf("legacy Ethereum envelope was not detected: kind=%q err=%v", kind, err)
	}
	decoded, err := DecodeEthereumLegacyTransaction(payload)
	if err != nil || decoded.Hash != tx.Hash || decoded.From != tx.From || decoded.To != tx.To {
		t.Fatalf("legacy Ethereum transaction did not round trip: decoded=%+v err=%v", decoded, err)
	}
	if err := decoded.Verify(6423); err != nil {
		t.Fatal(err)
	}
	if err := decoded.Verify(1); err == nil {
		t.Fatal("EIP-155 transaction was replayable on another chain")
	}
	if _, err := DecodeEthereumLegacyTransaction(append(payload, 0x00)); err == nil {
		t.Fatal("trailing RLP data was accepted")
	}
	if _, _, err := NewEthereumLegacyTransfer(senderKey, math.MaxInt64, 0, 1, recipient, 1); err == nil {
		t.Fatal("overflowing EIP-155 chain ID was accepted")
	}
}

func TestEthereumLegacyTransferRejectsUnsupportedOrNonCanonicalEnvelopes(t *testing.T) {
	payload, _, err := NewEthereumLegacyTransfer(deterministicPrivateKey(3), 6423, 0, 1, mustNativeAddress(t, deterministicPrivateKey(4)), 10)
	if err != nil {
		t.Fatal(err)
	}
	fields, err := decodeCanonicalRLPList(payload)
	if err != nil {
		t.Fatal(err)
	}
	rebuild := func(index int, replacement []byte) []byte {
		items := make([][]byte, len(fields))
		for i := range fields {
			items[i] = encodeRLPBytes(fields[i])
		}
		items[index] = replacement
		return encodeRLPList(items...)
	}
	tests := []struct {
		name    string
		payload []byte
		want    string
	}{
		{name: "typed fee market", payload: []byte{0x02, 0xc0}, want: "typed Ethereum"},
		{name: "contract creation", payload: rebuild(3, encodeRLPBytes(nil)), want: "contract creation"},
		{name: "calldata", payload: rebuild(5, encodeRLPBytes([]byte{1})), want: "calldata"},
		{name: "wrong gas", payload: rebuild(2, encodeRLPUint(EthereumTransferGasLimit+1)), want: "gas limit"},
		{name: "unprotected v", payload: rebuild(6, encodeRLPUint(27)), want: "EIP-155"},
		{name: "leading zero nonce", payload: rebuild(0, encodeRLPBytes([]byte{0, 1})), want: "leading zero"},
		{name: "nested field", payload: rebuild(0, encodeRLPList()), want: "nested lists"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := DecodeEthereumLegacyTransaction(test.payload)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q rejection, got %v", test.want, err)
			}
		})
	}
}

func TestApplicationExecutesEthereumLegacyTransferAndRejectsReplay(t *testing.T) {
	senderKey := deterministicPrivateKey(31)
	sender := mustNativeAddress(t, senderKey)
	recipient := mustNativeAddress(t, deterministicPrivateKey(32))
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 100_000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	payload, tx, err := NewEthereumLegacyTransfer(senderKey, migration.Network.ChainID, 0, 1, recipient, 125)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	check, err := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
	if err != nil || check.Code != abcitypes.CodeTypeOK || string(check.Data) != tx.Hash || check.GasWanted != int64(EthereumTransferGasLimit) || check.GasUsed != int64(EthereumTransferGasLimit) || check.Info != EthereumLegacyTransferType {
		t.Fatalf("valid Ethereum transfer failed CheckTx: response=%+v err=%v", check, err)
	}
	height := int64(migration.Height) + 1
	blockTime := time.Date(2026, 7, 27, 8, 30, 0, 0, time.UTC)
	proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: [][]byte{payload, payload}})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_REJECT {
		t.Fatalf("duplicate Ethereum nonce proposal was not rejected: response=%+v err=%v", proposal, err)
	}
	prepared, err := app.PrepareProposal(ctx, &abcitypes.RequestPrepareProposal{Height: height, Time: blockTime, MaxTxBytes: 1 << 20, Txs: [][]byte{payload, payload}})
	if err != nil || len(prepared.Txs) != 1 || !bytes.Equal(prepared.Txs[0], payload) {
		t.Fatalf("proposal preparation did not retain one Ethereum transfer: response=%+v err=%v", prepared, err)
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: prepared.Txs})
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != abcitypes.CodeTypeOK || string(finalized.TxResults[0].Data) != tx.Hash || finalized.TxResults[0].GasUsed != int64(EthereumTransferGasLimit) {
		t.Fatalf("Ethereum transfer finalization failed: response=%+v err=%v", finalized, err)
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	assertConsensusAccount(t, app, sender, 78_875, 1)
	assertConsensusAccount(t, app, recipient, 125, 0)
	if len(app.committed.FeeEvents) != 1 || app.committed.FeeEvents[0].TxHash != tx.Hash || app.committed.FeeEvents[0].TransactionType != EthereumLegacyTransferType ||
		app.committed.FeeEvents[0].GrossFeeYNXT != 21_000 || app.committed.FeeEvents[0].ValidatorYNXT != 21_000 || app.committed.FeeEvents[0].Source != EthereumLegacyGasFeeSource {
		t.Fatalf("Ethereum gas fee was not committed truthfully: %+v", app.committed.FeeEvents)
	}
	response, err := app.Query(ctx, &abcitypes.RequestQuery{Path: "/evm/receipts/" + tx.Hash})
	if err != nil || response.Code != abcitypes.CodeTypeOK {
		t.Fatalf("Ethereum committed receipt query failed: response=%+v err=%v", response, err)
	}
	var receipt BFTEVMReceipt
	if err := json.Unmarshal(response.Value, &receipt); err != nil || receipt.TxHash != tx.Hash || receipt.From != sender || receipt.To != recipient || receipt.Action != EthereumLegacyTransferType || receipt.BlockHeight != height || receipt.AuditHash != bftEVMReceiptAuditHash(receipt) {
		t.Fatalf("Ethereum committed receipt mismatch: receipt=%+v err=%v", receipt, err)
	}
	replay, err := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
	if err != nil || replay.Code != CodeInvalidNonce {
		t.Fatalf("Ethereum replay was not rejected by committed nonce: response=%+v err=%v", replay, err)
	}
	wrongChain, _, err := NewEthereumLegacyTransfer(senderKey, 1, 1, 1, recipient, 1)
	if err != nil {
		t.Fatal(err)
	}
	wrongChainResult, err := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: wrongChain})
	if err != nil || wrongChainResult.Code != CodeInvalidTx {
		t.Fatalf("wrong-chain Ethereum transfer was not rejected: response=%+v err=%v", wrongChainResult, err)
	}
}
