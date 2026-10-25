package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func pqCaseVerifierSelected(o options) bool {
	return o.pqProofVerifier != "" || o.pqProofVerifierSHA256 != "" || o.pqTrustContext != "" || o.pqTrustContextSHA256 != ""
}
func validatePQCaseVerifierOptions(o options) error {
	if !pqCaseVerifierSelected(o) {
		return nil
	}
	if !o.pqReadbackOnly || !o.pqCollectProof || (o.pqMemberWire == "" && o.pqRegistrationWire == "") || !filepath.IsAbs(o.pqProofVerifier) || !filepath.IsAbs(o.pqTrustContext) || !pqCaseHashPin(o.pqProofVerifierSHA256) || !pqCaseHashPin(o.pqTrustContextSHA256) {
		return errors.New("offline verification requires readback-only transfer/registration proof collection, original absolute verifier/context paths and independent SHA256 pins")
	}
	return nil
}
func pqCaseHashPin(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32 && hex.EncodeToString(b) == s && s != strings.Repeat("0", 64)
}

func readPQCasePinned(path, pin string, limit int64, executable bool) ([]byte, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("original absolute canonical file path required")
	}
	actual, e := filepath.EvalSymlinks(path)
	if e != nil || actual != path {
		return nil, errors.New("original file must not traverse a symlink")
	}
	before, e := os.Stat(path)
	if e != nil {
		return nil, e
	}
	if !before.Mode().IsRegular() || before.Mode().Perm()&0022 != 0 || executable && before.Mode().Perm()&0111 == 0 {
		return nil, errors.New("original pinned file permissions/type differ")
	}
	raw, e := readBounded(path, limit)
	if e != nil {
		return nil, e
	}
	after, e := os.Stat(path)
	if e != nil || !os.SameFile(before, after) || before.Size() != after.Size() || before.ModTime() != after.ModTime() {
		return nil, errors.New("original pinned file changed")
	}
	hash := sha256.Sum256(raw)
	if !pqCaseHashPin(pin) || hex.EncodeToString(hash[:]) != pin {
		return nil, errors.New("original file differs from independent SHA256")
	}
	return raw, nil
}

// The executable is only hashed, never decoded. Stream the same complete
// bytes before AND after execution, without allocating an executable-sized
// buffer or changing the independent pin and original-file checks.
func verifyPQCaseExecutablePin(path, pin string, limit int64) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || !pqCaseHashPin(pin) {
		return errors.New("original executable path and independent SHA256 required")
	}
	actual, e := filepath.EvalSymlinks(path)
	if e != nil || actual != path {
		return errors.New("original executable must not traverse a symlink")
	}
	before, e := os.Lstat(path)
	if e != nil {
		return e
	}
	if !before.Mode().IsRegular() || before.Mode().Perm()&0022 != 0 || before.Mode().Perm()&0111 == 0 || before.Size() > limit {
		return errors.New("original executable permissions/type/size differ")
	}
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	opened, e := f.Stat()
	if e != nil || !os.SameFile(before, opened) {
		return errors.New("original executable changed while opening")
	}
	h := sha256.New()
	n, e := io.CopyBuffer(h, io.LimitReader(f, limit+1), make([]byte, 32<<10))
	if e != nil {
		return e
	}
	after, e := f.Stat()
	if e != nil {
		return e
	}
	named, e := os.Lstat(path)
	if e != nil || !os.SameFile(before, after) || !os.SameFile(after, named) || before.Size() != n || n > limit || before.Size() != after.Size() || before.ModTime() != after.ModTime() || before.Mode() != after.Mode() || after.ModTime() != named.ModTime() || after.Mode() != named.Mode() {
		return errors.New("original executable changed while hashing")
	}
	if hex.EncodeToString(h.Sum(nil)) != pin {
		return errors.New("original executable differs from independent SHA256")
	}
	return nil
}

// Extract only the original externally pinned expectation. The unchanged
// canonical CLI validates its complete schema, source loaders and light trust.
// No expected header, authority, time or transaction is selected by RPC.
func pqCaseVerificationRequest(o options, p pqWholeCase, r *pqWholeCaseReport) ([]byte, error) {
	raw, e := readPQCasePinned(o.pqTrustContext, o.pqTrustContextSHA256, 4<<20, false)
	if e != nil {
		return nil, e
	}
	var contextFields map[string]json.RawMessage
	if e = strictJSON(raw, &contextFields); e != nil {
		return nil, e
	}
	var version string
	json.Unmarshal(contextFields["version"], &version)
	if version != "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1" {
		return nil, errors.New("original transaction trust context required")
	}
	expectedRaw := contextFields["expectedTransaction"]
	var expected struct {
		Block, Successor     json.RawMessage
		TransactionType      string `json:"transactionType"`
		Envelope, NativeWire []byte
		TransactionHash      string `json:"transactionHash"`
		NativeWireHash       string `json:"nativeWireHash"`
		Index                string `json:"index"`
	}
	if e = strictJSON(expectedRaw, &expected); e != nil {
		return nil, e
	}
	payload, e := consensus.EncodePQTransaction(p.kind, p.wire)
	if e != nil {
		return nil, e
	}
	var block struct {
		HeaderHeight string `json:"headerHeight"`
	}
	if e = json.Unmarshal(expected.Block, &block); e != nil {
		return nil, e
	}
	if r.CometIndex == nil || expected.TransactionType != p.kind || !bytes.Equal(expected.Envelope, payload) || !bytes.Equal(expected.NativeWire, p.wire) || expected.TransactionHash != strings.TrimPrefix(p.outer, "0x") || expected.NativeWireHash != strings.TrimPrefix(p.native, "0x") || expected.Index != strconv.FormatUint(uint64(*r.CometIndex), 10) || block.HeaderHeight != strconv.FormatUint(r.ExecutionHeight, 10) {
		return nil, errors.New("independent target differs from original transaction and observed coordinates")
	}
	proofRaw, e := readBounded(r.ProofEvidencePath, consensus.MaxPQTransactionProofRequestBytes+(64<<10))
	if e != nil {
		return nil, e
	}
	h := sha256.Sum256(proofRaw)
	if hex.EncodeToString(h[:]) != r.ProofEvidenceSHA256 {
		return nil, errors.New("original collector evidence changed")
	}
	var v bftgateway.PQFinalityView
	if e = strictJSON(proofRaw, &v); e != nil {
		return nil, e
	}
	if e = p.validateCollectedProof(v, r); e != nil {
		return nil, e
	}
	// Keep nested original proof bytes as received, not a normalized replacement.
	var fields map[string]json.RawMessage
	if e = json.Unmarshal(proofRaw, &fields); e != nil {
		return nil, e
	}
	return json.Marshal(struct {
		Version  string          `json:"version"`
		Expected json.RawMessage `json:"expected"`
		Proof    json.RawMessage `json:"proof"`
	}{"YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1", expectedRaw, fields["proof"]})
}

type pqCaseVerifierOutput struct {
	Version string                              `json:"version"`
	Code    string                              `json:"code"`
	Error   string                              `json:"error,omitempty"`
	Result  *consensus.PQTransactionProofResult `json:"result,omitempty"`
}
type pqCaseBoundedCapture struct{ bytes.Buffer }

func (w *pqCaseBoundedCapture) Write(p []byte) (int, error) {
	if w.Len()+len(p) > 4<<20 {
		return 0, errors.New("original verifier output exceeded bound")
	}
	return w.Buffer.Write(p)
}

func verifyPQCaseCollectedProof(ctx context.Context, o options, p pqWholeCase, r *pqWholeCaseReport) {
	start := time.Now()
	defer func() { r.ProofVerificationNs = time.Since(start).Nanoseconds() }()
	r.ProofVerificationStatus = "rejected"
	r.ProofVerifierSHA256, r.TrustContextSHA256 = o.pqProofVerifierSHA256, o.pqTrustContextSHA256
	r.IndependentFinalityVerified = false
	r.ConfiguredRPCObservationOnly = true
	r.EffectiveBusinessFinalized = 0
	r.RegistrationFinalized = false
	r.ConsensusExecutionOutcome = ""
	r.FinalizedBusinessHashes = nil
	r.VerifierProcessStarted, r.VerifierInterrupted, r.VerifierExitCode = false, false, nil
	fail := func(e error) { r.ProofVerificationError = e.Error() }
	if e := ctx.Err(); e != nil {
		r.VerifierInterrupted = true
		fail(e)
		return
	}
	input, e := pqCaseVerificationRequest(o, p, r)
	if e != nil {
		fail(e)
		return
	}
	if e = verifyPQCaseExecutablePin(o.pqProofVerifier, o.pqProofVerifierSHA256, 128<<20); e != nil {
		fail(e)
		return
	}
	r.VerifierPreparationNs = time.Since(start).Nanoseconds()
	cmd := exec.CommandContext(ctx, o.pqProofVerifier, "--trust-context", o.pqTrustContext, "--trust-context-sha256", o.pqTrustContextSHA256)
	cmd.Stdin = bytes.NewReader(input)
	var output, diagnostic pqCaseBoundedCapture
	cmd.Stdout = &output
	cmd.Stderr = &diagnostic
	phaseStart := time.Now()
	executionErr := cmd.Run()
	r.VerifierProcessStarted = cmd.Process != nil
	r.VerifierInterrupted = ctx.Err() != nil
	if cmd.ProcessState != nil {
		code := cmd.ProcessState.ExitCode()
		r.VerifierExitCode = &code
	}
	r.VerifierProcessNs = time.Since(phaseStart).Nanoseconds()
	phaseStart = time.Now()
	path := o.output + ".pq-verification.json"
	if e = persistPQCaseProof(path, output.Bytes()); e != nil {
		fail(e)
		return
	}
	r.VerifierEvidenceDurabilityNs = time.Since(phaseStart).Nanoseconds()
	phaseStart = time.Now()
	defer func() { r.VerifierResultValidationNs = time.Since(phaseStart).Nanoseconds() }()
	hash := sha256.Sum256(output.Bytes())
	r.VerifierEvidencePath, r.VerifierEvidenceSHA256 = path, hex.EncodeToString(hash[:])
	if executionErr != nil {
		fail(fmt.Errorf("original verifier rejected proof or execution was interrupted: %w", executionErr))
		return
	}
	if e = verifyPQCaseExecutablePin(o.pqProofVerifier, o.pqProofVerifierSHA256, 128<<20); e != nil {
		fail(e)
		return
	}
	if _, e = readPQCasePinned(o.pqTrustContext, o.pqTrustContextSHA256, 4<<20, false); e != nil {
		fail(e)
		return
	}
	var v pqCaseVerifierOutput
	if e = strictJSON(output.Bytes(), &v); e != nil {
		fail(e)
		return
	}
	identities, e := p.verifiedBusinessIdentities(v, r)
	if e != nil {
		fail(e)
		return
	}
	r.ConsensusExecutionOutcome = v.Result.Outcome
	r.FinalizedBusinessHashes = identities
	r.EffectiveBusinessFinalized = len(identities)
	r.RegistrationFinalized = p.kind == consensus.PQInitialRegistrationType && v.Result.ExecutionSuccessful
	r.IndependentFinalityVerified = true
	r.ConfiguredRPCObservationOnly = false
	r.ProofVerificationStatus = "verified_original_transaction"
	// Observation starts at this explicit readback invocation. It cannot recover
	// original offer-to-finality latency or establish sustained throughput.
}

// Only the original verifier's fully bound consensus result reaches this
// classifier. A partial Whole is never N successful businesses; birth and a
// proven terminal rejection contribute zero. Expose original effect hashes so
// repeat readbacks can be deduplicated by the existing evidence consumer.
func (p pqWholeCase) verifiedBusinessIdentities(v pqCaseVerifierOutput, r *pqWholeCaseReport) ([]string, error) {
	result := v.Result
	if v.Version != "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-RESULT/v1" || v.Error != "" || result == nil || result.Version != consensus.PQTransactionProofVersion || result.Classification != "data" || !result.Included || !result.Finalized || result.NativeGrant || result.TransactionType != p.kind || result.TransactionHash != strings.TrimPrefix(p.outer, "0x") || result.NativeWireHash != strings.TrimPrefix(p.native, "0x") || result.Height != int64(r.ExecutionHeight) || r.CometIndex == nil || result.Index != int64(*r.CometIndex) || !result.Block.CommitVerified || !result.Successor.CommitVerified || !result.Block.LightTransitionVerified || !result.Successor.LightTransitionVerified {
		return nil, errors.New("canonical verifier result differs from original transaction finality")
	}
	switch result.Outcome {
	case "rejected":
		if v.Code != "VERIFIED_TRANSACTION_REJECTED_DATA" || result.ExecutionSuccessful || result.ExecutionCode == 0 {
			return nil, errors.New("terminal rejection code differs")
		}
		for _, row := range result.BatchResults {
			if row.Outcome != "rejected" || row.TransactionHash != "" {
				return nil, errors.New("rejected transaction carries business effects")
			}
		}
		return nil, nil
	case "succeeded":
		if v.Code != "VERIFIED_TRANSACTION_DATA" || !result.ExecutionSuccessful || result.ExecutionCode != 0 {
			return nil, errors.New("successful execution code differs")
		}
	case "partial":
		if p.kind != consensus.PQWholeType || v.Code != "VERIFIED_TRANSACTION_PARTIAL_DATA" || result.ExecutionSuccessful || result.ExecutionCode != 0 {
			return nil, errors.New("partial execution code differs")
		}
	default:
		return nil, errors.New("unknown canonical execution outcome")
	}
	if p.kind == consensus.PQInitialRegistrationType {
		if len(result.BatchResults) != 0 {
			return nil, errors.New("birth carries batch effects")
		}
		return nil, nil
	}
	if p.kind == consensus.PQTransferType {
		if len(result.BatchResults) != 0 {
			return nil, errors.New("single transfer carries batch effects")
		}
		return []string{p.native}, nil
	}
	if p.kind != consensus.PQWholeType || len(result.BatchResults) != len(p.members) {
		return nil, errors.New("Whole proof lacks complete original ordered results")
	}
	var effects []string
	for i, row := range result.BatchResults {
		if row.Index != uint32(i) {
			return nil, errors.New("Whole proof result order differs")
		}
		switch row.Outcome {
		case "admitted":
			if row.TransactionHash != p.members[i] || row.Error != "" {
				return nil, errors.New("admitted Whole effect differs")
			}
			effects = append(effects, row.TransactionHash)
		case "rejected":
			if row.TransactionHash != "" || strings.TrimSpace(row.Error) == "" {
				return nil, errors.New("rejected Whole member carries effect or lacks reason")
			}
		default:
			return nil, errors.New("unknown Whole member outcome")
		}
	}
	if len(effects) == 0 || result.Outcome == "partial" && len(effects) == len(p.members) || result.Outcome == "succeeded" && len(effects) != len(p.members) {
		return nil, errors.New("Whole outcome differs from admitted effect coverage")
	}
	return effects, nil
}
