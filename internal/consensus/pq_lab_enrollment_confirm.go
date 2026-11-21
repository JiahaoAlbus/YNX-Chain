//go:build unix

package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"golang.org/x/sys/unix"
)

// PQLabEnrollmentConfirmation contains independently verified historical DATA.
// It does not establish current target policy, nonce, spendable funds, signer
// custody, public deployment or permission to submit either transaction.
type PQLabEnrollmentConfirmation struct {
	Funding            PQLabProofExport     `json:"funding"`
	Migration          PQLabProofExport     `json:"migration"`
	Historical         PQLabEnrollmentProof `json:"historical"`
	FundingConfirmed   PQLabWorkloadFile    `json:"fundingConfirmed"`
	MigrationConfirmed PQLabWorkloadFile    `json:"migrationConfirmed"`
	CurrentEligibility string               `json:"currentEligibility"`
	AuthorityGranted   bool                 `json:"authorityGranted"`
}

// ConfirmPQLabEnrollmentOriginals verifies the two exact original signed byte
// files using independently captured normal proof materials. Both proofs must
// report successful execution and pass same-history validation before either
// CONFIRMED is written. On partial durable output retry only rechecks the exact
// original proof files; it never re-signs, broadcasts or replaces any original.
// Caller remains responsible for the independent provenance of its checkpoint
// and trusted light block, exactly as for existing PQLabSender.Confirm.
// Caller retains and must not concurrently mutate any request or proof inputs.
func (s *PQLabSender) ConfirmPQLabEnrollmentOriginals(r PQLabEnrollmentRequest, fundingMaterials, migrationMaterials PQLabProofMaterials, fundingProof, migrationProof PQTransactionProofRequest, now time.Time) (PQLabEnrollmentConfirmation, error) {
	var out PQLabEnrollmentConfirmation
	out.CurrentEligibility = "UNKNOWN"
	if s == nil {
		return out, errors.New("missing original synthetic sender")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key == nil || s.lease == nil {
		return out, errors.New("closed original synthetic sender")
	}
	r.PKA, r.PKB = bytes.Clone(r.PKA), bytes.Clone(r.PKB)
	original, err := s.recoverPQLabEnrollmentOriginalsLocked(r)
	if err != nil {
		return out, err
	}
	fd, _ := s.operation(r.FundingOperationID)
	md, _ := s.operation(r.MigrationOperationID)
	for _, entry := range []struct {
		dir      string
		expected PQTransactionProofExpectation
		kind     string
	}{{fd, fundingMaterials.Expected, PQTransferType}, {md, migrationMaterials.Expected, PQMigrationType}} {
		wire, e := pqLabRead(filepath.Join(entry.dir, "transaction.wire"), MaxPQWholeTransactionBytes)
		if e != nil {
			return out, ErrPQLabSenderUnknown
		}
		envelope, e := pqLabRead(filepath.Join(entry.dir, "transaction.abci"), MaxPQWholeTransactionBytes)
		if e != nil {
			return out, ErrPQLabSenderUnknown
		}
		if entry.expected.TransactionType != entry.kind || !bytes.Equal(entry.expected.NativeWire, wire) || !bytes.Equal(entry.expected.Envelope, envelope) {
			return out, errors.New("proof does not bind exact original signed operation")
		}
	}
	// The same independently captured checkpoint/authority must govern both;
	// only their pinned transaction targets may differ.
	first, second := fundingMaterials, migrationMaterials
	first.Expected = PQTransactionProofExpectation{}
	second.Expected = PQTransactionProofExpectation{}
	if !reflect.DeepEqual(first, second) || fundingMaterials.Pins.OriginalGenesisHash != s.manifest.OriginalGenesisHash || fundingMaterials.Pins.MigrationStateHash != s.manifest.MigrationStateHash {
		return out, errors.New("same original independently pinned trust materials required")
	}
	if err = validatePQLabProofMaterials(fundingMaterials, now); err != nil {
		return out, err
	}
	verifyOne := func(dir string, m PQLabProofMaterials, proof PQTransactionProofRequest) (PQLabProofExport, error) {
		proofDir := filepath.Join(dir, "confirmation-proof")
		if _, e := os.Lstat(proofDir); e == nil {
			return recheckPQLabProofInputs(proofDir, m, proof, now)
		} else if !os.IsNotExist(e) {
			return PQLabProofExport{}, e
		}
		return WritePQLabProofInputs(proofDir, m, proof, now)
	}
	out.Funding, err = verifyOne(fd, fundingMaterials, fundingProof)
	if err != nil {
		return out, fmt.Errorf("original funding proof: %w", err)
	}
	if !out.Funding.Result.Finalized || !out.Funding.Result.ExecutionSuccessful || out.Funding.Result.Outcome != "succeeded" || out.Funding.Result.NativeGrant {
		return out, errors.New("original funding finalized without successful execution")
	}
	out.Migration, err = verifyOne(md, migrationMaterials, migrationProof)
	if err != nil {
		return out, fmt.Errorf("original migration proof: %w", err)
	}
	if !out.Migration.Result.Finalized || !out.Migration.Result.ExecutionSuccessful || out.Migration.Result.Outcome != "succeeded" || out.Migration.Result.NativeGrant {
		return out, errors.New("original migration finalized without successful execution")
	}
	// Reconstruct the same normal immutable file source from the already retained
	// funding proof context; do not invent trust from the peer proof itself.
	var migration chain.ConsensusMigrationState
	if err = json.Unmarshal(fundingMaterials.Migration, &migration); err != nil {
		return out, err
	}
	bootstrap, err := NewConsensusBootstrap(fundingMaterials.Genesis, fundingMaterials.Pins, migration)
	if err != nil {
		return out, err
	}
	authorization, err := NewPQEngineAuthorization(fundingMaterials.Schedule, fundingMaterials.ScheduleHash)
	if err != nil {
		return out, err
	}
	source, err := NewPQEngineFileSource(migration, filepath.Join(fd, "confirmation-proof", "committed-state.json"), bootstrap, authorization)
	if err != nil {
		return out, err
	}
	authority, err := source.ConsensusAuthorityForState(bootstrap.record.ChainID, fundingMaterials.EngineHeight, fundingMaterials.EngineAppHash)
	if err != nil {
		return out, err
	}
	snapshot, ok := authority.(*PQEngineSnapshot)
	if !ok || snapshot == nil {
		return out, errors.New("normal source returned no committed PQ authority")
	}
	trusted, err := DecodePQTrustedLightBlock(fundingMaterials.TrustedLightBlock)
	if err != nil {
		return out, err
	}
	trust := PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: trusted, TrustingPeriod: fundingMaterials.TrustingPeriod, MaxClockDrift: fundingMaterials.MaxClockDrift, TrustLevel: cmtmath.Fraction{Numerator: fundingMaterials.TrustNumerator, Denominator: fundingMaterials.TrustDenominator}, Now: now}
	network, err := hex.DecodeString(s.manifest.OriginalGenesisHash)
	if err != nil {
		return out, err
	}
	pins := PQLabEnrollmentPins{OriginalGenesis: network, NativeChainID: uint64(PQLabNativeChainID), FundingSource: s.owner.Owner, Owner: r.TargetOwner, FundingAmount: r.FundingAmount, PKA: r.PKA, PKB: r.PKB, ActivationHeight: r.ActivationHeight}
	out.Historical, err = VerifyPQLabEnrollmentOriginals(trust, pins, PQLabEnrollmentOriginal{Expected: fundingMaterials.Expected, Proof: fundingProof}, PQLabEnrollmentOriginal{Expected: migrationMaterials.Expected, Proof: migrationProof})
	if err != nil {
		return out, fmt.Errorf("original enrollment history: %w", err)
	}
	if original.Request.FundingOperationID != r.FundingOperationID || original.Request.MigrationOperationID != r.MigrationOperationID {
		return out, ErrPQLabSenderUnknown
	}
	for _, entry := range []struct {
		dir   string
		value PQLabProofExport
	}{{fd, out.Funding}, {md, out.Migration}} {
		entry.value.Version = "YNX-PQ-LAB-ENROLLMENT-CONFIRMED/v1"
		raw, e := json.Marshal(entry.value)
		if e != nil {
			return out, e
		}
		path := filepath.Join(entry.dir, "CONFIRMED.json")
		if _, e = os.Lstat(path); e == nil {
			prior, readErr := s.readRecord(path)
			if readErr != nil || !bytes.Equal(prior, raw) {
				return out, ErrPQLabSenderUnknown
			}
			continue
		} else if !os.IsNotExist(e) {
			return out, ErrPQLabSenderUnknown
		}
		if e = s.writePQLabEnrollmentConfirmed(path, raw); e != nil {
			return out, errors.Join(ErrPQLabSenderUnknown, e)
		}
	}
	// Return hashes of the exact two authenticated, re-synced original record
	// files; this is evidence for the external owner's join, not a nonce grant.
	for _, entry := range []struct {
		dir   string
		value PQLabProofExport
		dest  *PQLabWorkloadFile
	}{{fd, out.Funding, &out.FundingConfirmed}, {md, out.Migration, &out.MigrationConfirmed}} {
		entry.value.Version = "YNX-PQ-LAB-ENROLLMENT-CONFIRMED/v1"
		body, e := json.Marshal(entry.value)
		if e != nil {
			return out, errors.Join(ErrPQLabSenderUnknown, e)
		}
		path := filepath.Join(entry.dir, "CONFIRMED.json")
		actual, e := s.readRecord(path)
		if e != nil || !bytes.Equal(actual, body) {
			return out, ErrPQLabSenderUnknown
		}
		raw, e := pqLabRead(path, 2<<20)
		if e != nil {
			return out, ErrPQLabSenderUnknown
		}
		canonical, e := json.Marshal(pqLabSenderRecord{Body: body, MAC: s.recordMAC(path, body)})
		if e != nil || !bytes.Equal(raw, canonical) {
			return out, ErrPQLabSenderUnknown
		}
		*entry.dest = pqLabFile("CONFIRMED.json", raw)
	}
	return out, nil
}

// Preserve exclusive create, file fsync and containing directory fsync. The
// private per-sender sync hooks inject actual barrier failures only in tests.
func (s *PQLabSender) writePQLabEnrollmentConfirmed(path string, body []byte) error {
	raw, err := json.Marshal(pqLabSenderRecord{Body: body, MAC: s.recordMAC(path, body)})
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	n, writeErr := f.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = io.ErrShortWrite
	}
	if writeErr == nil {
		if s.enrollmentConfirmedFileSync != nil {
			writeErr = s.enrollmentConfirmedFileSync(f)
		} else {
			writeErr = f.Sync()
		}
	}
	if err = errors.Join(writeErr, f.Close()); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	if s.enrollmentConfirmedDirectorySync != nil {
		err = s.enrollmentConfirmedDirectorySync(dir)
	} else {
		err = dir.Sync()
	}
	return errors.Join(err, dir.Close())
}

func syncPQLabEnrollmentConfirmed(path string) (resultErr error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(fd), "original-enrollment-confirmation")
	defer func() { resultErr = errors.Join(resultErr, f.Close()) }()
	dirFD, err := unix.Open(filepath.Dir(path), unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	dir := os.NewFile(uintptr(dirFD), "original-enrollment-confirmation-directory")
	defer func() { resultErr = errors.Join(resultErr, dir.Close()) }()
	info, statErr := f.Stat()
	current, pathErr := os.Lstat(path)
	if statErr != nil || pathErr != nil || !info.Mode().IsRegular() || !os.SameFile(info, current) {
		return errors.New("original confirmed file changed")
	}
	dirInfo, err := dir.Stat()
	if err != nil {
		return err
	}
	currentDir, err := os.Lstat(filepath.Dir(path))
	if err != nil || !os.SameFile(dirInfo, currentDir) {
		return errors.New("original confirmed directory changed")
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = dir.Sync(); err != nil {
		return err
	}
	after, err := os.Lstat(path)
	if err != nil || !after.Mode().IsRegular() || !os.SameFile(info, after) {
		return errors.New("original confirmed inode changed during barrier")
	}
	afterDir, err := os.Lstat(filepath.Dir(path))
	if err != nil || !os.SameFile(dirInfo, afterDir) {
		return errors.New("original confirmed directory changed during barrier")
	}
	return nil
}
