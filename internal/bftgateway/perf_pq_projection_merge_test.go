package bftgateway

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// Only RPC transport is simulated. Both entries are genuinely signed, applied
// by the real ABCI application, committed, and queried from its persisted state.
// The synthetic block header is a transport fixture, not a BFT finality proof.
func TestMergedGatewayEthereumAfterPQWholeUsesOriginalCometIndex(t *testing.T) {
	ctx := context.Background()
	f := newPQGatewayFixture(t)
	if _, err := f.d.Faucet(f.recipient, 100_000); err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	var err error
	f.migration, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f.a, err = consensus.NewPersistentApplication(f.migration, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	wholeWire := signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, [][]byte{f.message(t, 2, 1)})
	whole, err := consensus.EncodePQTransaction(consensus.PQWholeType, wholeWire)
	if err != nil {
		t.Fatal(err)
	}
	classic := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(214)))
	rawEthereum, ethereum, err := consensus.NewEthereumLegacyTransfer(classic, 6423, 0, 1, f.owner, 2)
	if err != nil {
		t.Fatal(err)
	}
	m := newPQMock(t, f)
	m.height = 4
	commitPQMockBlock(t, m, [][]byte{whole, rawEthereum})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/block" && r.URL.Path != "/block_by_hash" {
			m.serve(w, r)
			return
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		info, err := f.a.Info(r.Context(), &abcitypes.RequestInfo{})
		if err != nil {
			t.Error(err)
			http.Error(w, "app info failed", 500)
			return
		}
		txs := make(cmttypes.Txs, len(m.block))
		for i, raw := range m.block {
			txs[i] = cmttypes.Tx(raw)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
			"block_id": map[string]any{"hash": strings.Repeat("B", 64)},
			"block": map[string]any{"header": map[string]any{
				"height": strconv.FormatUint(m.height, 10), "time": time.Unix(int64(m.height), 0).UTC(),
				"proposer_address": strings.Repeat("C", 40), "last_block_id": map[string]any{"hash": strings.Repeat("A", 64)},
				"app_hash": hex.EncodeToString(info.LastBlockAppHash), "data_hash": hex.EncodeToString(txs.Hash()),
			}, "data": map[string]any{"txs": m.block}},
		}})
	}))
	t.Cleanup(upstream.Close)
	g, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := g.blockAtHeight(ctx, 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(evidence.RawTransactions) != 2 || len(evidence.Block.Transactions) != 1 || len(evidence.Projection.PQBatches) != 1 || evidence.Projection.CometTransactionCount != 2 {
		t.Fatal("mixed block lost raw containers or invented an ordinary Whole transfer")
	}
	if len(evidence.Projection.TransactionOrder) != 2 || evidence.Projection.TransactionOrder[0].CometIndex != 0 || evidence.Projection.TransactionOrder[1].CometIndex != 1 {
		t.Fatal("native projection lost original outer order")
	}
	if _, err := mappedAtCometIndex(evidence, 0); !errors.Is(err, errPQEthereumProjection) {
		t.Fatalf("Whole acquired an Ethereum transaction projection: %v", err)
	}
	mapped, err := mappedAtCometIndex(evidence, 1)
	if err != nil || mapped.Hash != ethereum.Hash {
		t.Fatalf("Ethereum transaction shifted to the shortened native index: %v", err)
	}
	committed, tx, found, err := g.committedTransaction(ctx, ethereum.Hash)
	if err != nil || !found || committed.Index != 1 || tx.Hash != ethereum.Hash || !bytes.Equal(committed.Tx, rawEthereum) {
		t.Fatalf("committed Ethereum original evidence lost: found=%v index=%d err=%v", found, committed.Index, err)
	}
	blockHash := "0x" + strings.Repeat("b", 64)
	params := func(values ...any) json.RawMessage {
		out, err := json.Marshal(values)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	count, code, err := g.evmCommittedBlockTransactionResult(ctx, "eth_getBlockTransactionCountByHash", params(blockHash))
	if err != nil || code != 0 || count != "0x2" {
		t.Fatalf("raw outer count: %v code=%d err=%v", count, code, err)
	}
	object, code, err := g.evmCommittedBlockTransactionResult(ctx, "eth_getTransactionByBlockHashAndIndex", params(blockHash, "0x1"))
	if err != nil || code != 0 {
		t.Fatalf("Ethereum raw index lookup: code=%d err=%v", code, err)
	}
	transactionObject, ok := object.(map[string]any)
	if !ok || transactionObject["hash"] != ethereum.Hash || transactionObject["transactionIndex"] != "0x1" {
		t.Fatalf("incorrect Ethereum index object: %+v", object)
	}
	if _, _, err := g.evmCommittedBlockTransactionResult(ctx, "eth_getTransactionByBlockHashAndIndex", params(blockHash, "0x0")); !errors.Is(err, errPQEthereumProjection) {
		t.Fatalf("Whole index lookup invented a transfer: %v", err)
	}
	hashBlock, err := g.evmCommittedBlockResult(ctx, "eth_getBlockByHash", params(blockHash, false))
	if err != nil {
		t.Fatal(err)
	}
	hashes := hashBlock.(map[string]any)["transactions"].([]any)
	if len(hashes) != 2 || hashes[0] != consensus.SignedTransactionHash(whole) || hashes[1] != ethereum.Hash {
		t.Fatalf("raw block hash order changed: %+v", hashes)
	}
	if _, err := g.evmCommittedBlockResult(ctx, "eth_getBlockByHash", params(blockHash, true)); !errors.Is(err, errPQEthereumProjection) {
		t.Fatalf("full mixed block fabricated Whole semantics: %v", err)
	}
	receipt, err := g.evmCommittedResult(ctx, "eth_getTransactionReceipt", params(ethereum.Hash))
	if err != nil {
		t.Fatal(err)
	}
	receiptObject, ok := receipt.(map[string]any)
	wholeGas, err := parseCometGas(m.blockResults[0].GasUsed)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || receiptObject["transactionHash"] != ethereum.Hash || receiptObject["transactionIndex"] != "0x1" || receiptObject["gasUsed"] != "0x5208" || receiptObject["cumulativeGasUsed"] != hexEVMQuantity(wholeGas+consensus.EthereumTransferGasLimit) {
		t.Fatalf("actual receipt evidence shifted or lost cumulative gas: %+v", receipt)
	}
	// A successful ABCI receipt alone cannot excuse false Comet execution data.
	m.mu.Lock()
	originalResult := m.blockResults[1]
	m.blockResults[1].GasUsed = "1"
	m.mu.Unlock()
	if _, _, _, err := g.committedTransaction(ctx, ethereum.Hash); err == nil {
		t.Fatal("forged gas result was accepted after a genuine PQ container")
	}
	m.mu.Lock()
	m.blockResults[1] = originalResult
	m.mu.Unlock()
	if _, _, found, err := g.committedTransaction(ctx, ethereum.Hash); err != nil || !found {
		t.Fatalf("original receipt failed after restoring exact evidence: %v", err)
	}
	forged := evidence
	forged.Block.Transactions = append(forged.Block.Transactions[:0:0], evidence.Block.Transactions...)
	forged.Block.Transactions[0].Amount++
	if _, err := mappedAtCometIndex(forged, 1); err == nil {
		t.Fatal("tampered mapped metadata overrode original signed Ethereum bytes")
	}
	if _, err := mappedAtCometIndex(evidence, 2); err == nil {
		t.Fatal("out-of-bounds original Comet index was accepted")
	}
}
