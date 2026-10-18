// Command verify-pq-wallet-restored verifies public output of an isolated Wallet
// restore test. It neither loads private keys nor contacts or mutates a ledger.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const bindingVersion = "ynx-wallet-restore-interop-v1"

// Binding is retained by the test parent before the fresh Wallet process runs.
// Policy contains the original complete public keys, not keys taken from the
// restored signature. This is an isolated test policy, not chain authority.
type binding struct {
	Version         string        `json:"version"`
	Owner           string        `json:"owner"`
	ExecutionHeight string        `json:"executionHeight"`
	NativeChainID   string        `json:"nativeChainId"`
	Policy          ynxauth.State `json:"policy"`
}

func exactUint(s string) (uint64, error) {
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != s {
		return 0, errors.New("expected a positive canonical decimal uint64")
	}
	return n, nil
}

func verify(bindingJSON, message, wire []byte) (map[string]any, error) {
	if len(bindingJSON) == 0 || len(bindingJSON) > 256<<10 || len(message) == 0 || len(message) > ynxauth.MaxActionBytes || len(wire) == 0 || len(wire) > 128<<10 {
		return nil, errors.New("missing or oversized public restore evidence")
	}
	var b binding
	d := json.NewDecoder(bytes.NewReader(bindingJSON))
	d.DisallowUnknownFields()
	if err := d.Decode(&b); err != nil {
		return nil, fmt.Errorf("binding JSON: %w", err)
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, errors.New("binding JSON has trailing data")
	}
	if b.Version != bindingVersion || !accountaddress.IsCanonical(b.Owner) {
		return nil, errors.New("invalid restore binding version or canonical owner")
	}
	height, err := exactUint(b.ExecutionHeight)
	if err != nil {
		return nil, err
	}
	chainID, err := exactUint(b.NativeChainID)
	if err != nil {
		return nil, err
	}
	if err := b.Policy.Validate(b.Policy.NetworkID); err != nil {
		return nil, err
	}
	action, actionErr := ynxauth.DecodeAction(message)
	owner, nativeID, network, kind := action.Owner, action.NativeChainID, action.ChainID, action.Kind
	if actionErr != nil {
		transfer, err := ynxauth.DecodeTransfer(message)
		if err != nil {
			return nil, fmt.Errorf("expected original typed action or transfer: %w", err)
		}
		owner, nativeID, network, kind = transfer.From, transfer.NativeChainID, transfer.ChainID, "transfer"
	}
	if owner != b.Owner || nativeID != chainID || !bytes.Equal(network, b.Policy.NetworkID) {
		return nil, errors.New("original typed action differs from parent owner or network binding")
	}
	// This is the production verifier: both full registered keys, both signature
	// branches, both member paths, activation and terminal revocation checks.
	if err := b.Policy.VerifyMember(b.Owner, ynxauth.TransactionPurpose, message, wire, height); err != nil {
		return nil, err
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return nil, err
	}
	hash := func(raw []byte) string {
		h := sha256.Sum256(raw)
		return hex.EncodeToString(h[:])
	}
	return map[string]any{
		"version": bindingVersion, "verified": true,
		"scope":         "wallet-restore-public-signature-verification",
		"bindingSHA256": hash(bindingJSON), "messageSHA256": hash(message), "memberSHA256": hash(wire),
		"publicKeyASHA256": hash(member.Certificate.PKA), "publicKeyBSHA256": hash(member.Certificate.PKB),
		"owner": b.Owner, "executionHeight": b.ExecutionHeight, "actionKind": kind,
		"authorizesLedgerExecution": false, "freshProcessRestoreVerified": false,
	}, nil
}

func readBounded(path string, limit int64) ([]byte, error) {
	if path == "" {
		return nil, errors.New("all three public evidence file paths are required")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nil, errors.New("cannot read bounded public evidence file")
	}
	return raw, nil
}

func run(args []string, out io.Writer) error {
	flags := flag.NewFlagSet("verify-pq-wallet-restored", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	bindingPath := flags.String("binding", "", "parent-retained public policy binding JSON")
	messagePath := flags.String("message", "", "parent-retained original typed action binary")
	memberPath := flags.String("member", "", "fresh Wallet process's restored-key MemberWire binary")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 {
		return errors.New("use -binding file.json -message message.bin -member member.bin")
	}
	b, err := readBounded(*bindingPath, 256<<10)
	if err != nil {
		return err
	}
	m, err := readBounded(*messagePath, ynxauth.MaxActionBytes)
	if err != nil {
		return err
	}
	w, err := readBounded(*memberPath, 128<<10)
	if err != nil {
		return err
	}
	result, err := verify(b, m, w)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "restore verification failed:", err)
		os.Exit(1)
	}
}
