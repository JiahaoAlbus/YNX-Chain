//go:build pay_pq

package paynativesource

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"github.com/cometbft/cometbft/light"
	cmttypes "github.com/cometbft/cometbft/types"
)

var errProofUnavailable = errors.New("PAY_INDEPENDENT_SNAPSHOT_ANCHOR_HEADERS_NOT_SUPPLIED")

// All handles are original concrete producers, held only by private normal
// commissioning. Collector request/RPC response cannot supply any of them.
type originalProofReader struct {
	engine                   *originalPayEngineResources
	authenticatedAnchor      *cmttypes.LightBlock
	trustingPeriod, maxDrift time.Duration
	trustLevel               cmtmath.Fraction
	chainID                  string
	genesis                  []byte
	nativeID                 uint64
}

func hashBytes(original string, wire []byte) ([]byte, error) {
	if original != consensus.SignedTransactionHash(wire) || len(original) != 66 {
		return nil, errors.New("PAY_ORIGINAL_TRANSACTION_HASH_MISMATCH")
	}
	return hex.DecodeString(original[2:])
}
func blockExpectation(b *cmttypes.Block) consensus.PQLightProofExpectation {
	return consensus.PQLightProofExpectation{ChainID: b.ChainID, HeaderHeight: b.Height, BlockHash: bytes.Clone(b.Hash()), StateHeight: b.Height - 1, StateAppHash: bytes.Clone(b.AppHash)}
}
func (r *originalProofReader) read(ctx context.Context, o payproduct.NativePayOriginal) (consensus.PQLightProofTrust, consensus.PQTransactionProofExpectation, error) {
	var trust consensus.PQLightProofTrust
	var expectation consensus.PQTransactionProofExpectation
	if ctx == nil {
		return trust, expectation, ErrDenied
	}
	if e := ctx.Err(); e != nil {
		return trust, expectation, e
	}
	if r == nil || r.engine == nil {
		return trust, expectation, errProofUnavailable
	}
	if r.engine.engine == OriginalPayNativeEngine {
		return trust, expectation, ErrNativeBFTProofUnsupported
	}
	if r.engine.engine != OriginalPayBFTEngine || r.engine.view == nil || r.engine.application == nil {
		return trust, expectation, ErrPayEngineResources
	}
	if r.authenticatedAnchor == nil || r.trustingPeriod <= 0 || r.maxDrift < 0 || r.chainID == "" {
		return trust, expectation, errProofUnavailable
	}
	native, e := hashBytes(o.NativeHash, o.Member)
	if e != nil {
		return trust, expectation, e
	}
	abci, e := hashBytes(o.ABCIHash, o.Envelope)
	if e != nil {
		return trust, expectation, e
	}
	envelope, e := consensus.EncodePQNativeActionTransaction(o.Member)
	if e != nil || !bytes.Equal(envelope, o.Envelope) {
		return trust, expectation, errors.New("PAY_ORIGINAL_MEMBER_ENVELOPE_MISMATCH")
	}
	// Producer observation locates an original; it cannot assert finality. The
	// independently held block store fixes H/H+1 and exact transaction index.
	state, e := r.engine.view.LoadState()
	if e != nil {
		return trust, expectation, e
	}
	if _, e = r.engine.application.ConsensusAuthorityForState(state.ChainID, state.LastBlockHeight, state.AppHash); e != nil {
		return trust, expectation, e
	}
	location, e := r.originalBFTTransactionLocation(ctx, o, state.LastBlockHeight, state.AppHash)
	if e != nil {
		return trust, expectation, e
	}
	height := location.height
	if height == 0 || height > math.MaxInt64-1 {
		return trust, expectation, errProofUnavailable
	}
	h := int64(height)
	if state.LastBlockHeight < h+1 || state.ChainID != r.chainID {
		return trust, expectation, errProofUnavailable
	}
	block, next := r.engine.view.LoadBlock(h), r.engine.view.LoadBlock(h+1)
	if block == nil || next == nil || block.Height != h || next.Height != h+1 || block.ChainID != r.chainID || next.ChainID != r.chainID || !bytes.Equal(next.LastBlockID.Hash, block.Hash()) {
		return trust, expectation, errProofUnavailable
	}
	index := int64(-1)
	for i, tx := range block.Data.Txs {
		if bytes.Equal(tx, o.Envelope) {
			if index >= 0 {
				return trust, expectation, errors.New("PAY_ORIGINAL_TRANSACTION_INDEX_AMBIGUOUS")
			}
			index = int64(i)
		}
	}
	if index < 0 {
		return trust, expectation, errProofUnavailable
	}
	results, e := r.engine.view.LoadFinalizeBlockResponse(h)
	if e != nil {
		return trust, expectation, e
	}
	if results == nil || len(results.TxResults) != len(block.Data.Txs) || index >= int64(len(results.TxResults)) || results.TxResults[index] == nil {
		return trust, expectation, errProofUnavailable
	}
	if results.TxResults[index].Code != 0 {
		return trust, expectation, errors.New("PAY_ORIGINAL_BFT_EXECUTION_FAILED")
	}
	if !bytes.Equal(results.TxResults[index].Data, location.executionData) {
		return trust, expectation, errors.New("PAY_ORIGINAL_BFT_EXECUTION_RESULT_MISMATCH")
	}
	actualAuthority, e := r.engine.application.ConsensusAuthorityForState(state.ChainID, state.LastBlockHeight, state.AppHash)
	if e != nil {
		return trust, expectation, e
	}
	snapshot, ok := actualAuthority.(*consensus.PQEngineSnapshot)
	if !ok || snapshot == nil {
		return trust, expectation, errProofUnavailable
	}
	authority := snapshot.Anchor()
	if authority.ChainID != r.chainID || !bytes.Equal(authority.GenesisID, r.genesis) {
		return trust, expectation, errProofUnavailable
	}
	anchorBytes, e := cmtjson.Marshal(r.authenticatedAnchor)
	if e != nil {
		return trust, expectation, e
	}
	anchor, e := consensus.DecodePQTrustedLightBlock(anchorBytes)
	if e != nil {
		return trust, expectation, e
	}
	// A decoded blob/profile hash is not anchor authentication. The original
	// engine registry and unchanged Core/Comet full quorum check must pass.
	anchor, e = light.BindLightBlock(snapshot, anchor)
	if e != nil {
		return trust, expectation, e
	}
	if e = anchor.ValidatorSet.VerifyCommit(authority.ChainID, anchor.Commit.BlockID, anchor.Height, anchor.Commit); e != nil {
		return trust, expectation, e
	}
	trust = consensus.PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: anchor, TrustingPeriod: r.trustingPeriod, MaxClockDrift: r.maxDrift, TrustLevel: r.trustLevel, Now: time.Now().UTC()}
	expectation = consensus.PQTransactionProofExpectation{Block: blockExpectation(block), Successor: blockExpectation(next), TransactionType: consensus.PQActionType, Envelope: bytes.Clone(o.Envelope), NativeWire: bytes.Clone(o.Member), TransactionHash: abci, NativeWireHash: native, Index: index}
	if e = ctx.Err(); e != nil {
		return consensus.PQLightProofTrust{}, consensus.PQTransactionProofExpectation{}, e
	}
	after, e := r.engine.view.LoadState()
	if e != nil {
		return consensus.PQLightProofTrust{}, consensus.PQTransactionProofExpectation{}, e
	}
	if after.ChainID != state.ChainID || after.LastBlockHeight != state.LastBlockHeight || !bytes.Equal(after.AppHash, state.AppHash) || !after.LastBlockID.Equals(state.LastBlockID) {
		return consensus.PQLightProofTrust{}, consensus.PQTransactionProofExpectation{}, ErrDenied
	}
	return trust, expectation, nil
}

// Original App action history supplies a locator only after its same-state
// authorization/history/effects validator. Node-owned bytes/index/results and
// independent quorum/H+1 checks above remain necessary finality inputs.
type originalBFTPayLocation struct {
	height        uint64
	executionData []byte
}

func (r *originalProofReader) originalBFTTransactionHeight(ctx context.Context, o payproduct.NativePayOriginal, height int64, hash []byte) (uint64, bool, error) {
	v, e := r.originalBFTTransactionLocation(ctx, o, height, hash)
	return v.height, e == nil, e
}
func (r *originalProofReader) originalBFTTransactionLocation(ctx context.Context, o payproduct.NativePayOriginal, height int64, hash []byte) (originalBFTPayLocation, error) {
	if ctx == nil || r == nil || r.engine == nil || r.engine.engine != OriginalPayBFTEngine || r.engine.application == nil || len(hash) != 32 || height <= 0 {
		return originalBFTPayLocation{}, ErrPayEngineResources
	}
	if e := ctx.Err(); e != nil {
		return originalBFTPayLocation{}, e
	}
	app := r.engine.application
	if _, e := app.ConsensusAuthorityForState(r.chainID, height, hash); e != nil {
		return originalBFTPayLocation{}, e
	}
	// The original committed App, not a decoded history projection, fixes the
	// unique standalone BFT execution height and exact canonical envelope.
	location, e := app.CommittedPQExecutionForState(r.chainID, height, hash, o.NativeHash, o.Envelope)
	if e != nil {
		return originalBFTPayLocation{}, e
	}
	if location.NativeHash != o.NativeHash || location.ABCITransactionHash != o.ABCIHash || location.CommittedHeight != height || !bytes.Equal(location.CommittedAppHash[:], hash) || !bytes.Equal(location.Envelope, o.Envelope) || location.ExecutionHeight == 0 || location.ExecutionHeight > uint64(height) {
		return originalBFTPayLocation{}, ErrDenied
	}
	// Existing query is retained ONLY for canonical invoice-result DATA; it
	// supplies neither account authority nor the trusted execution locator.
	response, e := r.engine.application.Query(ctx, &abci.RequestQuery{Path: consensus.PQActionHistoryPath + o.NativeHash})
	if e != nil {
		return originalBFTPayLocation{}, e
	}
	if response == nil || response.Code != 0 || response.Height != height || len(response.Value) == 0 || len(response.Value) > consensus.MaxPQWalletQueryBytes {
		return originalBFTPayLocation{}, errProofUnavailable
	}
	var original consensus.PQActionHistoryView
	if json.Unmarshal(response.Value, &original) != nil || original.Authorization.CommittedHeight != height || original.Authorization.CommittedAppHash != hex.EncodeToString(hash) || original.Authorization.NetworkID != hex.EncodeToString(r.genesis) || r.nativeID == 0 || uint64(original.Authorization.NativeChainID) != r.nativeID || original.ABCITransactionHash != o.ABCIHash || !bytes.Equal(original.Transport, o.Envelope) {
		return originalBFTPayLocation{}, ErrDenied
	}
	tx, _, e := consensus.ValidatePQActionHistoryView(original, height)
	if e != nil {
		return originalBFTPayLocation{}, e
	}
	if tx.Hash != o.NativeHash || tx.BlockNum != location.ExecutionHeight || original.ExecutionHeight != location.ExecutionHeight {
		return originalBFTPayLocation{}, ErrDenied
	}
	data, e := consensus.PQInvoiceActionResult(original, height)
	if e != nil {
		return originalBFTPayLocation{}, e
	}
	if _, e = app.ConsensusAuthorityForState(r.chainID, height, hash); e != nil {
		return originalBFTPayLocation{}, e
	}
	if e = ctx.Err(); e != nil {
		return originalBFTPayLocation{}, e
	}
	return originalBFTPayLocation{height: location.ExecutionHeight, executionData: bytes.Clone(data)}, nil
}
