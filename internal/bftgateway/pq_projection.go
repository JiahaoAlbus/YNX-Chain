package bftgateway

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Transactions keeps its legacy ordinary-transaction shape. Whole containers
// have their own typed collection. Order and count refer to actual Comet outer
// transactions; native member indexes appear only inside each batch's Results.
type CometTransactionReference struct {
	UnsupportedProjection string `json:"unsupportedProjection,omitempty"`
	Hash                  string `json:"hash"`
	Type                  string `json:"type"`
	CometIndex            uint32 `json:"cometIndex"`
	Height                uint64 `json:"height"`
}

type ProjectedBlock struct {
	chain.Block
	UnmappedTransactions  []CometTransactionReference `json:"unmappedTransactions,omitempty"`
	PQBatches             []PQWholeView               `json:"pqBatches,omitempty"`
	CometTransactionCount int                         `json:"cometTransactionCount"`
	TransactionOrder      []CometTransactionReference `json:"transactionOrder"`
}

// A default Comet block is at most 22,020,096 raw bytes; its base64 RPC form plus
// JSON framing fits 32 MiB. This is a read budget, not a consensus cap override.
const cometBlockReadBytes int64 = 32 << 20

func readCometBody(body io.Reader, limit int64) ([]byte, error) {
	payload, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > limit {
		return nil, fmt.Errorf("CometBFT response exceeds explicit %d-byte read budget", limit)
	}
	return payload, nil
}

func (g *Gateway) wholeBlockResults(ctx context.Context, height uint64, count int) ([]cometTxResult, error) {
	var results cometBlockResults
	if err := g.client.getBounded(ctx, "/block_results", url.Values{"height": {strconv.FormatUint(height, 10)}}, &results, cometBlockReadBytes); err != nil {
		return nil, err
	}
	if results.Error != nil {
		return nil, errors.New(cometError(results.Error))
	}
	h, err := strconv.ParseUint(results.Result.Height, 10, 64)
	if err != nil || h != height || len(results.Result.TxsResults) != count {
		return nil, errors.New("Comet block result height/count mismatch")
	}
	return results.Result.TxsResults, nil
}

func compactWhole(view PQWholeView) PQWholeView {
	// The immutable original bytes are available from ReadbackURL. Block and
	// history views do not duplicate hundreds of kilobytes of shared proof.
	view.Whole = nil
	return view
}

func isWholeEnvelope(payload []byte) bool {
	kind, err := consensus.TransactionEnvelopeType(payload)
	return err == nil && kind == consensus.PQWholeType
}

// These envelopes execute in ABCI, but this gateway has no native effect
// projection for them yet. Preserve the real outer record without inventing a
// chain.Transaction, fee, success receipt or member identity.
func unmappedPQTransaction(tx cometTx) (CometTransactionReference, bool, error) {
	kind, err := consensus.TransactionEnvelopeType(tx.Tx)
	if err != nil || kind != consensus.PQTransferType && kind != consensus.PQMigrationType && kind != consensus.PQRevocationType {
		return CometTransactionReference{}, false, nil
	}
	if _, _, err = consensus.DecodePQTransaction(tx.Tx); err != nil {
		return CometTransactionReference{}, true, err
	}
	hash := consensus.SignedTransactionHash(tx.Tx)
	height, err := strconv.ParseUint(tx.Height, 10, 64)
	if err != nil || height == 0 || !strings.EqualFold(tx.Hash, strings.TrimPrefix(hash, "0x")) {
		return CometTransactionReference{}, true, errors.New("unmapped PQ outer evidence mismatch")
	}
	return CometTransactionReference{Hash: hash, Type: kind, CometIndex: tx.Index, Height: height, UnsupportedProjection: "native effect projection is not implemented; outer identity only"}, true, nil
}
