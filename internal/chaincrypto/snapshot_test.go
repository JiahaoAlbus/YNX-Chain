package chaincrypto

import (
	"bytes"
	"testing"
)

type snapshotPauseProvider struct {
	entered, release chan struct{}
	consensus        bool
}

func (p snapshotPauseProvider) VerifyAccount(k PublicKeys, raw []byte, s Signatures) error {
	if !p.consensus {
		close(p.entered)
		<-p.release
	}
	return (CIRCLProvider{}).VerifyAccount(k, raw, s)
}
func (p snapshotPauseProvider) VerifyConsensus(k PublicKeys, raw []byte, s Signatures) error {
	if p.consensus {
		close(p.entered)
		<-p.release
	}
	return (CIRCLProvider{}).VerifyConsensus(k, raw, s)
}

func TestMigrationSnapshotsEveryCallerAliasBeforeProvider(t *testing.T) {
	for _, name := range []string{"policyKey", "newKey", "classicalSignature", "pqSignature"} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			p := AuthPolicy{[20]byte{1}, Legacy, 1, 1, 0, PublicKeys{Classical: append([]byte(nil), f.account.Classical...)}}
			originalPolicy := snapshotPolicy(p)
			m := MigrationRequest{testNetwork(), p.Account, 1, 1, 8, 40, PQRegistered, append([]byte(nil), f.account.PostQuantum...), false}
			raw, _ := m.CanonicalBytes()
			s := f.sign(t, raw, false)
			provider := snapshotPauseProvider{make(chan struct{}), make(chan struct{}), false}
			type result struct {
				proof TransitionProof
				err   error
			}
			done := make(chan result)
			go func() {
				proof, err := (TxVerifier{provider, testNetwork()}).VerifyTransition(p, m, s, nil, 20, 8)
				done <- result{proof, err}
			}()
			<-provider.entered
			switch name {
			case "policyKey":
				p.Keys.Classical[0] ^= 1
			case "newKey":
				m.NewPQKey[0] ^= 1
			case "classicalSignature":
				s.Classical[0] ^= 1
			case "pqSignature":
				s.PostQuantum[0] ^= 1
			}
			close(provider.release)
			r := <-done
			if r.err != nil {
				t.Fatal("real verified immutable snapshot unexpectedly rejected", r.err)
			}
			authorized, err := AuthorizedMigration(originalPolicy, r.proof, 20, 8)
			if err != nil {
				t.Fatal(err)
			}
			returned, _ := authorized.CanonicalBytes()
			if !bytes.Equal(returned, raw) {
				t.Fatal("authorized request changed after dual verification")
			}
		})
	}
}
func TestConsensusSnapshotsSetVoteAndOriginalBeforeProvider(t *testing.T) {
	f := newFixture(t)
	m := ConsensusMessage{testNetwork(), [20]byte{1}, 1, 100, 2, Precommit, []byte("original full vote")}
	raw, _ := m.CanonicalBytes()
	sig := f.sign(t, raw, true)
	set := []Validator{{m.Validator, 1, 7, f.validator}, {[20]byte{2}, 1, 3, snapshotKeys(f.validator)}}
	votes := []Vote{{m, sig}}
	original := append([]byte(nil), m.OriginalSignBytes...)
	provider := snapshotPauseProvider{make(chan struct{}), make(chan struct{}), true}
	done := make(chan error)
	go func() {
		done <- (ConsensusVerifier{provider}).VerifyQuorum(set, votes, m.Network, 100, 2, Precommit, original)
	}()
	<-provider.entered
	set[0].Power = 1
	set[0].Keys.PostQuantum[0] ^= 1
	votes[0].Message.OriginalSignBytes[0] ^= 1
	votes[0].Signatures.Classical[0] ^= 1
	original[0] ^= 1
	close(provider.release)
	if err := <-done; err != nil {
		t.Fatal("original real dual quorum snapshot was not preserved", err)
	}
}
