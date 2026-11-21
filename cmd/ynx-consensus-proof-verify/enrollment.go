//go:build unix

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const enrollmentContextVersion = "YNX-CONSENSUS-ENROLLMENT-PROOF-TRUST/v1"
const enrollmentRequestVersion = "YNX-CONSENSUS-ENROLLMENT-PROOF-VERIFY-REQUEST/v1"
const enrollmentResultVersion = "YNX-CONSENSUS-ENROLLMENT-PROOF-VERIFY-RESULT/v1"
const maxEnrollmentContextBytes = 2*maxTransactionExpectedBytes + (64 << 10)
const maxEnrollmentInputBytes = 2*consensus.MaxPQTransactionProofRequestBytes + (4 << 10)

type enrollmentPins struct {
	OriginalGenesis  string `json:"originalGenesis"`
	NativeChainID    string `json:"nativeChainId"`
	FundingSource    string `json:"fundingSource"`
	Owner            string `json:"owner"`
	FundingAmount    string `json:"fundingAmount"`
	PKA              string `json:"pka"`
	PKB              string `json:"pkb"`
	ActivationHeight string `json:"activationHeight"`
}
type enrollmentContext struct {
	Version               string              `json:"version"`
	LightTrust            trustContext        `json:"lightTrust"`
	Pins                  enrollmentPins      `json:"pins"`
	FundingExpected       transactionExpected `json:"fundingExpected"`
	MigrationExpected     transactionExpected `json:"migrationExpected"`
	FundingOriginalFile   string              `json:"fundingOriginalFile"`
	MigrationOriginalFile string              `json:"migrationOriginalFile"`
}
type enrollmentInput struct {
	Version        string          `json:"version"`
	FundingProof   json.RawMessage `json:"fundingProof"`
	MigrationProof json.RawMessage `json:"migrationProof"`
}
type enrollmentResult struct {
	Version            string                          `json:"version"`
	Code               string                          `json:"code"`
	Error              string                          `json:"error,omitempty"`
	OperationIdentity  string                          `json:"operationIdentity"`
	CurrentEligibility string                          `json:"currentEligibility"`
	NativeGrant        bool                            `json:"nativeGrant"`
	Result             *consensus.PQLabEnrollmentProof `json:"result,omitempty"`
}

func decodeEnrollmentContext(raw []byte, pin string) (enrollmentContext, consensus.PQLabEnrollmentPins, consensus.PQTransactionProofExpectation, consensus.PQTransactionProofExpectation, error) {
	var c enrollmentContext
	var p consensus.PQLabEnrollmentPins
	var f, m consensus.PQTransactionProofExpectation
	if len(raw) == 0 || len(raw) > maxEnrollmentContextBytes || !matchesSHA256(raw, pin) {
		return c, p, f, m, errors.New("independent context pin or size mismatch")
	}
	fields, err := strictTransactionObject(raw, &c)
	if err != nil || c.Version != enrollmentContextVersion {
		return c, p, f, m, errors.New("invalid enrollment context schema")
	}
	if len(fields["lightTrust"]) > 32<<10 {
		return c, p, f, m, errors.New("light context exceeds bound")
	}
	if err = strictStringObject(fields["lightTrust"], &c.LightTrust); err != nil {
		return c, p, f, m, err
	}
	if err = c.LightTrust.validate(); err != nil {
		return c, p, f, m, err
	}
	if err = strictStringObject(fields["pins"], &c.Pins); err != nil {
		return c, p, f, m, err
	}
	c.FundingExpected, f, err = decodeTransactionExpectedMode(fields["fundingExpected"], true)
	if err != nil {
		return c, p, f, m, err
	}
	c.MigrationExpected, m, err = decodeTransactionExpected(fields["migrationExpected"])
	if err != nil {
		return c, p, f, m, err
	}
	if c.FundingExpected.Block != c.LightTrust.expected() || m.TransactionType != consensus.PQMigrationType || (f.TransactionType != consensus.PQTransferType && f.TransactionType != consensus.PQLabLegacyFundingType) {
		return c, p, f, m, errors.New("original funding, migration and light target required")
	}
	if !canonicalAbsolutePath(c.FundingOriginalFile) || !canonicalAbsolutePath(c.MigrationOriginalFile) || c.FundingOriginalFile == c.MigrationOriginalFile {
		return c, p, f, m, errors.New("distinct original public transaction paths required")
	}
	p.OriginalGenesis, err = hash32(c.Pins.OriginalGenesis)
	if err != nil || c.Pins.OriginalGenesis != c.LightTrust.OriginalGenesisHash {
		return c, p, f, m, errors.New("native genesis differs from trust context")
	}
	p.NativeChainID, err = decimal(c.Pins.NativeChainID, math.MaxInt64, true)
	if err != nil {
		return c, p, f, m, err
	}
	p.FundingAmount, err = decimal(c.Pins.FundingAmount, math.MaxInt64, true)
	if err != nil {
		return c, p, f, m, err
	}
	p.ActivationHeight, err = decimal(c.Pins.ActivationHeight, math.MaxInt64, true)
	if err != nil {
		return c, p, f, m, err
	}
	p.FundingSource, p.Owner = c.Pins.FundingSource, c.Pins.Owner
	for _, v := range []struct {
		s    string
		size int
		out  *[]byte
	}{{c.Pins.PKA, ynxbatch.PublicKeyASize, &p.PKA}, {c.Pins.PKB, ynxbatch.PublicKeyBSize, &p.PKB}} {
		if len(v.s) != 4*((v.size+2)/3) {
			return c, p, f, m, errors.New("exact original full public keys required")
		}
		b, e := base64.StdEncoding.Strict().DecodeString(v.s)
		if e != nil || len(b) != v.size || base64.StdEncoding.EncodeToString(b) != v.s {
			return c, p, f, m, errors.New("exact original full public keys required")
		}
		*v.out = b
	}
	return c, p, f, m, nil
}

// Only verifies retained public historical data. No ID in this context proves
// an outbox identity; original funding/migration durable producers do not yet
// supply such a contract. UNKNOWN never grants retry, signing or reservation.
func runEnrollmentProof(args []string, input io.Reader, output io.Writer, localClock func() time.Time) int {
	fail := func(code, message string) int {
		_ = json.NewEncoder(output).Encode(enrollmentResult{Version: enrollmentResultVersion, Code: code, Error: message, OperationIdentity: "UNKNOWN", CurrentEligibility: "UNKNOWN"})
		return 1
	}
	o, err := parseOptions(args)
	if err != nil {
		return fail("INVALID_ARGUMENTS", "explicit independent context and hash required")
	}
	raw, err := readPublicFile(o.contextPath, maxEnrollmentContextBytes)
	if err != nil {
		return fail("TRUST_CONTEXT_INVALID", "independent enrollment context unavailable")
	}
	c, p, f, m, err := decodeEnrollmentContext(raw, o.contextSHA256)
	if err != nil {
		return fail("TRUST_CONTEXT_INVALID", "independent enrollment context rejected")
	}
	fund, err := readPublicFile(c.FundingOriginalFile, consensus.MaxPQContractTransactionBytes)
	if err != nil || !bytes.Equal(fund, f.Envelope) {
		return fail("ORIGINAL_INPUT_INVALID", "original funding bytes unavailable or changed")
	}
	migration, err := readPublicFile(c.MigrationOriginalFile, consensus.MaxPQContractTransactionBytes)
	if err != nil || !bytes.Equal(migration, m.Envelope) {
		return fail("ORIGINAL_INPUT_INVALID", "original migration bytes unavailable or changed")
	}
	requestRaw, err := io.ReadAll(io.LimitReader(input, maxEnrollmentInputBytes+1))
	if err != nil || len(requestRaw) > maxEnrollmentInputBytes {
		return fail("INVALID_REQUEST", "proof request exceeds bound")
	}
	var request enrollmentInput
	if _, err = strictTransactionObject(requestRaw, &request); err != nil || request.Version != enrollmentRequestVersion {
		return fail("INVALID_REQUEST", "exact enrollment proof request required")
	}
	fp, err := consensus.DecodePQTransactionProofRequest(request.FundingProof)
	if err != nil {
		return fail("INVALID_REQUEST", "invalid original funding proof")
	}
	mp, err := consensus.DecodePQTransactionProofRequest(request.MigrationProof)
	if err != nil {
		return fail("INVALID_REQUEST", "invalid original migration proof")
	}
	trust, err := c.LightTrust.load()
	if err != nil {
		return fail("TRUST_SOURCE_INVALID", "independently pinned trust inputs rejected")
	}
	if localClock == nil {
		return fail("TRUST_CONTEXT_INVALID", "local clock unavailable")
	}
	trust.Now = localClock().UTC()
	verified, err := consensus.VerifyPQLabEnrollmentOriginals(trust, p, consensus.PQLabEnrollmentOriginal{Expected: f, Proof: fp}, consensus.PQLabEnrollmentOriginal{Expected: m, Proof: mp})
	if err != nil {
		var rejected *consensus.PQLightProofError
		if errors.As(err, &rejected) {
			// Same bounded public stage/cause as the existing transaction CLI;
			// never echo original wire, proof, key material or arbitrary errors.
			return fail("PROOF_REJECTED", rejected.Error())
		}
		return fail("PROOF_REJECTED", "original enrollment proofs did not verify")
	}
	if err = json.NewEncoder(output).Encode(enrollmentResult{Version: enrollmentResultVersion, Code: "VERIFIED_HISTORICAL_DATA", OperationIdentity: "UNKNOWN", CurrentEligibility: "UNKNOWN", Result: &verified}); err != nil {
		return 1
	}
	return 0
}
