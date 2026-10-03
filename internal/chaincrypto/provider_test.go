package chaincrypto

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"testing"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// Only synthetic, ephemeral fixture keys. No production import/export or files.
type fixture struct {
	secp               *secp256k1.PrivateKey
	ed                 ed25519.PrivateKey
	pq                 *mldsa87.PrivateKey
	account, validator PublicKeys
}

func newFixture(t testing.TB) fixture {
	t.Helper()
	s, e := secp256k1.GeneratePrivateKey()
	if e != nil {
		t.Fatal(e)
	}
	ep, ed, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	pk, sk, e := mldsa87.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	return fixture{s, ed, sk, PublicKeys{s.PubKey().SerializeCompressed(), pk.Bytes()}, PublicKeys{ep, pk.Bytes()}}
}
func (f fixture) sign(t testing.TB, raw []byte, consensus bool) Signatures {
	t.Helper()
	ctx := AccountContext
	var classic []byte
	if consensus {
		ctx = ConsensusContext
		classic = ed25519.Sign(f.ed, raw)
	} else {
		h := sha256.Sum256(raw)
		classic = ecdsa.Sign(f.secp, h[:]).Serialize()
	}
	pq := make([]byte, mldsa87.SignatureSize)
	if e := mldsa87.SignTo(f.pq, raw, []byte(ctx), true, pq); e != nil {
		t.Fatal(e)
	}
	return Signatures{classic, pq}
}
func testNetwork() Network {
	return Network{ChainID: 6423, ConsensusID: "synthetic-isolated-network", Genesis: [32]byte{1}}
}
func testTx() TxMessage {
	return TxMessage{Network: testNetwork(), Account: [20]byte{1}, PolicyVersion: 2, KeyVersion: 1, Nonce: 1, ExpiryHeight: 100, Action: 1, Recipient: [20]byte{2}, Amount: [32]byte{31: 9}, Fee: [32]byte{31: 1}, Gas: 25000, Payload: []byte("complete synthetic action")}
}

func TestAccountANDAndExactEncodings(t *testing.T) {
	f := newFixture(t)
	m := testTx()
	raw, e := m.CanonicalBytes()
	if e != nil {
		t.Fatal(e)
	}
	sig := f.sign(t, raw, false)
	p := CIRCLProvider{}
	if e = p.VerifyAccount(f.account, raw, sig); e != nil {
		t.Fatal(e)
	}
	tests := map[string]Signatures{"missingClassic": {nil, sig.PostQuantum}, "missingPQ": {sig.Classical, nil}, "classicBad": {append([]byte(nil), sig.Classical...), sig.PostQuantum}, "pqBad": {sig.Classical, append([]byte(nil), sig.PostQuantum...)}, "trailingPQ": {sig.Classical, append(append([]byte(nil), sig.PostQuantum...), 0)}, "trailingDER": {append(append([]byte(nil), sig.Classical...), 0), sig.PostQuantum}}
	tests["classicBad"].Classical[3] ^= 1
	tests["pqBad"].PostQuantum[200] ^= 1
	for name, s := range tests {
		t.Run(name, func(t *testing.T) {
			if p.VerifyAccount(f.account, raw, s) == nil {
				t.Fatal("invalid half accepted")
			}
		})
	}
	wrong := PublicKeys{f.account.Classical, append(append([]byte(nil), f.account.PostQuantum...), 0)}
	if p.VerifyAccount(wrong, raw, sig) == nil {
		t.Fatal("trailing key accepted")
	}
}

func TestTransactionCompleteBindingAndExpiry(t *testing.T) {
	f := newFixture(t)
	m := testTx()
	raw, _ := m.CanonicalBytes()
	sig := f.sign(t, raw, false)
	policy := AuthPolicy{m.Account, HybridEnforced, m.PolicyVersion, m.KeyVersion, 10, f.account}
	v := TxVerifier{CIRCLProvider{}, testNetwork()}
	if v.Verify(policy, m, sig, 20) != nil {
		t.Fatal("valid hybrid rejected")
	}
	mutations := map[string]func(*TxMessage){"chain": func(m *TxMessage) { m.Network.ChainID++ }, "genesis": func(m *TxMessage) { m.Network.Genesis[1] = 7 }, "network": func(m *TxMessage) { m.Network.ConsensusID = "other" }, "account": func(m *TxMessage) { m.Account[2] = 9 }, "policy": func(m *TxMessage) { m.PolicyVersion++ }, "key": func(m *TxMessage) { m.KeyVersion++ }, "nonce": func(m *TxMessage) { m.Nonce++ }, "recipient": func(m *TxMessage) { m.Recipient[2] = 9 }, "amount": func(m *TxMessage) { m.Amount[29] = 1 }, "fee": func(m *TxMessage) { m.Fee[2] = 1 }, "gas": func(m *TxMessage) { m.Gas++ }, "payload": func(m *TxMessage) { m.Payload = []byte("different full action") }}
	for name, change := range mutations {
		t.Run(name, func(t *testing.T) {
			other := m
			change(&other)
			if v.Verify(policy, other, sig, 20) == nil {
				t.Fatal("mutation accepted")
			}
		})
	}
	if v.Verify(policy, m, sig, 101) == nil || v.Verify(policy, m, sig, 9) == nil {
		t.Fatal("height boundary bypass")
	}
	if policy.AllowsLegacyAt(10) || !policy.AllowsLegacyAt(9) {
		t.Fatal("legacy height rule")
	}
	policy.State = RecoveryPending
	if policy.AllowsLegacyAt(9) || v.Verify(policy, m, sig, 20) == nil {
		t.Fatal("recovery bypass")
	}
}

func TestMigrationRequiresActualDualProofAndImmutablePolicy(t *testing.T) {
	f := newFixture(t)
	p := AuthPolicy{Account: [20]byte{1}, State: Legacy, Version: 1, KeyVersion: 1, Keys: PublicKeys{Classical: f.account.Classical}}
	v := TxVerifier{CIRCLProvider{}, testNetwork()}
	m := MigrationRequest{Network: testNetwork(), Account: p.Account, PolicyVersion: 1, KeyVersion: 1, Nonce: 8, ExpiryHeight: 100, Next: PQRegistered, NewPQKey: f.account.PostQuantum}
	raw, _ := m.CanonicalBytes()
	sig := f.sign(t, raw, false)
	proof, e := v.VerifyTransition(p, m, sig, nil, 20, 8)
	if e != nil {
		t.Fatal(e)
	}
	if Transition(p, PQRegistered, proof, 20, 8) != nil {
		t.Fatal("verified registration rejected")
	}
	if Transition(p, PQRegistered, TransitionProof{}, 20, 8) == nil || Transition(p, PQRegistered, proof, 101, 8) == nil || Transition(p, PQRegistered, proof, 20, 9) == nil {
		t.Fatal("forged/expired/replayed proof accepted")
	}
	p.Version++
	if Transition(p, PQRegistered, proof, 20, 8) == nil {
		t.Fatal("changed policy accepted")
	}
	p.Version--
	if _, e = v.VerifyTransition(p, m, Signatures{sig.Classical, nil}, nil, 20, 8); e == nil {
		t.Fatal("classic-only registration")
	}
	m.Next = HybridEnforced
	if _, e = v.VerifyTransition(p, m, sig, nil, 20, 8); e == nil {
		t.Fatal("legacy skips registration")
	}
	p.State = PQRegistered
	p.Keys = f.account
	m.Next = HybridEnforced
	m.NewPQKey = nil
	m.ExplicitEnable = true
	raw, _ = m.CanonicalBytes()
	sig = f.sign(t, raw, false)
	if _, e = v.VerifyTransition(p, m, sig, nil, 20, 8); e != nil {
		t.Fatal(e)
	}
	m.ExplicitEnable = false
	if _, e = v.VerifyTransition(p, m, sig, nil, 20, 8); e == nil {
		t.Fatal("enable consent not bound")
	}
}

func TestConsensusSameVoteANDQuorumAndDomain(t *testing.T) {
	v := ConsensusVerifier{CIRCLProvider{}}
	n := testNetwork()
	original := []byte("synthetic complete precommit sign bytes incl blockID timestamp parts")
	var set []Validator
	var votes []Vote
	for i := byte(1); i <= 3; i++ {
		f := newFixture(t)
		m := ConsensusMessage{n, [20]byte{i}, 1, 100, 2, Precommit, original}
		raw, _ := m.CanonicalBytes()
		set = append(set, Validator{m.Validator, 1, 3, f.validator})
		votes = append(votes, Vote{m, f.sign(t, raw, true)})
	}
	if v.VerifyQuorum(set, votes, n, 100, 2, Precommit, original) != nil {
		t.Fatal("valid 9-power quorum rejected")
	}
	if v.VerifyQuorum(set, votes[:2], n, 100, 2, Precommit, original) == nil {
		t.Fatal("exact 2/3 accepted")
	}
	bad := append([]Vote(nil), votes...)
	bad[2].Signatures = Signatures{votes[2].Signatures.Classical, votes[0].Signatures.PostQuantum}
	if v.VerifyQuorum(set, bad, n, 100, 2, Precommit, original) == nil {
		t.Fatal("different PQ voter quorum")
	}
	bad = append([]Vote(nil), votes...)
	bad[2] = votes[0]
	if v.VerifyQuorum(set, bad, n, 100, 2, Precommit, original) == nil {
		t.Fatal("duplicate vote power")
	}
	if v.VerifyQuorum(set, votes, n, 101, 2, Precommit, original) == nil || v.VerifyQuorum(set, votes, n, 100, 3, Precommit, original) == nil || v.VerifyQuorum(set, votes, n, 100, 2, Prevote, original) == nil || v.VerifyQuorum(set, votes, n, 100, 2, Precommit, []byte("other block")) == nil {
		t.Fatal("consensus binding bypass")
	}
	f := newFixture(t)
	raw, _ := votes[0].Message.CanonicalBytes()
	sig := f.sign(t, raw, false)
	if (CIRCLProvider{}).VerifyConsensus(f.validator, raw, sig) == nil {
		t.Fatal("account proof in consensus")
	}
}

func TestCanonicalBoundedDeterminism(t *testing.T) {
	m := testTx()
	a, e := m.CanonicalBytes()
	if e != nil {
		t.Fatal(e)
	}
	b, _ := m.CanonicalBytes()
	if !bytes.Equal(a, b) {
		t.Fatal("non-deterministic bytes")
	}
	m.Payload = make([]byte, MaxAuthMessage)
	if _, e = m.CanonicalBytes(); e == nil {
		t.Fatal("oversize accepted")
	}
	m = testTx()
	m.Network.Genesis = [32]byte{}
	if _, e = m.CanonicalBytes(); e == nil {
		t.Fatal("missing genesis accepted")
	}
	if mldsa87.PublicKeySize != 2592 || mldsa87.SignatureSize != 4627 {
		t.Fatal("wrong parameter set")
	}
}

func TestAuthorizedMigrationRetainsExactSignedKey(t *testing.T) {
	f := newFixture(t)
	p := AuthPolicy{[20]byte{1}, Legacy, 1, 1, 0, PublicKeys{Classical: f.account.Classical}}
	m := MigrationRequest{testNetwork(), p.Account, 1, 1, 8, 40, PQRegistered, append([]byte(nil), f.account.PostQuantum...), false}
	raw, _ := m.CanonicalBytes()
	proof, err := (TxVerifier{CIRCLProvider{}, testNetwork()}).VerifyTransition(p, m, f.sign(t, raw, false), nil, 20, 8)
	if err != nil {
		t.Fatal(err)
	}
	m.NewPQKey[0] ^= 1
	a, err := AuthorizedMigration(p, proof, 20, 8)
	if err != nil || !bytes.Equal(a.NewPQKey, f.account.PostQuantum) {
		t.Fatal("caller changed authenticated key")
	}
	a.NewPQKey[0] ^= 1
	b, err := AuthorizedMigration(p, proof, 20, 8)
	if err != nil || !bytes.Equal(b.NewPQKey, f.account.PostQuantum) {
		t.Fatal("returned key aliases proof")
	}
	if _, err = AuthorizedMigration(p, proof, 41, 8); err == nil {
		t.Fatal("expired request returned")
	}
	if _, err = AuthorizedMigration(p, proof, 20, 9); err == nil {
		t.Fatal("different nonce returned")
	}
}

func BenchmarkAccountDualVerify(b *testing.B) {
	f := newFixture(b)
	m := testTx()
	raw, _ := m.CanonicalBytes()
	sig := f.sign(b, raw, false)
	p := CIRCLProvider{}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if p.VerifyAccount(f.account, raw, sig) != nil {
			b.Fatal("verify")
		}
	}
}
