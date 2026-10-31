package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const invoiceSyntaxVectorSHA256 = "d5895426311ef8f4eea003d1ec548834d92ea9100052a5eed2d3d0616dbbff9a"

type invoiceTXCase struct {
	name, kind string
	in         txInputs
}

func invoiceTransactionFixture(t *testing.T) ([]invoiceTXCase, ynxauth.State, ynxbatch.KeyMaterial) {
	t.Helper()
	in, state, material := transactionFixture(t)
	raw, err := os.ReadFile("../../internal/ynxauth/testdata/invoice-action-v1.json")
	must(t, err)
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != invoiceSyntaxVectorSHA256 {
		t.Fatal("invoice syntax vector source changed")
	}
	var vectors struct {
		Version, AlgorithmVersion, Purpose, Encoding, Note string
		Envelope                                           struct {
			NetworkHex, NativeChainID, Owner, Nonce, Fee string
		}
		Vectors []struct {
			Name, Kind, Domain, PayloadHex, MessageHex string
			Input                                      map[string]string
			PayloadFields, PayloadBytes, MessageBytes  int
		}
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	must(t, d.Decode(&vectors))
	if vectors.Version != "YNX-INVOICE-ACTION-PUBLIC-VECTORS/v1" || vectors.AlgorithmVersion != ynxbatch.Version || vectors.Purpose != ynxauth.TransactionPurpose || len(vectors.Vectors) != 4 {
		t.Fatal("unexpected public invoice vector profile")
	}
	in.expected.NetworkID, err = hex.DecodeString(vectors.Envelope.NetworkHex)
	must(t, err)
	in.expected.Owner = vectors.Envelope.Owner
	in.expected.NativeChainID, err = strconv.ParseUint(vectors.Envelope.NativeChainID, 10, 64)
	must(t, err)
	state.NetworkID = bytes.Clone(in.expected.NetworkID)
	state.Records[0].Owner = in.expected.Owner
	in = transactionPolicy(t, in, state)
	var cases []invoiceTXCase
	for _, v := range vectors.Vectors {
		message, err := hex.DecodeString(v.MessageHex)
		must(t, err)
		payload, err := hex.DecodeString(v.PayloadHex)
		must(t, err)
		a, err := ynxauth.DecodeAction(message)
		must(t, err)
		canonical, err := a.SigningBytes()
		must(t, err)
		if !ynxauth.IsInvoiceAction(v.Kind) || a.Kind != v.Kind || a.Fee != ynxauth.InvoiceActionFee || !bytes.Equal(canonical, message) || !bytes.Equal(a.Payload, payload) || len(message) != v.MessageBytes {
			t.Fatal("fixed normal Action message does not match public codec vector")
		}
		x := in
		x.message = message
		cases = append(cases, invoiceTXCase{name: v.Name, kind: v.Kind, in: x})
	}
	return cases, state, material
}

func invoiceIndependentVerification(t *testing.T, plan txPlan, wire []byte) registeredN1VerifyCode {
	t.Helper()
	r, err := plan.policy.TrustedRegistration(plan.expected.Owner, ynxauth.TransactionPurpose, plan.height)
	must(t, err)
	revision, err := strconv.ParseUint(r.PolicyRevision, 10, 64)
	must(t, err)
	in := registeredN1Inputs{member: wire, message: plan.message, network: plan.expected.NetworkID,
		pkA: r.PKA, pkB: r.PKB, owner: plan.expected.Owner, purpose: ynxauth.TransactionPurpose,
		policyRevision: revision, observedHeight: plan.height, activeFrom: r.ActiveFrom, enabled: 1}
	if r.RevokedAt != nil {
		in.hasRevokedAt, in.revokedAt = 1, *r.RevokedAt
	}
	// This is the existing separate registered-N1 verifier, not a signer output
	// flag. It performs both complete signatures and both roots again.
	return verifyRegisteredANDMemberN1(in)
}

func invoiceSignNormalCore(t *testing.T, in txInputs, material ynxbatch.KeyMaterial) (txPlan, []byte) {
	t.Helper()
	plan := transactionPlan(t, in)
	wire, code, cleanup := signTransactionPrepared(plan, material)
	if code != resultOK || cleanup != cleanupLogicalComplete || len(wire) == 0 || len(wire) > txMemberCapacity {
		t.Fatal("invoice normal transaction core refused or released uncertain output")
	}
	must(t, inspectTransactionMember(plan, wire))
	if invoiceIndependentVerification(t, plan, wire) != registeredN1OK {
		t.Fatal("independent complete invoice AND verification failed")
	}
	return plan, wire
}

type invoiceTXPublicCase struct {
	Name                     string `json:"name"`
	Kind                     string `json:"kind"`
	NetworkID                string `json:"networkId"`
	Owner                    string `json:"owner"`
	NativeChainID            string `json:"nativeChainId"`
	KeyVersion               string `json:"keyVersion"`
	ExecutionHeight          string `json:"executionHeight"`
	PKA                      string `json:"pkA"`
	PKB                      string `json:"pkB"`
	MessageOriginalBase64URL string `json:"messageOriginalBase64Url"`
	PolicyOriginalBase64URL  string `json:"policyOriginalBase64Url"`
	MemberOriginalBase64URL  string `json:"memberOriginalBase64Url"`
	MemberSHA256             string `json:"memberSHA256"`
	MemberBytes              int    `json:"memberBytes"`
	ResultCode               int32  `json:"resultCode"`
	CleanupStatus            uint32 `json:"cleanupStatus"`
	IndependentANDVerified   bool   `json:"independentANDVerified"`
}

type invoiceTXPublicFixture struct {
	Version            string                `json:"version"`
	SyntaxVectorSHA256 string                `json:"syntaxVectorSHA256"`
	Purpose            string                `json:"purpose"`
	ProductionCABI     string                `json:"productionCABI"`
	ExecutedCallee     string                `json:"executedCallee"`
	SyntheticOnly      bool                  `json:"syntheticOnly"`
	ActualCABIExecuted bool                  `json:"actualCABIExecuted"`
	LedgerValidated    bool                  `json:"ledgerValidated"`
	AuthorityGranted   bool                  `json:"authorityGranted"`
	RootGranted        bool                  `json:"rootGranted"`
	Submitted          bool                  `json:"submitted"`
	Finality           bool                  `json:"finality"`
	Cases              []invoiceTXPublicCase `json:"cases"`
}

// This optional delivery is public DATA only. A fresh explicit directory is
// mandatory; failed/partial exports are retained, never replaced or removed.
func writeInvoiceTXPublic(directory string, fixture invoiceTXPublicFixture) error {
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return errors.New("canonical absolute public fixture directory required")
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(directory))
	if err != nil || parent != filepath.Dir(directory) {
		return errors.New("public fixture parent must exist without aliases")
	}
	if err := os.Mkdir(directory, 0700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(directory, "PUBLIC-INVOICE-TX.json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	n, err := f.Write(raw)
	if err != nil || n != len(raw) {
		_ = f.Close()
		return errors.New("public fixture write incomplete; preserve original")
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

func TestInvoiceTransactionCanonicalVectorsAndOwnedSigning(t *testing.T) {
	cases, _, material := invoiceTransactionFixture(t)
	before := cloneMaterial(material)
	defer before.Clear()
	public := invoiceTXPublicFixture{Version: "YNX-INVOICE-TX-CORE-PUBLIC-INTEROP/v1", SyntaxVectorSHA256: invoiceSyntaxVectorSHA256,
		Purpose: ynxauth.TransactionPurpose, ProductionCABI: "YNXTransactionBatchSignV1",
		ExecutedCallee: "prepareTransaction/signTransactionPrepared/inspectTransactionMember", SyntheticOnly: true}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plan, wire := invoiceSignNormalCore(t, tc.in, material)
			defer clear(wire)
			m, err := ynxbatch.DecodeMember(wire)
			must(t, err)
			if m.Certificate.N != 1 || m.Index != 0 || len(m.PathA)+len(m.PathB) != 0 || m.Certificate.Purpose != "TX-BATCH" || !bytes.Equal(m.Message, tc.in.message) || !bytes.Equal(m.Certificate.PKA, material.PKA) || !bytes.Equal(m.Certificate.PKB, material.PKB) {
				t.Fatal("invoice normal member profile or complete message changed")
			}
			equalMaterial(t, material, before)
			hash := sha256.Sum256(wire)
			public.Cases = append(public.Cases, invoiceTXPublicCase{Name: tc.name, Kind: tc.kind,
				NetworkID: hex.EncodeToString(plan.expected.NetworkID), Owner: plan.expected.Owner,
				NativeChainID: strconv.FormatUint(plan.expected.NativeChainID, 10), KeyVersion: plan.expected.KeyVersion,
				ExecutionHeight: plan.expected.ExecutionHeight, PKA: hex.EncodeToString(material.PKA), PKB: hex.EncodeToString(material.PKB),
				MessageOriginalBase64URL: base64.RawURLEncoding.EncodeToString(tc.in.message), PolicyOriginalBase64URL: base64.RawURLEncoding.EncodeToString(tc.in.policy),
				MemberOriginalBase64URL: base64.RawURLEncoding.EncodeToString(wire), MemberSHA256: hex.EncodeToString(hash[:]), MemberBytes: len(wire),
				ResultCode: int32(resultOK), CleanupStatus: uint32(cleanupLogicalComplete), IndependentANDVerified: true})
			t.Logf("INVOICE_TX_CORE_AND_VERIFIED kind=%s messageBytes=%d memberBytes=%d actualCABI=false ledgerValidated=false authority=false", tc.kind, len(tc.in.message), len(wire))
		})
	}
	if t.Failed() {
		return
	}
	if directory := os.Getenv("YNX_INVOICE_TX_PUBLIC_OUT"); directory != "" {
		must(t, writeInvoiceTXPublic(directory, public))
	}
	// The high numeric syntax vectors deliberately do not assert that their
	// invoice keyEpoch/revision/expiry/amount matches a live ledger. The signer
	// binds them unchanged; execution must enforce those separate business rules.
}

func TestInvoiceTransactionCurrentPolicyEpochAndFullPair(t *testing.T) {
	cases, state, material := invoiceTransactionFixture(t)
	key, next, err := ynxbatch.KeyGen()
	must(t, err)
	defer key.Destroy()
	nextMaterial, err := ynxbatch.ExportKeyMaterial(key)
	must(t, err)
	defer nextMaterial.Clear()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, mutate := range []func(*txInputs){
				func(x *txInputs) { x.expected.NetworkID = bytes.Repeat([]byte{0xff}, 32) },
				func(x *txInputs) { x.expected.Owner = "0x0000000000000000000000000000000000000000" },
				func(x *txInputs) { x.expected.NativeChainID++ },
				func(x *txInputs) { x.expected.KeyVersion = "2" },
				func(x *txInputs) { x.expected.ExecutionHeight = "1" },
				func(x *txInputs) { x.expected.PKA = bytes.Clone(next.PKA) },
				func(x *txInputs) { x.expected.PKB = bytes.Clone(next.PKB) },
				func(x *txInputs) { x.policy = []byte(`{"version":"YNX-ACCOUNT-POLICY/v1"}`) },
			} {
				x := tc.in
				mutate(&x)
				if _, code := prepareTransaction(x, txMemberCapacity); code != resultPublicBinding {
					t.Fatal("invoice accepted a foreign policy/epoch/full-pair binding")
				}
			}
			rotated := state.Clone()
			rotated.Records = append(rotated.Records, ynxauth.Record{AlgorithmVersion: ynxbatch.Version, Owner: tc.in.expected.Owner,
				PKA: next.PKA, PKB: next.PKB, Revision: 2, RegisteredAt: 3, ActiveFrom: 8, LedgerNonce: 2})
			input := transactionPolicy(t, tc.in, rotated)
			transactionPlan(t, input) // Pending rotation leaves the original pair active at H7.
			input.expected.ExecutionHeight = "8"
			if _, code := prepareTransaction(input, txMemberCapacity); code != resultPublicBinding {
				t.Fatal("invoice signer accepted superseded keys at activation")
			}
			input.expected.KeyVersion, input.expected.PKA, input.expected.PKB = "2", bytes.Clone(next.PKA), bytes.Clone(next.PKB)
			plan := transactionPlan(t, input)
			out, code, cleanup := signTransactionPrepared(plan, material)
			if len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
				t.Fatal("current invoice policy accepted old borrowed private material")
			}
			_, wire := invoiceSignNormalCore(t, input, nextMaterial)
			defer clear(wire)
			rotated.Version = ynxauth.PolicyRevocationVersion
			rotated.Revocations = []ynxauth.RevocationRecord{{Owner: input.expected.Owner, AuthorizingRevision: 2, ThroughRevision: 2, RegisteredAt: 8, RevokedFrom: 9, LedgerNonce: 3}}
			input = transactionPolicy(t, input, rotated)
			transactionPlan(t, input) // Historical H8 remains valid, without classic fallback.
			input.expected.ExecutionHeight = "9"
			if _, code := prepareTransaction(input, txMemberCapacity); code != resultPublicBinding {
				t.Fatal("invoice signer accepted terminally revoked policy")
			}
			must(t, rotated.VerifyMember(plan.expected.Owner, ynxauth.TransactionPurpose, plan.message, wire, 8))
			if rotated.VerifyMember(plan.expected.Owner, ynxauth.TransactionPurpose, plan.message, wire, 9) == nil {
				t.Fatal("invoice member revived after terminal revocation")
			}
		})
	}
}

func TestInvoiceTransactionANDTamperAndUnknownPreservation(t *testing.T) {
	cases, _, material := invoiceTransactionFixture(t)
	before := cloneMaterial(material)
	defer before.Clear()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plan, wire := invoiceSignNormalCore(t, tc.in, material)
			defer clear(wire)
			retained := bytes.Clone(wire) // The caller keeps its exact original before late checks.
			defer clear(retained)
			for _, part := range []string{"signature A", "signature B", "network", "owner", "purpose", "public A", "public B", "message"} {
				m, err := ynxbatch.DecodeMember(wire)
				must(t, err)
				switch part {
				case "signature A":
					m.Certificate.SigmaA[0] ^= 1
				case "signature B":
					m.Certificate.SigmaB[0] ^= 1
				case "network":
					m.Certificate.ChainID[0] ^= 1
				case "owner":
					m.Certificate.Owner = "0x0000000000000000000000000000000000000000"
				case "purpose":
					m.Certificate.Purpose = "ARTIFACT-RELEASE"
				case "public A":
					m.Certificate.PKA[0] ^= 1
				case "public B":
					m.Certificate.PKB[0] ^= 1
				case "message":
					m.Message[len(m.Message)-1] ^= 1
				}
				bad, err := ynxbatch.EncodeMember(m)
				must(t, err)
				if inspectTransactionMember(plan, bad) == nil || invoiceIndependentVerification(t, plan, bad) == registeredN1OK {
					t.Fatalf("invoice signer output accepted corrupted %s", part)
				}
			}
			for _, other := range cases {
				if tc.kind == other.kind {
					continue
				}
				m, err := ynxbatch.DecodeMember(wire)
				must(t, err)
				m.Message = bytes.Clone(other.in.message)
				bad, err := ynxbatch.EncodeMember(m)
				must(t, err)
				if invoiceIndependentVerification(t, transactionPlan(t, other.in), bad) == registeredN1OK {
					t.Fatal("one invoice operation reused another operation's signature")
				}
			}
			for _, branch := range []string{"A", "B"} {
				bad := cloneMaterial(material)
				if branch == "A" {
					bad.PKCS8A[22] ^= 1
				} else {
					bad.PKCS8B[118] ^= 1
				}
				borrow := cloneMaterial(bad)
				out, code, cleanup := signTransactionPrepared(plan, bad)
				if len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
					t.Fatal("invalid invoice private branch released partial output")
				}
				equalMaterial(t, bad, borrow)
				bad.Clear()
				borrow.Clear()
			}
			for _, failure := range []struct {
				panicked, clean bool
				code            resultCode
				cleanup         cleanupCode
			}{{true, true, resultInternal, cleanupUnknown}, {false, false, resultCleanup, cleanupFailed}} {
				candidate := bytes.Clone(wire)
				out, code, cleanup := finishTransaction(candidate, resultOK, failure.panicked, failure.clean)
				if len(out) != 0 || code != failure.code || cleanup != failure.cleanup || !bytes.Equal(candidate, make([]byte, len(candidate))) {
					t.Fatal("invoice uncertain cleanup published usable partial output")
				}
				if !bytes.Equal(wire, retained) {
					t.Fatal("failed later attempt replaced the retained invoice original")
				}
			}
			late := tc.in
			late.expected.KeyVersion = "2"
			if _, code := prepareTransaction(late, txMemberCapacity); code != resultPublicBinding || !bytes.Equal(wire, retained) {
				t.Fatal("late current check silently replaced the original invoice member")
			}
			must(t, inspectTransactionMember(plan, retained))
			equalMaterial(t, material, before)
		})
	}
	// This exercises the original core's UNKNOWN publication gate. It does not
	// claim execution of the C pointer/overlap checks or Wallet journal recovery.
}

func TestInvoiceTransactionPublicExportPreservesExisting(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	must(t, err)
	fixture := invoiceTXPublicFixture{Version: "YNX-INVOICE-TX-CORE-PUBLIC-INTEROP/v1", SyntheticOnly: true}
	directory := filepath.Join(parent, "new-public")
	must(t, writeInvoiceTXPublic(directory, fixture))
	path := filepath.Join(directory, "PUBLIC-INVOICE-TX.json")
	original, err := os.ReadFile(path)
	must(t, err)
	if writeInvoiceTXPublic(directory, fixture) == nil {
		t.Fatal("public fixture export overwrote an existing or UNKNOWN result")
	}
	after, err := os.ReadFile(path)
	must(t, err)
	if !bytes.Equal(original, after) || bytes.Contains(original, []byte("pkcs8")) || bytes.Contains(original, []byte("privateKey")) {
		t.Fatal("public delivery changed an original or serialized private material")
	}
	alias := filepath.Join(parent, "alias")
	must(t, os.Symlink(directory, alias))
	if writeInvoiceTXPublic(alias, fixture) == nil || writeInvoiceTXPublic(filepath.Join(alias, "child"), fixture) == nil || writeInvoiceTXPublic("relative", fixture) == nil {
		t.Fatal("public fixture accepted an alias or relative output")
	}
}
