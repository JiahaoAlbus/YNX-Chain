package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

var invoiceCABIPrivateNames = []string{"SYNTHETIC-ONLY-a.der", "SYNTHETIC-ONLY-b.der", "SYNTHETIC-ONLY-next-a.der", "SYNTHETIC-ONLY-next-b.der"}

func invoiceCABIDirectory(directory string) error {
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return errors.New("canonical absolute synthetic directory required")
	}
	resolved, err := filepath.EvalSymlinks(directory)
	if err != nil || resolved != directory {
		return errors.New("synthetic directory alias or missing directory refused")
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return errors.New("synthetic directory must be owned private mode0700")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) {
		return errors.New("synthetic directory owner mismatch")
	}
	return nil
}

func invoiceCABIWrite(directory, name string, raw []byte) error {
	if err := invoiceCABIDirectory(directory); err != nil {
		return err
	}
	if filepath.Base(name) != name {
		return errors.New("fixed synthetic leaf required")
	}
	f, err := os.OpenFile(filepath.Join(directory, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return errors.New("exclusive synthetic output refused; preserve original")
	}
	n, writeErr := f.Write(raw)
	if writeErr != nil || n != len(raw) {
		_ = f.Close()
		return errors.New("synthetic write incomplete; preserve original")
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return errors.New("synthetic output sync uncertain; preserve original")
	}
	return f.Close()
}

func invoiceCABIRead(directory, name string, max int) ([]byte, error) {
	if err := invoiceCABIDirectory(directory); err != nil {
		return nil, err
	}
	if filepath.Base(name) != name {
		return nil, errors.New("fixed synthetic leaf required")
	}
	path := filepath.Join(directory, name)
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() <= 0 || info.Size() > int64(max) {
		return nil, errors.New("bounded private-mode synthetic leaf required")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) {
		return nil, errors.New("synthetic leaf alias or owner mismatch")
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, errors.New("synthetic original open refused")
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, errors.New("synthetic original changed while opening")
	}
	raw, err := io.ReadAll(io.LimitReader(f, int64(max)+1))
	if err != nil || len(raw) > max || int64(len(raw)) != info.Size() {
		return nil, errors.New("synthetic original extent changed")
	}
	return raw, nil
}

// Only these four ephemeral files can be removed, and only after validating
// the original private case. Public receipts and UNKNOWN originals survive.
func cleanupInvoiceCABIPrivate(directory string) error {
	if _, err := os.Lstat(directory); os.IsNotExist(err) {
		return nil
	}
	if err := invoiceCABIDirectory(directory); err != nil {
		return err
	}
	for _, name := range invoiceCABIPrivateNames {
		path := filepath.Join(directory, name)
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			continue
		}
		limit := ynxbatch.PKCS8BSize
		raw, err := invoiceCABIRead(directory, name, limit)
		clear(raw)
		if err != nil {
			return err
		}
		if err = os.Remove(path); err != nil {
			return errors.New("synthetic private cleanup failed; preserve case")
		}
	}
	return nil
}

type invoiceCABIDriverReceipt struct {
	Version                     string `json:"version"`
	ActualCABIExecuted          bool   `json:"actualCABIExecuted"`
	ActualRegisteredVerifier    bool   `json:"actualRegisteredVerifier"`
	SignedMembers               uint32 `json:"signedMembers"`
	RejectedCalls               uint32 `json:"rejectedCalls"`
	RejectedVerifications       uint32 `json:"rejectedVerifications"`
	LateCallerOriginalPreserved bool   `json:"lateCallerOriginalPreserved"`
	ABIPanicInjected            bool   `json:"abiPanicInjected"`
	SyntheticOnly               bool   `json:"syntheticOnly"`
	AuthorityGranted            bool   `json:"authorityGranted"`
}

func invoiceCABIStrict(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return errors.New("trailing C fixture data")
	}
	b, err := json.Marshal(out)
	if err != nil || !bytes.Equal(raw, b) {
		return errors.New("noncanonical C fixture data")
	}
	return nil
}

// The explicit script runs this same test binary in generation, verification
// and cleanup processes. Ordinary Go tests do not create secrets or claim CABI
// execution. No files are taken from a Wallet/Keychain or an existing account.
func TestInvoiceTransactionCABIProcess(t *testing.T) {
	mode := os.Getenv("YNX_INVOICE_TX_CABI_MODE")
	if mode == "" {
		return
	}
	directory := os.Getenv("YNX_INVOICE_TX_CABI_DIRECTORY")
	if mode == "cleanup" {
		must(t, cleanupInvoiceCABIPrivate(directory))
		t.Log("INVOICE_CABI_SYNTHETIC_PRIVATE_CLEANUP_COMPLETE physicalErasureClaim=false")
		return
	}
	if mode == "generate" {
		if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
			t.Fatal("canonical synthetic path required")
		}
		must(t, invoiceCABIDirectory(filepath.Dir(directory)))
		must(t, os.Mkdir(directory, 0700))
		cases, state, material := invoiceTransactionFixture(t)
		next, pub, err := ynxbatch.KeyGen()
		must(t, err)
		defer next.Destroy()
		nextMaterial, err := ynxbatch.ExportKeyMaterial(next)
		must(t, err)
		defer nextMaterial.Clear()
		rotated := state.Clone()
		rotated.Records = append(rotated.Records, ynxauth.Record{AlgorithmVersion: ynxbatch.Version, Owner: cases[0].in.expected.Owner, PKA: pub.PKA, PKB: pub.PKB, Revision: 2, RegisteredAt: 3, ActiveFrom: 8, LedgerNonce: 2})
		rotation, err := ynxauth.EncodeWalletPolicyProjection(rotated, cases[0].in.expected.Owner)
		must(t, err)
		revoked := rotated.Clone()
		revoked.Version = ynxauth.PolicyRevocationVersion
		revoked.Revocations = []ynxauth.RevocationRecord{{Owner: cases[0].in.expected.Owner, AuthorizingRevision: 2, ThroughRevision: 2, RegisteredAt: 8, RevokedFrom: 9, LedgerNonce: 3}}
		revocation, err := ynxauth.EncodeWalletPolicyProjection(revoked, cases[0].in.expected.Owner)
		must(t, err)
		for name, raw := range map[string][]byte{"policy.json": cases[0].in.policy, "policy-rotated.json": rotation, "policy-revoked.json": revocation, "pk-a.bin": material.PKA, "pk-b.bin": material.PKB, "pk-next-a.bin": nextMaterial.PKA, "pk-next-b.bin": nextMaterial.PKB, invoiceCABIPrivateNames[0]: material.PKCS8A, invoiceCABIPrivateNames[1]: material.PKCS8B, invoiceCABIPrivateNames[2]: nextMaterial.PKCS8A, invoiceCABIPrivateNames[3]: nextMaterial.PKCS8B} {
			must(t, invoiceCABIWrite(directory, name, raw))
		}
		for i, tc := range cases {
			must(t, invoiceCABIWrite(directory, fmt.Sprintf("message-%d.bin", i), tc.in.message))
		}
		t.Log("INVOICE_CABI_SYNTHETIC_INPUT_READY messages=4 privateLeaves=4 authority=false")
		return
	}
	if mode != "verify" {
		t.Fatal("unsupported invoice C fixture mode")
	}
	read := func(name string, max int) []byte {
		t.Helper()
		b, err := invoiceCABIRead(directory, name, max)
		must(t, err)
		return b
	}
	var receipt invoiceCABIDriverReceipt
	must(t, invoiceCABIStrict(read("DRIVER-RESULT.json", 4096), &receipt))
	if receipt.Version != "YNX-INVOICE-TX-CABI-DRIVER/v1" || !receipt.ActualCABIExecuted || !receipt.ActualRegisteredVerifier || receipt.SignedMembers != 5 || receipt.RejectedCalls < 12 || receipt.RejectedVerifications != 24 || !receipt.LateCallerOriginalPreserved || receipt.ABIPanicInjected || !receipt.SyntheticOnly || receipt.AuthorityGranted {
		t.Fatal("actual C driver result is incomplete")
	}
	// The independent verifier loads only public files. Derive the expected
	// messages again from the fixed public vector, never from the C output.
	vector, err := os.ReadFile("../../internal/ynxauth/testdata/invoice-action-v1.json")
	must(t, err)
	sum := sha256.Sum256(vector)
	if hex.EncodeToString(sum[:]) != invoiceSyntaxVectorSHA256 {
		t.Fatal("fixed invoice vector changed")
	}
	var source struct {
		Vectors []struct{ Name, Kind, MessageHex string }
	}
	must(t, json.Unmarshal(vector, &source))
	if len(source.Vectors) != 4 {
		t.Fatal("four fixed vectors required")
	}
	pkA, pkB := read("pk-a.bin", 2592), read("pk-b.bin", 64)
	network := make([]byte, 32)
	for i := range network {
		network[i] = byte(i)
	}
	expected := txExpected{NetworkID: network, Owner: "0x1234567890abcdef1234567890abcdef12345678", NativeChainID: 9007199254740993, KeyVersion: "1", ExecutionHeight: "7", PKA: pkA, PKB: pkB}
	policy := read("policy-rotated.json", txPolicyMaximum)
	public := invoiceTXPublicFixture{Version: "YNX-INVOICE-TX-CABI-PUBLIC-INTEROP/v1", SyntaxVectorSHA256: invoiceSyntaxVectorSHA256, Purpose: ynxauth.TransactionPurpose, ProductionCABI: "YNXTransactionBatchSignV1", ExecutedCallee: "C process: YNXTransactionBatchSignV1 + YNXRegisteredANDMemberVerifyN1V1; independent Go AND", SyntheticOnly: true, ActualCABIExecuted: true}
	for i := 0; i < 5; i++ {
		index := i
		if index == 4 {
			index = 0
			expected.KeyVersion, expected.ExecutionHeight = "2", "8"
			expected.PKA, expected.PKB = read("pk-next-a.bin", 2592), read("pk-next-b.bin", 64)
		}
		v := source.Vectors[index]
		message, err := hex.DecodeString(v.MessageHex)
		must(t, err)
		if !bytes.Equal(message, read(fmt.Sprintf("message-%d.bin", index), txMessageMaximum)) {
			t.Fatal("C message changed fixed public vector")
		}
		plan := transactionPlan(t, txInputs{message: message, policy: policy, expected: expected})
		wire := read(fmt.Sprintf("member-%d.bin", i), txMemberCapacity)
		retained := bytes.Clone(wire)
		must(t, inspectTransactionMember(plan, wire))
		if invoiceIndependentVerification(t, plan, wire) != registeredN1OK {
			t.Fatal("actual C output failed independent AND")
		}
		for _, branch := range []string{"A", "B", "purpose", "message"} {
			member, err := ynxbatch.DecodeMember(wire)
			must(t, err)
			switch branch {
			case "A":
				member.Certificate.SigmaA[0] ^= 1
			case "B":
				member.Certificate.SigmaB[0] ^= 1
			case "purpose":
				member.Certificate.Purpose = "ACCOUNT-MIGRATION"
			case "message":
				member.Message[len(member.Message)-1] ^= 1
			}
			bad, err := ynxbatch.EncodeMember(member)
			must(t, err)
			if invoiceIndependentVerification(t, plan, bad) == registeredN1OK {
				t.Fatal("actual C output accepted a corrupt full-message AND binding")
			}
		}
		// These are the original Go cleanup gates applied to actual C-returned
		// DATA. This is not an injected C panic or a Wallet-journal test.
		for _, failure := range []struct {
			panic, clean bool
			code         resultCode
			status       cleanupCode
		}{{true, true, resultInternal, cleanupUnknown}, {false, false, resultCleanup, cleanupFailed}} {
			candidate := bytes.Clone(wire)
			out, code, cleanup := finishTransaction(candidate, resultOK, failure.panic, failure.clean)
			if len(out) != 0 || code != failure.code || cleanup != failure.status || !bytes.Equal(candidate, make([]byte, len(candidate))) || !bytes.Equal(retained, read(fmt.Sprintf("member-%d.bin", i), txMemberCapacity)) {
				t.Fatal("UNKNOWN changed retained C output or published partial candidate")
			}
		}
		hash := sha256.Sum256(wire)
		name := v.Name
		if i == 4 {
			name += "-current-epoch2"
		}
		public.Cases = append(public.Cases, invoiceTXPublicCase{Name: name, Kind: v.Kind, NetworkID: hex.EncodeToString(network), Owner: expected.Owner, NativeChainID: strconv.FormatUint(expected.NativeChainID, 10), KeyVersion: expected.KeyVersion, ExecutionHeight: expected.ExecutionHeight, PKA: hex.EncodeToString(expected.PKA), PKB: hex.EncodeToString(expected.PKB), MessageOriginalBase64URL: base64.RawURLEncoding.EncodeToString(message), PolicyOriginalBase64URL: base64.RawURLEncoding.EncodeToString(policy), MemberOriginalBase64URL: base64.RawURLEncoding.EncodeToString(wire), MemberSHA256: hex.EncodeToString(hash[:]), MemberBytes: len(wire), ResultCode: 0, CleanupStatus: uint32(cleanupLogicalComplete), IndependentANDVerified: true})
	}
	archiveSHA := os.Getenv("YNX_INVOICE_TX_CABI_ARCHIVE_SHA256")
	decoded, err := hex.DecodeString(archiveSHA)
	must(t, err)
	if len(decoded) != 32 || hex.EncodeToString(decoded) != archiveSHA {
		t.Fatal("exact shared archive SHA256 required")
	}
	archiveBytes, err := strconv.ParseUint(os.Getenv("YNX_INVOICE_TX_CABI_ARCHIVE_BYTES"), 10, 64)
	must(t, err)
	if archiveBytes == 0 || strconv.FormatUint(archiveBytes, 10) != os.Getenv("YNX_INVOICE_TX_CABI_ARCHIVE_BYTES") {
		t.Fatal("exact shared archive byte count required")
	}
	must(t, cleanupInvoiceCABIPrivate(directory))
	result := struct {
		invoiceTXPublicFixture
		ArchiveSHA256                string                   `json:"archiveSHA256"`
		ArchiveBytes                 uint64                   `json:"archiveBytes,string"`
		NativeTarget                 string                   `json:"nativeTarget"`
		CDriver                      invoiceCABIDriverReceipt `json:"cDriver"`
		GoUnknownGateVerified        bool                     `json:"goUnknownGateVerified"`
		RealKeychainApproval         bool                     `json:"realKeychainApproval"`
		SyntheticPrivateFilesRemoved bool                     `json:"syntheticPrivateFilesRemoved"`
	}{public, archiveSHA, archiveBytes, runtime.GOOS + "/" + runtime.GOARCH, receipt, true, false, true}
	raw, err := json.Marshal(result)
	must(t, err)
	must(t, invoiceCABIWrite(filepath.Dir(directory), "PUBLIC-RESULT.json", raw))
	t.Log("INVOICE_TX_CABI_INDEPENDENT_AND_PASS originals=4 members=5 actualCABI=true keychainApproval=false authority=false")
}

func TestInvoiceTransactionCABIFixtureOwnershipAndUnknownFiles(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	must(t, err)
	must(t, os.Chmod(parent, 0700))
	directory := filepath.Join(parent, "synthetic")
	must(t, os.Mkdir(directory, 0700))
	original := []byte("public exact unknown original")
	must(t, invoiceCABIWrite(directory, "member-0.bin", original))
	if invoiceCABIWrite(directory, "member-0.bin", []byte("replacement")) == nil {
		t.Fatal("existing public UNKNOWN output replaced")
	}
	for _, name := range invoiceCABIPrivateNames {
		must(t, invoiceCABIWrite(directory, name, []byte{1, 2, 3}))
	}
	must(t, cleanupInvoiceCABIPrivate(directory))
	got, err := invoiceCABIRead(directory, "member-0.bin", 100)
	must(t, err)
	if !bytes.Equal(got, original) {
		t.Fatal("cleanup changed original public member")
	}
	outside := filepath.Join(parent, "owned-original")
	must(t, os.WriteFile(outside, []byte{7}, 0600))
	must(t, os.Symlink(outside, filepath.Join(directory, invoiceCABIPrivateNames[0])))
	if cleanupInvoiceCABIPrivate(directory) == nil {
		t.Fatal("cleanup accepted aliased private leaf")
	}
	if b, err := os.ReadFile(outside); err != nil || !bytes.Equal(b, []byte{7}) {
		t.Fatal("cleanup removed unrelated original")
	}
	alias := filepath.Join(parent, "alias")
	must(t, os.Symlink(directory, alias))
	if invoiceCABIWrite(alias, "new", []byte{1}) == nil {
		t.Fatal("fixture accepted directory alias")
	}
}
