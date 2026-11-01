package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/hex"
	"math/big"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

// Only synthetic ephemeral keys; no original account, approval, funds or Node.
func migrationPUBLICFixture(t *testing.T) (migrationInputs, ynxauth.State, ynxbatch.KeyMaterial, *ynxbatch.PrivateKey, *secp256k1.PrivateKey) {
	t.Helper()
	classic, err := secp256k1.GeneratePrivateKey()
	must(t, err)
	t.Cleanup(classic.Zero)
	h := sha3.NewLegacyKeccak256()
	_, err = h.Write(classic.PubKey().SerializeUncompressed()[1:])
	must(t, err)
	digest := h.Sum(nil)
	owner := "0x" + hex.EncodeToString(digest[len(digest)-20:])
	key, pub, err := ynxbatch.KeyGen()
	must(t, err)
	t.Cleanup(key.Destroy)
	material, err := ynxbatch.ExportKeyMaterial(key)
	must(t, err)
	t.Cleanup(material.Clear)
	state := ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: bytes.Repeat([]byte{0x39}, 32), EnableAt: 1}
	policy, err := ynxauth.EncodeWalletPolicyProjection(state, owner)
	must(t, err)
	intent := ynxauth.RegistrationIntent{ChainID: state.NetworkID, Owner: owner, PKA: pub.PKA, PKB: pub.PKB,
		PriorRevision: 0, NewRevision: 1, LedgerNonce: 41, ActivateAt: 8}
	message, err := intent.SigningBytes()
	must(t, err)
	hash := sha256.Sum256(message)
	in := migrationInputs{message: message, policy: policy, classicPublicKey: classic.PubKey().SerializeCompressed(),
		classicSignature: ecdsa.Sign(classic, hash[:]).Serialize(), signingPKA: bytes.Clone(pub.PKA), signingPKB: bytes.Clone(pub.PKB),
		expected: migrationExpected{NetworkID: bytes.Clone(state.NetworkID), Owner: owner, NewRevision: "1", CurrentNonce: "40", ExecutionHeight: "7",
			PKA: bytes.Clone(pub.PKA), PKB: bytes.Clone(pub.PKB)}}
	return in, state, material, key, classic
}

func migrationPUBLICPolicy(t *testing.T, in migrationInputs, s ynxauth.State) migrationInputs {
	t.Helper()
	var err error
	in.policy, err = ynxauth.EncodeWalletPolicyProjection(s, in.expected.Owner)
	must(t, err)
	return in
}

func migrationPUBLICIntent(t *testing.T, in migrationInputs, classic *secp256k1.PrivateKey, edit func(*ynxauth.RegistrationIntent)) migrationInputs {
	t.Helper()
	intent, err := ynxauth.DecodeRegistrationIntent(in.message)
	must(t, err)
	edit(&intent)
	in.message, err = intent.SigningBytes()
	must(t, err)
	if classic != nil {
		hash := sha256.Sum256(in.message)
		in.classicSignature = ecdsa.Sign(classic, hash[:]).Serialize()
	}
	return in
}

func TestAccountMigrationCABIPUBLICOriginalWholeAndBothSignatures(t *testing.T) {
	in, state, material, _, _ := migrationPUBLICFixture(t)
	beforeState, beforeMaterial := state.Clone(), cloneMaterial(material)
	defer beforeMaterial.Clear()
	plan, code := prepareMigration(in, migrationWholeCapacity)
	if code != resultOK || !reflect.DeepEqual(state, beforeState) {
		t.Fatal("public preflight changed or refused synthetic original state")
	}
	// The successful authorization preflight is NOT admission or possession.
	if _, err := plan.policy.AdmitMigration(plan.migration, plan.height, plan.nonce); err == nil {
		t.Fatal("authorization-only plan admitted an absent proposed-pair proof")
	}
	whole, code, cleanup := signMigrationPrepared(plan, material)
	defer clear(whole)
	if code != resultOK || cleanup != cleanupLogicalComplete || len(whole) == 0 || len(whole) > migrationWholeCapacity {
		t.Fatal("fixed migration proof or logical cleanup failed")
	}
	must(t, inspectMigrationPossession(plan, whole))
	w, err := ynxbatch.DecodeWhole(whole)
	must(t, err)
	if w.Certificate.Purpose != ynxauth.MigrationPurpose || w.Certificate.N != 1 || len(w.Messages) != 1 || !bytes.Equal(w.Messages[0], in.message) {
		t.Fatal("not original ACCOUNT-MIGRATION N1 Whole")
	}
	for _, branch := range []string{"A", "B", "TX-purpose", "foreign-new-pair", "foreign-network"} {
		t.Run(branch, func(t *testing.T) {
			bad, e := ynxbatch.DecodeWhole(whole)
			must(t, e)
			switch branch {
			case "A":
				bad.Certificate.SigmaA[0] ^= 1
			case "B":
				bad.Certificate.SigmaB[0] ^= 1
			case "TX-purpose":
				bad.Certificate.Purpose = ynxauth.TransactionPurpose
			case "foreign-new-pair":
				bad.Certificate.PKB[0] ^= 1
			case "foreign-network":
				bad.Certificate.ChainID[0] ^= 1
			}
			wire, e := ynxbatch.EncodeWhole(bad)
			must(t, e)
			if inspectMigrationPossession(plan, wire) == nil {
				t.Fatal("invalid possession accepted")
			}
		})
	}
	for _, bad := range [][]byte{whole[:len(whole)-1], append(bytes.Clone(whole), 0)} {
		if inspectMigrationPossession(plan, bad) == nil {
			t.Fatal("noncanonical Whole accepted")
		}
	}
	// Existing Main still assembles E6; Core admission returns only a detached
	// state, leaves original history unchanged, and defers activation to H+1.
	m := plan.migration
	m.NewKeyProof = whole
	wire, err := m.Encode()
	must(t, err)
	decoded, err := ynxauth.DecodeMigration(wire)
	must(t, err)
	next, err := state.AdmitMigration(decoded, 7, 40)
	must(t, err)
	if _, active := next.PolicyAt(in.expected.Owner, 7); active {
		t.Fatal("pending pair became active early")
	}
	if r, active := next.PolicyAt(in.expected.Owner, 8); !active || r.LedgerNonce != 41 || r.Revision != 1 {
		t.Fatal("original activation/nonce contract changed")
	}
	if !reflect.DeepEqual(state, beforeState) || !reflect.DeepEqual(plan.policy, beforeState) {
		t.Fatal("signing committed or mutated source policy")
	}
	equalMaterial(t, material, beforeMaterial)
}

func TestAccountMigrationCABIPUBLICPreflightNoPrivateInput(t *testing.T) {
	in, state, _, _, classic := migrationPUBLICFixture(t)
	for name, edit := range map[string]func(migrationInputs) migrationInputs{
		"network": func(x migrationInputs) migrationInputs {
			x.expected.NetworkID = bytes.Repeat([]byte{0x40}, 32)
			return x
		},
		"owner": func(x migrationInputs) migrationInputs { x.expected.Owner = "0x" + strings.Repeat("11", 20); return x },
		"foreign-pair-A": func(x migrationInputs) migrationInputs {
			x.signingPKA = make([]byte, ynxbatch.PublicKeyASize)
			return x
		},
		"foreign-pair-B": func(x migrationInputs) migrationInputs {
			x.expected.PKB = make([]byte, ynxbatch.PublicKeyBSize)
			return x
		},
		"new-revision":                          func(x migrationInputs) migrationInputs { x.expected.NewRevision = "2"; return x },
		"current-ledger-nonce-not-auth-counter": func(x migrationInputs) migrationInputs { x.expected.CurrentNonce = "41"; return x },
		"nonce-alias":                           func(x migrationInputs) migrationInputs { x.expected.CurrentNonce = "040"; return x },
		"nonce-overflow":                        func(x migrationInputs) migrationInputs { x.expected.CurrentNonce = "18446744073709551616"; return x },
		"height-alias":                          func(x migrationInputs) migrationInputs { x.expected.ExecutionHeight = "+7"; return x },
		"missing-classic":                       func(x migrationInputs) migrationInputs { x.classicSignature = nil; return x },
		"bad-classic": func(x migrationInputs) migrationInputs {
			x.classicSignature = bytes.Clone(x.classicSignature)
			x.classicSignature[len(x.classicSignature)-1] ^= 1
			return x
		},
		"trailing-DER": func(x migrationInputs) migrationInputs {
			x.classicSignature = append(bytes.Clone(x.classicSignature), 0)
			return x
		},
		"unexpected-current-PQ": func(x migrationInputs) migrationInputs { x.currentPQProof = []byte{1}; return x },
		"canonical-intent-tail": func(x migrationInputs) migrationInputs { x.message = append(bytes.Clone(x.message), 0); return x },
		"not-future-activation": func(x migrationInputs) migrationInputs {
			return migrationPUBLICIntent(t, x, classic, func(i *ynxauth.RegistrationIntent) { i.ActivateAt = 7 })
		},
		"old-nonce-signed-validly": func(x migrationInputs) migrationInputs {
			return migrationPUBLICIntent(t, x, classic, func(i *ynxauth.RegistrationIntent) { i.LedgerNonce = 40 })
		},
		"not-enabled": func(x migrationInputs) migrationInputs {
			s := state.Clone()
			s.EnableAt = 8
			return migrationPUBLICPolicy(t, x, s)
		},
		"policy-duplicate": func(x migrationInputs) migrationInputs {
			x.policy = append(bytes.Clone(x.policy[:len(x.policy)-1]), []byte(`,"version":"YNX-ACCOUNT-POLICY/v1"}`)...)
			return x
		},
	} {
		t.Run(name, func(t *testing.T) {
			before := state.Clone()
			// prepareMigration's type contains only public DATA: no secret,
			// custody handle or private callback is available on these failures.
			if _, code := prepareMigration(edit(in), migrationWholeCapacity); code == resultOK {
				t.Fatal("invalid current authority/public binding accepted")
			}
			if !reflect.DeepEqual(before, state) {
				t.Fatal("rejection mutated source policy")
			}
		})
	}
	var parsed struct{ R, S *big.Int }
	rest, err := asn1.Unmarshal(in.classicSignature, &parsed)
	must(t, err)
	if len(rest) != 0 {
		t.Fatal("unexpected original DER tail")
	}
	order, _ := new(big.Int).SetString("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", 16)
	parsed.S = new(big.Int).Sub(order, parsed.S)
	x := in
	x.classicSignature, err = asn1.Marshal(parsed)
	must(t, err)
	if _, code := prepareMigration(x, migrationWholeCapacity); code == resultOK {
		t.Fatal("high-S migration accepted")
	}
	for _, capacity := range []uint64{0, migrationWholeCapacity - 1, migrationWholeCapacity + 1, ^uint64(0)} {
		if _, code := prepareMigration(in, capacity); code != resultCapacity {
			t.Fatal("nonfixed capacity accepted")
		}
	}
	for _, field := range []string{"message", "policy", "classic-key", "classic-signature", "current-proof"} {
		x := in
		switch field {
		case "message":
			x.message = make([]byte, migrationMessageMaximum+1)
		case "policy":
			x.policy = make([]byte, txPolicyMaximum+1)
		case "classic-key":
			x.classicPublicKey = make([]byte, 34)
		case "classic-signature":
			x.classicSignature = make([]byte, 73)
		case "current-proof":
			x.currentPQProof = make([]byte, migrationProofMaximum+1)
		}
		if _, code := prepareMigration(x, migrationWholeCapacity); code != resultBounds {
			t.Fatal("oversize public input accepted")
		}
	}
}

func TestAccountMigrationCABIPUBLICCurrentPQNoLegacyFallback(t *testing.T) {
	in, state, currentMaterial, current, _ := migrationPUBLICFixture(t)
	state.Records = []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: in.expected.Owner, PKA: bytes.Clone(currentMaterial.PKA), PKB: bytes.Clone(currentMaterial.PKB), Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 1}}
	next, pub, err := ynxbatch.KeyGen()
	must(t, err)
	t.Cleanup(next.Destroy)
	nextMaterial, err := ynxbatch.ExportKeyMaterial(next)
	must(t, err)
	t.Cleanup(nextMaterial.Clear)
	in = migrationPUBLICIntent(t, in, nil, func(i *ynxauth.RegistrationIntent) {
		i.PriorRevision = 1
		i.NewRevision = 2
		i.PKA = pub.PKA
		i.PKB = pub.PKB
	})
	in.expected.NewRevision = "2"
	in.expected.PKA = bytes.Clone(pub.PKA)
	in.expected.PKB = bytes.Clone(pub.PKB)
	in.signingPKA = bytes.Clone(pub.PKA)
	in.signingPKB = bytes.Clone(pub.PKB)
	in = migrationPUBLICPolicy(t, in, state)
	if _, code := prepareMigration(in, migrationWholeCapacity); code == resultOK {
		t.Fatal("classic proof recovered an already active PQ account")
	}
	in.classicPublicKey = nil
	in.classicSignature = nil
	if _, code := prepareMigration(in, migrationWholeCapacity); code == resultOK {
		t.Fatal("active PQ without current full-pair proof accepted")
	}
	b, err := ynxbatch.BatchSign(current, ynxbatch.Metadata{ChainID: state.NetworkID, Owner: in.expected.Owner, Purpose: ynxauth.MigrationPurpose}, [][]byte{in.message}, ynxbatch.SignOptions{Optimized: true})
	must(t, err)
	defer b.Discard()
	m, err := ynxbatch.Extract(b, 0)
	must(t, err)
	in.currentPQProof, err = ynxbatch.EncodeMember(m)
	must(t, err)
	plan, code := prepareMigration(in, migrationWholeCapacity)
	if code != resultOK {
		t.Fatal("actual current dual proof refused")
	}
	whole, code, cleanup := signMigrationPrepared(plan, nextMaterial)
	defer clear(whole)
	if code != resultOK || cleanup != cleanupLogicalComplete {
		t.Fatal("actual rotation possession failed")
	}
	must(t, inspectMigrationPossession(plan, whole))
	for _, branch := range []string{"A", "B", "TX-purpose"} {
		t.Run(branch, func(t *testing.T) {
			bad, err := ynxbatch.DecodeMember(in.currentPQProof)
			must(t, err)
			if branch == "A" {
				bad.Certificate.SigmaA[0] ^= 1
			} else if branch == "B" {
				bad.Certificate.SigmaB[0] ^= 1
			} else {
				bad.Certificate.Purpose = ynxauth.TransactionPurpose
			}
			x := in
			x.currentPQProof, err = ynxbatch.EncodeMember(bad)
			must(t, err)
			if _, code := prepareMigration(x, migrationWholeCapacity); code == resultOK {
				t.Fatal("invalid current proof passed before proposed-key borrow")
			}
		})
	}
	pending := state.Clone()
	pending.Records[0].ActiveFrom = 8
	if _, code := prepareMigration(migrationPUBLICPolicy(t, in, pending), migrationWholeCapacity); code == resultOK {
		t.Fatal("pending revision ignored")
	}
	revoked := state.Clone()
	revoked.Version = ynxauth.PolicyRevocationVersion
	revoked.Revocations = []ynxauth.RevocationRecord{{Owner: in.expected.Owner, AuthorizingRevision: 1, ThroughRevision: 1, RegisteredAt: 3, RevokedFrom: 4, LedgerNonce: 2}}
	if _, code := prepareMigration(migrationPUBLICPolicy(t, in, revoked), migrationWholeCapacity); code == resultOK {
		t.Fatal("terminal revocation bypassed")
	}
	// Zero is a lawful original account nonce; decimal aliases/overflow are not.
	for _, n := range []uint64{0, 1<<53 + 9, ^uint64(0)} {
		if actual, ok := migrationNonceDecimal(strconv.FormatUint(n, 10)); !ok || actual != n {
			t.Fatal("canonical original nonce narrowed")
		}
	}
}

func TestAccountMigrationCABIPUBLICOwnedPlanAndWrongPrivatePair(t *testing.T) {
	in, _, material, _, _ := migrationPUBLICFixture(t)
	plan, code := prepareMigration(in, migrationWholeCapacity)
	if code != resultOK {
		t.Fatal("preflight")
	}
	before := cloneMaterial(material)
	defer before.Clear()
	in.message[0] ^= 1
	in.policy[0] ^= 1
	in.classicPublicKey[0] ^= 1
	in.classicSignature[0] ^= 1
	in.expected.PKA[0] ^= 1
	in.signingPKB[0] ^= 1
	whole, code, cleanup := signMigrationPrepared(plan, material)
	defer clear(whole)
	if code != resultOK || cleanup != cleanupLogicalComplete {
		t.Fatal("plan retained caller-owned public bytes")
	}
	must(t, inspectMigrationPossession(plan, whole))
	equalMaterial(t, material, before)
	wrong := cloneMaterial(material)
	defer wrong.Clear()
	wrong.PKA[0] ^= 1
	if out, code, cleanup := signMigrationPrepared(plan, wrong); out != nil || code != resultKeyMaterial || cleanup != cleanupNotRequired {
		t.Fatal("foreign exposed public pair was not refused before private copy")
	}
	wrong.PKA[0] ^= 1
	wrong.PKCS8A[0] ^= 1
	if out, code, cleanup := signMigrationPrepared(plan, wrong); out != nil || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
		t.Fatal("malformed private material published a proof or lost cleanup")
	}
}

// The public C header's 64-bit POD layout. This is a caller allocation, not an
// alternate signer/crypto provider. Reflect constructs the actual generated C
// pointer types, so this test calls the production exported bridge without an
// import-C test file or a second runtime. External C/archive linking stays a
// separate normal native-host CI acceptance step.
type migrationPUBLICABISpan struct {
	Data unsafe.Pointer
	Size uintptr
}
type migrationPUBLICABIExpected struct {
	Network, Owner, Revision, Nonce, Height, PKA, PKB migrationPUBLICABISpan
}
type migrationPUBLICABIRequest struct {
	Version                                                     uint32
	Size                                                        uintptr
	Message, Policy, ClassicKey, ClassicSignature, CurrentProof migrationPUBLICABISpan
	Expected                                                    migrationPUBLICABIExpected
	PrivateA, PrivateB, PublicA, PublicB                        migrationPUBLICABISpan
}

func migrationPUBLICSpan(raw []byte) migrationPUBLICABISpan {
	if len(raw) == 0 {
		return migrationPUBLICABISpan{}
	}
	return migrationPUBLICABISpan{unsafe.Pointer(&raw[0]), uintptr(len(raw))}
}

func TestAccountMigrationCABIPUBLICBridgeLayoutAndCall(t *testing.T) {
	in, _, material, _, _ := migrationPUBLICFixture(t)
	before := cloneMaterial(material)
	defer before.Clear()
	plan, code := prepareMigration(in, migrationWholeCapacity)
	if code != resultOK {
		t.Fatal("public preflight")
	}
	req := migrationPUBLICABIRequest{Version: 1, Size: unsafe.Sizeof(migrationPUBLICABIRequest{}), Message: migrationPUBLICSpan(in.message), Policy: migrationPUBLICSpan(in.policy),
		ClassicKey: migrationPUBLICSpan(in.classicPublicKey), ClassicSignature: migrationPUBLICSpan(in.classicSignature),
		Expected: migrationPUBLICABIExpected{migrationPUBLICSpan(in.expected.NetworkID), migrationPUBLICSpan([]byte(in.expected.Owner)), migrationPUBLICSpan([]byte(in.expected.NewRevision)), migrationPUBLICSpan([]byte(in.expected.CurrentNonce)), migrationPUBLICSpan([]byte(in.expected.ExecutionHeight)), migrationPUBLICSpan(in.expected.PKA), migrationPUBLICSpan(in.expected.PKB)},
		PrivateA: migrationPUBLICSpan(material.PKCS8A), PrivateB: migrationPUBLICSpan(material.PKCS8B), PublicA: migrationPUBLICSpan(material.PKA), PublicB: migrationPUBLICSpan(material.PKB)}
	function := reflect.ValueOf(YNXAccountMigrationPossessionSignV1)
	if req.Size != 272 || function.Type().In(0).Elem().Size() != req.Size || unsafe.Offsetof(req.Expected) != 96 || unsafe.Offsetof(req.PrivateA) != 208 {
		t.Fatal("public ABI64 caller layout differs")
	}
	buffer := bytes.Repeat([]byte{0xa5}, migrationWholeCapacity+16)
	length := uintptr(777)
	cleanup := uint32(999)
	call := func(r *migrationPUBLICABIRequest, capacity uintptr, lengthPointer unsafe.Pointer, cleanupPointer unsafe.Pointer) int32 {
		args := []reflect.Value{reflect.Zero(function.Type().In(0)), reflect.NewAt(function.Type().In(1).Elem(), unsafe.Pointer(&buffer[0])), reflect.ValueOf(capacity).Convert(function.Type().In(2)), reflect.NewAt(function.Type().In(3).Elem(), lengthPointer), reflect.NewAt(function.Type().In(4).Elem(), cleanupPointer)}
		if r != nil {
			args[0] = reflect.NewAt(function.Type().In(0).Elem(), unsafe.Pointer(r))
		}
		result := int32(function.Call(args)[0].Int())
		runtime.KeepAlive(r)
		runtime.KeepAlive(in)
		runtime.KeepAlive(material)
		runtime.KeepAlive(buffer)
		return result
	}
	reject := func(r *migrationPUBLICABIRequest, capacity uintptr, want resultCode, layout bool, wantCleanup cleanupCode) {
		t.Helper()
		snapshot := bytes.Clone(buffer)
		length = 777
		cleanup = 999
		if got := call(r, capacity, unsafe.Pointer(&length), unsafe.Pointer(&cleanup)); got != int32(want) {
			t.Fatalf("actual bridge returned %d, expected %d", got, want)
		}
		if !bytes.Equal(buffer, snapshot) {
			t.Fatal("failure modified caller output")
		}
		if layout {
			if length != 777 || cleanup != 999 {
				t.Fatal("layout rejection wrote failure scalars")
			}
		} else if length != 0 || cleanup != uint32(wantCleanup) {
			t.Fatal("admitted failure output/cleanup contract changed")
		}
	}
	t.Run("nil-and-fixed-capacity", func(t *testing.T) {
		reject(nil, migrationWholeCapacity, resultInvalidArgument, true, cleanupUnknown)
		reject(&req, migrationWholeCapacity-1, resultCapacity, true, cleanupUnknown)
	})
	t.Run("private-output-alias", func(t *testing.T) {
		changed := req
		changed.PrivateA = migrationPUBLICSpan(buffer[:ynxbatch.PKCS8ASize])
		reject(&changed, migrationWholeCapacity, resultOverlap, true, cleanupUnknown)
	})
	t.Run("empty-current-proof-valid-classic-and-public-refusal-before-import", func(t *testing.T) {
		changed := req
		changed.Expected.Nonce = migrationPUBLICSpan([]byte("41"))
		reject(&changed, migrationWholeCapacity, resultPublicBinding, false, cleanupNotRequired)
	})
	t.Run("real-private-DER-failure-no-output", func(t *testing.T) {
		material.PKCS8A[0] ^= 1
		defer func() { material.PKCS8A[0] ^= 1 }()
		reject(&req, migrationWholeCapacity, resultKeyMaterial, false, cleanupLogicalComplete)
	})
	t.Run("scalar-output-alias", func(t *testing.T) {
		snapshot := bytes.Clone(buffer)
		cleanup = 999
		if got := call(&req, migrationWholeCapacity, unsafe.Pointer(&buffer[0]), unsafe.Pointer(&cleanup)); got != int32(resultOverlap) || !bytes.Equal(buffer, snapshot) || cleanup != 999 {
			t.Fatal("overlapping scalar wrote caller data")
		}
	})
	t.Run("actual-exported-bridge-success", func(t *testing.T) {
		length = 0
		cleanup = uint32(cleanupUnknown)
		if got := call(&req, migrationWholeCapacity, unsafe.Pointer(&length), unsafe.Pointer(&cleanup)); got != 0 || cleanup != uint32(cleanupLogicalComplete) || length == 0 || length > migrationWholeCapacity {
			t.Fatalf("production bridge did not return a complete proof: %d", got)
		}
		must(t, inspectMigrationPossession(plan, buffer[:length]))
		if !bytes.Equal(buffer[length:], bytes.Repeat([]byte{0xa5}, len(buffer)-int(length))) {
			t.Fatal("success changed unused capacity/canary")
		}
		equalMaterial(t, material, before)
	})
}

func TestAccountMigrationCABIPUBLICSecretPublicAliasBoundary(t *testing.T) {
	// Synthetic bytes only, no key generation or signing. Allowed layouts reach
	// the ordinary public-binding refusal; forbidden layouts must stop BEFORE
	// copying any public span or writing either output scalar. All span extents
	// below are real live allocations, including overlapping/adjacent extents.
	arena := bytes.Repeat([]byte{0x35}, 16384)
	buffer := bytes.Repeat([]byte{0xa5}, migrationWholeCapacity+16)
	span := func(offset, size int) migrationPUBLICABISpan { return migrationPUBLICSpan(arena[offset : offset+size]) }
	fresh := func() migrationPUBLICABIRequest {
		return migrationPUBLICABIRequest{Version: 1, Size: unsafe.Sizeof(migrationPUBLICABIRequest{}),
			Message: span(0, 8), Policy: span(0, 8), ClassicKey: span(0, 33), ClassicSignature: span(0, 8), CurrentProof: span(0, 8),
			Expected: migrationPUBLICABIExpected{span(0, 32), span(0, 42), span(0, 2), span(0, 2), span(0, 2), span(0, 2592), span(0, 64)},
			PrivateA: span(4096, 54), PrivateB: span(8192, 150), PublicA: span(0, 2592), PublicB: span(0, 64)}
	}
	fields := []struct {
		name string
		get  func(*migrationPUBLICABIRequest) *migrationPUBLICABISpan
	}{
		{"message", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Message }},
		{"policy", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Policy }},
		{"classic-public-key", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.ClassicKey }},
		{"classic-signature", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.ClassicSignature }},
		{"current-proof", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.CurrentProof }},
		{"network", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.Network }},
		{"owner", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.Owner }},
		{"revision", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.Revision }},
		{"nonce", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.Nonce }},
		{"height", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.Height }},
		{"expected-A", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.PKA }},
		{"expected-B", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.PKB }},
		{"signing-public-A", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.PublicA }},
		{"signing-public-B", func(r *migrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.PublicB }},
	}
	function := reflect.ValueOf(YNXAccountMigrationPossessionSignV1)
	call := func(t *testing.T, r *migrationPUBLICABIRequest, want resultCode, layout bool) {
		t.Helper()
		before, publicBefore := bytes.Clone(buffer), bytes.Clone(arena)
		length, cleanup := uintptr(777), uint32(999)
		args := []reflect.Value{reflect.NewAt(function.Type().In(0).Elem(), unsafe.Pointer(r)),
			reflect.NewAt(function.Type().In(1).Elem(), unsafe.Pointer(&buffer[0])), reflect.ValueOf(uintptr(migrationWholeCapacity)).Convert(function.Type().In(2)),
			reflect.NewAt(function.Type().In(3).Elem(), unsafe.Pointer(&length)), reflect.NewAt(function.Type().In(4).Elem(), unsafe.Pointer(&cleanup))}
		got := int32(function.Call(args)[0].Int())
		runtime.KeepAlive(r)
		runtime.KeepAlive(arena)
		if got != int32(want) {
			t.Errorf("actual production bridge result=%d want=%d", got, want)
		}
		if !bytes.Equal(buffer, before) || !bytes.Equal(arena, publicBefore) {
			t.Error("refusal changed caller allocation")
		}
		if layout {
			if length != 777 || cleanup != 999 {
				t.Error("secret/public layout refusal wrote output scalars")
			}
		} else if length != 0 || cleanup != uint32(cleanupNotRequired) {
			t.Error("allowed layout did not reach normal public preflight")
		}
	}
	for _, secret := range []struct {
		name        string
		start, size int
	}{{"PKCS8-A", 4096, 54}, {"PKCS8-B", 8192, 150}} {
		for _, field := range fields {
			for _, position := range []string{"same-start", "partial-before", "partial-after", "adjacent-before", "adjacent-after"} {
				t.Run(secret.name+"/"+field.name+"/"+position, func(t *testing.T) {
					r := fresh()
					target := field.get(&r)
					size := int(target.Size)
					offset := secret.start
					layout := true
					switch position {
					case "partial-before":
						offset = secret.start - size + 1
					case "partial-after":
						offset = secret.start + secret.size - 1
					case "adjacent-before":
						offset = secret.start - size
						layout = false
					case "adjacent-after":
						offset = secret.start + secret.size
						layout = false
					}
					*target = span(offset, size)
					want := resultOverlap
					if !layout {
						want = resultPublicBinding
					}
					call(t, &r, want, layout)
				})
			}
		}
	}
	t.Run("all-public-spans-may-alias", func(t *testing.T) { r := fresh(); call(t, &r, resultPublicBinding, false) })
	t.Run("private-spans-may-alias", func(t *testing.T) {
		r := fresh()
		r.PrivateB = span(4096, 150)
		call(t, &r, resultPublicBinding, false)
	})
	t.Run("empty-public-span-does-not-read-private-address", func(t *testing.T) {
		r := fresh()
		r.ClassicKey = migrationPUBLICABISpan{unsafe.Pointer(&arena[4096]), 0}
		r.ClassicSignature = migrationPUBLICABISpan{unsafe.Pointer(&arena[8192]), 0}
		r.CurrentProof = migrationPUBLICABISpan{unsafe.Pointer(&arena[4096]), 0}
		call(t, &r, resultPublicBinding, false)
	})
}
