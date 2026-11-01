package main

import (
	"bytes"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Synthetic fixture only. Existing legacy/current identities are not replaced
// or imported, and no account, authority, funds, approval or Node is created.
func currentMigrationPUBLICFixture(t *testing.T) (migrationAuthorizationInputs, ynxauth.State, ynxbatch.KeyMaterial, ynxbatch.KeyMaterial) {
	t.Helper()
	base, state, current, _, _ := migrationPUBLICFixture(t)
	state.Records = []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: base.expected.Owner, PKA: bytes.Clone(current.PKA), PKB: bytes.Clone(current.PKB), Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 1}}
	next, pub, err := ynxbatch.KeyGen()
	must(t, err)
	t.Cleanup(next.Destroy)
	proposed, err := ynxbatch.ExportKeyMaterial(next)
	must(t, err)
	t.Cleanup(proposed.Clear)
	base = migrationPUBLICIntent(t, base, nil, func(i *ynxauth.RegistrationIntent) {
		i.PriorRevision = 1
		i.NewRevision = 2
		i.PKA = pub.PKA
		i.PKB = pub.PKB
	})
	policy, err := ynxauth.EncodeWalletPolicyProjection(state, base.expected.Owner)
	must(t, err)
	return migrationAuthorizationInputs{message: base.message, policy: policy, signingPKA: bytes.Clone(current.PKA), signingPKB: bytes.Clone(current.PKB),
		expected: migrationAuthorizationExpected{NetworkID: bytes.Clone(state.NetworkID), Owner: base.expected.Owner, CurrentRevision: "1", CurrentNonce: "40", ExecutionHeight: "7", CurrentPKA: bytes.Clone(current.PKA), CurrentPKB: bytes.Clone(current.PKB)}}, state, current, proposed
}

func currentMigrationPUBLICPolicy(t *testing.T, in migrationAuthorizationInputs, state ynxauth.State) migrationAuthorizationInputs {
	t.Helper()
	var err error
	in.policy, err = ynxauth.EncodeWalletPolicyProjection(state, in.expected.Owner)
	must(t, err)
	return in
}

func currentMigrationPUBLICIntent(t *testing.T, in migrationAuthorizationInputs, edit func(*ynxauth.RegistrationIntent)) migrationAuthorizationInputs {
	t.Helper()
	intent, err := ynxauth.DecodeRegistrationIntent(in.message)
	must(t, err)
	edit(&intent)
	in.message, err = intent.SigningBytes()
	must(t, err)
	return in
}

func TestCurrentMigrationCABIPUBLICDualAuthorizationAndIndependentPossession(t *testing.T) {
	in, state, current, proposed := currentMigrationPUBLICFixture(t)
	before := state.Clone()
	materialBefore := cloneMaterial(current)
	defer materialBefore.Clear()
	plan, code := prepareMigrationAuthorization(in, migrationAuthorizationCapacity)
	if code != resultOK {
		t.Fatal("valid current authorization preflight refused")
	}
	intent, err := ynxauth.DecodeRegistrationIntent(in.message)
	must(t, err)
	if _, err = state.AdmitMigration(ynxauth.Migration{Intent: intent}, 7, 40); err == nil {
		t.Fatal("public preflight became a current proof")
	}
	member, code, cleanup := signMigrationAuthorizationPrepared(plan, current)
	defer clear(member)
	if code != resultOK || cleanup != cleanupLogicalComplete {
		t.Fatal("fixed CURRENT pair signer or cleanup failed")
	}
	must(t, inspectMigrationAuthorization(plan, member))
	m, err := ynxbatch.DecodeMember(member)
	must(t, err)
	if m.Certificate.N != 1 || m.Index != 0 || m.Certificate.Purpose != ynxauth.MigrationPurpose || !bytes.Equal(m.Certificate.PKA, current.PKA) || bytes.Equal(m.Certificate.PKA, proposed.PKA) {
		t.Fatal("proposed pair impersonated CURRENT authority")
	}
	must(t, state.ValidateMigrationAuthorization(ynxauth.Migration{Intent: intent, CurrentPQProof: member}, 7, 40))
	if _, err = state.AdmitMigration(ynxauth.Migration{Intent: intent, CurrentPQProof: member}, 7, 40); err == nil {
		t.Fatal("current proof alone admitted proposed keys")
	}
	// Use the unchanged Core15 proposed-pair callee; only both independent
	// purpose-correct proofs together can pass the original full admission.
	newPlan, newCode := prepareMigration(migrationInputs{message: in.message, policy: in.policy, currentPQProof: member, signingPKA: proposed.PKA, signingPKB: proposed.PKB,
		expected: migrationExpected{NetworkID: in.expected.NetworkID, Owner: in.expected.Owner, NewRevision: "2", CurrentNonce: "40", ExecutionHeight: "7", PKA: proposed.PKA, PKB: proposed.PKB}}, migrationWholeCapacity)
	if newCode != resultOK {
		t.Fatal("unchanged new-key possession preflight refused valid current proof")
	}
	whole, newCode, newCleanup := signMigrationPrepared(newPlan, proposed)
	defer clear(whole)
	if newCode != resultOK || newCleanup != cleanupLogicalComplete {
		t.Fatal("unchanged new-key possession failed")
	}
	next, err := state.AdmitMigration(ynxauth.Migration{Intent: intent, CurrentPQProof: member, NewKeyProof: whole}, 7, 40)
	must(t, err)
	if r, active := next.PolicyAt(in.expected.Owner, 7); !active || r.Revision != 1 {
		t.Fatal("current pair changed before activation")
	}
	if r, active := next.PolicyAt(in.expected.Owner, 8); !active || r.Revision != 2 || r.LedgerNonce != 41 || !bytes.Equal(r.PKA, proposed.PKA) {
		t.Fatal("original rotation activation/nonce changed")
	}
	for _, branch := range []string{"ML-signature", "SLH-signature", "TX-purpose", "proposed-pair", "foreign-network", "different-intent"} {
		t.Run(branch, func(t *testing.T) {
			bad, e := ynxbatch.DecodeMember(member)
			must(t, e)
			switch branch {
			case "ML-signature":
				bad.Certificate.SigmaA[0] ^= 1
			case "SLH-signature":
				bad.Certificate.SigmaB[0] ^= 1
			case "TX-purpose":
				bad.Certificate.Purpose = ynxauth.TransactionPurpose
			case "proposed-pair":
				bad.Certificate.PKA = bytes.Clone(proposed.PKA)
			case "foreign-network":
				bad.Certificate.ChainID[0] ^= 1
			case "different-intent":
				bad.Message[len(bad.Message)-1] ^= 1
			}
			wire, e := ynxbatch.EncodeMember(bad)
			must(t, e)
			if inspectMigrationAuthorization(plan, wire) == nil {
				t.Fatal("invalid CURRENT proof accepted")
			}
		})
	}
	if !reflect.DeepEqual(state, before) || !reflect.DeepEqual(plan.policy, before) {
		t.Fatal("authorization signer mutated policy")
	}
	equalMaterial(t, current, materialBefore)
}

func TestCurrentMigrationCABIPUBLICPreflightBeforePrivateRead(t *testing.T) {
	in, state, _, proposed := currentMigrationPUBLICFixture(t)
	for name, edit := range map[string]func(migrationAuthorizationInputs) migrationAuthorizationInputs{
		"foreign-network": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.expected.NetworkID = bytes.Repeat([]byte{0x40}, 32)
			return x
		},
		"foreign-owner": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.expected.Owner = "0x" + strings.Repeat("11", 20)
			return x
		},
		"revision-alias": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.expected.CurrentRevision = "01"
			return x
		},
		"wrong-current-revision": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.expected.CurrentRevision = "2"
			return x
		},
		"wrong-ledger-nonce": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.expected.CurrentNonce = "41"
			return x
		},
		"auth-counter-is-not-ledger-nonce": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.expected.CurrentNonce = "1"
			return x
		},
		"nonce-overflow": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.expected.CurrentNonce = "18446744073709551615"
			return x
		},
		"height-alias": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.expected.ExecutionHeight = "+7"
			return x
		},
		"proposed-pair-is-not-current": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.expected.CurrentPKA = proposed.PKA
			x.expected.CurrentPKB = proposed.PKB
			x.signingPKA = proposed.PKA
			x.signingPKB = proposed.PKB
			return x
		},
		"foreign-borrow-public": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.signingPKB = proposed.PKB
			return x
		},
		"intent-trailing-bytes": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.message = append(bytes.Clone(x.message), 0)
			return x
		},
		"policy-duplicate": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			x.policy = append(bytes.Clone(x.policy[:len(x.policy)-1]), []byte(`,"version":"YNX-ACCOUNT-POLICY/v1"}`)...)
			return x
		},
		"bad-signed-nonce": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			return currentMigrationPUBLICIntent(t, x, func(i *ynxauth.RegistrationIntent) { i.LedgerNonce = 40 })
		},
		"activation-not-future": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			return currentMigrationPUBLICIntent(t, x, func(i *ynxauth.RegistrationIntent) { i.ActivateAt = 7 })
		},
		"wrong-prior-revision": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			return currentMigrationPUBLICIntent(t, x, func(i *ynxauth.RegistrationIntent) { i.PriorRevision = 2; i.NewRevision = 3 })
		},
		"legacy-has-no-current-fallback": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			s := state.Clone()
			s.Records = nil
			return currentMigrationPUBLICPolicy(t, x, s)
		},
		"valid-first-intent-still-needs-current-PQ": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			s := state.Clone()
			s.Records = nil
			x = currentMigrationPUBLICIntent(t, x, func(i *ynxauth.RegistrationIntent) { i.PriorRevision = 0; i.NewRevision = 1 })
			return currentMigrationPUBLICPolicy(t, x, s)
		},
		"pending-next-revision": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			s := state.Clone()
			s.Records = append(s.Records, ynxauth.Record{AlgorithmVersion: ynxbatch.Version, Owner: x.expected.Owner, PKA: proposed.PKA, PKB: proposed.PKB, Revision: 2, RegisteredAt: 6, ActiveFrom: 8, LedgerNonce: 2})
			return currentMigrationPUBLICPolicy(t, x, s)
		},
		"terminal-revoked": func(x migrationAuthorizationInputs) migrationAuthorizationInputs {
			s := state.Clone()
			s.Version = ynxauth.PolicyRevocationVersion
			s.Revocations = []ynxauth.RevocationRecord{{Owner: x.expected.Owner, AuthorizingRevision: 1, ThroughRevision: 1, RegisteredAt: 3, RevokedFrom: 4, LedgerNonce: 2}}
			return currentMigrationPUBLICPolicy(t, x, s)
		},
	} {
		t.Run(name, func(t *testing.T) {
			before := state.Clone()
			if _, code := prepareMigrationAuthorization(edit(in), migrationAuthorizationCapacity); code == resultOK {
				t.Fatal("invalid public state accepted before private material exists")
			}
			if !reflect.DeepEqual(state, before) {
				t.Fatal("preflight changed original state")
			}
		})
	}
	for _, capacity := range []uint64{0, migrationAuthorizationCapacity - 1, migrationAuthorizationCapacity + 1, ^uint64(0)} {
		if _, code := prepareMigrationAuthorization(in, capacity); code != resultCapacity {
			t.Fatal("nonfixed capacity accepted")
		}
	}
	for _, bad := range []migrationAuthorizationInputs{{policy: in.policy, expected: in.expected}, {message: make([]byte, migrationMessageMaximum+1), policy: in.policy, expected: in.expected}, {message: in.message, policy: make([]byte, txPolicyMaximum+1), expected: in.expected}} {
		if _, code := prepareMigrationAuthorization(bad, migrationAuthorizationCapacity); code != resultBounds {
			t.Fatal("input bound changed")
		}
	}
}

func TestCurrentMigrationCABIPUBLICOwnedPlanCleanupAndKeySeparation(t *testing.T) {
	in, _, current, proposed := currentMigrationPUBLICFixture(t)
	plan, code := prepareMigrationAuthorization(in, migrationAuthorizationCapacity)
	if code != resultOK {
		t.Fatal("preflight")
	}
	in.message[0] ^= 1
	in.policy[0] ^= 1
	in.expected.CurrentPKA[0] ^= 1
	in.signingPKB[0] ^= 1
	wire, code, cleanup := signMigrationAuthorizationPrepared(plan, current)
	defer clear(wire)
	if code != resultOK || cleanup != cleanupLogicalComplete {
		t.Fatal("plan retained mutable caller bytes")
	}
	must(t, inspectMigrationAuthorization(plan, wire))
	if out, code, cleanup := signMigrationAuthorizationPrepared(plan, proposed); out != nil || code != resultKeyMaterial || cleanup != cleanupNotRequired {
		t.Fatal("proposed pair entered private import as current")
	}
	broken := cloneMaterial(current)
	defer broken.Clear()
	broken.PKCS8B[0] ^= 1
	if out, code, cleanup := signMigrationAuthorizationPrepared(plan, broken); out != nil || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
		t.Fatal("corrupt current private material exposed proof or hid cleanup")
	}
	if out, code, cleanup := finishPublication([]byte{1}, resultOutputValidation, false, false); out != nil || code != resultCleanup || cleanup != cleanupFailed {
		t.Fatal("cleanup failure promoted failed output")
	}
}

type currentMigrationPUBLICABIRequest struct {
	Version                              uint32
	Size                                 uintptr
	Message, Policy                      migrationPUBLICABISpan
	Expected                             migrationPUBLICABIExpected
	PrivateA, PrivateB, PublicA, PublicB migrationPUBLICABISpan
}

func currentMigrationPUBLICBridgeCall(r *currentMigrationPUBLICABIRequest, buffer []byte, capacity uintptr, lengthPointer, cleanupPointer unsafe.Pointer) int32 {
	f := reflect.ValueOf(YNXAccountMigrationAuthorizationSignV1)
	args := []reflect.Value{reflect.Zero(f.Type().In(0)), reflect.NewAt(f.Type().In(1).Elem(), unsafe.Pointer(&buffer[0])), reflect.ValueOf(capacity).Convert(f.Type().In(2)), reflect.NewAt(f.Type().In(3).Elem(), lengthPointer), reflect.NewAt(f.Type().In(4).Elem(), cleanupPointer)}
	if r != nil {
		args[0] = reflect.NewAt(f.Type().In(0).Elem(), unsafe.Pointer(r))
	}
	got := int32(f.Call(args)[0].Int())
	runtime.KeepAlive(r)
	runtime.KeepAlive(buffer)
	return got
}

func TestCurrentMigrationCABIPUBLICActualCGOBridge(t *testing.T) {
	in, _, current, _ := currentMigrationPUBLICFixture(t)
	plan, code := prepareMigrationAuthorization(in, migrationAuthorizationCapacity)
	if code != resultOK {
		t.Fatal("preflight")
	}
	before := cloneMaterial(current)
	defer before.Clear()
	r := currentMigrationPUBLICABIRequest{Version: 1, Size: unsafe.Sizeof(currentMigrationPUBLICABIRequest{}), Message: migrationPUBLICSpan(in.message), Policy: migrationPUBLICSpan(in.policy), Expected: migrationPUBLICABIExpected{migrationPUBLICSpan(in.expected.NetworkID), migrationPUBLICSpan([]byte(in.expected.Owner)), migrationPUBLICSpan([]byte(in.expected.CurrentRevision)), migrationPUBLICSpan([]byte(in.expected.CurrentNonce)), migrationPUBLICSpan([]byte(in.expected.ExecutionHeight)), migrationPUBLICSpan(in.expected.CurrentPKA), migrationPUBLICSpan(in.expected.CurrentPKB)}, PrivateA: migrationPUBLICSpan(current.PKCS8A), PrivateB: migrationPUBLICSpan(current.PKCS8B), PublicA: migrationPUBLICSpan(current.PKA), PublicB: migrationPUBLICSpan(current.PKB)}
	f := reflect.ValueOf(YNXAccountMigrationAuthorizationSignV1)
	if r.Size != 224 || f.Type().In(0).Elem().Size() != r.Size {
		t.Fatal("public ABI64 layout changed")
	}
	buffer := bytes.Repeat([]byte{0xa5}, migrationAuthorizationCapacity+16)
	length, cleanup := uintptr(777), uint32(999)
	for _, test := range []struct {
		name   string
		edit   func(*currentMigrationPUBLICABIRequest)
		want   resultCode
		layout bool
	}{{"fixed-capacity", func(*currentMigrationPUBLICABIRequest) {}, resultCapacity, true}, {"version", func(x *currentMigrationPUBLICABIRequest) { x.Version++ }, resultInvalidArgument, true}, {"private-output-alias", func(x *currentMigrationPUBLICABIRequest) { x.PrivateA = migrationPUBLICSpan(buffer[:54]) }, resultOverlap, true}, {"public-refused-before-private", func(x *currentMigrationPUBLICABIRequest) { x.Expected.Nonce = migrationPUBLICSpan([]byte("41")) }, resultPublicBinding, false}, {"real-private-DER-failure", func(x *currentMigrationPUBLICABIRequest) { x.PrivateB = migrationPUBLICSpan(make([]byte, 150)) }, resultKeyMaterial, false}} {
		t.Run(test.name, func(t *testing.T) {
			x := r
			test.edit(&x)
			snapshot := bytes.Clone(buffer)
			length, cleanup = 777, 999
			cap := uintptr(migrationAuthorizationCapacity)
			if test.name == "fixed-capacity" {
				cap--
			}
			got := currentMigrationPUBLICBridgeCall(&x, buffer, cap, unsafe.Pointer(&length), unsafe.Pointer(&cleanup))
			if got != int32(test.want) || !bytes.Equal(snapshot, buffer) {
				t.Fatal("actual bridge refusal/output contract")
			}
			if test.layout {
				if length != 777 || cleanup != 999 {
					t.Fatal("layout refusal wrote scalars")
				}
			} else if length != 0 || (test.want == resultPublicBinding && cleanup != uint32(cleanupNotRequired)) || (test.want == resultKeyMaterial && cleanup != uint32(cleanupLogicalComplete)) {
				t.Fatal("admitted failure lost cleanup/zero length")
			}
		})
	}
	t.Run("actual-current-exported-sign", func(t *testing.T) {
		length = 0
		cleanup = 0
		if got := currentMigrationPUBLICBridgeCall(&r, buffer, migrationAuthorizationCapacity, unsafe.Pointer(&length), unsafe.Pointer(&cleanup)); got != 0 || length == 0 || length > migrationAuthorizationCapacity || cleanup != uint32(cleanupLogicalComplete) {
			t.Fatalf("actual current exported sign failed: %d", got)
		}
		must(t, inspectMigrationAuthorization(plan, buffer[:length]))
		if !bytes.Equal(buffer[length:], bytes.Repeat([]byte{0xa5}, len(buffer)-int(length))) {
			t.Fatal("success touched unused capacity")
		}
		equalMaterial(t, current, before)
	})
	runtime.KeepAlive(in)
	runtime.KeepAlive(current)
}

func TestCurrentMigrationCABIPUBLICSecretPublicAliasBoundary(t *testing.T) {
	arena := bytes.Repeat([]byte{0x35}, 16384)
	buffer := bytes.Repeat([]byte{0xa5}, migrationAuthorizationCapacity+16)
	span := func(offset, size int) migrationPUBLICABISpan { return migrationPUBLICSpan(arena[offset : offset+size]) }
	fresh := func() currentMigrationPUBLICABIRequest {
		return currentMigrationPUBLICABIRequest{Version: 1, Size: unsafe.Sizeof(currentMigrationPUBLICABIRequest{}), Message: span(0, 8), Policy: span(0, 8), Expected: migrationPUBLICABIExpected{span(0, 32), span(0, 42), span(0, 2), span(0, 2), span(0, 2), span(0, 2592), span(0, 64)}, PrivateA: span(4096, 54), PrivateB: span(8192, 150), PublicA: span(0, 2592), PublicB: span(0, 64)}
	}
	fields := []struct {
		name string
		get  func(*currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan
	}{
		{"message", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Message }}, {"policy", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Policy }}, {"network", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.Network }}, {"owner", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.Owner }}, {"revision", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.Revision }}, {"nonce", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.Nonce }}, {"height", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.Height }}, {"expected-A", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.PKA }}, {"expected-B", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.Expected.PKB }}, {"borrow-public-A", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.PublicA }}, {"borrow-public-B", func(r *currentMigrationPUBLICABIRequest) *migrationPUBLICABISpan { return &r.PublicB }},
	}
	call := func(t *testing.T, r *currentMigrationPUBLICABIRequest, layout bool) {
		t.Helper()
		before := bytes.Clone(buffer)
		input := bytes.Clone(arena)
		length, cleanup := uintptr(777), uint32(999)
		want := resultPublicBinding
		if layout {
			want = resultOverlap
		}
		got := currentMigrationPUBLICBridgeCall(r, buffer, migrationAuthorizationCapacity, unsafe.Pointer(&length), unsafe.Pointer(&cleanup))
		runtime.KeepAlive(arena)
		if got != int32(want) || !bytes.Equal(before, buffer) || !bytes.Equal(input, arena) {
			t.Fatal("cross-category boundary or caller memory changed")
		}
		if layout {
			if length != 777 || cleanup != 999 {
				t.Fatal("cross alias wrote scalar outputs")
			}
		} else if length != 0 || cleanup != uint32(cleanupNotRequired) {
			t.Fatal("legal alias did not reach ordinary public preflight")
		}
	}
	for _, secret := range []struct {
		name         string
		offset, size int
	}{{"PKCS8-A", 4096, 54}, {"PKCS8-B", 8192, 150}} {
		for _, field := range fields {
			for _, position := range []string{"same-start", "partial-before", "partial-after", "adjacent-before", "adjacent-after"} {
				t.Run(secret.name+"/"+field.name+"/"+position, func(t *testing.T) {
					r := fresh()
					target := field.get(&r)
					size := int(target.Size)
					offset := secret.offset
					layout := true
					switch position {
					case "partial-before":
						offset -= size - 1
					case "partial-after":
						offset += secret.size - 1
					case "adjacent-before":
						offset -= size
						layout = false
					case "adjacent-after":
						offset += secret.size
						layout = false
					}
					*target = span(offset, size)
					call(t, &r, layout)
				})
			}
		}
	}
	t.Run("public-public-alias", func(t *testing.T) { r := fresh(); call(t, &r, false) })
	t.Run("private-private-alias", func(t *testing.T) { r := fresh(); r.PrivateB = span(4096, 150); call(t, &r, false) })
}
