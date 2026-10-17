package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	// Bound each request/proof. Historical proofs follow the ledger's own storage
	// lifecycle, not an unrelated global admission quota or verification cache.
	MaxPQBatchBytes     = 8 << 20
	pqBatchMemberDomain = "YNX-NATIVE-BATCH-MEMBER/v1"
	pqBatchMemo         = "ynx-pq-batch-member-v1:"
)

// PQBatchProof is immutable authoritative history. Whole occurs once per batch;
// transactions carry only the hash/index reference. Results freeze the original
// partial business outcome, so retrying a committed batch never executes a
// previously rejected member against a later balance or nonce.
type PQBatchProof struct {
	Whole   []byte                `json:"whole"`
	Height  uint64                `json:"height"`
	Results []PQBatchMemberResult `json:"results"`
}

type PQBatchMemberResult struct {
	Index           uint32 `json:"index"`
	Outcome         string `json:"outcome"` // admitted or rejected; durability is separate
	TransactionHash string `json:"transactionHash,omitempty"`
	Error           string `json:"error,omitempty"`
}

type PQBatchResult struct {
	ExecutionHeight uint64                `json:"executionHeight,string"`
	BatchHash       string                `json:"batchHash"`
	Status          string                `json:"status"` // durable, memory, uncertain, not_committed, rejected
	Replayed        bool                  `json:"replayed"`
	Results         []PQBatchMemberResult `json:"results"`
}

func pqBatchHash(wire []byte) string {
	h := sha256.Sum256(wire)
	return "0x" + hex.EncodeToString(h[:])
}

// PQBatchTransactionHash freezes the application identity without changing the
// protocol wire. It is 0x || hex(SHA256(E(UTF8(domain), rawWholeSHA256, U32(index)))).
// E and U32 are the original four-byte protocol codec. Index is zero-based.
func PQBatchTransactionHash(batchHash string, index uint32) (string, error) {
	if !transactionHashPattern.MatchString(batchHash) || len(batchHash) != 66 || index >= ynxbatch.MaxN {
		return "", errors.New("invalid PQ batch reference")
	}
	raw, err := hex.DecodeString(batchHash[2:])
	if err != nil || "0x"+hex.EncodeToString(raw) != batchHash {
		return "", errors.New("noncanonical PQ batch hash")
	}
	wire, err := ynxbatch.EncodeFields([]byte(pqBatchMemberDomain), raw, ynxbatch.U32(index))
	if err != nil {
		return "", err
	}
	return pqBatchHash(wire), nil
}

func pqBatchMemberMemo(batchHash string, index uint32) string {
	// Fixed-width canonical hash followed by a canonical decimal index.
	return pqBatchMemo + batchHash + ":" + strconv.FormatUint(uint64(index), 10)
}

func clonePQBatches(input map[string]PQBatchProof) map[string]PQBatchProof {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]PQBatchProof, len(input))
	for hash, proof := range input {
		proof.Whole = bytes.Clone(proof.Whole)
		proof.Results = append([]PQBatchMemberResult(nil), proof.Results...)
		out[hash] = proof
	}
	return out
}

// pqBatchAdmission can only be created after both signatures and both complete
// trees have been checked. It remains private to this package and this call;
// no exported boolean, arbitrary signature callback or reusable admission token
// can bypass verification. The caller holds the ledger lock throughout its use.
type pqBatchAdmission struct {
	whole    ynxbatch.Whole
	verifier *ynxbatch.Verifier
	chainID  int64
	state    *ynxauth.State
	trusted  ynxauth.Record
	enableAt uint64
}

func authenticatePQBatch(wire []byte, state *ynxauth.State, height uint64, chainID int64) (*pqBatchAdmission, error) {
	if len(wire) == 0 || len(wire) > MaxPQBatchBytes {
		return nil, errors.New("PQ batch wire exceeds bound")
	}
	if state == nil || state.Version != ynxauth.PolicyVersion || height < state.EnableAt {
		return nil, ynxauth.ErrPolicy
	}
	if err := state.Validate(state.NetworkID); err != nil {
		return nil, err
	}
	w, err := ynxbatch.DecodeWhole(wire)
	if err != nil {
		return nil, err
	}
	cert, err := ynxbatch.EncodeCertificate(w.Certificate)
	if err != nil {
		return nil, err
	}
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: state.NetworkID, Purpose: ynxauth.TransactionPurpose, CacheEntries: 1, Optimized: true, ResolveTrustedOwner: func(req ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		r, ok := state.PolicyAt(req.Owner, req.Height)
		if !ok || req.Height < state.EnableAt {
			return ynxbatch.Registration{}, ynxauth.ErrPolicy
		}
		return ynxbatch.Registration{AlgorithmVersion: r.AlgorithmVersion, Owner: r.Owner, Purpose: ynxauth.TransactionPurpose, PolicyRevision: strconv.FormatUint(r.Revision, 10), ChainID: state.NetworkID, PKA: r.PKA, PKB: r.PKB, Enabled: true, ActiveFrom: r.ActiveFrom}, nil
	}})
	if err != nil {
		return nil, err
	}
	if err = v.VerifyWholeBatch(cert, w.Messages, height); err != nil {
		v.Clear()
		return nil, err
	}
	trusted, active := state.PolicyAt(w.Certificate.Owner, height)
	if !active {
		v.Clear()
		return nil, ynxauth.ErrPolicy
	}
	return &pqBatchAdmission{whole: w, verifier: v, chainID: chainID, state: state, trusted: trusted, enableAt: state.EnableAt}, nil
}

func (a *pqBatchAdmission) transfer(index uint32, height uint64) (ynxauth.Transfer, error) {
	if a == nil || a.verifier == nil || index >= a.whole.Certificate.N || int(index) >= len(a.whole.Messages) {
		return ynxauth.Transfer{}, errors.New("unknown PQ batch admission")
	}
	// Refresh complete trusted registration on every member without decoding or
	// copying the 57 KiB certificate again. The private object was constructed
	// only after genuine AND verification and complete dual-tree coverage.
	if a.state == nil || a.state.Version != ynxauth.PolicyVersion || a.state.EnableAt != a.enableAt || height < a.enableAt || !bytes.Equal(a.state.NetworkID, a.whole.Certificate.ChainID) || a.whole.Certificate.Purpose != ynxauth.TransactionPurpose {
		return ynxauth.Transfer{}, ynxauth.ErrPolicy
	}
	current, active := a.state.PolicyAt(a.whole.Certificate.Owner, height)
	if !active || !equalAccountPolicyRecord(current, a.trusted) || current.AlgorithmVersion != ynxbatch.Version || !bytes.Equal(current.PKA, a.whole.Certificate.PKA) || !bytes.Equal(current.PKB, a.whole.Certificate.PKB) {
		return ynxauth.Transfer{}, ynxauth.ErrPolicy
	}
	t, err := ynxauth.DecodeTransfer(a.whole.Messages[index])
	if err != nil {
		return t, err
	}
	if t.From != a.whole.Certificate.Owner || !bytes.Equal(t.ChainID, a.whole.Certificate.ChainID) || t.NativeChainID != uint64(a.chainID) || t.Fee != 1 {
		return t, errors.New("PQ batch member differs from network, owner or fixed fee")
	}
	return t, nil
}

func (d *Devnet) pqBatchReplayLocked(hash string, proof PQBatchProof) (PQBatchResult, error) {
	out := PQBatchResult{BatchHash: hash, ExecutionHeight: proof.Height, Results: append([]PQBatchMemberResult(nil), proof.Results...), Status: "durable", Replayed: true}
	if d.dataDir == "" {
		out.Status = "memory"
	}
	confirm := false
	for _, r := range proof.Results {
		if r.Outcome != "admitted" {
			continue
		}
		tx, ok := d.transactionLocked(r.TransactionHash)
		if !ok || tx.Memo != pqBatchMemberMemo(hash, r.Index) {
			return PQBatchResult{}, errors.New("PQ batch replay is missing its original transaction")
		}
		_, uncertain := d.uncertainTransactions[tx.Hash]
		confirm = confirm || uncertain || (d.dataDir != "" && !d.transactionCheckpointCovers(tx))
	}
	if confirm {
		if err := d.confirmTransactionPersistenceLocked(); err != nil {
			out.Status, out.Replayed = "uncertain", false
			return out, err
		}
	}
	return out, nil
}

// SubmitPQBatch verifies one complete WholeWire, then evaluates every member in
// index order using the current business state left by preceding successes.
// Business rejection is per member. All successes and their one shared proof
// use one existing durable snapshot checkpoint; persistence failure is not
// misreported as per-member business rejection or partial durable acceptance.
func (d *Devnet) SubmitPQBatch(wire []byte) (PQBatchResult, error) {
	if len(wire) == 0 || len(wire) > MaxPQBatchBytes {
		return PQBatchResult{}, errors.New("PQ batch wire exceeds bound")
	}
	wire = bytes.Clone(wire)
	hash := pqBatchHash(wire)
	d.mu.Lock()
	defer d.mu.Unlock()
	if old, ok := d.pqBatches[hash]; ok {
		if !bytes.Equal(old.Whole, wire) {
			return PQBatchResult{}, errors.New("PQ batch hash conflict")
		}
		return d.pqBatchReplayLocked(hash, old)
	}
	height := d.accountExecutionHeightLocked()
	a, err := authenticatePQBatch(wire, d.accountPolicy, height, d.cfg.ChainID)
	if err != nil {
		return PQBatchResult{}, err
	}
	defer a.verifier.Clear()
	out := PQBatchResult{BatchHash: hash, ExecutionHeight: height, Status: "rejected", Results: make([]PQBatchMemberResult, a.whole.Certificate.N)}
	undos := make([]transferUndo, 0, a.whole.Certificate.N)
	for index := range out.Results {
		r := PQBatchMemberResult{Index: uint32(index), Outcome: "rejected"}
		transfer, memberErr := a.transfer(r.Index, d.accountExecutionHeightLocked())
		if memberErr == nil {
			txHash, hashErr := PQBatchTransactionHash(hash, r.Index)
			memberErr = hashErr
			if memberErr == nil {
				if _, exists := d.transactionLocked(txHash); exists {
					memberErr = errors.New("PQ batch transaction already exists without its shared proof")
				}
			}
			if memberErr == nil {
				input := SignedTransferInput{Hash: txHash, From: transfer.From, To: transfer.To, Amount: int64(transfer.Amount), Fee: int64(transfer.Fee), Nonce: transfer.Nonce}
				var tx Transaction
				var undo transferUndo
				tx, undo, memberErr = d.applySignedTransferLocked(input, nil)
				if memberErr == nil {
					tx.Memo = pqBatchMemberMemo(hash, r.Index)
					d.pending[len(d.pending)-1] = tx
					undos = append(undos, undo)
					r.Outcome, r.TransactionHash = "admitted", tx.Hash
				}
			}
		}
		if memberErr != nil {
			r.Error = memberErr.Error()
			if len(r.Error) > 256 {
				r.Error = r.Error[:256]
			}
		}
		out.Results[index] = r
	}
	if len(undos) == 0 {
		// Nothing was applied or persisted, so this response promises no replay.
		return out, nil
	}
	if d.pqBatches == nil {
		d.pqBatches = make(map[string]PQBatchProof)
	}
	d.pqBatches[hash] = PQBatchProof{Whole: wire, Height: height, Results: append([]PQBatchMemberResult(nil), out.Results...)}
	err = d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	if err != nil {
		if errors.Is(err, ErrSnapshotDurabilityUncertain) {
			if d.uncertainTransactions == nil {
				d.uncertainTransactions = make(map[string]struct{})
			}
			for _, r := range out.Results {
				if r.Outcome == "admitted" {
					d.uncertainTransactions[r.TransactionHash] = struct{}{}
				}
			}
			out.Status = "uncertain"
		} else {
			for i := len(undos) - 1; i >= 0; i-- {
				d.rollbackTransferLocked(undos[i])
			}
			delete(d.pqBatches, hash)
			out.Status = "not_committed"
		}
		return out, err
	}
	d.uncertainTransactions = nil
	out.Status = "durable"
	if d.dataDir == "" {
		out.Status = "memory"
	}
	return out, nil
}

func validatePQBatchContinuation(previous, next map[string]PQBatchProof) error {
	for hash, old := range previous {
		current, ok := next[hash]
		if !ok || current.Height != old.Height || !bytes.Equal(current.Whole, old.Whole) || len(current.Results) != len(old.Results) {
			return errors.New("PQ shared proof history removal or rewrite rejected")
		}
		for i := range old.Results {
			if old.Results[i] != current.Results[i] {
				return fmt.Errorf("PQ batch %s outcome rewrite rejected", hash)
			}
		}
	}
	return nil
}
