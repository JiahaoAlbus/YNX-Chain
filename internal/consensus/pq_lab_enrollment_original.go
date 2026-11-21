//go:build unix

package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// PQLabEnrollmentRequest is a complete, externally chosen synthetic request.
// Both operation IDs are reserved under the existing sender's original lease.
// It is not a Wallet authorization, broadcast instruction or account proof.
type PQLabEnrollmentRequest struct {
	Version              string `json:"version"`
	FundingOperationID   string `json:"fundingOperationId"`
	MigrationOperationID string `json:"migrationOperationId"`
	OwnerIndex           int    `json:"ownerIndex"`
	FundingNonce         uint64 `json:"fundingNonce,string"`
	TargetOwner          string `json:"targetOwner"`
	FundingAmount        uint64 `json:"fundingAmount,string"`
	ActivationHeight     uint64 `json:"activationHeight,string"`
	PKA                  []byte `json:"pka"`
	PKB                  []byte `json:"pkb"`
}

// PQLabEnrollmentOriginalResult reports two signed original byte files, not
// submission, finality, usable balance, current authorization or a retry grant.
type PQLabEnrollmentOriginalResult struct {
	Version            string                 `json:"version"`
	Status             string                 `json:"status"`
	SyntheticOnly      bool                   `json:"syntheticOnly"`
	AuthorityGranted   bool                   `json:"authorityGranted"`
	CurrentEligibility string                 `json:"currentEligibility"`
	Request            PQLabEnrollmentRequest `json:"request"`
	CheckpointHeight   int64                  `json:"checkpointHeight,string"`
	CheckpointAppHash  string                 `json:"checkpointAppHash"`
	FundingWire        PQLabWorkloadFile      `json:"fundingWire"`
	FundingEnvelope    PQLabWorkloadFile      `json:"fundingEnvelope"`
	MigrationWire      PQLabWorkloadFile      `json:"migrationWire"`
	MigrationEnvelope  PQLabWorkloadFile      `json:"migrationEnvelope"`
}

type pqLabEnrollmentIntent struct {
	Version           string                 `json:"version"`
	Request           PQLabEnrollmentRequest `json:"request"`
	CheckpointHeight  int64                  `json:"checkpointHeight,string"`
	CheckpointAppHash string                 `json:"checkpointAppHash"`
	Registration      ynxbatch.Registration  `json:"registration"`
}

// SignPQLabEnrollmentOriginals is limited to an already-open original synthetic
// sender and its independent current checkpoint. Caller holds synthetic target
// keys and must keep them unchanged during this call; they are never persisted
// here. It never opens a network, submits, changes ledger state or recovers by
// signing. Both IDs, request and authenticated intent are made durable first.
// Every failure after creating either directory is UNKNOWN and no file is erased.
func (s *PQLabSender) SignPQLabEnrollmentOriginals(r PQLabEnrollmentRequest, checkpoint *PQLabSenderCheckpoint, classic *secp256k1.PrivateKey, proposed *ynxbatch.PrivateKey) (PQLabEnrollmentOriginalResult, error) {
	return s.signPQLabEnrollmentOriginals(r, checkpoint, classic, proposed, nil)
}

// fault is an unexported test seam; normal caller always passes nil.
func (s *PQLabSender) signPQLabEnrollmentOriginals(r PQLabEnrollmentRequest, checkpoint *PQLabSenderCheckpoint, classic *secp256k1.PrivateKey, proposed *ynxbatch.PrivateKey, fault func(string) error) (PQLabEnrollmentOriginalResult, error) {
	var empty PQLabEnrollmentOriginalResult
	if s == nil {
		return empty, errors.New("missing original synthetic sender")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key == nil || s.lease == nil || classic == nil || proposed == nil || r.Version != "YNX-PQ-LAB-ENROLLMENT-REQUEST/v1" || r.OwnerIndex != s.owner.Index || s.manifest.Mode != "online" || !s.manifest.SyntheticOnly || s.manifest.AuthorityGranted || s.manifest.NativeChainID != "642399" {
		return empty, errors.New("open original synthetic owner and keys required")
	}
	r.PKA, r.PKB = bytes.Clone(r.PKA), bytes.Clone(r.PKB)
	fundDir, err := s.operation(r.FundingOperationID)
	if err != nil {
		return empty, err
	}
	migrationDir, err := s.operation(r.MigrationOperationID)
	if err != nil || fundDir == migrationDir {
		return empty, errors.New("two distinct original operation IDs required")
	}
	for _, dir := range []string{fundDir, migrationDir} {
		if _, e := os.Lstat(dir); e == nil {
			return empty, ErrPQLabSenderUnknown
		} else if !os.IsNotExist(e) {
			return empty, e
		}
	}
	capacity, err := strconv.Atoi(s.owner.MemberCapacity)
	if err != nil || capacity < 1 || capacity > MaxPQLabTransfers || r.FundingNonce < 2 || r.FundingNonce > uint64(capacity)+1 {
		return empty, errors.New("original bounded nonce capacity required")
	}
	if len(r.PKA) != ynxbatch.PublicKeyASize || len(r.PKB) != ynxbatch.PublicKeyBSize || r.FundingAmount < 3 || r.FundingAmount > math.MaxInt64-1 {
		return empty, errors.New("bounded target keys and funding amount required")
	}
	target, err := NativeAddress(classic.PubKey().SerializeCompressed())
	if err != nil || target != r.TargetOwner || target == s.owner.Owner {
		return empty, errors.New("exact synthetic target classic owner required")
	}
	if checkpoint == nil || checkpoint.current == nil || checkpoint.state.AccountPolicy == nil || checkpoint.state.Height < 1 || checkpoint.state.Height >= math.MaxInt64-2 || checkpoint.migrationHash != s.manifest.MigrationStateHash || hex.EncodeToString(checkpoint.network) != s.manifest.OriginalGenesisHash || r.ActivationHeight <= uint64(checkpoint.state.Height+1) {
		return empty, errors.New("independent current original checkpoint and future activation required")
	}
	if err = checkpoint.current(); err != nil {
		return empty, err
	}
	index, exists := accountIndex(checkpoint.state.Accounts, s.owner.Owner)
	if !exists || checkpoint.state.Accounts[index].Nonce == math.MaxUint64 || checkpoint.state.Accounts[index].Nonce+1 != r.FundingNonce || checkpoint.state.Accounts[index].Balance < int64(r.FundingAmount)+1 {
		return empty, errors.New("original sponsor nonce or balance differs")
	}
	if _, exists = accountIndex(checkpoint.state.Accounts, target); exists {
		return empty, errors.New("synthetic enrollment target must be absent at original checkpoint")
	}
	reg, err := checkpoint.state.AccountPolicy.TrustedRegistration(s.owner.Owner, ynxauth.TransactionPurpose, uint64(checkpoint.state.Height+1))
	if err != nil || !bytes.Equal(reg.PKA, s.public.PKA) || !bytes.Equal(reg.PKB, s.public.PKB) {
		return empty, errors.New("original active synthetic sponsor keys required")
	}
	parent := filepath.Dir(fundDir)
	dir, err := os.Open(parent)
	if err != nil {
		return empty, err
	}
	entries, readErr := dir.ReadDir(2*capacity + 1)
	closeErr := dir.Close()
	if readErr != nil && readErr != io.EOF {
		return empty, readErr
	}
	if closeErr != nil {
		return empty, closeErr
	}
	// Both IDs consume entries in the original bounded history; no pruning.
	if len(entries)+2 > 2*capacity {
		return empty, errors.New("bounded original operation history full")
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return empty, errors.New("unexpected original sender history")
		}
		raw, e := s.readRecord(filepath.Join(parent, entry.Name(), "CONFIRMED.json"))
		if e != nil {
			return empty, ErrPQLabSenderUnknown
		}
		var confirmed PQLabProofExport
		if pqLabDecode(raw, &confirmed) != nil || !confirmed.Result.Finalized || confirmed.Result.NativeGrant || checkpoint.state.Height < confirmed.Result.Successor.HeaderHeight {
			return empty, errors.New("original sender confirmation unavailable or checkpoint regressed")
		}
	}
	unknown := func(e error) (PQLabEnrollmentOriginalResult, error) {
		return empty, errors.Join(ErrPQLabSenderUnknown, e)
	}
	step := func(stage string) error {
		if fault != nil {
			return fault(stage)
		}
		return nil
	}
	if err = pqLabFreshOperationDirectory(fundDir, nil, s.operationParentSync); err != nil {
		return empty, err
	}
	if err = step("fund-directory"); err != nil {
		return unknown(err)
	}
	if err = pqLabFreshOperationDirectory(migrationDir, nil, s.operationParentSync); err != nil {
		return unknown(err)
	}
	if err = step("migration-directory"); err != nil {
		return unknown(err)
	}
	requestRaw, err := json.Marshal(r)
	if err != nil {
		return unknown(err)
	}
	intentRaw, err := json.Marshal(pqLabEnrollmentIntent{Version: "YNX-PQ-LAB-ENROLLMENT-INTENT/v1", Request: r, CheckpointHeight: checkpoint.state.Height, CheckpointAppHash: checkpoint.state.AppHash, Registration: reg})
	if err != nil {
		return unknown(err)
	}
	for _, d := range []string{fundDir, migrationDir} {
		if err = pqLabWriteExclusive(filepath.Join(d, "request.json"), requestRaw); err != nil {
			return unknown(err)
		}
		if err = s.writeRecord(filepath.Join(d, "INTENT.json"), intentRaw); err != nil {
			return unknown(err)
		}
	}
	if err = step("intents"); err != nil {
		return unknown(err)
	}
	message, err := (ynxauth.Transfer{ChainID: checkpoint.network, NativeChainID: uint64(PQLabNativeChainID), From: s.owner.Owner, To: target, Amount: r.FundingAmount, Fee: 1, Nonce: r.FundingNonce}).SigningBytes()
	if err != nil {
		return unknown(err)
	}
	batch, err := ynxbatch.BatchSign(s.key, ynxbatch.Metadata{ChainID: checkpoint.network, Owner: s.owner.Owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return unknown(err)
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		batch.Discard()
		return unknown(err)
	}
	fundWire, err := ynxbatch.EncodeMember(member)
	batch.Discard()
	if err != nil {
		return unknown(err)
	}
	verifier, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: checkpoint.network, Purpose: ynxauth.TransactionPurpose, ResolveTrustedOwner: func(q ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		if q.Owner != s.owner.Owner || q.Height != uint64(checkpoint.state.Height+1) {
			return ynxbatch.Registration{}, ErrPQLabSenderUnknown
		}
		return reg, nil
	}})
	if err != nil {
		return unknown(err)
	}
	if err = verifier.VerifyOne(fundWire, uint64(checkpoint.state.Height+1)); err != nil {
		return unknown(err)
	}
	fundEnvelope, err := EncodePQTransaction(PQTransferType, fundWire)
	if err != nil {
		return unknown(err)
	}
	if err = pqLabWriteExclusive(filepath.Join(fundDir, "transaction.wire"), fundWire); err != nil {
		return unknown(err)
	}
	if err = pqLabWriteExclusive(filepath.Join(fundDir, "transaction.abci"), fundEnvelope); err != nil {
		return unknown(err)
	}
	if err = step("funding-signed"); err != nil {
		return unknown(err)
	}
	migrationIntent := ynxauth.RegistrationIntent{ChainID: checkpoint.network, Owner: target, PKA: r.PKA, PKB: r.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: r.ActivationHeight}
	migrationMessage, err := migrationIntent.SigningBytes()
	if err != nil {
		return unknown(err)
	}
	popBatch, err := ynxbatch.BatchSign(proposed, ynxbatch.Metadata{ChainID: checkpoint.network, Owner: target, Purpose: ynxauth.MigrationPurpose}, [][]byte{migrationMessage}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return unknown(err)
	}
	pop, err := popBatch.WholeWire()
	popBatch.Discard()
	if err != nil {
		return unknown(err)
	}
	digest := sha256.Sum256(migrationMessage)
	migration := ynxauth.Migration{Intent: migrationIntent, ClassicPublicKey: classic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(classic, digest[:]).Serialize(), NewKeyProof: pop}
	if _, err = checkpoint.state.AccountPolicy.AdmitMigration(migration, uint64(checkpoint.state.Height+1), 0); err != nil {
		return unknown(err)
	}
	migrationWire, err := migration.Encode()
	if err != nil {
		return unknown(err)
	}
	migrationEnvelope, err := EncodePQTransaction(PQMigrationType, migrationWire)
	if err != nil {
		return unknown(err)
	}
	if err = pqLabWriteExclusive(filepath.Join(migrationDir, "transaction.wire"), migrationWire); err != nil {
		return unknown(err)
	}
	if err = pqLabWriteExclusive(filepath.Join(migrationDir, "transaction.abci"), migrationEnvelope); err != nil {
		return unknown(err)
	}
	if err = step("migration-signed"); err != nil {
		return unknown(err)
	}
	if err = checkpoint.current(); err != nil {
		return unknown(err)
	}
	result := PQLabEnrollmentOriginalResult{Version: "YNX-PQ-LAB-ENROLLMENT-RESULT/v1", Status: "signed-originals", SyntheticOnly: true, CurrentEligibility: "UNKNOWN", Request: r, CheckpointHeight: checkpoint.state.Height, CheckpointAppHash: checkpoint.state.AppHash, FundingWire: pqLabFile("transaction.wire", fundWire), FundingEnvelope: pqLabFile("transaction.abci", fundEnvelope), MigrationWire: pqLabFile("transaction.wire", migrationWire), MigrationEnvelope: pqLabFile("transaction.abci", migrationEnvelope)}
	resultRaw, err := json.Marshal(result)
	if err != nil {
		return unknown(err)
	}
	for _, d := range []string{fundDir, migrationDir} {
		if err = s.writeRecord(filepath.Join(d, "RESULT.json"), resultRaw); err != nil {
			return unknown(err)
		}
		if err = step("result-" + filepath.Base(d)); err != nil {
			return unknown(err)
		}
	}
	return result, nil
}

// RecoverPQLabEnrollmentOriginals is read-only and never signs, reconstructs,
// replaces or removes any part of an incomplete/UNKNOWN operation.
// The caller must not mutate request slices concurrently with the call.
func (s *PQLabSender) RecoverPQLabEnrollmentOriginals(r PQLabEnrollmentRequest) (PQLabEnrollmentOriginalResult, error) {
	var empty PQLabEnrollmentOriginalResult
	if s == nil {
		return empty, errors.New("missing original synthetic sender")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key == nil || s.lease == nil {
		return empty, errors.New("closed original synthetic sender")
	}
	r.PKA, r.PKB = bytes.Clone(r.PKA), bytes.Clone(r.PKB)
	return s.recoverPQLabEnrollmentOriginalsLocked(r)
}

func (s *PQLabSender) recoverPQLabEnrollmentOriginalsLocked(r PQLabEnrollmentRequest) (PQLabEnrollmentOriginalResult, error) {
	var empty PQLabEnrollmentOriginalResult
	fundDir, err := s.operation(r.FundingOperationID)
	if err != nil {
		return empty, err
	}
	migrationDir, err := s.operation(r.MigrationOperationID)
	if err != nil || fundDir == migrationDir {
		return empty, ErrPQLabSenderUnknown
	}
	requestRaw, err := json.Marshal(r)
	if err != nil {
		return empty, ErrPQLabSenderUnknown
	}
	var resultRaw []byte
	for _, d := range []string{fundDir, migrationDir} {
		raw, e := pqLabRead(filepath.Join(d, "request.json"), 16<<10)
		if e != nil || !bytes.Equal(raw, requestRaw) {
			return empty, ErrPQLabSenderUnknown
		}
		intent, e := s.readRecord(filepath.Join(d, "INTENT.json"))
		if e != nil {
			return empty, ErrPQLabSenderUnknown
		}
		var parsed pqLabEnrollmentIntent
		if pqLabDecode(intent, &parsed) != nil || parsed.Version != "YNX-PQ-LAB-ENROLLMENT-INTENT/v1" {
			return empty, ErrPQLabSenderUnknown
		}
		intentRequest, e := json.Marshal(parsed.Request)
		if e != nil || !bytes.Equal(intentRequest, requestRaw) {
			return empty, ErrPQLabSenderUnknown
		}
		raw, e = s.readRecord(filepath.Join(d, "RESULT.json"))
		if e != nil {
			return empty, ErrPQLabSenderUnknown
		}
		if resultRaw != nil && !bytes.Equal(resultRaw, raw) {
			return empty, ErrPQLabSenderUnknown
		}
		resultRaw = raw
	}
	var result PQLabEnrollmentOriginalResult
	if pqLabDecode(resultRaw, &result) != nil || result.Version != "YNX-PQ-LAB-ENROLLMENT-RESULT/v1" || result.Status != "signed-originals" || !result.SyntheticOnly || result.AuthorityGranted || result.CurrentEligibility != "UNKNOWN" || result.Request.OwnerIndex != s.owner.Index {
		return empty, ErrPQLabSenderUnknown
	}
	resultRequest, err := json.Marshal(result.Request)
	if err != nil || !bytes.Equal(resultRequest, requestRaw) {
		return empty, ErrPQLabSenderUnknown
	}
	for _, item := range []struct {
		dir  string
		file PQLabWorkloadFile
	}{{fundDir, result.FundingWire}, {fundDir, result.FundingEnvelope}, {migrationDir, result.MigrationWire}, {migrationDir, result.MigrationEnvelope}} {
		if item.file.Path != "transaction.wire" && item.file.Path != "transaction.abci" {
			return empty, ErrPQLabSenderUnknown
		}
		raw, e := pqLabRead(filepath.Join(item.dir, item.file.Path), MaxPQWholeTransactionBytes)
		if e != nil || pqLabFile(item.file.Path, raw) != item.file {
			return empty, ErrPQLabSenderUnknown
		}
	}
	return result, nil
}
