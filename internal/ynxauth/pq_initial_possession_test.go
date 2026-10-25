package ynxauth

import (
	"bytes"
	"math"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func TestPQInitialRegistrationPossessionFullPairAndMember(t *testing.T) {
	// This is an explicit synthetic bootstrap assignment, not a proposed PQ
	// address derivation rule or authority obtained from a submitted certificate.
	key, public, err := ynxbatch.KeyGen()
	authOK(t, err)
	t.Cleanup(key.Destroy)
	intent := RegistrationIntent{ChainID: authNetwork(t), Owner: qaFrom, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 20}
	message, err := intent.SigningBytes()
	authOK(t, err)
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: intent.ChainID, Owner: intent.Owner, Purpose: TransactionPurpose}, [][]byte{[]byte("unrelated first member"), message}, ynxbatch.SignOptions{Optimized: true})
	authOK(t, err)
	t.Cleanup(batch.Discard)
	member, err := ynxbatch.Extract(batch, 1)
	authOK(t, err)
	wire, err := ynxbatch.EncodeMember(member)
	authOK(t, err)
	trusted := ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: intent.Owner, Purpose: TransactionPurpose, PolicyRevision: "synthetic-bootstrap-only", ChainID: bytes.Clone(intent.ChainID), PKA: bytes.Clone(public.PKA), PKB: bytes.Clone(public.PKB), Enabled: true, ActiveFrom: 10}
	before := trusted
	before.ChainID, before.PKA, before.PKB = bytes.Clone(trusted.ChainID), bytes.Clone(trusted.PKA), bytes.Clone(trusted.PKB)
	got, err := VerifyPQInitialRegistrationPossession(wire, trusted, 10)
	authOK(t, err)
	if !reflect.DeepEqual(got, intent) || member.Certificate.N != 2 || member.Index != 1 {
		t.Fatal("initial possession lost the complete intent or normal N2/index1 member")
	}
	mutate := func(change func(*ynxbatch.Member)) []byte {
		m, e := ynxbatch.DecodeMember(wire)
		authOK(t, e)
		change(&m)
		out, e := ynxbatch.EncodeMember(m)
		authOK(t, e)
		return out
	}
	for name, change := range map[string]func(*ynxbatch.Member){
		"signature A": func(m *ynxbatch.Member) { m.Certificate.SigmaA[0] ^= 1 },
		"signature B": func(m *ynxbatch.Member) { m.Certificate.SigmaB[0] ^= 1 },
		"path A":      func(m *ynxbatch.Member) { m.PathA[0][0] ^= 1 },
		"path B":      func(m *ynxbatch.Member) { m.PathB[0][0] ^= 1 },
		"index":       func(m *ynxbatch.Member) { m.Index = 0 },
		"owner":       func(m *ynxbatch.Member) { m.Certificate.Owner = qaTo },
		"purpose":     func(m *ynxbatch.Member) { m.Certificate.Purpose = MigrationPurpose },
		"full key A":  func(m *ynxbatch.Member) { m.Certificate.PKA[0] ^= 1 },
		"full key B":  func(m *ynxbatch.Member) { m.Certificate.PKB[0] ^= 1 },
		"network":     func(m *ynxbatch.Member) { m.Certificate.ChainID[0] ^= 1 },
		"message":     func(m *ynxbatch.Member) { m.Message[len(m.Message)-1] ^= 1 },
	} {
		t.Run(name, func(t *testing.T) {
			_, err := VerifyPQInitialRegistrationPossession(mutate(change), trusted, 10)
			authReject(t, err)
		})
	}
	for name, change := range map[string]func(*ynxbatch.Registration){
		"absent":          func(r *ynxbatch.Registration) { *r = ynxbatch.Registration{} },
		"disabled":        func(r *ynxbatch.Registration) { r.Enabled = false },
		"wrong owner":     func(r *ynxbatch.Registration) { r.Owner = qaTo },
		"wrong purpose":   func(r *ynxbatch.Registration) { r.Purpose = MigrationPurpose },
		"wrong algorithm": func(r *ynxbatch.Registration) { r.AlgorithmVersion = "alias" },
		"missing revision": func(r *ynxbatch.Registration) {
			r.PolicyRevision = ""
		},
		"pending": func(r *ynxbatch.Registration) { r.ActiveFrom = 11 },
		"revoked": func(r *ynxbatch.Registration) { at := uint64(10); r.RevokedAt = &at },
		"swapped pair A": func(r *ynxbatch.Registration) {
			r.PKA = bytes.Clone(r.PKA)
			r.PKA[0] ^= 1
		},
		"swapped pair B": func(r *ynxbatch.Registration) {
			r.PKB = bytes.Clone(r.PKB)
			r.PKB[0] ^= 1
		},
		"wrong network": func(r *ynxbatch.Registration) {
			r.ChainID = bytes.Clone(r.ChainID)
			r.ChainID[0] ^= 1
		},
	} {
		t.Run(name, func(t *testing.T) {
			changed := trusted
			change(&changed)
			_, err := VerifyPQInitialRegistrationPossession(wire, changed, 10)
			authReject(t, err)
		})
	}
	for _, height := range []uint64{0, 20, math.MaxInt64, math.MaxUint64} {
		_, err := VerifyPQInitialRegistrationPossession(wire, trusted, height)
		authReject(t, err)
	}
	for _, malformed := range [][]byte{nil, append(bytes.Clone(wire), 0), wire[:len(wire)-1], bytes.Repeat([]byte{0}, MaxPQInitialRegistrationBytes+1)} {
		_, err := VerifyPQInitialRegistrationPossession(malformed, trusted, 10)
		authReject(t, err)
	}
	for name, change := range map[string]func(*RegistrationIntent){
		"not first revision": func(r *RegistrationIntent) { r.PriorRevision, r.NewRevision = 1, 2 },
		"nonce replay gap":   func(r *RegistrationIntent) { r.LedgerNonce = 2 },
		"current activation": func(r *RegistrationIntent) { r.ActivateAt = 10 },
		"activation overflow": func(r *RegistrationIntent) {
			r.ActivateAt = math.MaxUint64
		},
	} {
		t.Run(name, func(t *testing.T) {
			changed := intent
			change(&changed)
			message, err := changed.SigningBytes()
			authOK(t, err)
			_, err = VerifyPQInitialRegistrationPossession(mutate(func(m *ynxbatch.Member) { m.Message = message }), trusted, 10)
			authReject(t, err)
		})
	}
	if !reflect.DeepEqual(trusted, before) {
		t.Fatal("possession verification mutated its independent bootstrap input")
	}
	clear(wire)
	if !bytes.Equal(got.PKA, public.PKA) || !bytes.Equal(got.PKB, public.PKB) || !bytes.Equal(got.ChainID, intent.ChainID) {
		t.Fatal("returned intent retained submitted wire storage")
	}
}
