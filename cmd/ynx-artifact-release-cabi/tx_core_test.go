package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func transactionFixture(t *testing.T) (txInputs, ynxauth.State, ynxbatch.KeyMaterial) {
	t.Helper()
	// Only ephemeral synthetic custody. Nothing is an existing account, issuer,
	// source grant, nonce reservation or real transaction approval.
	key, pub, err := ynxbatch.KeyGen()
	must(t, err)
	t.Cleanup(key.Destroy)
	material, err := ynxbatch.ExportKeyMaterial(key)
	must(t, err)
	t.Cleanup(material.Clear)
	owner := "0x" + strings.Repeat("1", 40)
	network := bytes.Repeat([]byte{0x42}, 32)
	state := ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: bytes.Clone(network), EnableAt: 1,
		Records: []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: owner, PKA: bytes.Clone(pub.PKA), PKB: bytes.Clone(pub.PKB), Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 1}}}
	policy, err := ynxauth.EncodeWalletPolicyProjection(state, owner)
	must(t, err)
	message, err := (ynxauth.Transfer{ChainID: network, NativeChainID: 6423, From: owner,
		To: "0x" + strings.Repeat("2", 40), Amount: 3, Fee: 1, Nonce: math.MaxUint64}).SigningBytes()
	must(t, err)
	return txInputs{message: message, policy: policy, expected: txExpected{NetworkID: bytes.Clone(network),
		Owner: owner, NativeChainID: 6423, KeyVersion: "1", ExecutionHeight: "7", PKA: bytes.Clone(pub.PKA), PKB: bytes.Clone(pub.PKB)}}, state, material
}

func transactionPolicy(t *testing.T, in txInputs, state ynxauth.State) txInputs {
	t.Helper()
	var err error
	in.policy, err = ynxauth.EncodeWalletPolicyProjection(state, in.expected.Owner)
	must(t, err)
	return in
}

func transactionPlan(t *testing.T, in txInputs) txPlan {
	t.Helper()
	plan, code := prepareTransaction(in, txMemberCapacity)
	if code != resultOK {
		t.Fatal("synthetic canonical transaction preflight refused")
	}
	return plan
}

func TestTransactionBatchCoreSignProfiles(t *testing.T) {
	in, _, material := transactionFixture(t)
	before := cloneMaterial(material)
	defer before.Clear()
	deploy, err := ynxauth.EncodeActionPayload(ynxauth.ActionContractDeploy, ynxauth.ContractDeployPayload{
		Name: ynxauth.ContractCounterName, SourceHash: strings.Repeat("a", 64), DeployedBytecodeHash: strings.Repeat("b", 64),
		CompilerConfigHash: strings.Repeat("c", 64), ConstructorArgs: []uint64{math.MaxUint64}})
	must(t, err)
	call, err := ynxauth.EncodeActionPayload(ynxauth.ActionContractExecute, ynxauth.ContractExecutePayload{
		Name: ynxauth.ContractCounterName, Target: "0x" + strings.Repeat("3", 40), SourceHash: strings.Repeat("a", 64),
		DeployedBytecodeHash: strings.Repeat("b", 64), CompilerConfigHash: strings.Repeat("c", 64),
		ExpectedStorageCommitment: strings.Repeat("d", 64), Calldata: "0x7cf5dab0" + strings.Repeat("f", 64)})
	must(t, err)
	action := ynxauth.Action{ChainID: in.expected.NetworkID, NativeChainID: 6423, Owner: in.expected.Owner, Nonce: math.MaxUint64,
		Fee: ynxauth.ContractDeployFee, Kind: ynxauth.ActionContractDeploy, Payload: deploy}
	deployment, err := action.SigningBytes()
	must(t, err)
	action.Fee, action.Kind, action.Payload = ynxauth.ContractExecuteFee, ynxauth.ActionContractExecute, call
	execution, err := action.SigningBytes()
	must(t, err)
	value, err := (ynxauth.EthereumValueIntent{Profile: ynxauth.EthereumABCIIntegerGasProfile, ChainID: in.expected.NetworkID,
		NativeChainID: 6423, Owner: in.expected.Owner, To: "0x" + strings.Repeat("2", 40), TxType: 2, Value: 3,
		Nonce: math.MaxUint64, GasLimit: ynxauth.EthereumValueTransferGasLimit, MaxPriorityFeePerGas: 1, MaxFeePerGas: 3}).SigningBytes()
	must(t, err)
	for _, tc := range []struct {
		name string
		wire []byte
	}{{"native transfer", in.message}, {"pinned contract deployment", deployment}, {"pinned contract execution", execution}, {"independent Ethereum value profile", value}} {
		t.Run(tc.name, func(t *testing.T) {
			input := in
			input.message = tc.wire
			plan := transactionPlan(t, input)
			wire, code, cleanup := signTransactionPrepared(plan, material)
			defer clear(wire)
			if code != resultOK || cleanup != cleanupLogicalComplete || len(wire) == 0 || len(wire) > txMemberMaximum || len(wire) > txMemberCapacity {
				t.Fatal("fixed transaction signing or cleanup failed")
			}
			must(t, inspectTransactionMember(plan, wire))
			must(t, plan.policy.VerifyMember(in.expected.Owner, ynxauth.TransactionPurpose, tc.wire, wire, 7))
			m, err := ynxbatch.DecodeMember(wire)
			must(t, err)
			if m.Certificate.N != 1 || m.Index != 0 || m.Certificate.Purpose != "TX-BATCH" || !bytes.Equal(m.Message, tc.wire) {
				t.Fatal("fixed member profile changed")
			}
			equalMaterial(t, material, before)
		})
	}
}

func TestTransactionBatchPublicPreflight(t *testing.T) {
	in, state, _ := transactionFixture(t)
	for _, tc := range []struct {
		name string
		edit func(*txInputs)
	}{
		{"network", func(x *txInputs) { x.expected.NetworkID = bytes.Repeat([]byte{0x43}, 32) }},
		{"owner", func(x *txInputs) { x.expected.Owner = "0x" + strings.Repeat("3", 40) }},
		{"native chain", func(x *txInputs) { x.expected.NativeChainID++ }},
		{"revision", func(x *txInputs) { x.expected.KeyVersion = "2" }},
		{"revision alias", func(x *txInputs) { x.expected.KeyVersion = "01" }},
		{"height alias", func(x *txInputs) { x.expected.ExecutionHeight = "+7" }},
		{"height zero", func(x *txInputs) { x.expected.ExecutionHeight = "0" }},
		{"height overflow", func(x *txInputs) { x.expected.ExecutionHeight = "18446744073709551616" }},
		{"public A", func(x *txInputs) { x.expected.PKA = make([]byte, ynxbatch.PublicKeyASize) }},
		{"public B", func(x *txInputs) { x.expected.PKB = make([]byte, ynxbatch.PublicKeyBSize) }},
		{"trailing wire", func(x *txInputs) { x.message = append(bytes.Clone(x.message), 0) }},
		{"unrecognized domain", func(x *txInputs) {
			x.message = bytes.Replace(x.message, []byte(ynxauth.TransferDomain), []byte("YNX-NATIVE-TRANSFER/v3"), 1)
		}},
		{"policy duplicate", func(x *txInputs) {
			x.policy = append(bytes.Clone(x.policy[:len(x.policy)-1]), []byte(`,"version":"YNX-ACCOUNT-POLICY/v1"}`)...)
		}},
		{"policy extra", func(x *txInputs) {
			x.policy = append(bytes.Clone(x.policy[:len(x.policy)-1]), []byte(`,"approved":true}`)...)
		}},
		{"policy omitted", func(x *txInputs) { x.policy = []byte(`{"version":"YNX-ACCOUNT-POLICY/v1"}`) }},
		{"policy float integer", func(x *txInputs) {
			x.policy = bytes.Replace(x.policy, []byte(`"revision":"1"`), []byte(`"revision":1.0`), 1)
		}},
		{"policy trailing", func(x *txInputs) { x.policy = append(bytes.Clone(x.policy), '\n') }},
		{"not enabled", func(x *txInputs) {
			s := state.Clone()
			s.EnableAt = 8
			s.Records[0].RegisteredAt = 8
			s.Records[0].ActiveFrom = 9
			*x = transactionPolicy(t, *x, s)
		}},
		{"foreign owner projection", func(x *txInputs) {
			s := state.Clone()
			s.Records[0].Owner = "0x" + strings.Repeat("3", 40)
			var err error
			x.policy, err = ynxauth.EncodeWalletPolicyProjection(s, s.Records[0].Owner)
			must(t, err)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			x := in
			tc.edit(&x)
			if _, code := prepareTransaction(x, txMemberCapacity); code != resultPublicBinding {
				t.Fatal("incorrect canonical public transaction binding accepted")
			}
		})
	}
	for _, capacity := range []uint64{0, txMemberCapacity - 1, txMemberCapacity + 1, ^uint64(0)} {
		if _, code := prepareTransaction(in, capacity); code != resultCapacity {
			t.Fatal("incorrect fixed capacity accepted")
		}
	}
	for _, field := range []string{"message", "policy"} {
		x := in
		if field == "message" {
			x.message = make([]byte, txMessageMaximum+1)
		} else {
			x.policy = make([]byte, txPolicyMaximum+1)
		}
		if _, code := prepareTransaction(x, txMemberCapacity); code != resultBounds {
			t.Fatal("oversized public data accepted")
		}
	}
}

func TestTransactionBatchPolicyRotationAndRevocation(t *testing.T) {
	in, original, _ := transactionFixture(t)
	nextKey, next, err := ynxbatch.KeyGen()
	must(t, err)
	defer nextKey.Destroy()
	state := original.Clone()
	state.Records = append(state.Records, ynxauth.Record{AlgorithmVersion: ynxbatch.Version, Owner: in.expected.Owner,
		PKA: next.PKA, PKB: next.PKB, Revision: 2, RegisteredAt: 3, ActiveFrom: 8, LedgerNonce: 2})
	in = transactionPolicy(t, in, state)
	transactionPlan(t, in) // The pending pair does not replace height-7 authority.
	in.expected.ExecutionHeight = "8"
	if _, code := prepareTransaction(in, txMemberCapacity); code != resultPublicBinding {
		t.Fatal("superseded pair remained current")
	}
	in.expected.KeyVersion, in.expected.PKA, in.expected.PKB = "2", next.PKA, next.PKB
	transactionPlan(t, in)
	state.Version = ynxauth.PolicyRevocationVersion
	state.Revocations = []ynxauth.RevocationRecord{{Owner: in.expected.Owner, AuthorizingRevision: 1,
		ThroughRevision: 2, RegisteredAt: 5, RevokedFrom: 6, LedgerNonce: 3}}
	in = transactionPolicy(t, in, state)
	if _, code := prepareTransaction(in, txMemberCapacity); code != resultPublicBinding {
		t.Fatal("terminal revocation revived at pending rotation height")
	}
	in.expected.ExecutionHeight, in.expected.KeyVersion = "5", "1"
	in.expected.PKA, in.expected.PKB = original.Records[0].PKA, original.Records[0].PKB
	transactionPlan(t, in) // Original historical authority before revocation.
	in.expected.ExecutionHeight = "6"
	if _, code := prepareTransaction(in, txMemberCapacity); code != resultPublicBinding {
		t.Fatal("effective terminal revocation accepted")
	}
}

func TestTransactionBatchMemberANDAndContext(t *testing.T) {
	in, _, material := transactionFixture(t)
	plan := transactionPlan(t, in)
	wire, code, cleanup := signTransactionPrepared(plan, material)
	defer clear(wire)
	if code != resultOK || cleanup != cleanupLogicalComplete {
		t.Fatal("synthetic transaction signing failed")
	}
	for _, tc := range []struct {
		name string
		edit func(*ynxbatch.Member)
	}{
		{"ML-DSA branch", func(m *ynxbatch.Member) { m.Certificate.SigmaA[0] ^= 1 }},
		{"SLH-DSA branch", func(m *ynxbatch.Member) { m.Certificate.SigmaB[0] ^= 1 }},
		{"artifact purpose", func(m *ynxbatch.Member) { m.Certificate.Purpose = "ARTIFACT-RELEASE" }},
		{"control purpose", func(m *ynxbatch.Member) { m.Certificate.Purpose = "IDE-PROJECT-CONTROL" }},
		{"wrong member count", func(m *ynxbatch.Member) { m.Certificate.N = 2 }},
		{"wrong index", func(m *ynxbatch.Member) { m.Index = 1 }},
		{"other message", func(m *ynxbatch.Member) { m.Message[len(m.Message)-1] ^= 1 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, err := ynxbatch.DecodeMember(wire)
			must(t, err)
			tc.edit(&m)
			bad, err := ynxbatch.EncodeMember(m)
			// Structurally impossible coordinates must fail before verification.
			if err == nil && inspectTransactionMember(plan, bad) == nil {
				t.Fatal("corrupt transaction member accepted")
			}
		})
	}
}

func TestTransactionBatchBorrowAndCleanup(t *testing.T) {
	in, _, material := transactionFixture(t)
	plan := transactionPlan(t, in)
	for _, edit := range []func(*ynxbatch.KeyMaterial){
		func(m *ynxbatch.KeyMaterial) { m.PKCS8A[0] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKCS8A[22] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKCS8B[22] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKCS8B[118] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKA[0] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKB[0] ^= 1 },
	} {
		bad := cloneMaterial(material)
		edit(&bad)
		before := cloneMaterial(bad)
		out, code, cleanup := signTransactionPrepared(plan, bad)
		if len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
			t.Fatal("invalid private custody released output")
		}
		equalMaterial(t, bad, before)
		bad.Clear()
		before.Clear()
	}
	missing := cloneMaterial(material)
	missing.PKCS8B = nil
	if out, code, cleanup := signTransactionPrepared(plan, missing); len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupNotRequired {
		t.Fatal("partial material reached signing")
	}
	missing.Clear()
	for _, tc := range []struct {
		panic, clean bool
		code         resultCode
		cleanup      cleanupCode
	}{
		{false, false, resultCleanup, cleanupFailed}, {true, true, resultInternal, cleanupUnknown},
	} {
		candidate := []byte{1, 2, 3}
		out, code, cleanup := finishTransaction(candidate, resultOK, tc.panic, tc.clean)
		if len(out) != 0 || code != tc.code || cleanup != tc.cleanup || !bytes.Equal(candidate, []byte{0, 0, 0}) {
			t.Fatal("uncertain cleanup released output")
		}
	}
	// A later call cannot recover custody from an earlier imported key handle.
	clear(material.PKCS8A)
	clear(material.PKCS8B)
	if out, code, cleanup := signTransactionPrepared(plan, material); len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
		t.Fatal("private key retained between calls")
	}
}

func TestTransactionBatchOwnsPreflightAndLayout(t *testing.T) {
	in, _, _ := transactionFixture(t)
	plan := transactionPlan(t, in)
	originalMessage, originalNetwork := bytes.Clone(plan.message), bytes.Clone(plan.expected.NetworkID)
	in.message[0] ^= 1
	in.policy[0] ^= 1
	in.expected.NetworkID[0] ^= 1
	in.expected.PKA[0] ^= 1
	in.expected.PKB[0] ^= 1
	if !bytes.Equal(plan.message, originalMessage) || !bytes.Equal(plan.expected.NetworkID, originalNetwork) ||
		!bytes.Equal(plan.policy.NetworkID, originalNetwork) || !bytes.Equal(plan.expected.PKA, plan.policy.Records[0].PKA) || !bytes.Equal(plan.expected.PKB, plan.policy.Records[0].PKB) {
		t.Fatal("preflight plan retained external mutable bytes")
	}
	request := memoryRange{0x1000, 0x300}
	inputs := []memoryRange{{0x2000, txMessageMaximum}, {0x10000, txPolicyMaximum}, {0x900000, 54}, {0xa00000, 150}}
	outputs := []memoryRange{{0xb00000, txMemberCapacity}, {0xc00000, 8}, {0xd00000, 4}}
	if checkMemoryLayout(request, inputs, outputs) != resultOK {
		t.Fatal("disjoint transaction layout refused")
	}
	for _, target := range append(append([]memoryRange{request}, inputs...), outputs[1:]...) {
		bad := append([]memoryRange(nil), outputs...)
		bad[0] = target
		if checkMemoryLayout(request, inputs, bad) != resultOverlap {
			t.Fatal("transaction output overlaps private/public original")
		}
	}
}

// The normal CI C driver invokes this exact test binary in two separate
// processes. No fixture private material is checked in or uploaded. An ordinary
// package test does not generate files or claim that a C call was executed.
func TestTransactionBatchCABIProcess(t *testing.T) {
	mode := os.Getenv("YNX_TX_CABI_FIXTURE_MODE")
	if mode == "" {
		return
	}
	directory := os.Getenv("YNX_TX_CABI_FIXTURE_DIRECTORY")
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		t.Fatal("absolute synthetic fixture directory required")
	}
	write := func(name string, raw []byte) {
		t.Helper()
		f, err := os.OpenFile(filepath.Join(directory, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		must(t, err)
		n, err := f.Write(raw)
		if err != nil || n != len(raw) {
			_ = f.Close()
			t.Fatal("synthetic fixture write failed")
		}
		must(t, f.Sync())
		must(t, f.Close())
	}
	if mode == "generate" {
		must(t, os.Mkdir(directory, 0700))
		in, _, material := transactionFixture(t)
		for name, raw := range map[string][]byte{"message.bin": in.message, "policy.json": in.policy,
			"pk-a.bin": material.PKA, "pk-b.bin": material.PKB, "SYNTHETIC-ONLY-a.der": material.PKCS8A, "SYNTHETIC-ONLY-b.der": material.PKCS8B} {
			write(name, raw)
		}
		return
	}
	if mode != "verify" {
		t.Fatal("unknown synthetic C fixture operation")
	}
	read := func(name string, maximum int) []byte {
		t.Helper()
		path := filepath.Join(directory, name)
		info, err := os.Lstat(path)
		must(t, err)
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() < 1 || info.Size() > int64(maximum) {
			t.Fatal("bounded synthetic C fixture required")
		}
		raw, err := os.ReadFile(path)
		must(t, err)
		return raw
	}
	pkA, pkB := read("pk-a.bin", ynxbatch.PublicKeyASize), read("pk-b.bin", ynxbatch.PublicKeyBSize)
	expected := txExpected{NetworkID: bytes.Repeat([]byte{0x42}, 32), Owner: "0x" + strings.Repeat("1", 40), NativeChainID: 6423, KeyVersion: "1", ExecutionHeight: "7", PKA: pkA, PKB: pkB}
	state := ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: bytes.Clone(expected.NetworkID), EnableAt: 1,
		Records: []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: expected.Owner, PKA: pkA, PKB: pkB, Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 1}}}
	policy, err := ynxauth.EncodeWalletPolicyProjection(state, expected.Owner)
	must(t, err)
	message, err := (ynxauth.Transfer{ChainID: expected.NetworkID, NativeChainID: 6423, From: expected.Owner, To: "0x" + strings.Repeat("2", 40), Amount: 3, Fee: 1, Nonce: math.MaxUint64}).SigningBytes()
	must(t, err)
	if !bytes.Equal(read("message.bin", txMessageMaximum), message) || !bytes.Equal(read("policy.json", txPolicyMaximum), policy) {
		t.Fatal("independent synthetic original binding changed")
	}
	plan := transactionPlan(t, txInputs{message: message, policy: policy, expected: expected})
	wire := read("memberOriginal.bin", txMemberCapacity)
	must(t, inspectTransactionMember(plan, wire))
	for _, branch := range []string{"A", "B"} {
		m, err := ynxbatch.DecodeMember(wire)
		must(t, err)
		if branch == "A" {
			m.Certificate.SigmaA[0] ^= 1
		} else {
			m.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeMember(m)
		must(t, err)
		if state.VerifyMember(expected.Owner, ynxauth.TransactionPurpose, message, bad, 7) == nil {
			t.Fatal("actual C output accepted with a corrupt AND branch")
		}
	}
	hash := sha256.Sum256(wire)
	public := map[string]any{"version": "YNX-TX-BATCH-CABI-PUBLIC-INTEROP/v1", "classification": "synthetic-data", "actualCABIExecuted": true,
		"purpose": ynxauth.TransactionPurpose, "networkId": hex.EncodeToString(expected.NetworkID), "owner": expected.Owner, "nativeChainId": "6423", "keyVersion": "1", "executionHeight": "7",
		"pkA": hex.EncodeToString(pkA), "pkB": hex.EncodeToString(pkB), "messageOriginalBase64Url": base64.RawURLEncoding.EncodeToString(message),
		"policyOriginalBase64Url": base64.RawURLEncoding.EncodeToString(policy), "memberOriginalBase64Url": base64.RawURLEncoding.EncodeToString(wire),
		"memberSHA256": hex.EncodeToString(hash[:]), "memberBytes": len(wire), "authorityGranted": false, "rootGranted": false, "submitted": false, "finality": false}
	raw, err := json.Marshal(public)
	must(t, err)
	write("PUBLIC-INTEROP.json", append(raw, '\n'))
	receipt, err := json.Marshal(map[string]any{"version": "YNX-TX-BATCH-CABI-RECEIPT/v1", "actualCABIExecuted": true, "goANDVerified": true,
		"memberSHA256": hex.EncodeToString(hash[:]), "memberBytes": len(wire), "privateUploaded": false, "authorityGranted": false, "rootGranted": false})
	must(t, err)
	write("PUBLIC-RECEIPT.json", append(receipt, '\n'))
}
