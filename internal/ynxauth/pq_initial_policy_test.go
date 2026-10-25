package ynxauth

import (
	"bytes"
	"math"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func TestPQInitialRegistrationPolicyAdmission(t *testing.T) {
	// qaTo is an explicit synthetic operator bootstrap assignment. It is not
	// derived from either PQ public key or a classic key; no secp key is needed.
	key, public, err := ynxbatch.KeyGen()
	authOK(t, err)
	t.Cleanup(key.Destroy)
	base := State{Version: PolicyVersion, NetworkID: authNetwork(t), EnableAt: 10}
	intent := RegistrationIntent{ChainID: bytes.Clone(base.NetworkID), Owner: qaTo,
		PKA: bytes.Clone(public.PKA), PKB: bytes.Clone(public.PKB), NewRevision: 1, LedgerNonce: 1, ActivateAt: 40}
	trusted := ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: qaTo, Purpose: TransactionPurpose,
		PolicyRevision: "synthetic-operator-bootstrap-only", ChainID: bytes.Clone(base.NetworkID),
		PKA: bytes.Clone(public.PKA), PKB: bytes.Clone(public.PKB), Enabled: true, ActiveFrom: 10}
	cloneTrusted := func(r ynxbatch.Registration) ynxbatch.Registration {
		r.ChainID, r.PKA, r.PKB = bytes.Clone(r.ChainID), bytes.Clone(r.PKA), bytes.Clone(r.PKB)
		if r.RevokedAt != nil {
			at := *r.RevokedAt
			r.RevokedAt = &at
		}
		return r
	}
	trustedBefore := cloneTrusted(trusted)
	// Sign all intent variants once. The successful registration uses a normal
	// nonzero member index, and failures reuse actual dual-signed batch members.
	variants := []RegistrationIntent{intent, intent, intent, intent, intent, intent, intent, intent}
	variants[2].LedgerNonce = 2
	variants[3].PriorRevision, variants[3].NewRevision = 1, 2
	variants[4].ActivateAt = 20
	variants[5].ActivateAt = math.MaxUint64
	messages := make([][]byte, len(variants))
	for i := range variants {
		messages[i], err = variants[i].SigningBytes()
		authOK(t, err)
	}
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: base.NetworkID, Owner: qaTo, Purpose: TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	authOK(t, err)
	t.Cleanup(batch.Discard)
	wires := make([][]byte, len(messages))
	for i := range messages {
		member, err := ynxbatch.Extract(batch, uint32(i))
		authOK(t, err)
		wires[i], err = ynxbatch.EncodeMember(member)
		authOK(t, err)
	}
	wire := wires[1]
	selected, err := ynxbatch.DecodeMember(wire)
	authOK(t, err)
	if selected.Certificate.N != 8 || selected.Index != 1 {
		t.Fatal("initial registration fixture must use the actual N8/index1 member")
	}
	wireBefore := bytes.Clone(wire)
	baseBefore := base.Clone()
	admitted, err := base.AdmitPQInitialRegistration(wire, trusted, 20, false)
	authOK(t, err)
	want := Record{AlgorithmVersion: ynxbatch.Version, Owner: qaTo, PKA: public.PKA, PKB: public.PKB,
		Revision: 1, RegisteredAt: 20, ActiveFrom: 40, LedgerNonce: 1}
	if !reflect.DeepEqual(base, baseBefore) || len(admitted.Records) != 1 || !reflect.DeepEqual(admitted.Records[0], want) {
		t.Fatal("initial registration changed its source or admitted a different complete record")
	}
	authOK(t, admitted.Validate(base.NetworkID))
	if _, active := admitted.PolicyAt(qaTo, 39); active {
		t.Fatal("new registration became active before its signed activation height")
	}
	active, err := admitted.TrustedRegistration(qaTo, TransactionPurpose, 40)
	authOK(t, err)
	if active.Owner != qaTo || active.PolicyRevision != "1" || !bytes.Equal(active.PKA, public.PKA) || !bytes.Equal(active.PKB, public.PKB) {
		t.Fatal("activated first registration lost its full trusted pair")
	}
	if err := admitted.RequireLegacy(qaTo, 40); err == nil {
		t.Fatal("initial PQ registration enabled a classic authorization fallback")
	}

	// Pre-existing public records represent immutable synthetic migration
	// history. Their authority is not granted by the new submitted proof.
	left, right := "0x"+strings.Repeat("0", 39)+"1", "0x"+strings.Repeat("f", 40)
	oldRecord := func(owner string, revision, registered, activate, nonce uint64) Record {
		return Record{AlgorithmVersion: ynxbatch.Version, Owner: owner, PKA: bytes.Clone(public.PKA), PKB: bytes.Clone(public.PKB),
			Revision: revision, RegisteredAt: registered, ActiveFrom: activate, LedgerNonce: nonce}
	}
	history := base.Clone()
	history.Version = PolicyRevocationVersion
	history.Records = []Record{oldRecord(left, 1, 10, 11, 7), oldRecord(left, 2, 12, 13, 8), oldRecord(right, 1, 10, 11, 7)}
	history.Revocations = []RevocationRecord{{Owner: left, AuthorizingRevision: 2, ThroughRevision: 2, RegisteredAt: 15, RevokedFrom: 16, LedgerNonce: 9}}
	authOK(t, history.Validate(base.NetworkID))
	historyBefore := history.Clone()
	withHistory, err := history.AdmitPQInitialRegistration(wire, trusted, 20, false)
	authOK(t, err)
	if !reflect.DeepEqual(history, historyBefore) || withHistory.Version != history.Version ||
		!reflect.DeepEqual(withHistory.NetworkID, history.NetworkID) || withHistory.EnableAt != history.EnableAt ||
		!reflect.DeepEqual(withHistory.Revocations, history.Revocations) || len(withHistory.Records) != 4 ||
		!reflect.DeepEqual(withHistory.Records[0], history.Records[0]) || !reflect.DeepEqual(withHistory.Records[1], history.Records[1]) ||
		!reflect.DeepEqual(withHistory.Records[2], want) || !reflect.DeepEqual(withHistory.Records[3], history.Records[2]) {
		t.Fatal("initial admission replaced, reordered or dropped original migration/revocation history")
	}
	authOK(t, withHistory.Validate(base.NetworkID))

	reject := func(t *testing.T, state State, proof []byte, binding ynxbatch.Registration, height uint64, occupied bool) {
		t.Helper()
		before, input, publicBinding := state.Clone(), bytes.Clone(proof), cloneTrusted(binding)
		if _, err := state.AdmitPQInitialRegistration(proof, binding, height, occupied); err == nil {
			t.Fatal("invalid initial registration was admitted")
		}
		if !reflect.DeepEqual(state, before) || !bytes.Equal(proof, input) || !reflect.DeepEqual(binding, publicBinding) {
			t.Fatal("rejected registration changed original policy, proof or independent binding")
		}
	}
	occupied := base.Clone()
	occupied.Records = []Record{oldRecord(qaTo, 1, 10, 11, 41)}
	pending := base.Clone()
	pending.Records = []Record{oldRecord(qaTo, 1, 10, 30, 41)}
	revoked := occupied.Clone()
	revoked.Version = PolicyRevocationVersion
	revoked.Revocations = []RevocationRecord{{Owner: qaTo, AuthorizingRevision: 1, ThroughRevision: 1, RegisteredAt: 19, RevokedFrom: 20, LedgerNonce: 42}}
	for _, state := range []State{occupied, pending, revoked} {
		authOK(t, state.Validate(base.NetworkID))
	}
	for _, tc := range []struct {
		name     string
		state    State
		existing bool
	}{
		{"existing ledger owner without PQ record", base, true},
		{"same-state replay", admitted, false},
		{"existing active migration record", occupied, false},
		{"existing pending migration record", pending, false},
		{"terminal revoked owner", revoked, false},
	} {
		t.Run(tc.name, func(t *testing.T) { reject(t, tc.state, wire, trusted, 20, tc.existing) })
	}
	for name, change := range map[string]func(*State){
		"missing policy":           func(s *State) { *s = State{} },
		"invalid policy version":   func(s *State) { s.Version = "foreign-policy" },
		"wrong ledger network":     func(s *State) { s.NetworkID[0] ^= 1 },
		"missing admission height": func(s *State) { s.EnableAt = 0 },
	} {
		t.Run(name, func(t *testing.T) {
			state := base.Clone()
			change(&state)
			reject(t, state, wire, trusted, 20, false)
		})
	}
	for name, change := range map[string]func(*ynxbatch.Registration){
		"absent trusted bootstrap":   func(r *ynxbatch.Registration) { *r = ynxbatch.Registration{} },
		"disabled trusted bootstrap": func(r *ynxbatch.Registration) { r.Enabled = false },
		"different trusted owner":    func(r *ynxbatch.Registration) { r.Owner = qaFrom },
		"different trusted network":  func(r *ynxbatch.Registration) { r.ChainID[0] ^= 1 },
		"different full public A":    func(r *ynxbatch.Registration) { r.PKA[0] ^= 1 },
		"different full public B":    func(r *ynxbatch.Registration) { r.PKB[0] ^= 1 },
		"pending trusted bootstrap":  func(r *ynxbatch.Registration) { r.ActiveFrom = 21 },
		"revoked trusted bootstrap":  func(r *ynxbatch.Registration) { at := uint64(20); r.RevokedAt = &at },
	} {
		t.Run(name, func(t *testing.T) {
			binding := cloneTrusted(trusted)
			change(&binding)
			reject(t, history, wire, binding, 20, false)
		})
	}
	for _, height := range []uint64{0, 9, 40, math.MaxInt64, math.MaxUint64} {
		t.Run("execution height "+strconv.FormatUint(height, 10), func(t *testing.T) {
			reject(t, history, wire, trusted, height, false)
		})
	}
	for _, tc := range []struct {
		name  string
		proof []byte
	}{
		{"nonce gap", wires[2]},
		{"noninitial revision", wires[3]},
		{"current activation", wires[4]},
		{"activation overflow", wires[5]},
		{"missing member", nil},
		{"trailing member", append(bytes.Clone(wire), 0)},
		{"truncated member", wire[:len(wire)-1]},
	} {
		t.Run(tc.name, func(t *testing.T) { reject(t, history, tc.proof, trusted, 20, false) })
	}
	for _, branch := range []string{"A", "B"} {
		t.Run("corrupt signature "+branch, func(t *testing.T) {
			member, err := ynxbatch.DecodeMember(wire)
			authOK(t, err)
			if branch == "A" {
				member.Certificate.SigmaA[0] ^= 1
			} else {
				member.Certificate.SigmaB[0] ^= 1
			}
			proof, err := ynxbatch.EncodeMember(member)
			authOK(t, err)
			reject(t, history, proof, trusted, 20, false)
		})
	}
	if !bytes.Equal(wire, wireBefore) || !reflect.DeepEqual(trusted, trustedBefore) || !reflect.DeepEqual(history, historyBefore) {
		t.Fatal("admission retained or changed its input state and public binding")
	}
	// Both successful results must detach every old and newly admitted key slice.
	admittedBefore, withHistoryBefore := admitted.Clone(), withHistory.Clone()
	clear(wire)
	trusted.PKA[0] ^= 1
	trusted.PKB[0] ^= 1
	history.NetworkID[0] ^= 1
	history.Records[0].PKA[0] ^= 1
	history.Revocations[0].LedgerNonce++
	if !reflect.DeepEqual(admitted, admittedBefore) || !reflect.DeepEqual(withHistory, withHistoryBefore) {
		t.Fatal("caller mutation changed an admitted registration or retained history")
	}
}
