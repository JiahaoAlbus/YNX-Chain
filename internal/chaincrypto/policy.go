package chaincrypto

import (
	"bytes"
	"crypto/sha256"
)

type PolicyState uint8

const (
	Legacy          PolicyState = 1
	PQRegistered    PolicyState = 2
	HybridEnforced  PolicyState = 3
	RecoveryPending PolicyState = 4
)

// AuthPolicy must be loaded from authenticated committed state. A transaction
// cannot choose a weaker state or activation height. No wall clock is used.
type AuthPolicy struct {
	Account                            [20]byte
	State                              PolicyState
	Version, KeyVersion, EnforceHeight uint64
	Keys                               PublicKeys
}

func (p AuthPolicy) Validate() error {
	if !nonzero(p.Account[:]) || p.State < Legacy || p.State > RecoveryPending || p.Version == 0 || p.KeyVersion == 0 {
		return ErrInvalid
	}
	if p.State == Legacy {
		if len(p.Keys.Classical) != 33 || len(p.Keys.PostQuantum) != 0 || p.EnforceHeight != 0 {
			return ErrInvalid
		}
		return nil
	}
	if len(p.Keys.PostQuantum) != 2592 || len(p.Keys.Classical) != 33 {
		return ErrInvalid
	}
	if (p.State == HybridEnforced || p.State == RecoveryPending) && p.EnforceHeight == 0 {
		return ErrInvalid
	}
	return nil
}

// TxVerifier only accepts the new dual-signed candidate envelope. Legacy input
// remains the original verifier's responsibility; it is never auto-upgraded.
type TxVerifier struct {
	Provider CryptoProvider
	Network  Network
}

func (v TxVerifier) Verify(p AuthPolicy, m TxMessage, s Signatures, height uint64) error {
	if v.Provider == nil || !networkValid(v.Network) || m.Network != v.Network || p.Validate() != nil || p.State != HybridEnforced || height < p.EnforceHeight || height > m.ExpiryHeight || p.Account != m.Account || p.Version != m.PolicyVersion || p.KeyVersion != m.KeyVersion {
		return ErrInvalid
	}
	raw, err := m.CanonicalBytes()
	if err != nil {
		return err
	}
	return v.Provider.VerifyAccount(p.Keys, raw, s)
}

func (p AuthPolicy) AllowsLegacyAt(height uint64) bool {
	if p.Validate() != nil {
		return false
	}
	return p.State == Legacy || p.State == PQRegistered || p.State == HybridEnforced && height < p.EnforceHeight
}

// TransitionProof is opaque: a caller cannot substitute boolean assertions for
// actual dual authentication. The original state transaction still consumes
// its nonce atomically; this read-only module does not persist or consume it.
type TransitionProof struct {
	policyHash    [32]byte
	next          PolicyState
	nonce, expiry uint64
	valid         bool
	request       MigrationRequest
}
type MigrationRequest struct {
	Network                                        Network
	Account                                        [20]byte
	PolicyVersion, KeyVersion, Nonce, ExpiryHeight uint64
	Next                                           PolicyState
	NewPQKey                                       []byte
	ExplicitEnable                                 bool
}

func policyHash(p AuthPolicy) [32]byte {
	var b bytes.Buffer
	b.Write(p.Account[:])
	b.WriteByte(byte(p.State))
	put64(&b, p.Version)
	put64(&b, p.KeyVersion)
	put64(&b, p.EnforceHeight)
	blob(&b, p.Keys.Classical)
	blob(&b, p.Keys.PostQuantum)
	return sha256.Sum256(b.Bytes())
}
func (m MigrationRequest) CanonicalBytes() ([]byte, error) {
	if !networkValid(m.Network) || !nonzero(m.Account[:]) || m.PolicyVersion == 0 || m.KeyVersion == 0 || m.Nonce == 0 || m.ExpiryHeight == 0 || m.Next < PQRegistered || m.Next > RecoveryPending || len(m.NewPQKey) != 0 && len(m.NewPQKey) != 2592 {
		return nil, ErrInvalid
	}
	var b bytes.Buffer
	blob(&b, []byte("YNX/EXPERIMENT/ACCOUNT-MIGRATION/V2"))
	put16(&b, EnvelopeVersion)
	networkBytes(&b, m.Network)
	b.Write(m.Account[:])
	put64(&b, m.PolicyVersion)
	put64(&b, m.KeyVersion)
	put64(&b, m.Nonce)
	put64(&b, m.ExpiryHeight)
	b.WriteByte(byte(m.Next))
	blob(&b, m.NewPQKey)
	if m.ExplicitEnable {
		b.WriteByte(1)
	} else {
		b.WriteByte(0)
	}
	return b.Bytes(), nil
}
func (v TxVerifier) VerifyTransition(p AuthPolicy, m MigrationRequest, s Signatures, newPossession []byte, height, expectedNonce uint64) (TransitionProof, error) {
	var zero TransitionProof
	if v.Provider == nil || p.Validate() != nil || m.Network != v.Network || m.Account != p.Account || m.PolicyVersion != p.Version || m.KeyVersion != p.KeyVersion || height == 0 || height > m.ExpiryHeight || m.Nonce != expectedNonce {
		return zero, ErrInvalid
	}
	keys := p.Keys
	switch {
	case p.State == Legacy && m.Next == PQRegistered:
		if len(m.NewPQKey) != 2592 || m.ExplicitEnable || len(newPossession) != 0 {
			return zero, ErrInvalid
		}
		keys = PublicKeys{Classical: p.Keys.Classical, PostQuantum: m.NewPQKey}
	case p.State == PQRegistered && m.Next == HybridEnforced:
		if !m.ExplicitEnable || len(m.NewPQKey) != 0 || len(newPossession) != 0 {
			return zero, ErrInvalid
		}
	case p.State == HybridEnforced && m.Next == RecoveryPending:
		if len(m.NewPQKey) != 0 || m.ExplicitEnable || len(newPossession) != 0 {
			return zero, ErrInvalid
		}
	case p.State == RecoveryPending && m.Next == HybridEnforced:
		if len(m.NewPQKey) != 2592 || !m.ExplicitEnable {
			return zero, ErrInvalid
		}
	default:
		return zero, ErrInvalid
	}
	raw, err := m.CanonicalBytes()
	if err != nil {
		return zero, err
	}
	if err = v.Provider.VerifyAccount(keys, raw, s); err != nil {
		return zero, err
	}
	if p.State == RecoveryPending && !verifyPQ(m.NewPQKey, raw, newPossession, AccountContext) {
		return zero, ErrInvalid
	}
	// Retain the exact authorized request independently of caller-owned slices.
	m.NewPQKey = append([]byte(nil), m.NewPQKey...)
	return TransitionProof{policyHash: policyHash(p), next: m.Next, nonce: m.Nonce, expiry: m.ExpiryHeight, valid: true, request: m}, nil
}
func Transition(p AuthPolicy, next PolicyState, proof TransitionProof, height, expectedNonce uint64) error {
	if !proof.valid || p.Validate() != nil || proof.policyHash != policyHash(p) || proof.next != next || proof.nonce != expectedNonce || height == 0 || height > proof.expiry {
		return ErrInvalid
	}
	return nil
}

// AuthorizedMigration returns only the exact signed request. A state adapter
// must use this result, not substitute a caller-supplied new key after proof.
// Nonce consumption and policy update still belong to one committed transaction.
func AuthorizedMigration(p AuthPolicy, proof TransitionProof, height, expectedNonce uint64) (MigrationRequest, error) {
	if err := Transition(p, proof.next, proof, height, expectedNonce); err != nil {
		return MigrationRequest{}, err
	}
	m := proof.request
	m.NewPQKey = append([]byte(nil), m.NewPQKey...)
	return m, nil
}

type Validator struct {
	ID         [20]byte
	KeyVersion uint64
	Power      uint64
	Keys       PublicKeys
}
type Vote struct {
	Message    ConsensusMessage
	Signatures Signatures
}
type ConsensusVerifier struct{ Provider CryptoProvider }

func (v ConsensusVerifier) VerifyVote(set []Validator, vote Vote, expected Network, height uint64, round uint32, kind ConsensusKind, original []byte) (uint64, error) {
	if v.Provider == nil || vote.Message.Network != expected || vote.Message.Height != height || vote.Message.Round != round || vote.Message.Kind != kind || !bytes.Equal(vote.Message.OriginalSignBytes, original) {
		return 0, ErrInvalid
	}
	var selected *Validator
	for i := range set {
		if set[i].ID == vote.Message.Validator {
			if selected != nil {
				return 0, ErrInvalid
			}
			selected = &set[i]
		}
	}
	if selected == nil || selected.Power == 0 || selected.KeyVersion != vote.Message.KeyVersion {
		return 0, ErrInvalid
	}
	raw, err := vote.Message.CanonicalBytes()
	if err != nil {
		return 0, err
	}
	if err = v.Provider.VerifyConsensus(selected.Keys, raw, vote.Signatures); err != nil {
		return 0, err
	}
	return selected.Power, nil
}

// Quorum counts each validator once only after both signatures on that same
// vote verify. Comparison avoids multiplication overflow, preserving >2/3.
func (v ConsensusVerifier) VerifyQuorum(set []Validator, votes []Vote, n Network, h uint64, r uint32, k ConsensusKind, original []byte) error {
	var total, valid uint64
	seenSet := map[[20]byte]bool{}
	seenVotes := map[[20]byte]bool{}
	for _, x := range set {
		if seenSet[x.ID] || !nonzero(x.ID[:]) || x.Power == 0 || ^uint64(0)-total < x.Power {
			return ErrInvalid
		}
		seenSet[x.ID] = true
		total += x.Power
	}
	if total == 0 || len(votes) > len(set) {
		return ErrInvalid
	}
	for _, vote := range votes {
		id := vote.Message.Validator
		if seenVotes[id] {
			return ErrInvalid
		}
		seenVotes[id] = true
		power, err := v.VerifyVote(set, vote, n, h, r, k, original)
		if err != nil {
			return err
		}
		valid += power
	}
	threshold := total - total/3
	if total%3 == 0 {
		threshold++
	}
	if valid < threshold {
		return ErrInvalid
	}
	return nil
}
