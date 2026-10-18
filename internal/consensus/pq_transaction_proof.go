package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/merkle"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	PQTransactionProofVersion            = "YNX-PQ-TRANSACTION-PROOF/v1"
	MaxPQTransactionProofRequestBytes    = 80 << 20
	MaxPQTransactionTxProofBytes         = 4*((MaxPQContractTransactionBytes+2)/3) + (64 << 10)
	MaxPQTransactionExecutionResultBytes = 1 << 20
	MaxPQTransactionExecutionProofBytes  = 32 << 10
)

// These are original Comet result/proof encodings. No field supplies trust,
// an execution target, a local clock, or a replacement authorization source.
// The larger transport bound accommodates existing contract material; it does
// not change any node, mempool, block, RPC, or gateway acceptance limit.
type PQTransactionProofRequest struct {
	Version          string              `json:"version"`
	Block            PQLightProofRequest `json:"block"`
	Successor        PQLightProofRequest `json:"successor"`
	TransactionProof []byte              `json:"transactionProof"`
	ExecutionResult  []byte              `json:"executionResult"`
	ExecutionProof   []byte              `json:"executionProof"`
}

// The host pins BOTH requested headers and the exact original transaction.
// Neither the untrusted proof nor an RPC acknowledgement may select them.
type PQTransactionProofExpectation struct {
	Block, Successor                                      PQLightProofExpectation
	TransactionType                                       string
	Envelope, NativeWire, TransactionHash, NativeWireHash []byte
	Index                                                 int64
}

type PQTransactionBatchResult struct {
	Index           uint32 `json:"index,string"`
	Outcome         string `json:"outcome"`
	TransactionHash string `json:"transactionHash"`
	Error           string `json:"error"`
}

// Finalized proves consensus commitment of inclusion and deterministic ABCI
// result, conditional on the supplied independent light trust. It is DATA, not
// an issuer/Native grant, effect replay, current account authority or deployment
// claim. Nonzero Code and partial Whole outcomes never release success.
type PQTransactionProofResult struct {
	Version             string                     `json:"version"`
	Classification      string                     `json:"classification"`
	Block               PQLightProofResult         `json:"block"`
	Successor           PQLightProofResult         `json:"successor"`
	TransactionType     string                     `json:"transactionType"`
	TransactionHash     string                     `json:"transactionHash"`
	NativeWireHash      string                     `json:"nativeWireHash"`
	Height              int64                      `json:"height,string"`
	Index               int64                      `json:"index,string"`
	Total               int64                      `json:"total,string"`
	ExecutionCode       uint32                     `json:"executionCode,string"`
	GasWanted           int64                      `json:"gasWanted,string"`
	GasUsed             int64                      `json:"gasUsed,string"`
	ExecutionData       []byte                     `json:"executionData"`
	Included            bool                       `json:"included"`
	Finalized           bool                       `json:"finalized"`
	ExecutionSuccessful bool                       `json:"executionSuccessful"`
	Outcome             string                     `json:"outcome"`
	BatchResults        []PQTransactionBatchResult `json:"batchResults,omitempty"`
	NativeGrant         bool                       `json:"nativeGrant"`
}

func (p PQTransactionProofRequest) validate() error {
	if p.Version != PQTransactionProofVersion || p.Block.validate() != nil || p.Successor.validate() != nil || len(p.TransactionProof) == 0 || len(p.TransactionProof) > MaxPQTransactionTxProofBytes || len(p.ExecutionResult) == 0 || len(p.ExecutionResult) > MaxPQTransactionExecutionResultBytes || len(p.ExecutionProof) == 0 || len(p.ExecutionProof) > MaxPQTransactionExecutionProofBytes {
		return pqLightFailure("invalid_proof", "invalid transaction proof version or bounded original proof fields")
	}
	return nil
}

func DecodePQTransactionProofRequest(raw []byte) (PQTransactionProofRequest, error) {
	var p PQTransactionProofRequest
	if len(raw) == 0 || len(raw) > MaxPQTransactionProofRequestBytes || pqLightUniqueJSON(raw) != nil || json.Unmarshal(raw, &p) != nil || p.validate() != nil {
		return p, pqLightFailure("invalid_proof", "invalid bounded transaction proof JSON")
	}
	canonical, err := json.Marshal(p)
	if err != nil || !pqLightJSONEquivalent(raw, canonical) {
		return PQTransactionProofRequest{}, pqLightFailure("invalid_proof", "unknown, missing or noncanonical transaction proof field")
	}
	return p, nil
}

// EncodePQTransactionExecutionProof only constructs the normal Comet proof.
// It grants no trust: the verifier must match its root to signed Header H+1.
// Logs, Info, events and Codespace are intentionally excluded by NewResults.
func EncodePQTransactionExecutionProof(results []*abci.ExecTxResult, index int) ([]byte, []byte, error) {
	if index < 0 || index >= len(results) || len(results) > 100000 {
		return nil, nil, errors.New("invalid bounded ABCI result index")
	}
	for _, result := range results {
		if result == nil || len(result.Data) > MaxPQTransactionExecutionResultBytes {
			return nil, nil, errors.New("missing or oversized ABCI result")
		}
	}
	deterministic := cmttypes.NewResults(results)
	raw, err := deterministic[index].Marshal()
	if err != nil || len(raw) == 0 || len(raw) > MaxPQTransactionExecutionResultBytes {
		return nil, nil, errors.New("invalid deterministic result encoding")
	}
	proof, err := cmtjson.Marshal(deterministic.ProveResult(index))
	if err != nil || len(proof) > MaxPQTransactionExecutionProofBytes {
		return nil, nil, errors.New("invalid execution proof encoding")
	}
	return raw, proof, nil
}

func pqTransactionComet(raw []byte, out any, limit int) error {
	if len(raw) == 0 || len(raw) > limit || pqLightUniqueJSON(raw) != nil || cmtjson.Unmarshal(raw, out) != nil {
		return pqLightFailure("invalid_proof", "invalid bounded Comet transaction proof")
	}
	if err := RestorePQCometSingleLeafAunts(raw, out); err != nil {
		return pqLightFailure("invalid_proof", err.Error())
	}
	canonical, err := cmtjson.Marshal(out)
	if err != nil || !pqLightJSONEquivalent(raw, canonical) {
		return pqLightFailure("invalid_proof", "noncanonical Comet transaction proof fields")
	}
	return nil
}

// RestorePQCometSingleLeafAunts preserves Comet's own single-leaf encoding
// after its Amino-compatible decoder converts an explicit empty slice to nil.
// Only these three proof DTOs, the exact aunts field, Total=1 and Index=0 are
// eligible. Callers still enforce bounded unique JSON, complete canonical
// fields, expected coordinates, Merkle roots and independent consensus trust.
// This is not general null/empty equivalence and grants no proof validity.
func RestorePQCometSingleLeafAunts(raw []byte, out any) error {
	var proof *merkle.Proof
	depth := 0
	switch value := out.(type) {
	case *coretypes.ResultTx:
		if value != nil {
			proof, depth = &value.Proof.Proof, 2
		}
	case *cmttypes.TxProof:
		if value != nil {
			proof, depth = &value.Proof, 1
		}
	case *merkle.Proof:
		proof = value
	default:
		return nil
	}
	if proof == nil {
		return errors.New("missing typed Comet proof")
	}
	for i := 0; i < depth; i++ {
		var nested struct {
			Proof json.RawMessage `json:"proof"`
		}
		if err := json.Unmarshal(raw, &nested); err != nil {
			return err
		}
		if len(nested.Proof) == 0 {
			return nil
		}
		raw = nested.Proof
	}
	var fields struct {
		Aunts json.RawMessage `json:"aunts"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	if len(fields.Aunts) == 0 {
		return nil
	}
	var aunts []json.RawMessage
	if err := json.Unmarshal(fields.Aunts, &aunts); err != nil {
		return err
	}
	if aunts == nil || len(aunts) != 0 {
		return nil
	}
	if proof.Total != 1 || proof.Index != 0 || len(proof.LeafHash) != sha256.Size || len(proof.Aunts) != 0 {
		return errors.New("empty Comet aunts require an exact single-leaf proof")
	}
	proof.Aunts = make([][]byte, 0)
	return nil
}

func pqTransactionWire(envelope []byte) (string, []byte, error) {
	if len(envelope) == 0 || len(envelope) > MaxPQContractTransactionBytes {
		return "", nil, errors.New("invalid bounded PQ envelope")
	}
	var route PQTransaction
	if json.Unmarshal(envelope, &route) != nil {
		return "", nil, errors.New("invalid PQ route")
	}
	if route.Type == PQActionType {
		wire, _, err := DecodePQActionTransport(envelope)
		return route.Type, wire, err
	}
	e, wire, err := DecodePQTransaction(envelope)
	if err != nil {
		return "", nil, err
	}
	// Preserve the executor's actual codecs and legal Member N/index. This is
	// structural identity parsing, not a substitute account-policy verifier.
	switch e.Type {
	case PQTransferType:
		var member ynxbatch.Member
		member, err = ynxbatch.DecodeMember(wire)
		if err == nil {
			_, err = ynxauth.DecodeTransfer(member.Message)
		}
	case PQMigrationType:
		_, err = ynxauth.DecodeMigration(wire)
	case PQRevocationType:
		_, err = ynxauth.DecodeRevocation(wire)
	case PQWholeType:
		_, err = ynxbatch.DecodeWhole(wire)
	case PQEthereumValueType:
		_, _, err = DecodePQEthereumValueTransaction(envelope)
	default:
		err = errors.New("unsupported PQ proof transaction type")
	}
	return e.Type, wire, err
}

func VerifyPQTransactionProof(trust PQLightProofTrust, expected PQTransactionProofExpectation, proof PQTransactionProofRequest) (PQTransactionProofResult, error) {
	var empty PQTransactionProofResult
	if err := proof.validate(); err != nil {
		return empty, err
	}
	h := expected.Block.HeaderHeight
	if h <= 0 || h >= math.MaxInt64-2 || expected.Successor.HeaderHeight != h+1 || expected.Block.ChainID != expected.Successor.ChainID || expected.Index < 0 || expected.Index > math.MaxUint32 || len(expected.TransactionHash) != 32 || len(expected.NativeWireHash) != 32 {
		return empty, pqLightFailure("anchor_mismatch", "independent adjacent headers, transaction hashes and index are required")
	}
	kind, wire, err := pqTransactionWire(expected.Envelope)
	outerHash, nativeHash := sha256.Sum256(expected.Envelope), sha256.Sum256(wire)
	if err != nil || kind != expected.TransactionType || !bytes.Equal(wire, expected.NativeWire) || !bytes.Equal(outerHash[:], expected.TransactionHash) || !bytes.Equal(nativeHash[:], expected.NativeWireHash) {
		return empty, pqLightFailure("anchor_mismatch", "exact independently requested PQ type, envelope and native wire identities differ")
	}
	var txProof cmttypes.TxProof
	var resultProof merkle.Proof
	if err = pqTransactionComet(proof.TransactionProof, &txProof, MaxPQTransactionTxProofBytes); err != nil {
		return empty, err
	}
	if err = pqTransactionComet(proof.ExecutionProof, &resultProof, MaxPQTransactionExecutionProofBytes); err != nil {
		return empty, err
	}
	if txProof.Proof.ValidateBasic() != nil || resultProof.ValidateBasic() != nil || txProof.Proof.Total <= 0 || txProof.Proof.Index != expected.Index || resultProof.Index != expected.Index || resultProof.Total != txProof.Proof.Total || expected.Index >= txProof.Proof.Total || !bytes.Equal(txProof.Data, expected.Envelope) || !bytes.Equal(txProof.Leaf(), expected.TransactionHash) {
		return empty, pqLightFailure("transaction_proof_invalid", "transaction/result index, total, leaf or exact original envelope mismatch")
	}
	var result abci.ExecTxResult
	if result.Unmarshal(proof.ExecutionResult) != nil {
		return empty, pqLightFailure("invalid_proof", "invalid deterministic execution result protobuf")
	}
	deterministic := cmttypes.NewResults([]*abci.ExecTxResult{&result})[0]
	resultBytes, err := deterministic.Marshal()
	if err != nil || !bytes.Equal(resultBytes, proof.ExecutionResult) {
		return empty, pqLightFailure("invalid_proof", "execution result must contain only canonical Code/Data/GasWanted/GasUsed")
	}
	blockResult, err := VerifyPQLightProof(trust, expected.Block, proof.Block)
	if err != nil {
		return empty, err
	}
	// Decode the already verified H without changing bytes. Its full set is
	// rebound by the same normal light verifier before the adjacent H+1 step.
	var block, successor coretypes.ResultCommit
	var members coretypes.ResultValidators
	if err = pqLightDecodeComet(proof.Block.CommitResult, "commit-result", &block, maxPQLightCommitBytes); err != nil {
		return empty, err
	}
	if err = pqLightDecodeComet(proof.Block.ValidatorsResult, "validators-result", &members, maxPQLightValidatorsBytes); err != nil {
		return empty, err
	}
	set := &cmttypes.ValidatorSet{Validators: members.Validators}
	for _, v := range set.Validators {
		if bytes.Equal(v.Address, block.ProposerAddress) {
			set.Proposer = v
		}
	}
	nextTrust := trust
	nextTrust.TrustedLightBlock = &cmttypes.LightBlock{SignedHeader: &block.SignedHeader, ValidatorSet: set}
	successorResult, err := VerifyPQLightProof(nextTrust, expected.Successor, proof.Successor)
	if err != nil {
		return empty, err
	}
	if err = pqLightDecodeComet(proof.Successor.CommitResult, "commit-result", &successor, maxPQLightCommitBytes); err != nil {
		return empty, err
	}
	if !successor.LastBlockID.Equals(block.Commit.BlockID) || !bytes.Equal(successor.LastCommitHash, block.Commit.Hash()) {
		return empty, pqLightFailure("header_link_invalid", "successor does not commit the exact preceding BlockID, PartSetHeader and commit")
	}
	if len(block.DataHash) != 32 || txProof.Validate(block.DataHash) != nil {
		return empty, pqLightFailure("transaction_proof_invalid", "transaction proof differs from the signed DataHash")
	}
	if len(successor.LastResultsHash) != 32 || resultProof.Verify(successor.LastResultsHash, resultBytes) != nil {
		return empty, pqLightFailure("execution_proof_invalid", "deterministic execution result differs from successor LastResultsHash")
	}
	outcome, successful, batch, err := pqTransactionOutcome(kind, wire, expected.Envelope, h, &result)
	if err != nil {
		return empty, pqLightFailure("execution_proof_invalid", err.Error())
	}
	return PQTransactionProofResult{Version: PQTransactionProofVersion, Classification: "data", Block: blockResult, Successor: successorResult, TransactionType: kind, TransactionHash: hex.EncodeToString(outerHash[:]), NativeWireHash: hex.EncodeToString(nativeHash[:]), Height: h, Index: expected.Index, Total: txProof.Proof.Total, ExecutionCode: result.Code, GasWanted: result.GasWanted, GasUsed: result.GasUsed, ExecutionData: bytes.Clone(result.Data), Included: true, Finalized: true, ExecutionSuccessful: successful, Outcome: outcome, BatchResults: batch, NativeGrant: false}, nil
}

func pqTransactionOutcome(kind string, wire, envelope []byte, height int64, result *abci.ExecTxResult) (string, bool, []PQTransactionBatchResult, error) {
	if kind != PQWholeType {
		if result.Code != 0 {
			if len(result.Data) != 0 {
				return "", false, nil, errors.New("rejected single PQ result must not carry success identity or effect data")
			}
			return "rejected", false, nil, nil
		}
		if !bytes.Equal(result.Data, []byte(SignedTransactionHash(envelope))) {
			return "", false, nil, errors.New("successful PQ result does not bind the original ABCI transaction hash")
		}
		return "succeeded", true, nil, nil
	}
	// Before batch admission fails, there may be no per-member result. A
	// committed nonzero code remains a terminal rejection, never a retry grant.
	if result.Code != 0 && len(result.Data) == 0 {
		return "rejected", false, nil, nil
	}
	whole, err := ynxbatch.DecodeWhole(wire)
	if err != nil {
		return "", false, nil, errors.New("invalid original Whole")
	}
	var data PQBatchExecutionResult
	if json.Unmarshal(result.Data, &data) != nil {
		return "", false, nil, errors.New("invalid committed Whole result data")
	}
	canonical, err := json.Marshal(data)
	if err != nil || !bytes.Equal(result.Data, canonical) || data.ABCITransactionHash != SignedTransactionHash(envelope) || data.BatchHash != SignedTransactionHash(wire) || data.ExecutionHeight != uint64(height) || len(data.Results) != len(whole.Messages) {
		return "", false, nil, errors.New("Whole result differs from original batch, height or canonical results")
	}
	admitted := 0
	results := make([]PQTransactionBatchResult, len(data.Results))
	for index, r := range data.Results {
		if r.Index != uint32(index) || len(r.Error) > 256 {
			return "", false, nil, errors.New("invalid Whole result index or error bound")
		}
		switch r.Outcome {
		case "admitted":
			hash, e := chain.PQBatchTransactionHash(data.BatchHash, r.Index)
			if e != nil || r.TransactionHash != hash || r.Error != "" {
				return "", false, nil, errors.New("admitted Whole member identity differs")
			}
			admitted++
		case "rejected":
			if r.TransactionHash != "" || r.Error == "" {
				return "", false, nil, errors.New("rejected Whole member carries an effect identity")
			}
		default:
			return "", false, nil, errors.New("unknown Whole member outcome")
		}
		results[index] = PQTransactionBatchResult{Index: r.Index, Outcome: r.Outcome, TransactionHash: r.TransactionHash, Error: r.Error}
	}
	if result.Code != 0 {
		if admitted != 0 {
			return "", false, nil, errors.New("failed Whole cannot report admitted effects")
		}
		return "rejected", false, results, nil
	}
	if admitted == 0 {
		return "", false, nil, errors.New("successful Whole must admit at least one member")
	}
	if admitted < len(results) {
		return "partial", false, results, nil
	}
	return "succeeded", true, results, nil
}
