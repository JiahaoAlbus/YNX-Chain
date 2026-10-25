//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"reflect"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const (
	transactionContextVersion = "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1"
	transactionRequestVersion = "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1"
	transactionResultVersion  = "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-RESULT/v1"
	// These are proof transport bounds only. Actual original-envelope codecs
	// and the node's existing admission bounds are still checked by the core.
	maxTransactionExpectedBytes = 4*((consensus.MaxPQContractTransactionBytes+2)/3) + 4*((chain.MaxPQBatchBytes+2)/3) + (8 << 10)
	maxTransactionContextBytes  = maxTransactionExpectedBytes + (32 << 10) + 1024
	maxTransactionInputBytes    = consensus.MaxPQTransactionProofRequestBytes + maxTransactionExpectedBytes + 1024
)

type transactionExpected struct {
	Block           expectedStatement `json:"block"`
	Successor       expectedStatement `json:"successor"`
	TransactionType string            `json:"transactionType"`
	Envelope        string            `json:"envelope"`
	NativeWire      string            `json:"nativeWire"`
	TransactionHash string            `json:"transactionHash"`
	NativeWireHash  string            `json:"nativeWireHash"`
	Index           string            `json:"index"`
}

// The nested lightTrust is the unchanged 24-field v1 public authority context.
// ExpectedTransaction is also independent host input, covered by the external
// hash of this entire context. No stdin field supplies any of these values.
type transactionTrustContext struct {
	Version             string              `json:"version"`
	LightTrust          trustContext        `json:"lightTrust"`
	ExpectedTransaction transactionExpected `json:"expectedTransaction"`
}

type transactionInput struct {
	Version  string              `json:"version"`
	Expected transactionExpected `json:"expected"`
	Proof    json.RawMessage     `json:"proof"`
}

type transactionCommandResult struct {
	Version string                              `json:"version"`
	Code    string                              `json:"code"`
	Error   string                              `json:"error,omitempty"`
	Result  *consensus.PQTransactionProofResult `json:"result,omitempty"`
}

// Apply the same recursive duplicate/unknown checks as v1, plus exact names,
// presence and non-null JSON string types even where encoding/json is lenient.
func strictTransactionObject(raw []byte, out any) (map[string]json.RawMessage, error) {
	if err := strictJSON(raw, out); err != nil {
		return nil, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	t := reflect.TypeOf(out).Elem()
	if len(fields) != t.NumField() {
		return nil, errors.New("exact complete transaction schema required")
	}
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		value, ok := fields[field.Tag.Get("json")]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return nil, errors.New("missing, aliased or null transaction field")
		}
		if field.Type.Kind() == reflect.String && (len(bytes.TrimSpace(value)) == 0 || bytes.TrimSpace(value)[0] != '"') {
			return nil, errors.New("transaction scalars must be exact strings")
		}
	}
	return fields, nil
}

func decodeTransactionExpected(raw []byte) (transactionExpected, consensus.PQTransactionProofExpectation, error) {
	var e transactionExpected
	var decoded consensus.PQTransactionProofExpectation
	if len(raw) == 0 || len(raw) > maxTransactionExpectedBytes {
		return e, decoded, errors.New("bounded original transaction target required")
	}
	fields, err := strictTransactionObject(raw, &e)
	if err != nil {
		return e, decoded, err
	}
	if err = strictStringObject(fields["block"], &e.Block); err != nil {
		return e, decoded, err
	}
	if err = strictStringObject(fields["successor"], &e.Successor); err != nil {
		return e, decoded, err
	}
	decoded.Block, err = e.Block.decode()
	if err != nil {
		return e, decoded, err
	}
	decoded.Successor, err = e.Successor.decode()
	if err != nil {
		return e, decoded, err
	}
	if decoded.Block.HeaderHeight >= math.MaxInt64-2 || decoded.Successor.HeaderHeight != decoded.Block.HeaderHeight+1 || e.Block.ChainID != e.Successor.ChainID {
		return e, decoded, errors.New("same-chain adjacent independently pinned headers required")
	}
	switch e.TransactionType {
	case consensus.PQTransferType, consensus.PQMigrationType, consensus.PQRevocationType, consensus.PQWholeType, consensus.PQActionType, consensus.PQEthereumValueType:
	default:
		return e, decoded, errors.New("unsupported original PQ transaction type")
	}
	decoded.TransactionType = e.TransactionType
	index, err := decimal(e.Index, math.MaxUint32, false)
	if err != nil {
		return e, decoded, err
	}
	decoded.Index = int64(index)
	for _, item := range []struct {
		encoded string
		bound   int
		target  *[]byte
	}{
		{e.Envelope, consensus.MaxPQContractTransactionBytes, &decoded.Envelope},
		{e.NativeWire, chain.MaxPQBatchBytes, &decoded.NativeWire},
	} {
		if len(item.encoded) > 4*((item.bound+2)/3) {
			return e, decoded, errors.New("original transaction bytes exceed profile bound")
		}
		value, err := base64.StdEncoding.Strict().DecodeString(item.encoded)
		if err != nil || len(value) == 0 || len(value) > item.bound || base64.StdEncoding.EncodeToString(value) != item.encoded {
			return e, decoded, errors.New("exact canonical base64 original transaction required")
		}
		*item.target = value
	}
	decoded.TransactionHash, err = hash32(e.TransactionHash)
	if err != nil {
		return e, decoded, err
	}
	decoded.NativeWireHash, err = hash32(e.NativeWireHash)
	if err != nil {
		return e, decoded, err
	}
	outer, native := sha256.Sum256(decoded.Envelope), sha256.Sum256(decoded.NativeWire)
	if hex.EncodeToString(outer[:]) != e.TransactionHash || hex.EncodeToString(native[:]) != e.NativeWireHash {
		return e, decoded, errors.New("original bytes differ from independent transaction hashes")
	}
	return e, decoded, nil
}

func decodeTransactionTrustContext(raw []byte, pin string) (transactionTrustContext, consensus.PQTransactionProofExpectation, error) {
	var c transactionTrustContext
	var expected consensus.PQTransactionProofExpectation
	if len(raw) == 0 || len(raw) > maxTransactionContextBytes || !matchesSHA256(raw, pin) {
		return c, expected, errors.New("transaction context differs from external pin or bound")
	}
	fields, err := strictTransactionObject(raw, &c)
	if err != nil || c.Version != transactionContextVersion {
		return c, expected, errors.New("invalid transaction trust context schema")
	}
	if len(fields["lightTrust"]) > 32<<10 {
		return c, expected, errors.New("original light context exceeds v1 bound")
	}
	if err = strictStringObject(fields["lightTrust"], &c.LightTrust); err != nil {
		return c, expected, err
	}
	if err = c.LightTrust.validate(); err != nil {
		return c, expected, err
	}
	c.ExpectedTransaction, expected, err = decodeTransactionExpected(fields["expectedTransaction"])
	if err != nil {
		return c, expected, err
	}
	if c.ExpectedTransaction.Block != c.LightTrust.expected() {
		return c, expected, errors.New("light and transaction contexts bind different invocation targets")
	}
	return c, expected, nil
}

func runTransactionProof(o options, contextRaw []byte, input io.Reader, output io.Writer, localClock func() time.Time) int {
	failure := func(code, message string) int {
		_ = json.NewEncoder(output).Encode(transactionCommandResult{Version: transactionResultVersion, Code: code, Error: message})
		return 1
	}
	c, expected, err := decodeTransactionTrustContext(contextRaw, o.contextSHA256)
	if err != nil {
		return failure("TRUST_CONTEXT_INVALID", "independently pinned transaction trust context did not validate")
	}
	raw, err := io.ReadAll(io.LimitReader(input, maxTransactionInputBytes+1))
	if err != nil || len(raw) > maxTransactionInputBytes {
		return failure("INVALID_REQUEST", "transaction proof request read failed or exceeded its bound")
	}
	var request transactionInput
	fields, err := strictTransactionObject(raw, &request)
	if err != nil || request.Version != transactionRequestVersion {
		return failure("INVALID_REQUEST", "unsupported or non-strict transaction proof request")
	}
	request.Expected, _, err = decodeTransactionExpected(fields["expected"])
	if err != nil {
		return failure("INVALID_REQUEST", "invalid original transaction and adjacent header coordinates")
	}
	if request.Expected != c.ExpectedTransaction {
		return failure("INVALID_REQUEST", "transaction target differs from independently pinned invocation target")
	}
	proof, err := consensus.DecodePQTransactionProofRequest(request.Proof)
	if err != nil {
		return failure("INVALID_REQUEST", "invalid complete raw Comet transaction proof transport")
	}
	trust, err := c.LightTrust.load()
	if err != nil {
		return failure("TRUST_SOURCE_INVALID", "original committed source or independently pinned trusted light block did not validate")
	}
	if localClock == nil {
		return failure("TRUST_CONTEXT_INVALID", "local verifier clock is unavailable")
	}
	trust.Now = localClock().UTC()
	verified, err := consensus.VerifyPQTransactionProof(trust, expected, proof)
	if err != nil {
		var rejected *consensus.PQLightProofError
		if errors.As(err, &rejected) {
			return failure("PROOF_REJECTED", rejected.Error())
		}
		return failure("PROOF_REJECTED", "transaction inclusion and deterministic execution proof did not verify")
	}
	code := "VERIFIED_TRANSACTION_DATA"
	switch verified.Outcome {
	case "succeeded":
	case "rejected":
		code = "VERIFIED_TRANSACTION_REJECTED_DATA"
	case "partial":
		code = "VERIFIED_TRANSACTION_PARTIAL_DATA"
	default:
		return failure("PROOF_REJECTED", "unsupported verified execution outcome")
	}
	// Exit zero means the proof verified, not that execution succeeded. Failed
	// and partial execution are explicit terminal results, never a retry grant.
	if err = json.NewEncoder(output).Encode(transactionCommandResult{Version: transactionResultVersion, Code: code, Result: &verified}); err != nil {
		return 1
	}
	return 0
}
